// deposit_rewards: pour $WBULL into the reward_vault and advance
// acc_reward_per_share so existing stakers earn pro-rata yield.
//
// Permissionless: anyone can deposit, but in practice only the
// operator has Factory revenue to share. The accounting math is safe
// regardless of who calls this; the only way to "abuse" it is to
// give stakers free money, which is the entire point.
//
// If total_staked == 0, deposit_rewards still transfers the tokens
// into reward_vault but does NOT advance the accumulator. Those
// tokens sit in the vault and effectively get distributed pro-rata
// to whoever stakes next (each new staker enters with reward_debt
// matching the current accumulator, so first staker captures the
// whole pre-deposit if they stake before the next deposit).

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint as MintIf, TokenAccount as TokenAccountIf, TokenInterface, TransferChecked,
};

use crate::state::StakingPool;
use crate::errors::WrappedStakingError;
use crate::REWARD_PRECISION;

#[derive(Accounts)]
pub struct DepositRewards<'info> {
    /// The pool singleton. Mutated for acc_reward_per_share and
    /// lifetime_rewards_deposited.
    #[account(
        mut,
        seeds = [b"staking_pool"],
        bump = pool.bump,
    )]
    pub pool: Account<'info, StakingPool>,

    /// $WBULL mint. Constrained against pool.stake_mint so a caller
    /// cannot deposit a different mint and corrupt vault accounting.
    #[account(
        constraint = stake_mint.key() == pool.stake_mint
            @ WrappedStakingError::WrongStakeMint,
    )]
    pub stake_mint: Box<InterfaceAccount<'info, MintIf>>,

    /// Pool reward vault. Tokens flow here from the caller.
    #[account(
        mut,
        constraint = reward_vault.key() == pool.reward_vault
            @ WrappedStakingError::WrongRewardVault,
    )]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccountIf>>,

    /// Caller's token account. Source of the deposit.
    #[account(
        mut,
        constraint = depositor_token_account.owner == depositor.key(),
        constraint = depositor_token_account.mint == pool.stake_mint
            @ WrappedStakingError::WrongStakeMint,
    )]
    pub depositor_token_account: Box<InterfaceAccount<'info, TokenAccountIf>>,

    #[account(mut)]
    pub depositor: Signer<'info>,

    pub stake_token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<DepositRewards>, amount: u64) -> Result<()> {
    require!(amount > 0, WrappedStakingError::InvalidDepositAmount);
    require!(
        ctx.accounts.depositor_token_account.amount >= amount,
        WrappedStakingError::InsufficientDepositBalance,
    );

    // Transfer first, advance accumulator second. If transfer fails
    // for any reason, accumulator math never runs.
    let cpi_ctx = CpiContext::new(
        ctx.accounts.stake_token_program.key(),
        TransferChecked {
            from: ctx.accounts.depositor_token_account.to_account_info(),
            mint: ctx.accounts.stake_mint.to_account_info(),
            to: ctx.accounts.reward_vault.to_account_info(),
            authority: ctx.accounts.depositor.to_account_info(),
        },
    );
    token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.stake_mint.decimals)?;

    // Advance acc_reward_per_share = old + (amount * REWARD_PRECISION) / total_staked.
    // total_staked = 0 short circuits: deposit lands in vault, accumulator
    // unchanged, first staker after this captures the whole sum.
    let pool = &mut ctx.accounts.pool;
    if pool.total_staked > 0 {
        let delta = (amount as u128)
            .checked_mul(REWARD_PRECISION)
            .ok_or(WrappedStakingError::RewardMathOverflow)?
            .checked_div(pool.total_staked as u128)
            .ok_or(WrappedStakingError::RewardMathOverflow)?;
        pool.acc_reward_per_share = pool
            .acc_reward_per_share
            .checked_add(delta)
            .ok_or(WrappedStakingError::RewardMathOverflow)?;
    }
    pool.lifetime_rewards_deposited = pool
        .lifetime_rewards_deposited
        .checked_add(amount)
        .ok_or(WrappedStakingError::RewardMathOverflow)?;

    msg!(
        "deposit_rewards: amount={} total_staked={} acc_reward_per_share={} lifetime_deposited={}",
        amount,
        pool.total_staked,
        pool.acc_reward_per_share,
        pool.lifetime_rewards_deposited,
    );
    Ok(())
}
