import { NextResponse } from "next/server";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { getChallenge } from "@/lib/challenges";
import {
  connection,
  explorerLink,
  loadProgram,
  programId,
  verifierKeypair,
} from "@/lib/solana";

// Julga a foto com modelo de visão (Groq), descarta a imagem e, se aprovado,
// assina attest_challenge com VERIFIER_SECRET_KEY.
// LGPD: a foto nunca é armazenada — só vive nesta requisição. Na dúvida, aprova.
export async function POST(req: Request) {
  let imageBase64: string | null = null;
  try {
    const { challengeId, commitment, imageBase64: img } = await req.json();
    imageBase64 = img ?? null;
    if (!challengeId || !commitment || !imageBase64) {
      return NextResponse.json({ ok: false, error: "challengeId, commitment e foto obrigatórios." }, { status: 400 });
    }
    const challenge = getChallenge(challengeId);
    if (!challenge) return NextResponse.json({ ok: false, error: "Desafio expirado ou inválido." }, { status: 400 });
    if (Date.now() > challenge.expiresAt) {
      return NextResponse.json({ ok: false, error: "Tempo esgotado (5 min)." }, { status: 400 });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return NextResponse.json({ ok: false, error: "GROQ_API_KEY ausente." }, { status: 500 });

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "qwen/qwen3.8-27b",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'Você julga o desafio do treino. Responda APENAS JSON: {"passed": true/false, "confidence": 0-1, "reason": "curta"}. NA DÚVIDA APROVE (falso negativo custa dinheiro de usuário honesto).',
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Instrução do desafio: ${challenge.instruction}` },
              { type: "image_url", image_url: { url: imageBase64 } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Groq: ${res.status}`);
    const data = await res.json();
    const verdict = JSON.parse(data.choices[0].message.content) as {
      passed: boolean;
      confidence: number;
      reason: string;
    };
    // Na dúvida aprova: confiança baixa vira aprovação.
    const passed = verdict.passed || verdict.confidence < 0.5;

    let signature: string | null = null;
    if (passed) {
      const conn = connection();
      const verifier = verifierKeypair();
      const program = await loadProgram(conn, verifier);
      const pid = programId();
      signature = await (program.methods as any)
        .attestChallenge()
        .accounts({
          config: PublicKey.findProgramAddressSync([Buffer.from("config")], pid)[0],
          verifierAuthority: verifier.publicKey,
          commitment: new PublicKey(commitment),
        })
        .signers([verifier])
        .rpc();
    }
    return NextResponse.json({
      ok: true,
      passed,
      reason: verdict.reason,
      signature,
      explorer: signature ? explorerLink(signature) : null,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "erro desconhecido" },
      { status: 400 },
    );
  } finally {
    // Descarta a foto: zera a referência antes de sair.
    imageBase64 = null;
  }
}
