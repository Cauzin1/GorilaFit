// Setup da devnet: mints (mock SKR + FitCoin), config e academia de teste.
// Uso: cp .env.example .env (preencha PROGRAM_ID) e rode `npm run setup:devnet --workspace scripts`.
// Lê/escreve .env na raiz. Segredos nunca vão para logs ou commits.
//
// Ordem: mock SKR (SPL) -> FitCoin (Token-2022 NonTransferable, mint authority = PDA config)
// -> initialize_config -> register_gym (academia de teste).
import dotenv from "dotenv";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createInitializeNonTransferableMintInstruction,
  createInitializeMintInstruction,
  getMintLen,
  ExtensionType,
} from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import bs58 from "bs58";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = join(ROOT, ".env");
// Carrega o .env da raiz independente do cwd (npm --workspace roda em scripts/).
dotenv.config({ path: ENV_PATH });

function loadEnv() {
  // dotenv já carregou; garante chaves obrigatórias de servidor.
  const required = ["GYM_SECRET_KEY", "VERIFIER_SECRET_KEY"];
  for (const k of required) {
    if (!process.env[k]) {
      console.error(`Faltando ${k} no .env (base58, só no servidor). Veja .env.example.`);
      process.exit(1);
    }
  }
}

function saveEnv(pairs) {
  let content = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  for (const [k, v] of Object.entries(pairs)) {
    const line = `${k}=${v}`;
    if (new RegExp(`^${k}=.*$`, "m").test(content)) {
      content = content.replace(new RegExp(`^${k}=.*$`, "m"), line);
    } else {
      content += (content.endsWith("\n") || content === "" ? "" : "\n") + line + "\n";
    }
  }
  writeFileSync(ENV_PATH, content);
  console.log(`.env atualizado: ${Object.keys(pairs).join(", ")}`);
}

const explorer = (addr, cluster = "devnet") =>
  `https://explorer.solana.com/address/${addr}?cluster=${cluster}`;

