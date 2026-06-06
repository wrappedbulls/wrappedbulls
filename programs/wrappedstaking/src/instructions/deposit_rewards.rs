// deposit_rewards stub. C3 fills the handler.

use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct DepositRewards<'info> {
    pub depositor: Signer<'info>,
}

pub fn handler(_ctx: Context<DepositRewards>, _amount: u64) -> Result<()> {
    // C3: transfer_checked from caller to reward_vault, advance
    // pool.acc_reward_per_share by (amount * REWARD_PRECISION) / total_staked.
    Ok(())
}
