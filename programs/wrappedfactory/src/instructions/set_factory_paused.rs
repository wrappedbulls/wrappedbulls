// set_factory_paused: global circuit breaker for the WrappedFactory.
//
// Flips FactoryConfig.paused on or off. When true, the program rejects:
//   - wrap                  (no new asset capture into vaults)
//   - deploy_collection     (no new wrap layers can be created)
//   - claim_treasury        (the admin cannot drain accumulated fees
//                            during an incident; gives time to assess)
//
// What pause does NOT touch:
//   - unwrap        Always permitted. User-locked tokens are always
//                   drainable. Pausing unwrap would be fund capture, the
//                   thing a circuit breaker exists to prevent.
//   - set_verified  Admin retains the ability to flip the verified flag
//                   during an incident (e.g. to un-verify a deployment
//                   that has turned malicious).
//   - initialize    One-shot; only runnable on a fresh chain.
//   - set_factory_paused itself.
//
// Gated to the program upgrade authority (same Squads-style gate as
// initialize / claim_treasury / set_verified). Two-way: pass paused=false
// to lift the pause once the underlying issue is resolved.

use anchor_lang::prelude::*;

use crate::state::FactoryConfig;
use crate::errors::WrappedFactoryError;

#[derive(Accounts)]
pub struct SetFactoryPaused<'info> {
    /// The singleton FactoryConfig PDA. Mutated to write the new paused flag.
    #[account(
        mut,
        seeds = [b"factory_config"],
        bump = factory_config.bump,
    )]
    pub factory_config: Box<Account<'info, FactoryConfig>>,

    /// Caller. Must be the program upgrade authority.
    pub authority: Signer<'info>,

    /// This program's account, used to locate its ProgramData.
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ WrappedFactoryError::NotFactoryAdmin
    )]
    pub program: Program<'info, crate::program::Wrappedfactory>,

    /// Upgrade authority record. Only the wallet currently holding upgrade
    /// authority of THIS deployed program may flip the pause flag.
    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key())
            @ WrappedFactoryError::NotFactoryAdmin
    )]
    pub program_data: Account<'info, ProgramData>,
}

pub fn handler(ctx: Context<SetFactoryPaused>, paused: bool) -> Result<()> {
    let cfg = &mut ctx.accounts.factory_config;
    let previous = cfg.paused;
    cfg.paused = paused;

    msg!(
        "Factory pause flag updated: previous={} new={} authority={}",
        previous,
        paused,
        ctx.accounts.authority.key(),
    );
    Ok(())
}
