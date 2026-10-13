// Gorila: Proof of Sweat — programa `golias_commit` (devnet).
// Respostas e comentários em português. Nomes de código em inglês.
//
// Invariantes (não enfraquecer — é o pitch):
// - QR é do usuário; quem escaneia é o tablet fixo da academia. Nunca inverter.
// - check_in/check_out: signer = gym_authority. attest_challenge: signer = verifier.
//   settle: permissionless, só após end_ts.
// - qr_ts dentro de 60s do Clock; nonce inédito via CheckinNonce; 1 treino por
//   unidade de período (checkin_bitmask); saída só na mesma academia do check-in;
//   check_out exige challenge_passed e janela min/max de sessão.
// - Bônus fixo limitado ao pool. Sem coortes pró-rata.
// - Foto do desafio: descartada após julgamento, nunca armazenar (tratado na web).

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface};

// Keypair do programa em target/deploy/golias_commit-keypair.json (gerado pelo
// `anchor build`). Este ID == `anchor keys list` == Anchor.toml. Para rotacionar:
// gere novo keypair, rode `anchor keys sync` e atualize o .env (PROGRAM_ID +
// EXPO_PUBLIC_PROGRAM_ID).
declare_id!("FTJr6wZ6NLvzCkE3VwpEUPX8yjHgxdcve1oPdUWYdr8i");

const QR_FRESHNESS_SECS: i64 = 60;
const MAX_NAME_LEN: usize = 32;
const MAX_DURATION_UNITS: u64 = 64; // checkin_bitmask tem 64 bits

#[program]
pub mod golias_commit {
    use super::*;

