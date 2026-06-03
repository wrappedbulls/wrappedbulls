// wrap: lock N $TOKEN of the WrappedCollection's configured mint into a
// fresh NFT. Generic over the underlying token, so the same handler
// serves every WrappedX without code duplication. Mirrors the
// wrappedbulls::wrap_bull pipeline one-for-one with two differences:
//
//   - tokens_per_wrap is read from collection.tokens_per_wrap (not a
//     compile-time constant)
//   - NFT URI/name are composed from collection.art_source / .name /
//     .ticker at runtime (the deployer's chosen identity)
//
// PDAs derived in this instruction:
//   nft_mint           = PDA(["nft_mint",           token_mint, total_wrapped_le])
//   nft_mint_authority = PDA(["vault",              nft_mint])
//   bull_asset         = PDA(["bull",               token_mint, tier_index_le])
//   collection_authority = PDA(["collection_authority", token_mint])
//                        (same as deploy_collection -- the program signs
//                         the per-NFT verify_sized_collection_item CPI)

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint as TokenMint, MintTo, Token, TokenAccount as TokenAccountClassic};
use anchor_spl::token_interface::{
    self, Mint as MintIf, TokenAccount as TokenAccountIf, TokenInterface, TransferChecked,
};
use anchor_spl::metadata::{
    self,
    mpl_token_metadata::types::{Collection, Creator, DataV2},
    CreateMasterEditionV3, CreateMetadataAccountsV3, Metadata,
    VerifySizedCollectionItem,
};

use crate::state::{BullAsset, FactoryConfig, WrappedCollection};
use crate::errors::WrappedFactoryError;