async function main() {
  loadEnv();
  const rpc = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const connection = new Connection(rpc, "confirmed");
  const programId = new PublicKey(process.env.PROGRAM_ID);
  console.log("Programa:", programId.toBase58(), explorer(programId.toBase58()));

  // Admin = carteira local (paga criação de mints e config).
  // anchor.Wallet não existe no pacote: AnchorProvider.local usa NodeWallet.
  const provider = anchor.AnchorProvider.local(rpc);
  const admin = provider.wallet.payer;
  console.log("Admin:", admin.publicKey.toBase58());
  const bal = await connection.getBalance(admin.publicKey);
  console.log("Saldo admin:", bal / 1e9, "SOL");
  if (bal < 0.2 * 1e9) {
    console.log("Sem SOL suficiente. Rode: solana airdrop 2 --url devnet");
  }

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
  const [vaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from("vault")], programId);
  console.log("Config PDA:", configPda.toBase58());
  console.log("Vault authority PDA:", vaultAuthority.toBase58());

  // 1) mock SKR (SPL clássico, 6 decimais — imita o SKR real).
  let skrMint = process.env.SKR_MINT ? new PublicKey(process.env.SKR_MINT) : null;
  if (!skrMint) {
    console.log("Criando mock SKR (SPL)...");
    skrMint = await createMint(connection, admin, admin.publicKey, null, 6);
    console.log("SKR_MINT:", skrMint.toBase58(), explorer(skrMint.toBase58()));
    saveEnv({ SKR_MINT: skrMint.toBase58(), EXPO_PUBLIC_SKR_MINT: skrMint.toBase58() });
  }

  // 2) FitCoin (Token-2022 NonTransferable, decimals 0, mint authority = PDA config).
  // Criado manualmente porque o authority é um PDA (só o programa assina por ele).
  let fitcoinMint = process.env.FITCOIN_MINT ? new PublicKey(process.env.FITCOIN_MINT) : null;
  if (!fitcoinMint) {
    console.log("Criando FitCoin (Token-2022 NonTransferable)...");
    const mintKeypair = Keypair.generate();
    const extensions = [ExtensionType.NonTransferable];
    const mintLen = getMintLen(extensions);
    const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);
    const tx = new anchor.web3.Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeNonTransferableMintInstruction(mintKeypair.publicKey, TOKEN_2022_PROGRAM_ID),
      createInitializeMintInstruction(
        mintKeypair.publicKey,
        0,
        configPda, // mint authority = PDA do programa (só check_out minta)
        configPda, // freeze authority = PDA do programa
        TOKEN_2022_PROGRAM_ID,
      ),
    );
    await anchor.web3.sendAndConfirmTransaction(connection, tx, [admin, mintKeypair]);
    fitcoinMint = mintKeypair.publicKey;
    console.log("FITCOIN_MINT:", fitcoinMint.toBase58(), explorer(fitcoinMint.toBase58()));
    saveEnv({ FITCOIN_MINT: fitcoinMint.toBase58(), EXPO_PUBLIC_FITCOIN_MINT: fitcoinMint.toBase58() });
  }

  // 3) initialize_config + 4) register_gym via Anchor.
  const anchorProvider = new anchor.AnchorProvider(connection, provider.wallet, { commitment: "confirmed" });
  // IDL gerado por `anchor build` em target/idl/golias_commit.json.
  const idlPath = join(ROOT, "target", "idl", "golias_commit.json");
  if (!existsSync(idlPath)) {
    console.log("IDL não encontrado. Rode `anchor build` e depois este script de novo.");
    console.log("Mints já criados e salvos no .env.");
    return;
  }
  const idl = JSON.parse(readFileSync(idlPath, "utf8"));
  const program = new anchor.Program(idl, anchorProvider);

  const [vaultToken] = PublicKey.findProgramAddressSync([Buffer.from("vault-token")], programId);
  const configInfo = await connection.getAccountInfo(configPda);
  if (!configInfo) {
    console.log("Chamando initialize_config (demo: period ~60s, sessão mín ~30s)...");
    const verifier = Keypair.fromSecretKey(bs58.decode(process.env.VERIFIER_SECRET_KEY));
    await program.methods
      .initializeConfig(1000, new anchor.BN(1), new anchor.BN(60), new anchor.BN(30), new anchor.BN(14400))
      .accounts({
        admin: admin.publicKey,
        verifierAuthority: verifier.publicKey,
        skrMint,
        fitcoinMint,
        config: configPda,
        vaultAuthority,
        vault: vaultToken,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
    console.log("Config criada:", explorer(configPda.toBase58()));
    saveEnv({ EXPO_PUBLIC_PROGRAM_ID: programId.toBase58() });
  } else {
    console.log("Config já existe, pulando initialize_config.");
  }

  // 4) Academia de teste (tablet). Chave GYM_SECRET_KEY assina check-in/out.
  const gymKey = Keypair.fromSecretKey(bs58.decode(process.env.GYM_SECRET_KEY));
  const [gymPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("gym"), gymKey.publicKey.toBuffer()],
    programId,
  );
  const gymInfo = await connection.getAccountInfo(gymPda);
  if (!gymInfo) {
    console.log("Registrando academia de teste...");
    await program.methods
      .registerGym("Academia Gorila (teste)")
      .accounts({
        config: configPda,
        admin: admin.publicKey,
        gymAuthority: gymKey.publicKey,
        gym: gymPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
    console.log("Academia:", gymPda.toBase58(), explorer(gymPda.toBase58()));
  } else {
    console.log("Academia de teste já existe.");
  }

  // 5) Airdrop de mock SKR para a academia (não precisa) e instrução final.
  console.log("\nPronto. Tablet do teste: /gym/" + gymPda.toBase58());
  console.log("Distribua mock SKR aos testadores com spl-token mint + transfer.");
  void getOrCreateAssociatedTokenAccount;
  void mintTo;
  void TOKEN_2022_PROGRAM_ID;
}

main().catch((e) => {
  console.error("Falha no setup:", e.message);
  process.exit(1);
});