    // Cria Config + Vault. bonus_bps padrão 1000 (10%).
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        bonus_bps: u16,
        fitcoin_per_workout: u64,
        period_unit_secs: i64,
        min_session_secs: i64,
        max_session_secs: i64,
    ) -> Result<()> {
        require!(bonus_bps <= 10_000, GoliasError::InvalidBonusBps);
        require!(period_unit_secs > 0, GoliasError::InvalidPeriod);
        require!(
            min_session_secs > 0 && max_session_secs >= min_session_secs,
            GoliasError::InvalidSessionWindow
        );
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.verifier_authority = ctx.accounts.verifier_authority.key();
        config.skr_mint = ctx.accounts.skr_mint.key();
        config.fitcoin_mint = ctx.accounts.fitcoin_mint.key();
        config.vault = ctx.accounts.vault.key();
        config.bonus_bps = bonus_bps;
        config.fitcoin_per_workout = fitcoin_per_workout;
        config.period_unit_secs = period_unit_secs;
        config.min_session_secs = min_session_secs;
        config.max_session_secs = max_session_secs;
        config.pool_balance = 0;
        config.bump = ctx.bumps.config;
        config.vault_authority_bump = ctx.bumps.vault_authority;
        Ok(())
    }

    // Admin registra academia. gym_authority = chave que assina check-in/out.
    pub fn register_gym(ctx: Context<RegisterGym>, name: String) -> Result<()> {
        require!(
            !name.is_empty() && name.len() <= MAX_NAME_LEN,
            GoliasError::InvalidGymName
        );
        let gym = &mut ctx.accounts.gym;
        gym.gym_authority = ctx.accounts.gym_authority.key();
        gym.name = name;
        gym.active = true;
        gym.bump = ctx.bumps.gym;
        Ok(())
    }

    // Usuário trava SKR no Vault. start_ts vem do cliente (seed do PDA);
    // precisa estar dentro de 60s do Clock para o PDA ser derivável.
    pub fn create_commitment(
        ctx: Context<CreateCommitment>,
        start_ts: i64,
        target_workouts: u8,
        stake_amount: u64,
        duration_units: u8,
    ) -> Result<()> {
        require!(target_workouts > 0, GoliasError::InvalidTarget);
        require!(stake_amount > 0, GoliasError::InvalidStake);
        require!(
            duration_units > 0 && (duration_units as u64) <= MAX_DURATION_UNITS,
            GoliasError::InvalidDuration
        );
        require!(
            target_workouts <= duration_units,
            GoliasError::TargetExceedsDuration
        );
        let now = Clock::get()?.unix_timestamp;
        require!(
            (now - start_ts).abs() <= QR_FRESHNESS_SECS,
            GoliasError::StaleTimestamp
        );

        // Transfere SKR do usuário para o Vault.
        let cpi_accounts = token_interface::TransferChecked {
            from: ctx.accounts.user_skr_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
            mint: ctx.accounts.skr_mint.to_account_info(),
        };
        let decimals = ctx.accounts.skr_mint.decimals;
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
            ),
            stake_amount,
            decimals,
        )?;

        let commitment = &mut ctx.accounts.commitment;
        commitment.user = ctx.accounts.user.key();
        commitment.target_workouts = target_workouts;
        commitment.completed = 0;
        commitment.stake_amount = stake_amount;
        commitment.start_ts = start_ts;
        commitment.end_ts = start_ts
            .checked_add((duration_units as i64) * ctx.accounts.config.period_unit_secs)
            .ok_or(GoliasError::Overflow)?;
        commitment.checkin_bitmask = 0;
        commitment.open_session_start = 0;
        commitment.open_session_gym = Pubkey::default();
        commitment.challenge_passed = false;
        commitment.status = CommitmentStatus::Active;
        commitment.bump = ctx.bumps.commitment;
        Ok(())
    }

    // Academia registra entrada. Signer = gym_authority (paga taxa + aluguel do nonce).
    pub fn check_in(ctx: Context<CheckIn>, nonce: u64, qr_ts: i64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            (now - qr_ts).abs() <= QR_FRESHNESS_SECS,
            GoliasError::StaleQr
        );
        require!(ctx.accounts.gym.active, GoliasError::GymInactive);
        require!(
            ctx.accounts.gym.gym_authority == ctx.accounts.gym_authority.key(),
            GoliasError::WrongGymSigner
        );

        let commitment = &mut ctx.accounts.commitment;
        require!(
            commitment.status == CommitmentStatus::Active,
            GoliasError::CommitmentNotActive
        );
        require!(now >= commitment.start_ts, GoliasError::NotStarted);
        require!(now < commitment.end_ts, GoliasError::CommitmentEnded);
        require!(
            commitment.open_session_start == 0,
            GoliasError::SessionAlreadyOpen
        );

        let period_index = unchecked_period_index(
            commitment.start_ts,
            now,
            ctx.accounts.config.period_unit_secs,
        )?;
        require!(
            (commitment.checkin_bitmask & (1u64 << period_index)) == 0,
            GoliasError::PeriodAlreadyCounted
        );

        commitment.open_session_start = now;
        commitment.open_session_gym = ctx.accounts.gym.key();
        commitment.challenge_passed = false;

        // Conta CheckinNonce (init) impede replay do mesmo QR. Nonce fica
        // registrado nos seeds; nada mais a fazer aqui.
        let _ = nonce;
        Ok(())
    }

    // Servidor atesta desafio por foto. Signer = verifier_authority.
    pub fn attest_challenge(ctx: Context<AttestChallenge>) -> Result<()> {
        let commitment = &mut ctx.accounts.commitment;
        require!(
            commitment.status == CommitmentStatus::Active,
            GoliasError::CommitmentNotActive
        );
        require!(
            commitment.open_session_start != 0,
            GoliasError::NoOpenSession
        );
        commitment.challenge_passed = true;
        Ok(())
    }

    // Academia registra saída. Signer = gym_authority DA MESMA academia do check-in.
    pub fn check_out(ctx: Context<CheckOut>, nonce: u64, qr_ts: i64) -> Result<()> {
        // `nonce` só aparece nos seeds do CheckinNonce (anti-replay).
        let _ = nonce;
        let now = Clock::get()?.unix_timestamp;
        require!(
            (now - qr_ts).abs() <= QR_FRESHNESS_SECS,
            GoliasError::StaleQr
        );
        require!(ctx.accounts.gym.active, GoliasError::GymInactive);
        require!(
            ctx.accounts.gym.gym_authority == ctx.accounts.gym_authority.key(),
            GoliasError::WrongGymSigner
        );

        let config = &ctx.accounts.config;
        let commitment = &mut ctx.accounts.commitment;
        require!(
            commitment.status == CommitmentStatus::Active,
            GoliasError::CommitmentNotActive
        );
        require!(
            commitment.open_session_start != 0,
            GoliasError::NoOpenSession
        );
        // Saída só na mesma academia do check-in.
        require!(
            commitment.open_session_gym == ctx.accounts.gym.key(),
            GoliasError::WrongGym
        );

        let duration = now
            .checked_sub(commitment.open_session_start)
            .ok_or(GoliasError::Overflow)?;

        // Estourou o máximo: zera sessão, treino não conta.
        if duration > config.max_session_secs {
            commitment.open_session_start = 0;
            commitment.open_session_gym = Pubkey::default();
            commitment.challenge_passed = false;
            return Ok(());
        }

        require!(
            commitment.challenge_passed,
            GoliasError::ChallengeNotPassed
        );
        require!(duration >= config.min_session_secs, GoliasError::SessionTooShort);

        let period_index = unchecked_period_index(
            commitment.start_ts,
            now,
            config.period_unit_secs,
        )?;
        require!(
            (commitment.checkin_bitmask & (1u64 << period_index)) == 0,
            GoliasError::PeriodAlreadyCounted
        );

        commitment.checkin_bitmask |= 1u64 << period_index;
        commitment.completed = commitment.completed.saturating_add(1);
        commitment.open_session_start = 0;
        commitment.open_session_gym = Pubkey::default();
        commitment.challenge_passed = false;

        // Minta FitCoin para o usuário. Mint authority = PDA config.
        let seeds: &[&[u8]] = &[b"config", &[config.bump]];
        let signer_seeds: &[&[&[u8]]] = &[seeds];
        let cpi_accounts = token_interface::MintTo {
            mint: ctx.accounts.fitcoin_mint.to_account_info(),
            to: ctx.accounts.user_fitcoin_account.to_account_info(),
            authority: ctx.accounts.config_authority.to_account_info(),
        };
        token_interface::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program_2022.to_account_info(),
                cpi_accounts,
                signer_seeds,
            ),
            config.fitcoin_per_workout,
        )?;
        Ok(())
    }

    // Qualquer um liquida após end_ts. Cumpriu: stake + bônus (limitado ao pool).
    // Não cumpriu: stake vai para o pool.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let commitment = &mut ctx.accounts.commitment;
        require!(
            commitment.status == CommitmentStatus::Active,
            GoliasError::AlreadySettled
        );
        require!(now >= commitment.end_ts, GoliasError::NotEnded);

        let config = &mut ctx.accounts.config;
        let vault_bump = config.vault_authority_bump;
        let seeds: &[&[u8]] = &[b"vault", &[vault_bump]];
        let signer_seeds: &[&[&[u8]]] = &[seeds];

        if commitment.completed >= commitment.target_workouts {
            let bonus = (commitment.stake_amount as u128)
                .checked_mul(config.bonus_bps as u128)
                .ok_or(GoliasError::Overflow)?
                .checked_div(10_000)
                .ok_or(GoliasError::Overflow)? as u64;
            let bonus = bonus.min(config.pool_balance);
            let payout = commitment
                .stake_amount
                .checked_add(bonus)
                .ok_or(GoliasError::Overflow)?;
            config.pool_balance = config.pool_balance.saturating_sub(bonus);
            transfer_from_vault(
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.user_skr_account.to_account_info(),
                ctx.accounts.vault_authority.to_account_info(),
                ctx.accounts.skr_mint.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                payout,
                signer_seeds,
            )?;
            commitment.status = CommitmentStatus::Won;
        } else {
            config.pool_balance = config
                .pool_balance
                .checked_add(commitment.stake_amount)
                .ok_or(GoliasError::Overflow)?;
            commitment.status = CommitmentStatus::Lost;
        }
        // Sessão aberta na liquidação é descartada.
        commitment.open_session_start = 0;
        commitment.open_session_gym = Pubkey::default();
        commitment.challenge_passed = false;
        Ok(())
    }
}

