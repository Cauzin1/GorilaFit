import { NextResponse } from "next/server";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  checkinNoncePda,
  connection,
  explorerLink,
  gymKeypair,
  loadProgram,
  programId,
  readCommitment,
  readFitcoinMint,
  SystemProgram,
} from "@/lib/solana";

// Decide entre check_in e check_out lendo o Commitment, monta a transação,
// assina com a chave da academia (GYM_SECRET_KEY) e envia.
// O usuário nunca assina aqui: signer = gym_authority (academia paga a taxa).
export async function POST(req: Request) {
  try {
    const { gymId, commitment, nonce, ts } = await req.json();
    if (!gymId || !commitment || typeof nonce !== "number" || typeof ts !== "number") {
      return NextResponse.json({ ok: false, error: "Payload inválido." }, { status: 400 });
    }
    const conn = connection();
    const pid = programId();
    const gym = gymKeypair();
    const commitmentPk = new PublicKey(commitment);
    const gymPk = new PublicKey(gymId);

    const { openSessionStart, user } = await readCommitment(conn, commitmentPk);
    const isEntry = openSessionStart === 0;

    const program = await loadProgram(conn, gym);
    const noncePda = checkinNoncePda(commitmentPk, BigInt(nonce), pid);
    const configPda = PublicKey.findProgramAddressSync([Buffer.from("config")], pid)[0];

    let signature: string;
    if (isEntry) {
      signature = await (program.methods as any)
        .checkIn(new anchor.BN(nonce), new anchor.BN(ts))
        .accounts({
          config: PublicKey.findProgramAddressSync([Buffer.from("config")], pid)[0],
          gymAuthority: gym.publicKey,
          gym: gymPk,
          commitment: commitmentPk,
          checkinNonce: noncePda,
          systemProgram: SystemProgram.programId,
        })
        .signers([gym])
        .rpc();
      return NextResponse.json({
        ok: true,
        kind: "check_in",
        signature,
        explorer: explorerLink(signature),
      });
    }
    // Saída: programa valida mesma academia, challenge_passed e janela de sessão.
    // O contexto CheckOut exige ainda: PDA config (mint authority do FitCoin),
    // fitcoin_mint, ATA do usuário (init_if_needed, paga pela academia) e programas de token.
    const fitcoinMint = await readFitcoinMint(conn, configPda);
    const userAta = getAssociatedTokenAddressSync(fitcoinMint, user, false, TOKEN_2022_PROGRAM_ID);
    signature = await (program.methods as any)
      .checkOut(new anchor.BN(nonce), new anchor.BN(ts))
      .accounts({
        config: configPda,
        configAuthority: configPda,
        gymAuthority: gym.publicKey,
        gym: gymPk,
        commitment: commitmentPk,
        checkinNonce: noncePda,
        fitcoinMint,
        userFitcoinAccount: userAta,
        commitmentUser: user,
        tokenProgram2022: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([gym])
      .rpc();
    return NextResponse.json({
      ok: true,
      kind: "check_out",
      signature,
      explorer: explorerLink(signature),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro desconhecido";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
