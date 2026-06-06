// claim_rewards: pay out the position's pending $WBULL rewards
// without touching the staked balance. Position stays open.
//
// CRITICAL: same invariant as unstake. This ix is intentionally
// unpauseable. Earned rewards are user funds; payouts must always
// succeed regardless of pool state.
//
// Mechanics mirror the "settle" half of stake / unstake:
//   pending = (amount * acc_reward_per_share / REWARD_PRECISION)
//             - reward_debt
//   transfer pending from reward_vault to staker_token_account
//   reward_debt = amount * acc_reward_per_share / REWARD_PRECISION

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    Mint as MintIf, TokenAccount as TokenAccountIf, TokenInterface,
};

use crate::state::{StakingPool, StakerPosition};
use crate::errors::WrappedStakingError;
use crate::REWARD_PRECISION;
use crate::instructions::stake::settle_pending;

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(
        mut,
        seeds = [b"staking_pool"],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, StakingPool>>,

    /// Caller's position. NOT closed by claim_rewards: amount is
    /// unchanged and the staker may continue earning.
    #[account(
        mut,
        seeds = [b"position", staker.key().as_ref()],
        bump = position.bump,
        constraint = position.owner == staker.key()
            @ WrappedStakingError::PositionOwnerMismatch,
    )]
    pub position: Box<Account<'info, StakerPosition>>,

    #[account(
        constraint = stake_mint.key() == pool.stake_mint
            @ WrappedStakingError::WrongStakeMint,
    )]
    pub stake_mint: Box<InterfaceAccount<'info, MintIf>>,

    #[account(
        mut,
        constraint = reward_vault.key() == pool.reward_vault
            @ WrappedStakingError::WrongRewardVault,
    )]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccountIf>>,

    #[account(
        mut,
        constraint = staker_token_account.owner == staker.key(),
        constraint = staker_token_account.mint == pool.stake_mint
            @ WrappedStakingError::WrongStakeMint,
    )]
    pub staker_token_account: Box<InterfaceAccount<'info, TokenAccountIf>>,

    #[account(mut)]
    pub staker: Signer<'info>,

    pub stake_token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<ClaimRewards>) -> Result<()> {
    // Pay out pending rewards. settle_pending is a no-op if pending
    // is zero (returns 0); we still bump reward_debt afterward so
    // calling claim with zero pending is harmless idempotent.
    let paid = settle_pending(
        &ctx.accounts.pool,
        &ctx.accounts.position,
        &ctx.accounts.reward_vault,
        &ctx.accounts.staker_token_account,
        &ctx.accounts.stake_mint,
        &ctx.accounts.stake_token_program,
        &[b"staking_pool".as_ref(), &[ctx.accounts.pool.bump]],
    )?;

    let pool = &mut ctx.accounts.pool;
    let position = &mut ctx.accounts.position;
    pool.lifetime_rewards_claimed = pool
        .lifetime_rewards_claimed
        .checked_add(paid)
        .ok_or(WrappedStakingError::RewardMathOverflow)?;
    position.reward_debt = (position.amount as u128)
        .checked_mul(pool.acc_reward_per_share)
        .ok_or(WrappedStakingError::RewardMathOverflow)?
        .checked_div(REWARD_PRECISION)
        .ok_or(WrappedStakingError::RewardMathOverflow)?;

    msg!(
        "claim_rewards: owner={} paid={} position_amount={} lifetime_claimed={}",
        position.owner,
        paid,
        position.amount,
        pool.lifetime_rewards_claimed,
    );
    Ok(())
}