fn unchecked_period_index(
    start_ts: i64,
    now: i64,
    period_unit_secs: i64,
) -> Result<u64> {
    let elapsed = now.checked_sub(start_ts).ok_or(GoliasError::Overflow)?;
    require!(elapsed >= 0, GoliasError::NotStarted);
    let index = (elapsed.checked_div(period_unit_secs).ok_or(GoliasError::Overflow)?) as u64;
    require!(index < MAX_DURATION_UNITS, GoliasError::CommitmentEnded);
    Ok(index)
}

#[allow(clippy::too_many_arguments)]
fn transfer_from_vault<'info>(
    vault: AccountInfo<'info>,
    to: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    amount: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let decimals: u8 = {
        let mint_data = mint.try_borrow_data()?;
        // Decimals fica no byte 44 do layout do Mint (SPL e Token-2022).
        if mint_data.len() < 45 {
            return err!(GoliasError::InvalidMint);
        }
        mint_data[44]
    };
    let cpi_accounts = token_interface::TransferChecked {
        from: vault,
        to,
        authority,
        mint,
    };
    token_interface::transfer_checked(
        CpiContext::new_with_signer(token_program, cpi_accounts, signer_seeds),
        amount,
        decimals,
    )?;
    Ok(())
}

// ---------- Contas ----------

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub verifier_authority: Pubkey,
    pub skr_mint: Pubkey,
    pub fitcoin_mint: Pubkey,
    pub vault: Pubkey,
    pub bonus_bps: u16,
    pub fitcoin_per_workout: u64,
    pub period_unit_secs: i64,
    pub min_session_secs: i64,
    pub max_session_secs: i64,
    pub pool_balance: u64,
    pub bump: u8,
    pub vault_authority_bump: u8,
}

