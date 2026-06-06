// initialize_pool: one-shot staking pool setup. Creates the StakingPool
// singleton, the stake_vault ATA, and the reward_vault ATA. Both vaults
// are owned by the StakingPool PDA itself, which signs CPI transfers
// out of them via seeds [b"staking_pool", &[pool.bump]] (same pattern
// wrappedfactory uses for bull_treasury_state).
//
// Gated to the program upgrade authority. Once it runs, the stake_mint
// is locked into the pool record forever -- there is no set_stake_mint
// ix on purpose. If the canonical $WBULL mint ever needs to change,
// it requires a program upgrade + a new pool, not a config flip.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint as MintIf, TokenAccount as TokenAccountIf, TokenInterface};

use crate::state::StakingPool;
use crate::errors::WrappedStakingError;

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(
        init,
        payer = authority,
        space = StakingPool::SIZE,
        seeds = [b"staking_pool"],
        bump
    )]
    pub pool: Account<'info, StakingPool>,

    /// $WBULL mint. Recorded into pool.stake_mint and used as both the
    /// stake and the reward currency. InterfaceAccount so Token-2022
    /// works transparently (mainnet $WBULL is Token-2022).
    pub stake_mint: Box<InterfaceAccount<'info, MintIf>>,

    /// ATA(stake_mint, pool). Holds the cumulative staked balance.
    /// Pool PDA signs CPI transfers out of this account via the
    /// pool.bump seed.
    #[account(
        init,
        payer = authority,
        associated_token::mint = stake_mint,
        associated_token::authority = pool,
        associated_token::token_program = stake_token_program,
    )]
    pub stake_vault: Box<InterfaceAccount<'info, TokenAccountIf>>,

    /// Token account at PDA [b"reward_vault"] owned by pool. Holds
    /// rewards deposited via deposit_rewards waiting for stakers
    /// to claim.
    ///
    /// NOT an ATA: an ATA is uniquely determined by (mint, owner),
    /// and stake_vault already occupies ATA(stake_mint, pool). The
    /// two vaults must be distinct accounts so we keep stake_vault
    /// as the conventional ATA and put reward_vault at a custom
    /// seeded address.
    #[account(
        init,
        payer = authority,
        seeds = [b"reward_vault"],
        bump,
        token::mint = stake_mint,
        token::authority = pool,
        token::token_program = stake_token_program,
    )]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccountIf>>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// This program's account, used to locate its ProgramData.
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ WrappedStakingError::NotPoolAdmin
    )]
    pub program: Program<'info, crate::program::Wrappedstaking>,

    /// The program's upgrade-authority record. Only the wallet that
    /// currently holds upgrade authority on THIS deployed program may
    /// initialize the pool. Same gating as wrappedfactory.initialize.
    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key())
            @ WrappedStakingError::NotPoolAdmin
    )]
    pub program_data: Account<'info, ProgramData>,

    pub stake_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializePool>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    pool.stake_mint = ctx.accounts.stake_mint.key();
    pool.stake_vault = ctx.accounts.stake_vault.key();
    pool.reward_vault = ctx.accounts.reward_vault.key();
    pool.total_staked = 0;
    pool.acc_reward_per_share = 0;
    pool.lifetime_rewards_deposited = 0;
    pool.lifetime_rewards_claimed = 0;
    pool.bump = ctx.bumps.pool;
    pool.reserved = [0u8; 97];

    msg!(
        "WrappedStaking pool initialized: stake_mint={} stake_vault={} reward_vault={}",
        pool.stake_mint,
        pool.stake_vault,
        pool.reward_vault,
    );
    Ok(())
}
