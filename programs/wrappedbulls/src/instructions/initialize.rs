use anchor_lang::prelude::*;
use crate::state::BullBank;
use crate::errors::WrappedbullsError;
use crate::MAX_BULLS;

/// `initialize` is permissionless-looking (it just creates the singleton
/// `bank` PDA) but is the root of the program's entire trust chain:
/// `bank.authority` is set to whoever calls it, and `initialize_collection`
/// + future authority-gated logic trust that value. An ungated initialize
/// lets anyone front-run mainnet deploy with a garbage mint, permanently
/// bricking the singleton bank.
///
/// Gate: the signer MUST be the program's on-chain BPF upgrade authority.
/// This needs no hardcoded key — it resolves correctly on every cluster
/// (in `anchor test` the provider wallet is the upgrade authority; on
/// mainnet it is the deployer GMrJpP7Sa…). Standard Anchor pattern.
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = BullBank::SIZE,
        seeds = [b"bank"],
        bump
    )]
    pub bank: Account<'info, BullBank>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// This program's account — used to locate its ProgramData.
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ WrappedbullsError::UnauthorizedInitializer
    )]
    pub program: Program<'info, crate::program::Wrappedbulls>,

    /// The program's upgrade-authority record. Only the wallet that holds
    /// the upgrade authority of *this* deployed program may initialize.
    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key())
            @ WrappedbullsError::UnauthorizedInitializer
    )]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, token_mint: Pubkey) -> Result<()> {
    let bank = &mut ctx.accounts.bank;

    bank.token_mint = token_mint;
    bank.total_wrapped = 0;
    bank.total_unwrapped = 0;
    bank.in_circulation = 0;
    bank.next_tier = 1;
    bank.free_tiers = Vec::new();
    bank.authority = ctx.accounts.authority.key();
    bank.bump = ctx.bumps.bank;
    // collection_mint stays Pubkey::default() until initialize_collection
    // is called. wrap_bull rejects any wrap before that with
    // CollectionNotInitialized.
    bank.collection_mint = Pubkey::default();
    bank.reserved = [0u8; 32];

    msg!(
        "Wrappedbulls initialized: mint={}, max_bulls={}",
        token_mint,
        MAX_BULLS
    );
    Ok(())
}
