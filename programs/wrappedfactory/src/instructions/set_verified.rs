// set_verified: flip the WrappedCollection.verified flag on a specific
// deployment. Gated to the program upgrade authority -- so the same
// Squads multisig that controls deploys also gates badges.
//
// Two-way: callers pass `verified: bool`, so an admin can also un-verify
// a deployment that started looking legit and later went sideways.
//
// What this ix is NOT:
// - It does not transfer the deployment's authority. The deployer is
//   recorded immutably at deploy time.
// - It does not change any economic field (max_supply, tokens_per_wrap,
//   art_source). Those are deploy-time-locked.
// - It does not gate wrap/unwrap. Wrap and unwrap remain permissionless
//   on any deployment regardless of the verified flag.
//
// The flag is a UX signal for marketplaces + /launches + the SDK, NOT
// a security boundary.

use anchor_lang::prelude::*;

use crate::state::WrappedCollection;
use crate::errors::WrappedFactoryError;

#[derive(Accounts)]
pub struct SetVerified<'info> {
    /// The deployment whose verified flag is being flipped. Mutable.
    #[account(
        mut,
        seeds = [b"collection", collection.token_mint.as_ref()],
        bump = collection.bump,
    )]
    pub collection: Box<Account<'info, WrappedCollection>>,

    /// Caller. Must be the program upgrade authority -- same gate as
    /// initialize + claim_treasury, so on mainnet this requires the
    /// Squads multisig to consent.
    pub authority: Signer<'info>,

    /// This program's account, used to locate its ProgramData.
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ WrappedFactoryError::NotFactoryAdmin
    )]
    pub program: Program<'info, crate::program::Wrappedfactory>,

    /// Upgrade authority record. Only the wallet currently holding upgrade
    /// authority of THIS deployed program may flip the flag.
    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key())
            @ WrappedFactoryError::NotFactoryAdmin
    )]
    pub program_data: Account<'info, ProgramData>,
}

pub fn handler(ctx: Context<SetVerified>, verified: bool) -> Result<()> {
    let collection = &mut ctx.accounts.collection;
    let previous = collection.verified;
    collection.verified = verified;

    msg!(
        "Verified flag updated: token_mint={} previous={} new={}",
        collection.token_mint,
        previous,
        verified,
    );
    Ok(())
}
