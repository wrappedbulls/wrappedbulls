use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint as MintIf, TokenAccount as TokenAccountIf, TokenInterface};

use crate::state::{BullTreasuryState, FactoryConfig};
use crate::errors::WrappedFactoryError;

/// One-time Factory setup. Creates three PDAs in one tx:
///
///   1. FactoryConfig          - singleton: wbull_mint, admin, counters
///   2. BullTreasuryState      - accounting for the trickle-claim
///   3. bull_treasury_vault    - the ATA holding $WBULL pre-claim
///
/// Same trust model as wrappedbulls::initialize: gated to the program's
/// on-chain BPF upgrade authority so an attacker cannot front-run mainnet
/// deploy with a garbage $WBULL mint and brick every future
/// deploy_collection call. After mainnet handoff the upgrade authority
/// becomes the Squads multisig.
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = FactoryConfig::SIZE,
        seeds = [b"factory_config"],
        bump
    )]
    pub factory_config: Account<'info, FactoryConfig>,

    /// The bull treasury accounting + signing-authority PDA. Doubles as
    /// the authority for the bull_treasury_vault ATA so this PDA signs
    /// every claim_treasury token transfer via [b"bull_treasury", bump].
    #[account(
        init,
        payer = authority,
        space = BullTreasuryState::SIZE,
        seeds = [b"bull_treasury"],
        bump
    )]
    pub bull_treasury_state: Account<'info, BullTreasuryState>,

    /// $WBULL mint -- required for the bull_treasury_vault ATA derivation.
    /// Saved into factory_config so future deploy_collection calls can
    /// verify the deployer's $WBULL account matches this exact mint.
    pub wbull_mint: Box<InterfaceAccount<'info, MintIf>>,

    /// The treasury's $WBULL holding account. Canonical ATA owned by
    /// the bull_treasury_state PDA. All deploy_collection fees flow in
    /// here; claim_treasury transfers out, signed by treasury_state.
    #[account(
        init,
        payer = authority,
        associated_token::mint = wbull_mint,
        associated_token::authority = bull_treasury_state,
        associated_token::token_program = wbull_token_program,
    )]
    pub bull_treasury_vault: Box<InterfaceAccount<'info, TokenAccountIf>>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// This program's account, used to locate its ProgramData.
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ WrappedFactoryError::NotFactoryAdmin
    )]
    pub program: Program<'info, crate::program::Wrappedfactory>,

    /// The program's upgrade-authority record. Only the wallet that holds
    /// the upgrade authority of THIS deployed program may initialize.
    /// After mainnet handoff the upgrade authority becomes the Squads
    /// multisig, which means future re-initialize attempts (if a hypothetical
    /// upgrade re-enabled this ix) would also require multisig consent.
    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key())
            @ WrappedFactoryError::NotFactoryAdmin
    )]
    pub program_data: Account<'info, ProgramData>,

    pub wbull_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, wbull_mint: Pubkey) -> Result<()> {
    // Sanity: the account-level wbull_mint must match the arg. Belt + braces
    // -- the ATA constraint already derives the vault from
    // ctx.accounts.wbull_mint, but matching the arg makes the on-chain log
    // record unambiguous.
    require!(
        ctx.accounts.wbull_mint.key() == wbull_mint,
        WrappedFactoryError::WrongWbullMint
    );

    // ----- FactoryConfig -----
    let cfg = &mut ctx.accounts.factory_config;
    cfg.wbull_mint = wbull_mint;
    cfg.admin = ctx.accounts.authority.key();
    cfg.total_deployments = 0;
    cfg.total_wbull_deposited = 0;
    cfg.bump = ctx.bumps.factory_config;
    cfg.paused = false;
    cfg.reserved = [0u8; 95];

    // ----- BullTreasuryState -----
    let treasury = &mut ctx.accounts.bull_treasury_state;
    treasury.claimable = 0;
    treasury.pending = Vec::new();
    treasury.lifetime_deposited = 0;
    treasury.lifetime_claimed = 0;
    treasury.bump = ctx.bumps.bull_treasury_state;
    treasury.reserved = [0u8; 64];

    msg!(
        "WrappedFactory initialized: wbull_mint={} admin={} bull_treasury_state={} bull_treasury_vault={}",
        wbull_mint,
        cfg.admin,
        ctx.accounts.bull_treasury_state.key(),
        ctx.accounts.bull_treasury_vault.key()
    );
    Ok(())
}
