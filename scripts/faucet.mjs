// Faucet de mock SKR: distribui tokens de teste aos endereços dos testadores.
// Uso: node faucet.mjs <DESTINO> [QUANTIDADE_SKR] [OUTRO_DESTINO ...]
// Requer SKR_MINT no .env e que a carteira local seja mint authority do mock SKR
// (verdadeiro quando o mock foi criado pelo setup-devnet.mjs nesta máquina).
import "dotenv/config";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
void ROOT;

async function main() {
  const [dest, ...rest] = process.argv.slice(2);
  if (!dest) {
    console.error("Uso: node faucet.mjs <DESTINO> [QUANTIDADE_SKR=10] [OUTROS...]");
    process.exit(1);
  }
  // Aceita quantidade como segundo arg se for número, senão assume 10 para todos.
  let amount = 10;
  let targets = [dest, ...rest];
  if (rest.length > 0 && !Number.isNaN(Number(rest[0]))) {
    amount = Number(rest[0]);
    targets = [dest, ...rest.slice(1)];
  }
  if (!process.env.SKR_MINT) {
    console.error("SKR_MINT ausente no .env. Rode o setup da devnet primeiro.");
    process.exit(1);
  }

  const connection = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  const provider = anchor.AnchorProvider.local(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com");
  const admin = provider.wallet.payer;
  const mint = new PublicKey(process.env.SKR_MINT);
  const { value } = (await connection.getTokenSupply(mint)).value;
  const raw = BigInt(Math.round(amount * 10 ** value.decimals));

  for (const t of targets) {
    const owner = new PublicKey(t);
    const ata = await getOrCreateAssociatedTokenAccount(connection, admin, mint, owner);
    const sig = await mintTo(connection, admin, mint, ata.address, admin.publicKey, raw);
    console.log(`${amount} mock SKR -> ${t}: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  }
}

main().catch((e) => {
  console.error("Faucet falhou:", e.message);
  process.exit(1);
});
