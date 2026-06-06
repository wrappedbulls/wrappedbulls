// stake: deposit N $WBULL into the pool. Settles any pending rewards
// first (paid to the staker's token account), then transfers `amount`
// from the staker to stake_vault and updates the position.
//
// Account initialization: StakerPosition uses init_if_needed so the
// first stake call from a given owner creates the PDA and every
// subsequent call reuses it. The PDA seeds are [b"position", owner];
// only this program can create or modify PDAs at that derivation, so
// the canonical init-if-needed grief vector does not apply.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint as MintIf, TokenAccount as TokenAccountIf, TokenInterface, TransferChecked,
};

use crate::state::{StakingPool, StakerPosition};
use crate::errors::WrappedStakingError;
use crate::REWARD_PRECISION;

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(
        mut,
        seeds = [b"staking_pool"],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, StakingPool>>,

    /// Per-user position PDA. Created on first stake, kept alive
    /// across subsequent stakes / claims / partial unstakes.
    #[account(
        init_if_needed,
        payer = staker,
        space = StakerPosition::SIZE,
        seeds = [b"position", staker.key().as_ref()],
        bump,
    )]
    pub position: Box<Account<'info, StakerPosition>>,

    /// $WBULL mint. Constrained against pool.stake_mint.
    #[account(
        constraint = stake_mint.key() == pool.stake_mint
            @ WrappedStakingError::WrongStakeMint,
    )]
    pub stake_mint: Box<InterfaceAccount<'info, MintIf>>,

    #[account(
        mut,
        constraint = stake_vault.key() == pool.stake_vault
            @ WrappedStakingError::WrongStakeVault,
    )]
    pub stake_vault: Box<InterfaceAccount<'info, TokenAccountIf>>,

    /// Pool reward vault. Read AND written: we pay pending rewards
    /// out of here during the settle phase.
    #[account(
        mut,
        constraint = reward_vault.key() == pool.reward_vault
            @ WrappedStakingError::WrongRewardVault,
    )]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccountIf>>,

    /// Staker's $WBULL token account. Source of the stake transfer
    /// AND destination of any pending reward payout.
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
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Stake>, amount: u64) -> Result<()> {
    require!(amount > 0, WrappedStakingError::InvalidStakeAmount);
    require!(
        ctx.accounts.staker_token_account.amount >= amount,
        WrappedStakingError::InsufficientStakeBalance,
    );

    let position = &mut ctx.accounts.position;

    // If the position was just created by init_if_needed, anchor
    // zeroes the data including amount and reward_debt. Stamp the
    // owner so unstake / claim_rewards can verify the caller.
    if position.amount == 0 && position.owner == Pubkey::default() {
        position.owner = ctx.accounts.staker.key();
        position.bump = ctx.bumps.position;
    } else {
        require!(
            position.owner == ctx.accounts.staker.key(),
            WrappedStakingError::PositionOwnerMismatch,
        );
    }

    // Settle pending rewards to staker_token_account before the
    // stake balance changes. Caller bumps lifetime_rewards_claimed
    // after the immutable pool borrow inside settle_pending releases.
    let paid = settle_pending(
        &ctx.accounts.pool,
        position,
        &ctx.accounts.reward_vault,
        &ctx.accounts.staker_token_account,
        &ctx.accounts.stake_mint,
        &ctx.accounts.stake_token_program,
        &[
            b"staking_pool".as_ref(),
            &[ctx.accounts.pool.bump],
        ],
    )?;

    // Transfer the stake amount from staker to stake_vault.
    let cpi_ctx = CpiContext::new(
        ctx.accounts.stake_token_program.key(),
        TransferChecked {
            from: ctx.accounts.staker_token_account.to_account_info(),
            mint: ctx.accounts.stake_mint.to_account_info(),
            to: ctx.accounts.stake_vault.to_account_info(),
            authority: ctx.accounts.staker.to_account_info(),
        },
    );
    token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.stake_mint.decimals)?;

    // Update position + pool totals + reward_debt.
    let pool = &mut ctx.accounts.pool;
    pool.lifetime_rewards_claimed = pool
        .lifetime_rewards_claimed
        .checked_add(paid)
        .ok_or(WrappedStakingError::RewardMathOverflow)?;
    position.amount = position
        .amount
        .checked_add(amount)
        .ok_or(WrappedStakingError::RewardMathOverflow)?;
    pool.total_staked = pool
        .total_staked
        .checked_add(amount)
        .ok_or(WrappedStakingError::RewardMathOverflow)?;
    position.reward_debt = (position.amount as u128)
        .checked_mul(pool.acc_reward_per_share)
        .ok_or(WrappedStakingError::RewardMathOverflow)?
        .checked_div(REWARD_PRECISION)
        .ok_or(WrappedStakingError::RewardMathOverflow)?;

    msg!(
        "stake: owner={} amount={} new_position={} new_total_staked={}",
        position.owner,
        amount,
        position.amount,
        pool.total_staked,
    );
    Ok(())
}

/// Compute and pay out pending rewards from reward_vault to the
/// destination token account. Returns the amount paid so the caller
/// can bump pool.lifetime_rewards_claimed without re-deriving it.
/// reward_debt is updated by the caller AFTER position.amount may
/// have changed (which depends on the ix flow).
///
/// Shared by stake, unstake, and claim_rewards. The pool reference
/// is immutable here because we need to use pool.to_account_info()
/// as the CPI signer's AccountInfo source, and mutable + signer
/// borrowing on the same Account conflicts.
pub(crate) fn settle_pending<'info>(
    pool: &Account<'info, StakingPool>,
    position: &StakerPosition,
    reward_vault: &InterfaceAccount<'info, TokenAccountIf>,
    dest_token_account: &InterfaceAccount<'info, TokenAccountIf>,
    stake_mint: &InterfaceAccount<'info, MintIf>,
    stake_token_program: &Interface<'info, TokenInterface>,
    pool_signer_seeds: &[&[u8]],
) -> Result<u64> {
    let claimable = (position.amount as u128)
        .checked_mul(pool.acc_reward_per_share)
        .ok_or(WrappedStakingError::RewardMathOverflow)?
        .checked_div(REWARD_PRECISION)
        .ok_or(WrappedStakingError::RewardMathOverflow)?;
    let pending = claimable
        .checked_sub(position.reward_debt)
        .ok_or(WrappedStakingError::RewardMathOverflow)?;

    if pending == 0 {
        return Ok(0);
    }
    // u128 -> u64 conversion. claimable cannot exceed reward_vault
    // balance which is u64 by definition, so this is always safe.
    let pending_u64: u64 = pending
        .try_into()
        .map_err(|_| WrappedStakingError::RewardMathOverflow)?;

    let signer = &[pool_signer_seeds];
    let cpi_ctx = CpiContext::new_with_signer(
        stake_token_program.key(),
        TransferChecked {
            from: reward_vault.to_account_info(),
            mint: stake_mint.to_account_info(),
            to: dest_token_account.to_account_info(),
            authority: pool.to_account_info(),
        },
        signer,
    );
    token_interface::transfer_checked(cpi_ctx, pending_u64, stake_mint.decimals)?;

    msg!("settled pending rewards: {} owner: {}", pending_u64, position.owner);
    Ok(pending_u64)
}