#[derive(Accounts)]
#[instruction(tier_index: u16)]
pub struct Wrap<'info> {
    /// The Factory singleton. Read-only; needed so the handler can check
    /// the global pause flag before any state mutation. Not mutated by
    /// wrap, so no `mut` -- the PDA seed check is the only constraint we
    /// need (deriving from the canonical seed prevents account spoofing).
    #[account(
        seeds = [b"factory_config"],
        bump = factory_config.bump,
    )]
    pub factory_config: Box<Account<'info, FactoryConfig>>,

    /// The deployment's WrappedCollection PDA. Read for token_mint,
    /// tokens_per_wrap, art_source, name, ticker, collection_mint. Mutated
    /// at the end for tier accounting + counter bumps.
    #[account(
        mut,
        seeds = [b"collection", collection.token_mint.as_ref()],
        bump = collection.bump,
    )]
    pub collection: Box<Account<'info, WrappedCollection>>,

    /// The wrapping wallet. Pays rent for the new NFT mint, ATAs, and
    /// BullAsset PDA. Signs the token transfer into the vault.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Target token mint (must equal collection.token_mint). InterfaceAccount
    /// so this works for both classic SPL and Token-2022 mints.
    #[account(
        constraint = token_mint.key() == collection.token_mint @ WrappedFactoryError::WrongTokenMint,
    )]
    pub token_mint: Box<InterfaceAccount<'info, MintIf>>,

    /// Caller's token account. Source of the tokens_per_wrap transfer.
    #[account(
        mut,
        constraint = payer_token_account.owner == payer.key(),
        constraint = payer_token_account.mint == collection.token_mint
            @ WrappedFactoryError::WrongTokenMint,
    )]
    pub payer_token_account: Box<InterfaceAccount<'info, TokenAccountIf>>,

    /// NFT mint for this bull. PDA derived from (token_mint, total_wrapped)
    /// so each wrap gets a unique mint without a caller keypair (same
    /// single-signer pattern wrappedbulls adopted for Phantom warning
    /// elimination). Per-token namespacing prevents collisions between
    /// deployments.
    #[account(
        init,
        payer = payer,
        mint::decimals = 0,
        mint::authority = nft_mint_authority,
        mint::freeze_authority = nft_mint_authority,
        seeds = [
            b"nft_mint",
            collection.token_mint.as_ref(),
            &collection.total_wrapped.to_le_bytes()
        ],
        bump,
    )]
    pub nft_mint: Box<Account<'info, TokenMint>>,

    /// Vault authority + NFT mint authority. PDA derived from nft_mint so
    /// the locked tokens follow the NFT through every marketplace trade.
    /// CHECK: PDA, no data -- validated by seeds + bump.
    #[account(
        seeds = [b"vault", nft_mint.key().as_ref()],
        bump,
    )]
    pub nft_mint_authority: UncheckedAccount<'info>,

    /// Vault token account. ATA owned by nft_mint_authority. init_if_needed
    /// for the canonical-ATA grief vector (an attacker can pre-create the
    /// derivable ATA to make plain init fail; adopting an empty one is
    /// safe because unwrap drains the FULL balance).
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = token_mint,
        associated_token::authority = nft_mint_authority,
        associated_token::token_program = bulls_token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccountIf>>,

    /// Caller's NFT ATA. Receives the freshly minted 1-supply NFT.
    #[account(
        init,
        payer = payer,
        associated_token::mint = nft_mint,
        associated_token::authority = payer,
    )]
    pub payer_nft_account: Box<Account<'info, TokenAccountClassic>>,

    /// BullAsset record. PDA seeded by (token_mint, tier_index) so per-
    /// deployment tier records cannot collide across deployments.
    #[account(
        init,
        payer = payer,
        space = BullAsset::SIZE,
        seeds = [
            b"bull",
            collection.token_mint.as_ref(),
            &tier_index.to_le_bytes()
        ],
        bump,
    )]
    pub bull_asset: Box<Account<'info, BullAsset>>,

    /// Metaplex metadata account for this NFT.
    /// CHECK: address verified by Metaplex during CPI.
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,

    /// Metaplex master edition (caps supply at 1).
    /// CHECK: address verified by Metaplex during CPI.
    #[account(mut)]
    pub master_edition: UncheckedAccount<'info>,

    // -------- collection (MCC) accounts for verify_sized_collection_item --------

    /// Collection NFT mint. Must equal collection.collection_mint.
    /// CHECK: pubkey-equality validated via constraint.
    #[account(
        constraint = collection_mint.key() == collection.collection_mint
            @ WrappedFactoryError::WrongCollection,
    )]
    pub collection_mint: UncheckedAccount<'info>,

    /// Collection NFT's metadata. mut because verify decrements/increments
    /// the sized-collection size counter.
    /// CHECK: validated by Metaplex.
    #[account(mut)]
    pub collection_metadata: UncheckedAccount<'info>,

    /// Collection NFT's master edition.
    /// CHECK: validated by Metaplex.
    pub collection_master_edition: UncheckedAccount<'info>,

    /// Per-token collection authority PDA. Same PDA established by
    /// deploy_collection; signs verify_sized_collection_item.
    /// CHECK: PDA, no data -- validated by seeds + bump.
    #[account(
        seeds = [b"collection_authority", collection.token_mint.as_ref()],
        bump,
    )]
    pub collection_authority: UncheckedAccount<'info>,

    // -------- programs --------

    /// Classic SPL Token program. Used for the NFT side (mint_to + Metaplex
    /// CreateMasterEditionV3 requires classic SPL).
    pub token_program: Program<'info, Token>,
    /// Target-token side (Interface: classic or Token-2022). Used to
    /// transfer tokens_per_wrap from payer to vault.
    pub bulls_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_metadata_program: Program<'info, Metadata>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<Wrap>, tier_index: u16) -> Result<()> {
    // ============================================================
    // 0. Circuit breaker check (deliberate first step, before any state
    //    read or mutation, so a paused factory rejects with the cheapest
    //    possible CU cost).
    // ============================================================
    require!(
        !ctx.accounts.factory_config.paused,
        WrappedFactoryError::FactoryPaused
    );

    // ============================================================
    // 1. Validate balance and tier
    // ============================================================
    let tokens_per_wrap = ctx.accounts.collection.tokens_per_wrap;
    require!(
        ctx.accounts.payer_token_account.amount >= tokens_per_wrap,
        WrappedFactoryError::InsufficientBalance
    );

    let max_supply = ctx.accounts.collection.max_supply;
    require!(
        tier_index >= 1 && tier_index <= max_supply,
        WrappedFactoryError::TierOutOfBounds
    );

    let popped = ctx.accounts.collection.pop_tier()?;
    require!(popped == tier_index, WrappedFactoryError::TierMismatch);

    // ============================================================
    // 2. Transfer tokens_per_wrap of target token: payer -> vault
    // ============================================================
    {
        let decimals = ctx.accounts.token_mint.decimals;
        let cpi_accounts = TransferChecked {
            from:      ctx.accounts.payer_token_account.to_account_info(),
            mint:      ctx.accounts.token_mint.to_account_info(),
            to:        ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.payer.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.bulls_token_program.key(),
            cpi_accounts,
        );
        token_interface::transfer_checked(cpi_ctx, tokens_per_wrap, decimals)?;
    }

    // ============================================================
    // Prepare per-NFT signer seeds (used for mint_to + Metaplex CPIs)
    // ============================================================
    let nft_mint_key = ctx.accounts.nft_mint.key();
    let auth_bump = ctx.bumps.nft_mint_authority;
    let nft_signer_seeds: &[&[&[u8]]] = &[&[b"vault", nft_mint_key.as_ref(), &[auth_bump]]];

    // ============================================================
    // 3. Mint 1 NFT to payer's ATA
    // ============================================================
    {
        let cpi_accounts = MintTo {
            mint:      ctx.accounts.nft_mint.to_account_info(),
            to:        ctx.accounts.payer_nft_account.to_account_info(),
            authority: ctx.accounts.nft_mint_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            cpi_accounts,
            nft_signer_seeds,
        );
        token::mint_to(cpi_ctx, 1)?;
    }

    // ============================================================
    // 4. Create Metaplex metadata
    //    Name/URI composed from collection identity + tier_index.
    //    Storage caps in state.rs guarantee these never exceed Metaplex's
    //    DataV2 length limits regardless of tier count or deployer choice.
    // ============================================================
    let nft_name   = format!("{} #{}", ctx.accounts.collection.name, tier_index);
    let nft_symbol = ctx.accounts.collection.ticker.clone();
    let nft_uri    = format!("{}{}", ctx.accounts.collection.art_source.uri(), tier_index);
    let deployer   = ctx.accounts.collection.deployer;
    let coll_mint  = ctx.accounts.collection.collection_mint;

    {
        let data = DataV2 {
            name:                    nft_name,
            symbol:                  nft_symbol,
            uri:                     nft_uri,
            seller_fee_basis_points: 0,
            creators:                Some(vec![Creator {
                address:  deployer,
                verified: false,
                share:    100,
            }]),
            collection:              Some(Collection {
                key:      coll_mint,
                verified: false, // flipped true by verify_sized_collection_item below
            }),
            uses:                    None,
        };
        let cpi_accounts = CreateMetadataAccountsV3 {
            metadata:         ctx.accounts.metadata.to_account_info(),
            mint:             ctx.accounts.nft_mint.to_account_info(),
            mint_authority:   ctx.accounts.nft_mint_authority.to_account_info(),
            payer:            ctx.accounts.payer.to_account_info(),
            update_authority: ctx.accounts.nft_mint_authority.to_account_info(),
            system_program:   ctx.accounts.system_program.to_account_info(),
            rent:             ctx.accounts.rent.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_metadata_program.key(),
            cpi_accounts,
            nft_signer_seeds,
        );
        metadata::create_metadata_accounts_v3(
            cpi_ctx,
            data,
            true,                                    // is_mutable
            true,                                    // update_authority_is_signer
            None,                                    // collection_details (per-NFT, not the collection itself)
        )?;
    }

    // ============================================================
    // 5. Create master edition (caps supply at 1, NFT-style)
    // ============================================================
    {
        let cpi_accounts = CreateMasterEditionV3 {
            edition:          ctx.accounts.master_edition.to_account_info(),
            mint:             ctx.accounts.nft_mint.to_account_info(),
            update_authority: ctx.accounts.nft_mint_authority.to_account_info(),
            mint_authority:   ctx.accounts.nft_mint_authority.to_account_info(),
            payer:            ctx.accounts.payer.to_account_info(),
            metadata:         ctx.accounts.metadata.to_account_info(),
            token_program:    ctx.accounts.token_program.to_account_info(),
            system_program:   ctx.accounts.system_program.to_account_info(),
            rent:             ctx.accounts.rent.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_metadata_program.key(),
            cpi_accounts,
            nft_signer_seeds,
        );
        metadata::create_master_edition_v3(cpi_ctx, Some(0))?;
    }

    // ============================================================
    // 6. Verify this NFT into the deployment's MCC.
    //    Flips metadata.collection.verified false -> true and bumps the
    //    parent collection's sized-collection size counter. After this,
    //    marketplaces (Magic Eden / Tensor) recognise this NFT as a
    //    verified member of WrappedX -- no DYOR warnings.
    // ============================================================
    {
        let coll_auth_bump = ctx.bumps.collection_authority;
        let token_mint_key = ctx.accounts.collection.token_mint;
        let coll_signer_seeds: &[&[&[u8]]] = &[&[
            b"collection_authority",
            token_mint_key.as_ref(),
            &[coll_auth_bump],
        ]];

        let cpi_accounts = VerifySizedCollectionItem {
            payer:                     ctx.accounts.payer.to_account_info(),
            metadata:                  ctx.accounts.metadata.to_account_info(),
            collection_authority:      ctx.accounts.collection_authority.to_account_info(),
            collection_mint:           ctx.accounts.collection_mint.to_account_info(),
            collection_metadata:       ctx.accounts.collection_metadata.to_account_info(),
            collection_master_edition: ctx.accounts.collection_master_edition.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_metadata_program.key(),
            cpi_accounts,
            coll_signer_seeds,
        );
        metadata::verify_sized_collection_item(cpi_ctx, None)?;
    }

    // ============================================================
    // 7. Init BullAsset record
    // ============================================================
    let bull = &mut ctx.accounts.bull_asset;
    bull.nft_mint   = ctx.accounts.nft_mint.key();
    bull.tier_index = tier_index;
    bull.wrapped_at = Clock::get()?.unix_timestamp;
    bull.bump       = ctx.bumps.bull_asset;

    // ============================================================
    // 8. Bump collection counters
    // ============================================================
    let collection = &mut ctx.accounts.collection;
    collection.total_wrapped  = collection.total_wrapped.saturating_add(1);
    collection.in_circulation = collection.in_circulation.saturating_add(1);

    msg!(
        "Wrap: token_mint={} tier={} nft_mint={} payer={}",
        collection.token_mint,
        tier_index,
        ctx.accounts.nft_mint.key(),
        ctx.accounts.payer.key()
    );

    Ok(())
}
