// claim_rewards stub. C3 fills the handler.
//
// Same unpauseable invariant as unstake: payouts always work, never
// blockable.

use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    pub staker: Signer<'info>,
}

pub fn handler(_ctx: Context<ClaimRewards>) -> Result<()> {
    // C3:
    //   1. pending = position.amount * pool.acc_reward_per_share / REWARD_PRECISION - reward_debt
    //   2. require!(pending > 0)
    //   3. transfer_checked pending from reward_vault to staker
    //   4. reward_debt = position.amount * pool.acc_reward_per_share / REWARD_PRECISION
    //   5. pool.lifetime_rewards_claimed += pending
    Ok(())
}
