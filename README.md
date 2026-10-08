# Gorila: Proof of Sweat

> Aposte SKR no seu próprio treino. Cumpra a semana e receba de volta com bônus. Desista e financie quem não desistiu.

Construído para o **CLOCK IN — Solana Mobile Hackathon** (Solana Mobile × Radiants).

🎥 **Demo:** <!-- link do vídeo -->
📱 **APK:** <!-- link -->
🔗 **Programa (devnet):** <!-- program id + link do explorer -->

## O problema
<!-- 1 dado com fonte sobre abandono de academia. Não usar número sem fonte. -->

## Como funciona
1. A IA do Gorila monta a meta da semana com base no seu nível.
2. Você trava SKR num cofre on-chain.
3. Na academia, o tablet da recepção escaneia seu QR na entrada e na saída.
4. Durante o treino, a IA pede um desafio por foto em um momento aleatório.
5. Cada treino validado gera FitCoin (não-transferível, usado dentro do app).
6. No fim da semana: cumpriu → SKR de volta + bônus. Não cumpriu → seu stake vai para o pool.

## Por que é difícil trapacear (e por que não compensa)
- **QR do usuário, scanner fixo na academia:** foto repassada não funciona.
- **Entrada + saída com tempo mínimo:** escanear e ir embora não conta.
- **Desafio por foto com IA:** instrução aleatória, só câmera do app.
- **Bônus baixo e limitado:** trapacear rende pouco.

**Burla residual que assumimos:** ficar na academia sem treinar. Ver Roadmap.

## Arquitetura
<!-- diagrama simples: App (Expo + MWA) ↔ Programa Anchor ↔ Web (tablet + IA) -->

| Peça | Stack |
|---|---|
| Programa on-chain | Anchor (Rust), devnet |
| App | Expo / React Native, Mobile Wallet Adapter |
| Tablet da academia + IA | Next.js no Vercel, Groq |
| Tokens | mock SKR (SPL) · FitCoin (Token-2022 NonTransferable) |

## O que é simulado
- mock SKR na devnet no lugar do SKR real
- "semana" de poucos minutos na demo (`period_unit_secs` ~60, `min_session_secs` ~30)
- academia de teste registrada pelo admin
- tablet da academia = navegador com a página `/gym/[id]`
- desafios por foto guardados em memória no servidor (sem banco; reiniciar perde)
- program id placeholder até o primeiro `anchor deploy` na devnet

## Uso real
<!-- X pessoas · Y compromissos · Z treinos · W SKR liquidados · período -->

## Roadmap
- Contagem de repetições por detecção de pose no aparelho (nenhuma imagem sai do celular)
- Integração com catraca biométrica das academias
- Academias travam SKR como garantia (slashing por validação falsa)
- Esquadrões: compromisso em grupo
- Divisão pró-rata do pool por coorte
- Loja de programas de treino pagos em FitCoin
- Mainnet com SKR real

## Rodando localmente
```bash
cp .env.example .env
anchor build && anchor test
pnpm --filter scripts setup:devnet
cd app && npx expo run:android
cd web && pnpm dev
```

## Time
<!-- nomes e papéis -->
