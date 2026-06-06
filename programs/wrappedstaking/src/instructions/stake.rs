// stake stub. C3 fills the handler.

use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Stake<'info> {
    pub staker: Signer<'info>,
}

pub fn handler(_ctx: Context<Stake>, _amount: u64) -> Result<()> {
    // C3:
    //   1. Init StakerPosition PDA if needed (init_if_needed)
    //   2. Settle pending rewards to staker's $WBULL token account
    //   3. transfer_checked amount from staker to stake_vault
    //   4. position.amount += amount; pool.total_staked += amount
    //   5. reward_debt = position.amount * pool.acc_reward_per_share / REWARD_PRECISION
    Ok(())
}
