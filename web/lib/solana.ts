// Helpers de servidor: lê Commitment on-chain e monta check_in/check_out.
// Chaves GYM_SECRET_KEY e VERIFIER_SECRET_KEY: só aqui no servidor, nunca no app.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import bs58 from "bs58";

export function connection() {
  return new Connection(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
}

export function programId() {
  return new PublicKey(process.env.PROGRAM_ID!);
}

export function gymKeypair() {
  return Keypair.fromSecretKey(bs58.decode(process.env.GYM_SECRET_KEY!));
}

export function verifierKeypair() {
  return Keypair.fromSecretKey(bs58.decode(process.env.VERIFIER_SECRET_KEY!));
}

export function explorerLink(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

// AnchorProvider só precisa de publicKey/signTransaction/signAllTransactions.
// `anchor.Wallet` não existe no pacote — esta classe mínima assina com o Keypair.
export class ServerWallet {
  readonly payer: Keypair;
  constructor(payer: Keypair) {
    this.payer = payer;
  }
  get publicKey() {
    return this.payer.publicKey;
  }
  signTransaction<T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(tx: T) {
    if (tx instanceof anchor.web3.Transaction) tx.partialSign(this.payer);
    else tx.sign([this.payer]);
    return Promise.resolve(tx);
  }
  signAllTransactions<T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(txs: T[]) {
    txs.forEach((tx) => {
      if (tx instanceof anchor.web3.Transaction) tx.partialSign(this.payer);
      else tx.sign([this.payer]);
    });
    return Promise.resolve(txs);
  }
}

export async function loadProgram(conn: Connection, keypair: Keypair) {
  const provider = new anchor.AnchorProvider(conn, new ServerWallet(keypair), { commitment: "confirmed" });
  const idlPath = join(process.cwd(), "..", "target", "idl", "golias_commit.json");
  if (!existsSync(idlPath)) throw new Error("IDL ausente. Rode `anchor build` primeiro.");
  const idl = JSON.parse(readFileSync(idlPath, "utf8"));
  return new anchor.Program(idl, provider);
}

export async function readCommitment(conn: Connection, commitment: PublicKey) {
  const info = await conn.getAccountInfo(commitment);
  if (!info) throw new Error("Compromisso não encontrado.");
  // Layout mínimo: discriminator(8) + user(32) + target(1) + completed(1) + stake(8)
  // + start(8) + end(8) + bitmask(8) + open_session_start(8) + open_session_gym(32)
  // + challenge(1) + status(1) + bump(1). open_session_start offset = 74.
  const openSessionStart = info.data.readBigInt64LE(74);
  const user = new PublicKey(info.data.subarray(8, 40));
  return { openSessionStart: Number(openSessionStart), user };
}

// Lê o fitcoin_mint guardado na Config (bytes 104–136 do layout).
export async function readFitcoinMint(conn: Connection, config: PublicKey) {
  const info = await conn.getAccountInfo(config);
  if (!info) throw new Error("Config não encontrada. Rode o setup da devnet.");
  return new PublicKey(info.data.subarray(104, 136));
}

export function checkinNoncePda(commitment: PublicKey, nonce: bigint, pid: PublicKey) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(nonce);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("checkin"), commitment.toBuffer(), buf],
    pid,
  )[0];
}

export { SystemProgram };
