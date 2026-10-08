// Store em memória dos desafios sorteados (demo; reiniciar o servidor perde).
// Nunca guarda foto — só instrução + expiração. Separado das routes porque
// arquivos route.ts só podem exportar handlers HTTP.
interface Challenge {
  instruction: string;
  expiresAt: number;
}

const challenges = new Map<string, Challenge>();

export function saveChallenge(id: string, instruction: string, expiresAt: number) {
  challenges.set(id, { instruction, expiresAt });
}

export function getChallenge(id: string) {
  return challenges.get(id);
}
