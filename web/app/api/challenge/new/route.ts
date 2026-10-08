import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { saveChallenge } from "@/lib/challenges";

// Sorteia o desafio da sessão: instrução aleatória + expiração de 5 min.
// Store em memória (demo; em produção usar banco). Nunca recebe foto aqui.
const INSTRUCTIONS = [
  "prancha mostrando 3 dedos",
  "agachamento com os braços para cima",
  "flexão com uma toalha na cabeça",
  "selfie pós-série mostrando 2 dedos",
  "alongamento lateral com sorriso",
];

export async function POST(req: Request) {
  const { commitment } = await req.json();
  if (!commitment) return NextResponse.json({ ok: false, error: "commitment ausente." }, { status: 400 });
  const instruction = INSTRUCTIONS[Math.floor(Math.random() * INSTRUCTIONS.length)];
  const challengeId = randomUUID();
  const expiresAt = Date.now() + 5 * 60 * 1000;
  saveChallenge(challengeId, instruction, expiresAt);
  return NextResponse.json({ ok: true, challengeId, instruction, expiresAt });
}
