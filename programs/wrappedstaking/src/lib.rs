// wrappedstaking: single-pool yield staking for $WBULL holders.
//
// Stakers deposit $WBULL, the operator routes a percentage of
// Factory deploy fee revenue here via deposit_rewards, stakers earn
// continuous yield via a MasterChef style acc_reward_per_share
// accumulator. Sibling program to wrappedfactory and wrappedbulls;
// shares the $WBULL mint but no PDAs.
//
// Design doc: docs/STAKING_DESIGN.md.
//
// Three user-facing instructions:
//   - stake:         deposit N $WBULL into the pool, settles pending
//                    rewards as a side effect
//   - unstake:       withdraw N $WBULL from the position, settles
//                    pending rewards first. NEVER pauseable; locked
//                    user funds must always be drainable
//   - claim_rewards: pay out pending rewards without touching the
//                    staked balance
//
// One admin instruction:
//   - initialize_pool: one-shot setup. Writes the StakingPool
//                      singleton + creates the stake_vault and
//                      reward_vault ATAs. Gated to the program
//                      upgrade authority
//
// One operator instruction (permissionless caller, but in practice
// only the operator has revenue to give):
//   - deposit_rewards: transfer N $WBULL from caller to reward_vault,
//                      advance acc_reward_per_share

use anchor_lang::prelude::*;

pub mod state;
pub mod instructions;
pub mod errors;

use instructions::*;

// =====================================================================
// Program ID.
//
// Vanity ID matching the wrappedbulls product family (sibling to the
// WrapF... factory ID). Generated on the VPS via solana-keygen grind
// with prefix "stak" (case insensitive); the canonical keypair lives
// at /root/vanity-grind/wrappedstaking/<id>.json on the deploy host
// and is required for the first program deploy on every cluster.
// =====================================================================
declare_id!("StAKeuh5kDJXpJRD72ELe3MGUc319uCZbMS82LNB7BW");

// =====================================================================
// Protocol constants.
//
// REWARD_PRECISION is the canonical MasterChef u128 scaling factor.
// 10^12 is large enough that integer division in
// acc_reward_per_share += (amount * REWARD_PRECISION) / total_staked
// is precise for any realistic (amount, total_staked) pair without
// overflowing u128 even at 10^18 base units of stake.
// =====================================================================
pub const REWARD_PRECISION: u128 = 1_000_000_000_000;

#[program]
pub mod wrappedstaking {
    use super::*;

    /// One-time pool setup. Writes the StakingPool singleton with
    /// the canonical $WBULL mint and creates the stake_vault and
    /// reward_vault ATAs. Gated to the program upgrade authority.
    pub fn initialize_pool(ctx: Context<InitializePool>) -> Result<()> {
        instructions::initialize_pool::handler(ctx)
    }

    /// Transfer `amount` $WBULL from caller's token account to
    /// reward_vault and advance acc_reward_per_share. Permissionless:
    /// anyone can pour rewards into the pool, but in practice only
    /// the operator has Factory revenue to distribute. The accounting
    /// math is safe regardless of who calls this.
    pub fn deposit_rewards(ctx: Context<DepositRewards>, amount: u64) -> Result<()> {
        instructions::deposit_rewards::handler(ctx, amount)
    }

    /// Stake `amount` $WBULL. Settles any pending rewards first
    /// (paid out to caller's token account), then transfers `amount`
    /// from caller to stake_vault and updates the position.
    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        instructions::stake::handler(ctx, amount)
    }

    /// Unstake `amount` $WBULL. Settles pending rewards first, then
    /// returns `amount` from stake_vault to caller. Reverts if
    /// `amount > position.amount`. NEVER pauseable: locked user
    /// funds must always be drainable.
    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        instructions::unstake::handler(ctx, amount)
    }

    /// Pay out pending rewards without touching the staked balance.
    /// Equivalent to a no-amount stake / unstake for accounting
    /// purposes. NEVER pauseable for the same reason as unstake.
    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        instructions::claim_rewards::handler(ctx)
    }
}