#[account]
pub struct Gym {
    pub gym_authority: Pubkey,
    pub name: String,
    pub active: bool,
    pub bump: u8,
}

#[account]
pub struct Commitment {
    pub user: Pubkey,
    pub target_workouts: u8,
    pub completed: u8,
    pub stake_amount: u64,
    pub start_ts: i64,
    pub end_ts: i64,
    pub checkin_bitmask: u64,
    pub open_session_start: i64,
    pub open_session_gym: Pubkey,
    pub challenge_passed: bool,
    pub status: CommitmentStatus,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum CommitmentStatus {
    Active,
    Won,
    Lost,
}

// ---------- Contextos ----------

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: autoridade do verificador (servidor) — só guardada.
    pub verifier_authority: UncheckedAccount<'info>,
    pub skr_mint: InterfaceAccount<'info, Mint>,
    pub fitcoin_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = admin,
        seeds = [b"config"],
        bump,
        space = 8 + 32 + 32 + 32 + 32 + 32 + 2 + 8 + 8 + 8 + 8 + 8 + 1 + 1,
    )]
    pub config: Account<'info, Config>,
    /// CHECK: PDA autoridade do Vault, seeds ["vault"].
    #[account(seeds = [b"vault"], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(
        init,
        payer = admin,
        seeds = [b"vault-token"],
        bump,
        token::mint = skr_mint,
        token::authority = vault_authority,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(name: String)]
pub struct RegisterGym<'info> {
    #[account(mut, has_one = admin @ GoliasError::NotAdmin)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: chave da academia que vai assinar check-in/out — só guardada.
    pub gym_authority: UncheckedAccount<'info>,
    #[account(
        init,
        payer = admin,
        seeds = [b"gym", gym_authority.key().as_ref()],
        bump,
        space = 8 + 32 + (4 + MAX_NAME_LEN) + 1 + 1,
    )]
    pub gym: Account<'info, Gym>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(start_ts: i64)]
