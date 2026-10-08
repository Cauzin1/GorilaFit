# AGENTS.md — Gorila: Proof of Sweat

Hackathon CLOCK IN (Solana Mobile × Radiants). Submissão 12/10/2026, interno 11/10 à noite. Em dúvida de escopo: vale ponto no júri (IA 20 · SKR 20 · UX 15 · UI 15 · Inovação 15 · Ecossistema 15) ou na demo? Se não, não entra.

## Fontes de verdade

- `CLAUDE.md` = spec completa do programa, app e web. `README.md` = pitch + "O que é simulado".
- Docs conflitam com código? Vale o executável. Repo ainda sem código: siga `CLAUDE.md` à risca, não invente estrutura.

## Regras que o agente erraria

- **Solana: não confie na sua memória.** Antes de escrever Anchor, Token-2022, Mobile Wallet Adapter ou web3.js, consulte MCP `solana-mcp` (ver `.mcp.json`). Expo/React Native/libs: consulte `context7`.
- **Segredos nunca em código, logs ou commits.** Só em `.env` (gitignored; ver `.env.example`). `GYM_SECRET_KEY` e `VERIFIER_SECRET_KEY` (base58) só no servidor/Vercel — nunca no app. App só usa `EXPO_PUBLIC_*`.
- Responda e comente código em português. Nomes de código em inglês.
- Toda funcionalidade simulada nova entra na seção "O que é simulado" do `README.md`.
- Prazo manda: solução mais simples que funcione na demo. Sem abstração "pra depois".

## Arquitetura planejada (não criar outra)

- `/programs/golias_commit` — Anchor (Rust), devnet. PDAs: `Config["config"]`, `Gym["gym", gym_authority]`, `Commitment["commitment", user, start_ts]`, `CheckinNonce["checkin", commitment, nonce]`, Vault SKR com autoridade PDA `["vault"]`.
- `/app` — Expo + dev client (MWA não roda no Expo Go), Android/Seeker. Sem wallet própria: usa `transact` do MWA. Link do explorer (devnet) em toda tx confirmada.
- `/web` — Next.js no Vercel: `GET /gym/[id]` (scanner do tablet), `POST /api/gym/scan`, `POST /api/plan` (Groq Llama 3.3, JSON estrito), `POST /api/challenge/new`, `POST /api/challenge/submit` (Groq visão).
- `/scripts` — setup devnet (mints, config, academia teste).
- Moedas: mock SKR = SPL devnet (dinheiro em jogo). FitCoin = **Token-2022 NonTransferable**, mint authority = PDA do programa, gasta-se queimando. Nunca negociável — decisão produto/regulatória.

## Invariantes on-chain (não enfraquecer — é o pitch)

- QR é do **usuário** (`{commitment, nonce, ts}`, renova ~30s); quem escaneia é o **tablet fixo** (`GET /gym/[id]`). Nunca inverter.
- `check_in` / `check_out`: **signer = `gym_authority`** (academia assina e paga taxa). `attest_challenge`: signer = `Config.verifier_authority`. `settle`: permissionless, só após `end_ts`.
- Validações: `qr_ts` dentro de 60s do Clock; nonce inédito via `CheckinNonce`; 1 treino por unidade de período (`checkin_bitmask`); sem sessão aberta para entrar; saída só na **mesma academia** do check-in; `check_out` exige `challenge_passed == true` e `min_session_secs <= duração <= max_session_secs` (demo: `period_unit_secs` ~60, `min_session_secs` ~30; prod: 86400/2400; `max_session_secs` 14400). Estourou o máximo: zera sessão, treino não conta.
- Bônus: fixo `stake * bonus_bps / 10000` (padrão 1000 = 10%), limitado ao `pool_balance`. Sem coortes pró-rata (roadmap, não implementar).
- Desafio por foto: 1/sessão, momento + instrução aleatórios, só câmera do app (sem galeria), 5 min p/ responder. **Na dúvida aprova.** **Foto descartada após julgamento — nunca armazenar** (LGPD).

## Não fazer (vai p/ Roadmap do README)

Acelerômetro/expo-sensors, pose/rep-count, esquadrões, loja FitCoin, Health Connect, Supabase, login próprio, mainnet, coortes pró-rata.

## Comandos

```bash
anchor build && anchor test
anchor deploy --provider.cluster devnet
pnpm --filter scripts setup:devnet
cd app && npx expo run:android   # dev client, nunca Expo Go
cd web && pnpm dev
```

## Visual

Escuro índigo/roxo + dourado, ranks RPG (Recruta → Gorila), mascote gorila, tom coach/RPG (Duolingo/Discord). Animação curta celebratória em "+X FitCoin" e na liquidação.
Tokens espelhados: `app/src/theme.ts` ↔ `web/app/globals.css` (nada de hex solto). Fontes: Barlow Condensed (títulos) + Barlow (texto). Botões: fundo ouro + texto escuro (branco sobre ouro falha contraste). Alvos ≥48dp,viewport com device-width na web.

## Pronto (dia 4)

No Android sem tocar código: conectar → plano IA → apostar → 2+ treinos (entrada + desafio foto + saída via "tablet") → liquidar → SKR de volta com bônus no explorer.
