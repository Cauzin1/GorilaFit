import { Dumbbell } from "lucide-react";

export default function Home() {
  return (
    <main style={{ padding: 32, maxWidth: 640, margin: "0 auto" }}>
      <div
        role="img"
        aria-label="Marca Gorila: halter dourado"
        style={{
          width: 72,
          height: 72,
          borderRadius: 20,
          background: "var(--color-gold)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 16,
        }}
      >
        <Dumbbell size={40} color="var(--color-on-gold)" strokeWidth={2.5} />
      </div>
      <h1>Gorila: Proof of Sweat</h1>
      <p style={{ color: "var(--color-text-dim)" }}>
        Aposte SKR no seu próprio treino. Cumpra a semana e receba de volta com bônus.
      </p>
      <p>
        Tablet da academia: abra <code>/gym/[id]</code> com o endereço da conta Gym
        (impresso no setup da devnet).
      </p>
    </main>
  );
}
