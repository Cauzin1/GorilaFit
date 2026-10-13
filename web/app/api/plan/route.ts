import { NextResponse } from "next/server";

// Gera a meta semanal com Groq (gpt-oss-120b), resposta em JSON estrito.
// Entrada: { level, history } — nível do usuário + resumo do histórico.
// Saída: { targetWorkouts, durationUnits, suggestion }.
export async function POST(req: Request) {
  try {
    const { level, history } = await req.json();
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return NextResponse.json({ ok: false, error: "GROQ_API_KEY ausente." }, { status: 500 });

    const system = [
      "Você é o coach Gorila (tom RPG motivador, direto).",
      "Responda APENAS com JSON válido, sem markdown: ",
      '{"targetWorkouts": <2-6>, "durationUnits": 7, "suggestion": "<frase curta de treino>"}',
      "targetWorkouts entre 2 e 6 conforme o nível. durationUnits sempre 7.",
    ].join(" ");
    const user = `Nível: ${level ?? "Recruta"}. Histórico: ${history ?? "sem histórico"}.`;

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Groq: ${res.status}`);
    const data = await res.json();
    const plan = JSON.parse(data.choices[0].message.content);
    return NextResponse.json({ ok: true, plan });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "erro desconhecido" },
      { status: 400 },
    );
  }
}
