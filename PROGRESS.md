# Gorila — estado da sessão (08/10/2026, madrugada)

Sessão anterior cobriu: scaffold completo → auditoria UI/UX → auditoria QA → fiação on-chain no app.
Tudo que foi validado está marcado abaixo. Nada foi commitado (branch `main` ainda sem commits).

## Pronto e validado

- **Programa** `programs/golias_commit/src/lib.rs`: 7 instruções com todos os invariantes
  (signer academia/verificador, QR 60s, nonce anti-replay, bitmask, mesma academia na saída,
  janela min/max, bônus fixo limitado ao pool, mint FitCoin via PDA `config`).
  Fixes QA aplicados: `nonce` (não `_nonce`) no `check_out`, constraints de destino no `settle`
  (+ erro `WrongUserAccount`), space exato do Commitment (117), program id válido.
- **IDL** `idl/golias_commit.json`: escrita à mão espelhando a `lib.rs`. ATENÇÃO: conferir contra
  `target/idl/golias_commit.json` após o primeiro `anchor build`; se divergir, atualizar o app.
- **Scripts**: `setup-devnet.mjs` (mints + config + academia teste) e `faucet.mjs`
  (`node faucet.mjs <ENDEREÇO> [QTD]`). Ambos passam em `node --check`.
- **Web**: `next build` verde. Scanner `/gym/[id]` sem stale closure (refs + cooldown 4s +
  banner sucesso/erro), 4 APIs (`gym/scan` com contexto `checkOut` completo,
  `plan`, `challenge/new`, `challenge/submit` com foto descartada).
  `ServerWallet` em `web/lib/solana.ts` (anchor não exporta `Wallet`).
- **App**: `tsc` limpo. Fluxo completo via MWA: conectar → plano IA → apostar
  (`createCommitment` real) → QR com countdown + progresso on-chain real → desafio
  (captura + submit + animação +FitCoin) → liquidar (`settle` real + animação de vitória).
  `signAndSend` devolve assinatura base58 (estava base64 — links quebrados).
- **Design system**: tokens `app/src/theme.ts` ↔ `web/app/globals.css`, Barlow Condensed/Barlow
  (TTFs em `app/assets/fonts/`, Google Fonts na web), `AGENTS.md` atualizado.
- **Docs**: `README.md` "O que é simulado" atualizado (inclui store em memória + program id).

## IDs e parâmetros (demo)

- Program id: `9Aa5qLry7p6rtJhevZ3ugFyffGqffvvcgEmdTq4LX75Z` (`declare_id!` + `Anchor.toml`).
- ⚠️ Keypair gerado em `/tmp/golias-keypair.json` — TEMPORÁRIO, `/tmp` pode ter sumido.
  Antes do deploy real: `solana-keygen new -o target/deploy/golias_commit-keypair.json`
  e atualizar `declare_id!` + `Anchor.toml` + `.env` (`PROGRAM_ID` + `EXPO_PUBLIC_PROGRAM_ID`).
- Demo: `period_unit_secs=60`, `min_session_secs=30`, `max_session_secs=14400`,
  `bonus_bps=1000`, `fitcoin_per_workout=1`. `.env` ainda NÃO criado (só `.env.example`).

## O que NUNCA rodou aqui (sem Rust/Solana/Anchor/pnpm nesta máquina)

`anchor build`, `anchor test`, `anchor deploy`, `setup:devnet`, teste no Seeker/tablet.
Auditoria da `lib.rs` foi manual e rigorosa, mas o build é confirmação obrigatória.

## Próximos passos (nesta ordem)

1. Toolchain: Rust → Solana CLI → Anchor (`avm`) → `solana airdrop 2 --url devnet`.
2. Keypair definitivo (ver ATM acima) + `anchor build` → comparar IDL gerada com `/idl`.
3. `anchor deploy --provider.cluster devnet` → preencher `.env` (copiar de `.env.example`:
   `PROGRAM_ID`, `SKR_MINT`, `FITCOIN_MINT`, `GYM_SECRET_KEY`, `VERIFIER_SECRET_KEY`,
   `GROQ_API_KEY`, `EXPO_PUBLIC_*`).
4. `npm run setup:devnet` → anotar endereço da Gym (URL do tablet `/gym/[ID]`).
5. `npm run faucet -- <endereços dos testadores>` (+ SOL via airdrop p/ academia e testadores).
6. Subir web (Vercel com envs de servidor) → `EXPO_PUBLIC_API_URL` no app.
7. `cd app && npx expo run:android` (dev client, nunca Expo Go) → fluxo completo:
   conectar → plano → apostar → 2+ treinos (entrada + foto + saída via tablet) →
   liquidar → SKR+bônus no explorer.
8. Confirmar no device: formato de retorno do `signAndSendTransactions` MWA
   (código assume `Uint8Array` com fallback p/ string) e câmera frontal na captura.
9. Vídeo de demo (reservar 1 dia), APK, métricas de uso real no README, submissão.
   Prazo: submissão 12/10/2026, interno 11/10 à noite.

## TODOs restantes no código

- `tests/golias_commit.ts`: stub (fluxo ponta a ponta p/ `anchor test`).
- Roadmap (não fazer agora): pose/rep-count, esquadrões, loja FitCoin, Health Connect,
  Supabase, login próprio, mainnet, coortes pró-rata.
