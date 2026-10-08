// Tokens do design system Gorila — única fonte de verdade para o app.
// Espelha web/app/globals.css. Nada de hex solto nos componentes.
//
// Contraste (texto normal ≥4.5:1 sobre --background):
// - text #f5f0e1 ≈ 15:1 · gold #d4a437 ≈ 8:1 · dim #b9b2d6 ≈ 7:1.
// Botões: fundo gold + texto escuro (branco sobre ouro daria ~2,2:1 — falha).
export const colors = {
  background: "#0f0d1d",
  surface: "#1d1933",
  surfaceBorder: "#3a3358",
  gold: "#d4a437",
  onGold: "#0f0d1d",
  text: "#f5f0e1",
  textDim: "#b9b2d6",
  success: "#4ade80",
  error: "#f87171",
} as const;

// Ritmo 4/8dp. Alvos de toque: 44pt iOS / 48dp Android.
export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const touchMin = 48;
export const radius = 12;

export const fonts = {
  display: "BarlowCondensed-Bold", // títulos esportivos (fallback: sistema, weight 900)
  body: "Barlow-Regular",
  bodyBold: "Barlow-SemiBold",
} as const;
