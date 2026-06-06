// initialize_pool: one-shot setup. Stubbed for C2 (program scaffold);
// C3 fills in the body. Reserves the Accounts struct shape so the
// rest of the module compiles and the IDL has a stable initialize_pool
// surface.

use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitializePool<'info> {
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(_ctx: Context<InitializePool>) -> Result<()> {
    // C3: write StakingPool singleton, create stake_vault + reward_vault
    // ATAs, gate on program upgrade authority via program_data.
    Ok(())
}
