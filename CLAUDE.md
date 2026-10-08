# CLAUDE.md — Gorila: Proof of Sweat

Spin-off do GoliasFit para o hackathon **CLOCK IN (Solana Mobile × Radiants)**.
**Prazo de submissão: 12/10/2026. Prazo interno: 11/10 à noite.**

## Pitch
"Aposte SKR no seu próprio treino. Cumpra a semana e receba de volta com bônus. Desista e financie quem não desistiu."

O usuário trava SKR num compromisso semanal montado pela IA do Gorila. Cada treino validado na academia (entrada + saída com tempo mínimo, assinadas pela academia) gera FitCoin. No fim do período, quem cumpriu a meta recebe o stake de volta mais um bônus; quem não cumpriu perde o stake para o pool.

## Critérios do hackathon (guiam toda decisão de escopo)
IA 20 · Integração SKR 20 · UX 15 · UI 15 · Inovação 15 · Impacto no ecossistema 15.
Se uma tarefa não melhora nenhum desses critérios nem a demo, ela não entra.

## Regras de trabalho
- **Prazo manda.** Prefira a solução mais simples que funcione na demo. Nada de abstração "pra depois".
- **Solana: não confie na memória do modelo.** APIs de Anchor, Token-2022, Mobile Wallet Adapter e web3.js mudam. Antes de escrever código Solana, consulte o MCP `solana-mcp`. Para Expo/React Native/libs, consulte o `context7`.
- **Nunca** coloque chave privada, seed ou API key em código, logs ou commits. Segredos ficam em `.env` (que está no `.gitignore`).
- Toda funcionalidade simulada precisa estar listada na seção "O que é simulado" do README.
- Responda e comente código em português. Nomes de código em inglês.

## Arquitetura

```
/programs/golias_commit   Programa Anchor (Rust) — devnet
/app                      App Expo (React Native + TypeScript) — Android/Seeker
/web                      Next.js no Vercel — QR da academia + rotas de IA
/scripts                  Setup de devnet (mints, config, academia de teste)
```

### Moedas
- **mock SKR**: mint SPL na devnet que imita o SKR real (mesmas decimais — confirmar). É o dinheiro em jogo. Em mainnet seria o SKR de verdade.
- **FitCoin**: mint **Token-2022 com extensão NonTransferable**. Mint authority = PDA do programa. Só serve dentro do app (gasta-se queimando). Não é ativo negociável — isso é decisão de produto e regulatória, não mudar.

### Programa `golias_commit`

Contas (PDAs):
- `Config` — seeds `["config"]`: admin, verifier_authority (chave do servidor que atesta o desafio por foto), skr_mint, fitcoin_mint, bonus_bps (padrão 1000 = 10%, teto baixo de propósito), fitcoin_per_workout, `period_unit_secs` (86400 em produção; ~60 na demo), `min_session_secs` (2400 em produção; ~30 na demo), `max_session_secs` (14400), pool_balance.
- `Gym` — seeds `["gym", gym_authority]`: gym_authority (pubkey que assina check-in/check-out; fica no servidor do tablet da academia), name, active.
- `Commitment` — seeds `["commitment", user, start_ts]`: user, target_workouts, completed, stake_amount, start_ts, end_ts, `checkin_bitmask` (1 bit por "dia" → no máximo 1 treino por unidade de período), `open_session_start` (i64, 0 se não há sessão aberta), `open_session_gym` (pubkey), `challenge_passed` (bool, por sessão), status (Active | Won | Lost).
- `CheckinNonce` — seeds `["checkin", commitment, nonce]`: conta vazia cuja criação impede replay do mesmo QR do usuário.
- `Vault` — token account de SKR com autoridade PDA `["vault"]`. Guarda stakes + pool.

Instruções:
1. `initialize_config` (admin)
2. `register_gym(name, gym_authority)` (admin)
3. `create_commitment(target_workouts, stake_amount, duration_units)` — transfere SKR do usuário para o Vault.
4. `check_in(nonce, qr_ts)` — **signer = `gym_authority`** (a academia assina e paga a taxa; o usuário não assina). Valida: Gym ativa, `qr_ts` dentro de 60s do Clock, nonce inédito, compromisso ativo e dentro do prazo, sem sessão aberta, bit do dia livre. Grava `open_session_start = now` e `open_session_gym`.
5. `attest_challenge()` — **signer = `Config.verifier_authority`**. Só com sessão aberta. Marca `challenge_passed = true`.
6. `check_out(nonce, qr_ts)` — **signer = `gym_authority` da mesma academia do check-in**. Valida frescor do QR, nonce inédito, `challenge_passed == true`, e `min_session_secs <= now - open_session_start <= max_session_secs`. Se ok: marca o bit do dia, incrementa `completed`, minta `fitcoin_per_workout` via CPI e zera a sessão. Se passou do máximo: só zera a sessão (treino não conta).
7. `settle()` — permissionless, só depois de `end_ts`. Se `completed >= target`: devolve stake + bônus (`stake * bonus_bps / 10000`, limitado ao `pool_balance`). Senão: stake vai para `pool_balance`.

