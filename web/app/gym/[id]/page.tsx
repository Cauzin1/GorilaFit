"use client";
// Scanner fixo da recepção: lê o QR do USUÁRIO (nunca o contrário) e chama /api/gym/scan.
// QR do usuário: { commitment, nonce, ts } — renova a cada ~30s no app.
import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { CircleCheck, CircleX } from "lucide-react";

type ScanResult =
  | { ok: true; kind: "check_in" | "check_out"; signature: string; explorer: string }
  | { ok: false; error: string };

// Trava pós-leitura: sem isso o scanner (~10fps) reenvia o mesmo QR em rajada.
const COOLDOWN_MS = 4000;

export default function GymPage({ params }: { params: { id: string } }) {
  const gymId = params.id;
  const busyRef = useRef(false);
  const cooldownRef = useRef(false);
  const [status, setStatus] = useState("Aponte a câmera para o QR do usuário…");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [last, setLast] = useState<ScanResult | null>(null);
  const [cameraFailed, setCameraFailed] = useState(false);

  useEffect(() => {
    const scanner = new Html5Qrcode("gorila-qr-reader");
    let cancelled = false;
    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 250 },
        (decoded) => void onQr(decoded),
        () => {},
      )
      .catch(() => {
        if (!cancelled) setCameraFailed(true);
      });
    return () => {
      cancelled = true;
      void scanner.stop().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function lock() {
    busyRef.current = true;
    cooldownRef.current = true;
    setBusy(true);
    window.setTimeout(() => {
      cooldownRef.current = false;
      busyRef.current = false;
      setBusy(false);
    }, COOLDOWN_MS);
  }

  async function onQr(raw: string) {
    // Refs, não estado: o callback do scanner é registrado uma vez e
    // fecharia sobre um `busy` congelado (stale closure).
    if (busyRef.current || cooldownRef.current) return;
    let payload: { commitment: string; nonce: number; ts: number };
    try {
      payload = JSON.parse(raw);
      if (!payload.commitment || typeof payload.nonce !== "number") throw new Error("formato");
    } catch {
      setBanner({ tone: "error", text: "QR inválido. Mostre o QR do app Gorila." });
      return;
    }
    lock();
    setBanner(null);
    setStatus("Registrando on-chain…");
    try {
      const res = await fetch("/api/gym/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gymId, ...payload }),
      });
      const data = (await res.json()) as ScanResult;
      setLast(data);
      if (data.ok) {
        const text = data.kind === "check_in" ? "Entrada registrada. Bom treino!" : "Treino concluído + FitCoin!";
        setBanner({ tone: "success", text });
        setStatus(text);
      } else {
        setBanner({ tone: "error", text: `Erro: ${data.error}` });
        setStatus(`Erro: ${data.error}`);
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : "falha de rede";
      setLast({ ok: false, error });
      setBanner({ tone: "error", text: `Falha de rede. Tente de novo. (${error})` });
      setStatus("Falha de rede. Tente de novo.");
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 560, margin: "0 auto" }}>
      <h1>Recepção Gorila</h1>
      <p style={{ color: "var(--color-text-dim)" }}>
        Academia: <code>{gymId}</code>
      </p>

      {banner && (
        <div
          role={banner.tone === "error" ? "alert" : "status"}
          style={{
            padding: 20,
            borderRadius: 12,
            marginBottom: 16,
            fontSize: 20,
            fontWeight: 800,
            background: banner.tone === "success" ? "#14532d" : "#7f1d1d",
            color: "#ffffff",
            border: `3px solid ${banner.tone === "success" ? "var(--color-success)" : "var(--color-error)"}`,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          {banner.tone === "success" ? (
            <CircleCheck size={28} aria-hidden="true" />
          ) : (
            <CircleX size={28} aria-hidden="true" />
          )}
          <span>{banner.text}</span>
        </div>
      )}

      {cameraFailed ? (
        <p>Sem câmera neste aparelho. Use a entrada manual abaixo.</p>
      ) : (
        <div id="gorila-qr-reader" style={{ width: "100%" }} />
      )}
      <p aria-live="polite">{busy ? "Registrando on-chain…" : status}</p>

      {last?.ok && (
        <p>
          <a href={last.explorer} target="_blank" rel="noreferrer">
            Ver no explorer
          </a>
        </p>
      )}

      <details style={{ marginTop: 24 }}>
        <summary>Entrada manual (sem câmera)</summary>
        <ManualForm gymId={gymId} busy={busy} onQr={onQr} />
      </details>
    </main>
  );
}

function ManualForm({ gymId, busy, onQr }: { gymId: string; busy: boolean; onQr: (raw: string) => void }) {
  const [value, setValue] = useState("");
  const inputId = "gorila-manual-qr";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onQr(value);
      }}
    >
      <label htmlFor={inputId}>Conteúdo do QR do usuário</label>
      <input
        id={inputId}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder='{"commitment":"…","nonce":1,"ts":…}'
        autoComplete="off"
      />
      <div style={{ marginTop: 8 }}>
        <button type="submit" disabled={busy || value.trim() === ""}>
          {busy ? "Registrando…" : `Registrar (${gymId.slice(0, 6)}…)`}
        </button>
      </div>
    </form>
  );
}
