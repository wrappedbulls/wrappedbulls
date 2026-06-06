// unstake stub. C3 fills the handler.
//
// CRITICAL: unstake must NEVER be pauseable. Locked user funds must
// always be drainable. Analogous to wrappedfactory's unguarded
// unwrap.

use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Unstake<'info> {
    pub staker: Signer<'info>,
}

pub fn handler(_ctx: Context<Unstake>, _amount: u64) -> Result<()> {
    // C3:
    //   1. Settle pending rewards to staker's $WBULL token account
    //   2. require!(amount <= position.amount)
    //   3. transfer_checked amount from stake_vault to staker, signed
    //      by pool_authority PDA
    //   4. position.amount -= amount; pool.total_staked -= amount
    //   5. reward_debt = position.amount * pool.acc_reward_per_share / REWARD_PRECISION
    //   6. If position.amount == 0, close the StakerPosition account
    //      and refund rent to the staker
    Ok(())
}
