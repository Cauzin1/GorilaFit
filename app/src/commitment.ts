// Leitura do Commitment on-chain (sem assinatura — só RPC).
// Offsets seguem programs/golias_commit/src/lib.rs:
// user(8+32) target(40) completed(41) stake(42) start(50) end(58)
// bitmask(66) open_session(74) gym(82) challenge(114) status(115).
import { PublicKey } from "@solana/web3.js";
import { connection } from "./wallet";

export type CommitmentStatus = "Active" | "Won" | "Lost";

export interface CommitmentState {
  target: number;
  completed: number;
  stakeLamports: bigint;
  endTs: number;
  sessionOpen: boolean;
  status: CommitmentStatus;
}

export async function readCommitmentState(address: string): Promise<CommitmentState> {
  const info = await connection().getAccountInfo(new PublicKey(address));
  if (!info) throw new Error("Compromisso não encontrado on-chain.");
  const d = info.data;
  const statusByte = d[115] ?? 0;
  return {
    target: d[40] ?? 0,
    completed: d[41] ?? 0,
    stakeLamports: BigInt(d.readBigUInt64LE(42)),
    endTs: Number(d.readBigInt64LE(58)),
    sessionOpen: d.readBigInt64LE(74) !== 0n,
    status: statusByte === 1 ? "Won" : statusByte === 2 ? "Lost" : "Active",
  };
}
