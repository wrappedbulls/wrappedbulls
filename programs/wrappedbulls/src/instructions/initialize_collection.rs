use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};
use anchor_spl::metadata::{
    self,
    mpl_token_metadata::types::{CollectionDetails, DataV2},
    CreateMasterEditionV3, CreateMetadataAccountsV3, Metadata,
};

use crate::state::BullBank;
use crate::errors::WrappedbullsError;
use crate::{PROJECT_NAME, TICKER, COLLECTION_URI};

/// Create the Metaplex Certified Collection (MCC) parent NFT.
///
/// Why this exists:
///   - Magic Eden / Tensor / Phantom recognise NFTs as part of a collection
///     only when each NFT carries a verified `collection` field pointing to
///     a Sized Collection NFT (per the Metaplex MCC standard).
///   - Without this, bulls auto-list with DYOR warnings, are not searchable
///     by collection on Tensor, and Phantom cannot show collection floor.
///
/// Design:
///   - The collection NFT mint authority + freeze authority + Metaplex
///     update authority are all `PDA(["collection_authority"])` so the
///     program (not the deployer) can sign verify_sized_collection_item
///     during every wrap_bull.
///   - The collection NFT itself is minted (1 supply) to the deployer's
///     ATA so it shows up in the deployer's wallet for marketplace claim
///     flows (Tensor/Magic Eden expect the creator to own/control it).
///   - Sized collection (`CollectionDetails::V1 { size: 0 }`): the size
///     auto-increments as bulls verify in.
///   - One-shot: re-running fails with `CollectionAlreadyInitialized`
///     because `bank.collection_mint` is already set.
#[derive(Accounts)]
pub struct InitializeCollection<'info> {
    #[account(
        mut,
        seeds = [b"bank"],
        bump = bank.bump,
        // Only the deployer-recorded authority can mint the collection.
        constraint = bank.authority == authority.key() @ WrappedbullsError::NotProgramAuthority,
    )]
    pub bank: Account<'info, BullBank>,

    /// Deployer wallet — pays rent for collection mint, ATA, metadata,
    /// master edition. Must equal bank.authority.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Fresh keypair for the collection NFT mint (caller-generated).
    /// Initialized here with decimals=0; mint+freeze authority is the
    /// program-controlled `collection_authority` PDA so we can sign
    /// verify CPIs for every future wrap_bull.
    #[account(
        init,
        payer = authority,
        mint::decimals = 0,
        mint::authority = collection_authority,
        mint::freeze_authority = collection_authority,
    )]
    pub collection_mint: Box<Account<'info, Mint>>,

    /// Program PDA that signs as Metaplex update_authority + mint authority
    /// for the collection NFT. Same PDA signs verify_sized_collection_item
    /// for every wrap_bull, so the program (not a wallet) is the authority.
    /// CHECK: PDA, no data — validated by seeds + bump.
    #[account(
        seeds = [b"collection_authority"],
        bump,
    )]
    pub collection_authority: UncheckedAccount<'info>,

    /// Deployer's ATA for the collection NFT (receives the 1-supply mint).
    /// Holding the collection NFT in the deployer's wallet is the standard
    /// Tensor/ME pattern and lets the deployer claim the collection on
    /// Creator Hub / Tensor Creator Portal.
    #[account(
        init,
        payer = authority,
        associated_token::mint = collection_mint,
        associated_token::authority = authority,
    )]
    pub authority_collection_ata: Box<Account<'info, TokenAccount>>,

    /// Metaplex metadata account for the collection NFT.
    /// CHECK: address verified by Metaplex during CPI.
    #[account(mut)]
    pub collection_metadata: UncheckedAccount<'info>,

    /// Metaplex master edition account for the collection NFT.
    /// CHECK: address verified by Metaplex during CPI.
    #[account(mut)]
    pub collection_master_edition: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_metadata_program: Program<'info, Metadata>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<InitializeCollection>) -> Result<()> {
    // === Idempotency guard: refuse if collection_mint is already set ===
    require!(
        ctx.accounts.bank.collection_mint == Pubkey::default(),
        WrappedbullsError::CollectionAlreadyInitialized
    );

    // === Prepare collection_authority PDA signer seeds ===
    let auth_bump = ctx.bumps.collection_authority;
    let signer_seeds: &[&[&[u8]]] = &[&[b"collection_authority", &[auth_bump]]];

    // === 1. Mint 1 of the collection NFT to deployer's ATA ===
    {
        let cpi_accounts = MintTo {
            mint: ctx.accounts.collection_mint.to_account_info(),
            to: ctx.accounts.authority_collection_ata.to_account_info(),
            authority: ctx.accounts.collection_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            cpi_accounts,
            signer_seeds,
        );
        token::mint_to(cpi_ctx, 1)?;
    }

    // === 2. Create Metaplex metadata for the collection NFT ===
    //
    // collection_details=Some(CollectionDetails::V1 { size: 0 }) marks this
    // as a SIZED COLLECTION — the size auto-increments as bulls verify in.
    {
        let data = DataV2 {
            name: PROJECT_NAME.to_string(),
            symbol: TICKER.to_string(),
            uri: COLLECTION_URI.to_string(),
            seller_fee_basis_points: 0,
            creators: None,
            collection: None,
            uses: None,
        };
        let cpi_accounts = CreateMetadataAccountsV3 {
            metadata: ctx.accounts.collection_metadata.to_account_info(),
            mint: ctx.accounts.collection_mint.to_account_info(),
            mint_authority: ctx.accounts.collection_authority.to_account_info(),
            payer: ctx.accounts.authority.to_account_info(),
            update_authority: ctx.accounts.collection_authority.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_metadata_program.key(),
            cpi_accounts,
            signer_seeds,
        );
        metadata::create_metadata_accounts_v3(
            cpi_ctx,
            data,
            true,                                       // is_mutable
            true,                                       // update_authority_is_signer
            Some(CollectionDetails::V1 { size: 0 }),    // sized collection
        )?;
    }

    // === 3. Create master edition for the collection NFT (locks supply at 1) ===
    {
        let cpi_accounts = CreateMasterEditionV3 {
            edition: ctx.accounts.collection_master_edition.to_account_info(),
            mint: ctx.accounts.collection_mint.to_account_info(),
            update_authority: ctx.accounts.collection_authority.to_account_info(),
            mint_authority: ctx.accounts.collection_authority.to_account_info(),
            payer: ctx.accounts.authority.to_account_info(),
            metadata: ctx.accounts.collection_metadata.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_metadata_program.key(),
            cpi_accounts,
            signer_seeds,
        );
        metadata::create_master_edition_v3(cpi_ctx, Some(0))?;
    }

    // === 4. Record collection_mint in BullBank ===
    let bank = &mut ctx.accounts.bank;
    bank.collection_mint = ctx.accounts.collection_mint.key();

    msg!(
        "Collection initialized: collection_mint={} authority_pda={}",
        ctx.accounts.collection_mint.key(),
        ctx.accounts.collection_authority.key()
    );

    Ok(())
}
