// WrappedFactory: permissionless wrap-layer deploys on top of any
// pump.fun token. Sibling program to wrappedbulls.
//
// Why two programs?
//   - wrappedbulls is mainnet-live and audited. We do NOT touch it.
//   - WrappedFactory is a brand-new program with a fresh ID. Anyone can
//     call deploy_collection to bring their own pump.fun token under
//     identical wrap/unwrap mechanics, with permission gated only by the
//     1,000,000 $WBULL fee that funds the deploy atomically.
//
// Three user-initiated instructions:
//   - deploy_collection: transfers 1M $WBULL into bull_treasury_vault,
//     creates the per-token WrappedCollection PDA + Metaplex Certified
//     Collection NFT. The deploy fee is NOT burned -- it accrues in the
//     treasury with a 7-day per-deposit lock so the multisig can never
//     instantly drain the full balance.
//   - wrap:   lock N $TOKEN into a fresh NFT (reads N from the collection
//     PDA, same pattern as wrappedbulls but generic over token mint).
//   - unwrap: burn the NFT and release the locked tokens (mirrors wrap).
//
// Two admin-only instructions (gated to the program upgrade authority,
// which on mainnet becomes the wrappedbulls Squads multisig):
//   - initialize:    writes FactoryConfig + BullTreasuryState + creates
//                    the bull_treasury_vault ATA. One-shot setup.
//   - claim_treasury: sweeps expired deposits, then transfers the full
//                     claimable balance to a destination $WBULL account.

use anchor_lang::prelude::*;

pub mod state;
pub mod instructions;
pub mod errors;

use instructions::*;

// =====================================================================
// Program ID.
//
// Vanity address: starts with "Wrap" (4-char base58 prefix), part of
// the wrappedbulls product family (consistent with future programs:
// WrappedFactory, WrappedLottery, etc.). Ground on a single-core VPS;
// ~3.4h wallclock; keypair at target/deploy/wrappedfactory-keypair.json.
// =====================================================================
declare_id!("WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh");

// =====================================================================
// Protocol-wide hard-coded constants.
//
// These are deliberately NOT stored in FactoryConfig. Storing them on
// chain would let a compromised admin lower the deploy fee or shift the
// supply caps silently. Keeping them as program constants means changing
// any of them requires a Squads-multisig-signed program upgrade, which
// is publicly observable.
// =====================================================================

/// Amount of $WBULL transferred atomically by deploy_collection to the bull treasury. Base units of
/// the $WBULL mint (apply mint decimals at deposit time). With $WBULL's 6
/// decimals on pump.fun this is 1,000,000 * 1e6.
pub const DEPLOY_BURN_AMOUNT_UI: u64 = 1_000_000;

#[program]
pub mod wrappedfactory {
    use super::*;

    /// One-time Factory setup. Writes the FactoryConfig singleton
    /// with the canonical $WBULL mint that every deploy_collection transfers
    /// from. Gated to the program's upgrade authority. After this runs,
    /// the $WBULL mint cannot be changed without a new program upgrade.
    pub fn initialize(ctx: Context<Initialize>, wbull_mint: Pubkey) -> Result<()> {
        instructions::initialize::handler(ctx, wbull_mint)
    }

    /// Permissionlessly launch a new wrap layer for any pump.fun token.
    ///
    /// Atomic sequence (all-or-nothing in one tx):
    ///   1. Burn 1,000,000 $WBULL from the deployer's $WBULL account
    ///   2. Initialize the WrappedCollection PDA (sandboxed by token_mint)
    ///   3. Create the Metaplex Certified Collection NFT for marketplace
    ///      recognition
    ///   4. Bump FactoryConfig.total_deployments and total_wbull_deposited
    ///
    /// Inputs are validated before any state is written: name length,
    /// ticker length, supply range, art URI length, tokens_per_wrap > 0.
    pub fn deploy_collection(
        ctx: Context<DeployCollection>,
        args: DeployCollectionArgs,
    ) -> Result<()> {
        instructions::deploy_collection::handler(ctx, args)
    }

    /// Wrap N $TOKEN of the WrappedCollection's configured token mint
    /// into a fresh NFT. Generic over the underlying token, so the same
    /// handler serves every WrappedX. tokens_per_wrap is read from the
    /// WrappedCollection PDA, not passed by the caller (so the caller
    /// cannot under-lock).
    pub fn wrap(ctx: Context<Wrap>, tier_index: u16) -> Result<()> {
        instructions::wrap::handler(ctx, tier_index)
    }

    /// Unwrap an NFT, draining the vault back to the caller and burning
    /// the NFT. Mirrors wrappedbulls::unwrap_bull but reads the expected
    /// drain amount from the WrappedCollection PDA.
    pub fn unwrap(ctx: Context<Unwrap>, tier_index: u16) -> Result<()> {
        instructions::unwrap::handler(ctx, tier_index)
    }

    /// Sweep + drain the bull treasury into the multisig's destination
    /// account. Gated to the program's upgrade authority (which on
    /// mainnet is the wrappedbulls Squads multisig). Enforces the
    /// 7-day per-deposit lock by running BullTreasuryState::sweep_expired
    /// before reading the claimable balance, so this ix can never
    /// transfer tokens deposited less than 7 days ago.
    pub fn claim_treasury(ctx: Context<ClaimTreasury>) -> Result<()> {
        instructions::claim_treasury::handler(ctx)
    }

    /// Flip the `verified` flag on a specific WrappedCollection. UX signal
    /// (not security) telling marketplaces + /launches + the SDK that
    /// the protocol multisig has blessed this deployment as the canonical
    /// wrap layer for its target token. Gated to program upgrade
    /// authority -- same Squads multisig that controls every other
    /// admin path. Two-way: pass `verified: false` to un-verify a
    /// deployment that started looking legit and later went sideways.
    pub fn set_verified(ctx: Context<SetVerified>, verified: bool) -> Result<()> {
        instructions::set_verified::handler(ctx, verified)
    }
}
