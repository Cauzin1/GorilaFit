// QR do usuário: { commitment, nonce, ts }. Renova a cada 30s.
// O TABLET escaneia este QR (nunca o contrário). Nonce aleatório por renovação.
// Expõe `secondsLeft` para a contagem regressiva visível (o QR nunca troca em silêncio).
import { useEffect, useState } from "react";

export const QR_RENEW_SECS = 30;

export interface UserQr {
  commitment: string;
  nonce: number;
  ts: number;
}

function freshQr(commitment: string): UserQr {
  return {
    commitment,
    nonce: Math.floor(Math.random() * 2 ** 31),
    ts: Math.floor(Date.now() / 1000),
  };
}

export function useUserQr(commitment: string | null) {
  const [qr, setQr] = useState<UserQr | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(QR_RENEW_SECS);

  useEffect(() => {
    if (!commitment) {
      setQr(null);
      setSecondsLeft(QR_RENEW_SECS);
      return;
    }
    setQr(freshQr(commitment));
    setSecondsLeft(QR_RENEW_SECS);
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          setQr(freshQr(commitment));
          return QR_RENEW_SECS;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [commitment]);

  return { qr, secondsLeft };
}
