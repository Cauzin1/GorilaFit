// Transações do usuário via MWA: create_commitment e settle.
// O usuário assina e paga a taxa das próprias tx (check-in/out é a academia que assina).
// IDL em /idl/golias_commit.json (espelha programs/golias_commit/src/lib.rs).
import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import idlJson from "../../idl/golias_commit.json";
import { connection, signAndSend } from "./wallet";

const PROGRAM_ID = new PublicKey(process.env.EXPO_PUBLIC_PROGRAM_ID ?? "");
const SKR_MINT = new PublicKey(process.env.EXPO_PUBLIC_SKR_MINT ?? "");

function programFor(user: PublicKey) {
  // Wallet fictícia: só monta a tx (.transaction()), o envio é via transact (wallet.ts).
  const provider = new AnchorProvider(
    connection(),
    {
      publicKey: user,
      signTransaction: () => Promise.reject(new Error("Use signAndSend via MWA.")),
      signAllTransactions: () => Promise.reject(new Error("Use signAndSend via MWA.")),
    },
    { commitment: "confirmed" },
  );
  return new Program(idlJson as unknown as Idl, provider);
}

async function withBlockhash(tx: Transaction, user: PublicKey) {
  tx.feePayer = user;
  tx.recentBlockhash = (await connection().getLatestBlockhash()).blockhash;
  return tx;
}

function commitmentPda(user: PublicKey, startTs: number) {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(BigInt(startTs));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("commitment"), user.toBuffer(), buf],
    PROGRAM_ID,
  )[0];
}

function configPda() {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];
}

function vaultPda() {
  return PublicKey.findProgramAddressSync([Buffer.from("vault-token")], PROGRAM_ID)[0];
}

async function skrDecimals(): Promise<number> {
  const supply = await connection().getTokenSupply(SKR_MINT);
  return supply.value.decimals;
}

export interface CreateResult {
  commitment: string;
  signature: string;
}

// Trava SKR no Vault. stakeSkr em SKR (converte para unidades base via decimais do mint).
// startTs vai nos seeds do PDA e precisa estar a ±60s do Clock on-chain na confirmação:
// a tx é montada e assinada em seguida, mas se a wallet demorar, tente de novo.
export async function createCommitment(
  user: PublicKey,
  targetWorkouts: number,
  stakeSkr: number,
  durationUnits: number,
): Promise<CreateResult> {
  const decimals = await skrDecimals();
  const stakeAmount = BigInt(Math.round(stakeSkr * 10 ** decimals));
  if (stakeAmount <= 0n) throw new Error("Stake precisa ser maior que zero.");

  const userAta = getAssociatedTokenAddressSync(SKR_MINT, user);
  const balance = await connection().getTokenAccountBalance(userAta).catch(() => null);
  const have = balance ? BigInt(balance.value.amount) : 0n;
  if (have < stakeAmount) {
    throw new Error(`Saldo insuficiente: você tem ${balance?.value.uiAmountString ?? "0"} SKR. Peça mock SKR ao organizador.`);
  }

  const startTs = Math.floor(Date.now() / 1000);
  const commitment = commitmentPda(user, startTs);
  const program = programFor(user);
  const tx = await program.methods
    .createCommitment(new BN(startTs), targetWorkouts, new BN(stakeAmount.toString()), durationUnits)
    .accounts({
      config: configPda(),
      user,
      commitment,
      userSkrAccount: userAta,
      vault: vaultPda(),
      skrMint: SKR_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .transaction();
  const signature = await signAndSend(await withBlockhash(tx, user));
  await connection().confirmTransaction(signature, "confirmed");
  return { commitment: commitment.toBase58(), signature };
}

// Liquida após end_ts (permissionless). Cria a ATA SKR se ainda não existir.
export async function settleCommitment(user: PublicKey, commitment: PublicKey): Promise<string> {
  const program = programFor(user);
  const userAta = getAssociatedTokenAddressSync(SKR_MINT, user);
  const tx = new Transaction();
  const ataInfo = await connection().getAccountInfo(userAta);
  if (!ataInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(user, userAta, user, SKR_MINT, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
    );
  }
  const settleIx = await program.methods
    .settle()
    .accounts({
      config: configPda(),
      vaultAuthority: PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID)[0],
      vault: vaultPda(),
      commitment,
      userSkrAccount: userAta,
      skrMint: SKR_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  tx.add(settleIx);
  const signature = await signAndSend(await withBlockhash(tx, user));
  await connection().confirmTransaction(signature, "confirmed");
  return signature;
}
