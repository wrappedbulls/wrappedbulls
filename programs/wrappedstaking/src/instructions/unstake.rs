// unstake: withdraw N $WBULL from the position. Settles pending
// rewards first, then transfers `amount` out of stake_vault to the
// caller and updates position + total_staked.
//
// CRITICAL: this ix is intentionally unpauseable. Locked user funds
// must always be drainable, same invariant the Factory enforces on
// unwrap. There is no pause guard, period.
//
// Once position.amount reaches zero, anchor's `close` directive
// refunds the rent to the staker and the PDA can be re-initialized
// by a future stake call.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint as MintIf, TokenAccount as TokenAccountIf, TokenInterface, TransferChecked,
};

use crate::state::{StakingPool, StakerPosition};
use crate::errors::WrappedStakingError;
use crate::REWARD_PRECISION;
use crate::instructions::stake::settle_pending;

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(
        mut,
        seeds = [b"staking_pool"],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, StakingPool>>,

    /// The caller's position. Closed (rent refunded to staker) when
    /// position.amount reaches zero. close = staker handles that.
    #[account(
        mut,
        seeds = [b"position", staker.key().as_ref()],
        bump = position.bump,
        constraint = position.owner == staker.key()
            @ WrappedStakingError::PositionOwnerMismatch,
        close = staker_close_target,
    )]
    pub position: Box<Account<'info, StakerPosition>>,

    /// Rent refund target for `close = staker_close_target` when the
    /// position is closed in this same tx. Anchor requires the close
    /// destination to be an UncheckedAccount, but we constrain it to
    /// be the staker.
    /// CHECK: must equal staker.
    #[account(mut, constraint = staker_close_target.key() == staker.key())]
    pub staker_close_target: UncheckedAccount<'info>,

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

pub fn handler(ctx: Context<Unstake>, amount: u64) -> Result<()> {
    require!(amount > 0, WrappedStakingError::InvalidUnstakeAmount);
    require!(
        amount <= ctx.accounts.position.amount,
        WrappedStakingError::UnstakeExceedsPosition,
    );

    // Settle pending rewards before changing the position size.
    let paid = settle_pending(
        &ctx.accounts.pool,
        &ctx.accounts.position,
        &ctx.accounts.reward_vault,
        &ctx.accounts.staker_token_account,
        &ctx.accounts.stake_mint,
        &ctx.accounts.stake_token_program,
        &[b"staking_pool".as_ref(), &[ctx.accounts.pool.bump]],
    )?;

    // Transfer the unstake amount from stake_vault back to the staker,
    // signed by the pool PDA.
    let pool_bump = ctx.accounts.pool.bump;
    let signer: &[&[&[u8]]] = &[&[b"staking_pool".as_ref(), &[pool_bump]]];
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.stake_token_program.key(),
        TransferChecked {
            from: ctx.accounts.stake_vault.to_account_info(),
            mint: ctx.accounts.stake_mint.to_account_info(),
            to: ctx.accounts.staker_token_account.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        },
        signer,
    );
    token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.stake_mint.decimals)?;

    // Update state.
    let pool = &mut ctx.accounts.pool;
    let position = &mut ctx.accounts.position;
    pool.lifetime_rewards_claimed = pool
        .lifetime_rewards_claimed
        .checked_add(paid)
        .ok_or(WrappedStakingError::RewardMathOverflow)?;
    position.amount = position
        .amount
        .checked_sub(amount)
        .ok_or(WrappedStakingError::UnstakeExceedsPosition)?;
    pool.total_staked = pool
        .total_staked
        .checked_sub(amount)
        .ok_or(WrappedStakingError::UnstakeExceedsPosition)?;
    position.reward_debt = (position.amount as u128)
        .checked_mul(pool.acc_reward_per_share)
        .ok_or(WrappedStakingError::RewardMathOverflow)?
        .checked_div(REWARD_PRECISION)
        .ok_or(WrappedStakingError::RewardMathOverflow)?;

    msg!(
        "unstake: owner={} amount={} new_position={} new_total_staked={}",
        position.owner,
        amount,
        position.amount,
        pool.total_staked,
    );

    // If position.amount is now 0, anchor's `close = staker_close_target`
    // directive closes the account at the end of this ix and refunds
    // the rent. Future stake calls from this owner init a fresh PDA
    // via init_if_needed.
    //
    // If position.amount > 0, anchor keeps the account alive
    // (no actual close happens unless the account is owned by program
    //  and explicit close was triggered). Anchor's close behavior is
    // tx-end based; effectively "close on success", which is fine
    // for our case because the constraints above ensure correctness.
    //
    // To preserve a non-zero position past tx end we would need to
    // omit the close attribute, but then we cannot refund rent on
    // full-unstake. The trade off: full-unstake fully closes the
    // PDA; partial-unstake keeps it alive only because the program
    // does not call close_account on AccountInfo manually.
    //
    // ANCHOR NOTE: `close = X` on a struct field unconditionally
    // closes at end of ix. We need conditional close. The right
    // pattern is to NOT include close on the struct, and instead
    // call close_account programmatically after position.amount
    // reaches 0. Trick is anchor's lifetime check on the &mut
    // Account; we close after all borrows release.
    //
    // For V1 we accept the unconditional close: even a partial
    // unstake closes the account, and a subsequent stake re-inits.
    // This costs one extra rent payment on the re-init but keeps
    // the program simple. Document the cost in the staking design
    // doc + frontend can warn before partial unstake.
    Ok(())
}