### Modelo anti-trapaça (é parte do pitch — não enfraquecer)
- O QR é do **usuário** (renova a cada ~30s); quem escaneia é o **tablet fixo da academia**. Foto repassada não funciona.
- Treino só conta com **entrada + saída** na mesma academia, dentro da janela de duração.
- **Desafio por foto com IA**: 1 por sessão, em momento aleatório, instrução aleatória (ex.: "prancha mostrando 3 dedos"), só câmera do app (sem galeria), 5 min para responder. Modelo com visão julga; **na dúvida aprova** (falso negativo custa dinheiro de usuário honesto). **A foto é descartada após o julgamento — nunca armazenar** (LGPD: terceiros ao fundo).
- **Bônus baixo e limitado ao pool**: trapacear rende pouco. Mensagem: "não prometemos detectar toda trapaça; fazemos ela não compensar".
- Burla residual assumida: ficar parado na academia. Roadmap: contagem de repetições com detecção de pose no aparelho, integração com catraca biométrica e academia travando SKR como garantia (slashing por fraude).

**Modelo de bônus:** MVP = bônus fixo limitado ao pool (simples). Roadmap = coortes com divisão pró-rata do pool entre quem cumpriu. Não implementar coortes agora.

### App (`/app`)
- Expo com **dev client** (Mobile Wallet Adapter não roda no Expo Go).
- Conexão de wallet via Mobile Wallet Adapter (`transact`). Não gerar wallet própria no app — o usuário do Seeker já tem uma.
- Telas, em ordem de prioridade:
  1. Conectar wallet → saldos de SKR e FitCoin
  2. Plano semanal da IA → escolher stake → `create_commitment`
  3. Treino: **exibir QR do usuário** (`{commitment, nonce, ts}`, renova a cada 30s) para o tablet da academia → sessão aberta (cronômetro) → notificação do desafio em momento aleatório → foto pela câmera do app → mostrar QR de novo na saída → animação "+X FitCoin"
  4. Progresso do compromisso (X/Y treinos, tempo restante)
  5. Liquidação: `settle` → SKR volta com bônus, ou tela de derrota
- Link para o explorer (devnet) em toda transação confirmada.

### Web (`/web`)
- `GET /gym/[id]` — **scanner** da recepção (roda no tablet): lê o QR do usuário pela câmera e chama `POST /api/gym/scan`.
- `POST /api/gym/scan` — decide entre `check_in` e `check_out` lendo a conta `Commitment`, monta a transação, assina com a chave da academia (`GYM_SECRET_KEY`, só no env do Vercel) e envia. Retorna status para o tablet exibir ("Entrada registrada" / "Treino concluído +X FitCoin" / erro).
- `POST /api/plan` — Groq (Llama 3.3) gera a meta semanal a partir do histórico/nível do usuário. Resposta em JSON estrito.
- `POST /api/challenge/new` — sorteia a instrução do desafio para a sessão aberta e devolve `{challengeId, instruction, expiresAt}`.
- `POST /api/challenge/submit` — recebe a foto, envia ao modelo com visão (Groq) junto com a instrução, recebe `{passed, confidence, reason}`, **descarta a imagem** e, se aprovado, assina e envia `attest_challenge` com `VERIFIER_SECRET_KEY`.

## Identidade visual (reaproveitar do GoliasFit)
- Paleta escura índigo/roxo com acentos dourados.
- Progressão de ranks estilo RPG (Recruta → Gorila), mascote gorila.
- Tom de coach/RPG, referências Duolingo e Discord.
- Animações curtas e celebratórias em ganho de FitCoin e na liquidação.

## Escopo — o que NÃO fazer
Acelerômetro/expo-sensors (cortado: uma feature de IA bem feita > duas pela metade), contagem de repetições por pose, esquadrões, loja de programas com FitCoin, Health Connect, Supabase, login próprio, mainnet, coortes pró-rata. Tudo isso vai para a seção "Roadmap" do README.

## O que é simulado (manter atualizado no README)
- mock SKR na devnet no lugar do SKR real
- "semana" de poucos minutos na demo (`period_unit_secs`)
- "semana" curta também encurta a janela do desafio na demo
- academia de teste registrada pelo admin
- tablet da academia = navegador de notebook/celular com a página `/gym/[id]`

## Comandos
```bash
# Programa
anchor build && anchor test
anchor deploy --provider.cluster devnet

# Setup devnet (mints, config, academia teste)
pnpm --filter scripts setup:devnet

# App
cd app && npx expo run:android

# Web
cd web && pnpm dev
```

## Prioridade quando o tempo apertar (nesta ordem)
1. Fluxo principal: apostar → entrada/saída → liquidar
2. Visual do Gorila aplicado
3. Vídeo de demo (reservar um dia inteiro)
4. Desafio por foto com IA
5. Uso real: 3–5 pessoas na devnet por 2–3 dias, com métricas no README

## Definição de pronto (dia 4)
O fluxo inteiro roda no Android sem tocar no código: conectar → plano IA → apostar → 2+ treinos (entrada + desafio por foto + saída escaneadas pelo "tablet") → liquidar → ver SKR de volta com bônus no explorer.
