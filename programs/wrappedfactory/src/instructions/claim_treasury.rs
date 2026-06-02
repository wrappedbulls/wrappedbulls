// claim_treasury: sweep + drain the bull treasury into the multisig's
// destination $WBULL account. Gated to the program upgrade authority,
// which on mainnet becomes the existing wrappedbulls Squads multisig.
//
// Sequence:
//   1. Run BullTreasuryState::sweep_expired(now) to fold any pending
//      deposits older than 7 days into claimable. (Idempotent; safe to
//      call repeatedly.)
//   2. Drain claimable to 0, returning the amount.
//   3. require! amount > 0 (so the multisig cannot waste a tx on a
//      no-op sweep + transfer of zero).
//   4. CPI: transfer `amount` $WBULL from bull_treasury_vault to the
//      destination ATA, signed by the bull_treasury_state PDA.
//
// Trust property: the only step the multisig CAN bypass is which
// destination receives the tokens. They CANNOT reach into pending --
// the on-chain sweep enforces the 7-day window for every individual
// deposit before its amount becomes drainable.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint as MintIf, TokenAccount as TokenAccountIf, TokenInterface, TransferChecked,
};

use crate::state::{BullTreasuryState, FactoryConfig};
use crate::errors::WrappedFactoryError;

#[derive(Accounts)]
pub struct ClaimTreasury<'info> {
    /// Factory singleton. Read for the canonical $WBULL mint so we can
    /// verify the destination ATA actually wraps $WBULL.
    #[account(
        seeds = [b"factory_config"],
        bump = factory_config.bump,
    )]
    pub factory_config: Box<Account<'info, FactoryConfig>>,

    /// Bull treasury state. Mutated by the sweep + drain.
    #[account(
        mut,
        seeds = [b"bull_treasury"],
        bump = bull_treasury_state.bump,
    )]
    pub bull_treasury_state: Box<Account<'info, BullTreasuryState>>,

    /// $WBULL mint -- required for the TransferChecked CPI's decimals
    /// argument. Constraint mirrors the factory's canonical mint.
    #[account(
        constraint = wbull_mint.key() == factory_config.wbull_mint
            @ WrappedFactoryError::WrongWbullMint,
    )]
    pub wbull_mint: Box<InterfaceAccount<'info, MintIf>>,

    /// Treasury's $WBULL ATA. Source of the transfer. Validated by
    /// associated_token derivation against (wbull_mint, treasury_state).
    #[account(
        mut,
        associated_token::mint = wbull_mint,
        associated_token::authority = bull_treasury_state,
        associated_token::token_program = wbull_token_program,
    )]
    pub bull_treasury_vault: Box<InterfaceAccount<'info, TokenAccountIf>>,

    /// Destination $WBULL account. Must hold the same mint as the
    /// treasury. We do NOT pin its owner -- the multisig may want to
    /// claim to an operating wallet, a vesting contract, a DAO treasury,
    /// or wrap the proceeds into bulls. The multisig's choice of
    /// destination is itself a multisig-signed decision.
    #[account(
        mut,
        constraint = destination_wbull_account.mint == factory_config.wbull_mint
            @ WrappedFactoryError::WrongWbullMint,
    )]
    pub destination_wbull_account: Box<InterfaceAccount<'info, TokenAccountIf>>,

    /// Caller -- must be the program upgrade authority. On mainnet this
    /// is the wrappedbulls Squads multisig, so a claim requires the
    /// multisig's signing flow.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// This program's account, for ProgramData lookup.
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ WrappedFactoryError::NotFactoryAdmin
    )]
    pub program: Program<'info, crate::program::Wrappedfactory>,

    /// Upgrade authority record. Only the wallet that holds upgrade
    /// authority of THIS deployed program may call.
    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key())
            @ WrappedFactoryError::NotFactoryAdmin
    )]
    pub program_data: Account<'info, ProgramData>,

    pub wbull_token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<ClaimTreasury>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let decimals = ctx.accounts.wbull_mint.decimals;

    // 1 + 2 + 3: sweep, drain, refuse no-op.
    let amount = {
        let treasury = &mut ctx.accounts.bull_treasury_state;
        let swept = treasury.sweep_expired(now);
        let drained = treasury.drain_claimable();
        require!(drained > 0, WrappedFactoryError::NothingClaimable);
        msg!(
            "claim_treasury: swept_this_call={} total_claimed={}",
            swept,
            drained
        );
        drained
    };

    // 4. Transfer signed by the treasury PDA.
    let treasury_bump = ctx.accounts.bull_treasury_state.bump;
    let treasury_signer_seeds: &[&[&[u8]]] = &[&[b"bull_treasury", &[treasury_bump]]];

    let cpi_accounts = TransferChecked {
        from:      ctx.accounts.bull_treasury_vault.to_account_info(),
        mint:      ctx.accounts.wbull_mint.to_account_info(),
        to:        ctx.accounts.destination_wbull_account.to_account_info(),
        authority: ctx.accounts.bull_treasury_state.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.wbull_token_program.key(),
        cpi_accounts,
        treasury_signer_seeds,
    );
    token_interface::transfer_checked(cpi_ctx, amount, decimals)?;

    msg!(
        "Bull treasury claim: amount={} destination={} authority={}",
        amount,
        ctx.accounts.destination_wbull_account.key(),
        ctx.accounts.authority.key()
    );
    Ok(())
}