pub struct CreateCommitment<'info> {
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        init,
        payer = user,
        seeds = [b"commitment", user.key().as_ref(), start_ts.to_le_bytes().as_ref()],
        bump,
        // 8 disc + user 32 + target 1 + completed 1 + stake 8 + start 8 + end 8
        // + bitmask 8 + open_start 8 + open_gym 32 + challenge 1 + status 1 + bump 1 = 117.
        space = 8 + 32 + 1 + 1 + 8 + 8 + 8 + 8 + 8 + 32 + 1 + 1 + 1,
    )]
    pub commitment: Account<'info, Commitment>,
    #[account(mut, token::mint = skr_mint, token::authority = user)]
    pub user_skr_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = config.vault)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(address = config.skr_mint)]
    pub skr_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CheckIn<'info> {
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub gym_authority: Signer<'info>,
    #[account(seeds = [b"gym", gym_authority.key().as_ref()], bump = gym.bump)]
    pub gym: Account<'info, Gym>,
    #[account(mut)]
    pub commitment: Account<'info, Commitment>,
    #[account(
        init,
        payer = gym_authority,
        seeds = [b"checkin", commitment.key().as_ref(), nonce.to_le_bytes().as_ref()],
        bump,
        space = 8,
    )]
    pub checkin_nonce: Account<'info, CheckinNonce>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AttestChallenge<'info> {
    #[account(has_one = verifier_authority @ GoliasError::WrongVerifier)]
    pub config: Account<'info, Config>,
    pub verifier_authority: Signer<'info>,
    #[account(mut)]
    pub commitment: Account<'info, Commitment>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CheckOut<'info> {
    pub config: Account<'info, Config>,
    /// CHECK: PDA config = mint authority do FitCoin, assina o mint via seeds.
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub gym_authority: Signer<'info>,
    #[account(seeds = [b"gym", gym_authority.key().as_ref()], bump = gym.bump)]
    pub gym: Account<'info, Gym>,
    #[account(mut)]
    pub commitment: Account<'info, Commitment>,
    #[account(
        init,
        payer = gym_authority,
        seeds = [b"checkin", commitment.key().as_ref(), nonce.to_le_bytes().as_ref()],
        bump,
        space = 8,
    )]
    pub checkin_nonce: Account<'info, CheckinNonce>,
    #[account(mut, address = config.fitcoin_mint)]
    pub fitcoin_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed,
        payer = gym_authority,
        associated_token::mint = fitcoin_mint,
        associated_token::authority = commitment_user,
        associated_token::token_program = token_program_2022,
    )]
    pub user_fitcoin_account: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: dono da conta FitCoin = usuário do commitment.
    #[account(address = commitment.user)]
    pub commitment_user: UncheckedAccount<'info>,
    pub token_program_2022: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub config: Account<'info, Config>,
    /// CHECK: PDA autoridade do Vault.
    #[account(seeds = [b"vault"], bump = config.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut, address = config.vault)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub commitment: Account<'info, Commitment>,
    // Destino travado: só a conta SKR do dono do compromisso recebe.
    // Sem isso, como settle é permissionless, qualquer um redirecionaria o payout.
    #[account(
        mut,
        constraint = user_skr_account.mint == config.skr_mint @ GoliasError::InvalidMint,
        constraint = user_skr_account.owner == commitment.user @ GoliasError::WrongUserAccount,
    )]
    pub user_skr_account: InterfaceAccount<'info, TokenAccount>,
    #[account(address = config.skr_mint)]
    pub skr_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[account]
pub struct CheckinNonce {}

// ---------- Erros (mensagens em português) ----------

#[error_code]
pub enum GoliasError {
    #[msg("Bônus inválido: bonus_bps vai de 0 a 10000.")]
    InvalidBonusBps,
    #[msg("Período inválido: period_unit_secs precisa ser positivo.")]
    InvalidPeriod,
    #[msg("Janela de sessão inválida: min precisa ser positivo e max >= min.")]
    InvalidSessionWindow,
    #[msg("Nome da academia inválido (1 a 32 caracteres).")]
    InvalidGymName,
    #[msg("Meta inválida: target_workouts precisa ser maior que zero.")]
    InvalidTarget,
    #[msg("Stake inválido: precisa ser maior que zero.")]
    InvalidStake,
    #[msg("Duração inválida: duration_units entre 1 e 64.")]
    InvalidDuration,
    #[msg("Meta maior que a duração do compromisso.")]
    TargetExceedsDuration,
    #[msg("Timestamp fora da tolerância de 60s.")]
    StaleTimestamp,
    #[msg("QR expirado: gere um novo (tolerância de 60s).")]
    StaleQr,
    #[msg("Academia desativada.")]
    GymInactive,
    #[msg("Assinante não é a gym_authority desta academia.")]
    WrongGymSigner,
    #[msg("Saída precisa ser na mesma academia do check-in.")]
    WrongGym,
    #[msg("Compromisso não está ativo.")]
    CommitmentNotActive,
    #[msg("Compromisso ainda não começou.")]
    NotStarted,
    #[msg("Compromisso já terminou.")]
    CommitmentEnded,
    #[msg("Já existe sessão aberta neste compromisso.")]
    SessionAlreadyOpen,
    #[msg("Nenhuma sessão aberta neste compromisso.")]
    NoOpenSession,
    #[msg("Este período já teve um treino contado.")]
    PeriodAlreadyCounted,
    #[msg("Desafio por foto ainda não aprovado para esta sessão.")]
    ChallengeNotPassed,
    #[msg("Sessão curta demais (min_session_secs).")]
    SessionTooShort,
    #[msg("Só o admin pode executar esta instrução.")]
    NotAdmin,
    #[msg("Assinante não é o verifier_authority.")]
    WrongVerifier,
    #[msg("Compromisso ainda não terminou (settle só após end_ts).")]
    NotEnded,
    #[msg("Compromisso já liquidado.")]
    AlreadySettled,
    #[msg("Estouro aritmético.")]
    Overflow,
    #[msg("Conta de destino não pertence ao dono do compromisso.")]
    WrongUserAccount,
    #[msg("Mint inválido.")]
    InvalidMint,
}
