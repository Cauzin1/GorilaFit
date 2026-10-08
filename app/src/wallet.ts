// Cliente MWA: conecta a wallet do Seeker via `transact`. Não gera wallet própria.
// Toda tx confirmada retorna link do explorer (devnet).
import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

const RPC_URL = process.env.EXPO_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";
const APP_IDENTITY = { name: "Gorila: Proof of Sweat" };

export function connection() {
  return new Connection(RPC_URL, "confirmed");
}

export async function connectWallet(): Promise<PublicKey> {
  const auth = await transact(async (wallet) => {
    return await wallet.authorize({ identity: APP_IDENTITY, cluster: "devnet" });
  });
  const key = auth.accounts[0]?.address;
  if (!key) throw new Error("Wallet não autorizou.");
  return new PublicKey(Buffer.from(key, "base64"));
}

// Assina via MWA e devolve a assinatura no formato padrão (base58).
export async function signAndSend(tx: Transaction): Promise<string> {
  const signatures = await transact(async (wallet) => {
    await wallet.authorize({ identity: APP_IDENTITY, cluster: "devnet" });
    return await wallet.signAndSendTransactions({ transactions: [tx] });
  });
  const raw = signatures[0] as unknown;
  if (typeof raw === "string") return raw;
  return bs58.encode(Buffer.from(raw as Uint8Array));
}

export function explorerTx(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}
