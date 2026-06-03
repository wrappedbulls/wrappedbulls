// deploy_collection: the headline Factory instruction.
//
// Atomic sequence (all-or-nothing in one tx):
//   1. Validate every input (length, range, ascii) BEFORE state changes
//   2. Sweep any treasury pending entries older than 7d into claimable
//      (frees room in the bounded pending vec)
//   3. Transfer 1,000,000 $WBULL: deployer -> bull_treasury_vault
//   4. Record the new (amount, deposited_at) entry on BullTreasuryState
//   5. Mint 1 of the collection NFT to the deployer's collection ATA
//      (mint authority is a per-token collection_authority PDA)
//   6. Create Metaplex metadata for the collection (SIZED collection so
//      size auto-increments when wrapped NFTs verify into it later)
//   7. Create master edition (locks collection NFT supply at 1)
//   8. Init the WrappedCollection PDA recording every deployment param
//   9. Bump FactoryConfig.total_deployments + total_wbull_deposited
//
// PDA layout for this deployment:
//   WrappedCollection      = PDA(["collection",           token_mint])
//   collection_mint        = PDA(["collection_mint",      token_mint])  (NFT mint)
//   collection_authority   = PDA(["collection_authority", token_mint])  (program signer)
//
// Per-token namespacing on every PDA means two deployments for two
// different pump.fun tokens cannot ever collide; deploys for the same
// token are blocked by the `init` constraint on `collection`.
//
// Token economics note: there is no burn anywhere in this handler. The
// 1M $WBULL flows deployer -> treasury where it remains as protocol
// working capital. Burning would shrink the protocol's own fuel supply
// (every wrap requires 1M $WBULL of circulating supply). See
// state.rs::BullTreasuryState for the trust-minimizing 7-day lock.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint as TokenMint, MintTo, Token, TokenAccount as TokenAccountClassic};
use anchor_spl::token_interface::{
    self, Mint as MintIf, TokenAccount as TokenAccountIf, TokenInterface, TransferChecked,
};
use anchor_spl::metadata::{
    self,
    mpl_token_metadata::types::{CollectionDetails, DataV2},
    CreateMasterEditionV3, CreateMetadataAccountsV3, Metadata,
};

use crate::state::{
    ArtSource, BullTreasuryState, FactoryConfig, WrappedCollection,
    MAX_NAME_LEN, MAX_TICKER_LEN, MAX_ART_URI_LEN, MIN_SUPPLY, MAX_SUPPLY,
};
use crate::errors::WrappedFactoryError;
use crate::DEPLOY_BURN_AMOUNT_UI;

/// Args bundled into one struct so the on-chain wire format stays small
/// even as v1.1 adds optional banner/social fields. ALL fields here are
/// validated in the handler before any chain state mutates.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DeployCollectionArgs {
    pub name:            String,    // "WrappedDoge",      1..=32
    pub ticker:          String,    // "WDOGE",            1..=12
    pub max_supply:      u16,       // 100..=10_000
    pub tokens_per_wrap: u64,       // base units of token_mint, > 0
    pub art_source:      ArtSource, // per-NFT metadata source
    pub collection_uri:  String,    // collection-level metadata URI, 1..=200
}

#[derive(Accounts)]
#[instruction(args: DeployCollectionArgs)]
pub struct DeployCollection<'info> {
    // -------- factory state --------

    /// Factory singleton. Read for the canonical $WBULL mint; bumped at
    /// the end with total_deployments + total_wbull_deposited counters.
    #[account(
        mut,
        seeds = [b"factory_config"],
        bump = factory_config.bump,
    )]
    pub factory_config: Box<Account<'info, FactoryConfig>>,

    /// Bull treasury accounting + token-signing authority PDA. Mutated in
    /// this ix to sweep expired entries + push the new deposit.
    #[account(
        mut,
        seeds = [b"bull_treasury"],
        bump = bull_treasury_state.bump,
    )]
    pub bull_treasury_state: Box<Account<'info, BullTreasuryState>>,

    /// Treasury's $WBULL ATA. Destination of the deploy fee. Validated by
    /// the associated_token derivation: this MUST be the canonical ATA at
    /// (wbull_mint, bull_treasury_state) -- attempting to pass a different
    /// account will fail account-constraint resolution before the handler
    /// runs.
    #[account(
        mut,
        associated_token::mint = wbull_mint,
        associated_token::authority = bull_treasury_state,
        associated_token::token_program = wbull_token_program,
    )]
    pub bull_treasury_vault: Box<InterfaceAccount<'info, TokenAccountIf>>,

    /// The deployer. Signs the $WBULL transfer + pays rent for every new
    /// account created in this ix. After this tx, the deployer's wallet
    /// holds the collection NFT (standard Tensor/Magic Eden ownership
    /// pattern).
    #[account(mut)]
    pub deployer: Signer<'info>,

    // -------- target token + $WBULL fee --------

    /// The target pump.fun token. The Factory wraps THIS mint. Pump.fun's
    /// 2026 migration moved everything to Token-2022, so we use
    /// InterfaceAccount which transparently accepts either classic SPL or
    /// Token-2022 mints. Read only -- nothing changes on the underlying
    /// token mint.
    pub token_mint: Box<InterfaceAccount<'info, MintIf>>,

    /// $WBULL mint. Required to match the canonical value in FactoryConfig.
    /// Source mint for the 1M deploy fee transfer.
    #[account(
        constraint = wbull_mint.key() == factory_config.wbull_mint
            @ WrappedFactoryError::WrongWbullMint,
    )]
    pub wbull_mint: Box<InterfaceAccount<'info, MintIf>>,

    /// Deployer's $WBULL token account. Source of the 1M deploy fee.
    #[account(
        mut,
        constraint = deployer_wbull_account.mint == factory_config.wbull_mint
            @ WrappedFactoryError::WrongWbullMint,
        constraint = deployer_wbull_account.owner == deployer.key(),
    )]
    pub deployer_wbull_account: Box<InterfaceAccount<'info, TokenAccountIf>>,

    // -------- WrappedCollection PDA --------

    /// New WrappedCollection PDA. `init` enforces uniqueness: two
    /// concurrent deploys for the same token_mint cannot both succeed,
    /// and a second deploy on a token that already has a wrap layer
    /// fails with CollectionAlreadyDeployed (anchor's PDA-exists error
    /// surfaces as that variant via our error mapping).
    #[account(
        init,
        payer = deployer,
        space = WrappedCollection::SIZE,
        seeds = [b"collection", token_mint.key().as_ref()],
        bump,
    )]
    pub collection: Box<Account<'info, WrappedCollection>>,

    // -------- collection NFT (MCC) --------

    /// Collection NFT mint. Deterministic PDA per-token: same token_mint
    /// always derives the same collection mint address. decimals=0,
    /// mint+freeze authority is the per-token collection_authority PDA so
    /// the program (not a wallet) signs verify_sized_collection_item
    /// during every wrap.
    #[account(
        init,
        payer = deployer,
        mint::decimals = 0,
        mint::authority = collection_authority,
        mint::freeze_authority = collection_authority,
        seeds = [b"collection_mint", token_mint.key().as_ref()],
        bump,
    )]
    pub collection_mint: Box<Account<'info, TokenMint>>,

    /// Per-token collection authority PDA. Signs as Metaplex
    /// update_authority + mint authority for the collection NFT. The
    /// same PDA signs verify_sized_collection_item during every wrap on
    /// this collection.
    /// CHECK: PDA, no data -- validated by seeds + bump.
    #[account(
        seeds = [b"collection_authority", token_mint.key().as_ref()],
        bump,
    )]
    pub collection_authority: UncheckedAccount<'info>,

    /// Deployer's ATA for the collection NFT. Receives the 1-supply mint.
    /// Holding the collection NFT in the deployer's wallet is the
    /// standard Tensor/Magic Eden pattern and lets the deployer claim
    /// the collection on Creator Hub / Tensor Creator Portal.
    ///
    /// init_if_needed because an attacker can pre-create the canonical
    /// ATA (mint + owner are both deterministically derivable from the
    /// token_mint and deployer pubkey) to make plain init fail with
    /// IllegalOwner and grief every deploy. Adoption is safe because
    /// the collection_mint is itself a PDA we initialize this same
    /// instruction -- nobody could have minted into it before now.
    #[account(
        init_if_needed,
        payer = deployer,
        associated_token::mint = collection_mint,
        associated_token::authority = deployer,
    )]
    pub deployer_collection_ata: Box<Account<'info, TokenAccountClassic>>,

    /// Metaplex metadata account for the collection NFT.
    /// CHECK: address verified by the Metaplex program during CPI.
    #[account(mut)]
    pub collection_metadata: UncheckedAccount<'info>,

    /// Metaplex master edition account for the collection NFT.
    /// CHECK: address verified by the Metaplex program during CPI.
    #[account(mut)]
    pub collection_master_edition: UncheckedAccount<'info>,

    // -------- programs --------

    /// Classic SPL Token program. Used for the NFT side (collection_mint
    /// init + mint_to + master edition; Metaplex CreateMasterEditionV3
    /// requires classic SPL).
    pub token_program: Program<'info, Token>,
    /// $WBULL-side token program (Interface: classic or Token-2022).
    /// Used for the $WBULL burn CPI. pump.fun migrated to Token-2022 in
    /// 2026 so this is almost always Token-2022 in practice.
    pub wbull_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_metadata_program: Program<'info, Metadata>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<DeployCollection>, args: DeployCollectionArgs) -> Result<()> {
    // ============================================================
    // 0. Circuit breaker check. Deliberate first step so a paused
    //    Factory rejects new deploys at minimum CU cost, before any
    //    string validation or PDA derivation.
    // ============================================================
    require!(
        !ctx.accounts.factory_config.paused,
        WrappedFactoryError::FactoryPaused
    );

    // ============================================================
    // 1. Validate all inputs FIRST, before any state changes.
    //    Atomicity guarantees that if any of these guards fire, the
    //    deployer's WBULL is NOT burned -- so a malformed args bundle
    //    cannot cost them the 1M deploy fee.
    // ============================================================

    require!(
        !args.name.is_empty() && args.name.len() <= MAX_NAME_LEN && args.name.is_ascii(),
        WrappedFactoryError::InvalidName
    );

    require!(
        !args.ticker.is_empty()
            && args.ticker.len() <= MAX_TICKER_LEN
            && args.ticker.is_ascii(),
        WrappedFactoryError::InvalidTicker
    );

    require!(
        args.max_supply >= MIN_SUPPLY && args.max_supply <= MAX_SUPPLY,
        WrappedFactoryError::InvalidSupplyRange
    );

    require!(args.tokens_per_wrap > 0, WrappedFactoryError::InvalidTokensPerWrap);

    {
        let art_uri = args.art_source.uri();
        require!(
            !art_uri.is_empty()
                && art_uri.len() <= MAX_ART_URI_LEN
                && art_uri.is_ascii()
                && !art_uri.ends_with(char::is_whitespace),
            WrappedFactoryError::InvalidArtUri
        );
    }

    require!(
        !args.collection_uri.is_empty()
            && args.collection_uri.len() <= MAX_ART_URI_LEN
            && args.collection_uri.is_ascii()
            && !args.collection_uri.ends_with(char::is_whitespace),
        WrappedFactoryError::InvalidArtUri
    );

    // ============================================================
    // 2. Sweep + transfer 1,000,000 $WBULL into bull_treasury_vault.
    //    Mint decimals are read at runtime so this works whether
    //    pump.fun's $WBULL stays at 6 decimals or ever migrates. If the
    //    deployer's balance is insufficient, the CPI fails and the
    //    entire tx (including the collection inits below) reverts -- so
    //    a partial deposit can never leak the deployer's $WBULL.
    //
    //    Before the push, we run sweep_expired() to compact pending into
    //    claimable. This both reflects the latest unlock state AND makes
    //    room for the new entry, so the cap can only bite when there are
    //    truly 256 unsettled (< 7d old) deposits backed up.
    // ============================================================
    let now = Clock::get()?.unix_timestamp;
    let decimals = ctx.accounts.wbull_mint.decimals;
    let amount = DEPLOY_BURN_AMOUNT_UI
        .checked_mul(10u64.pow(decimals as u32))
        .ok_or(WrappedFactoryError::InsufficientWbullForBurn)?;

    require!(
        ctx.accounts.deployer_wbull_account.amount >= amount,
        WrappedFactoryError::InsufficientWbullForBurn
    );

    // Sweep + push BEFORE the token transfer. If push fails with
    // TreasuryPendingFull, the whole tx reverts and no tokens move.
    {
        let treasury = &mut ctx.accounts.bull_treasury_state;
        treasury.sweep_expired(now);
        treasury.push_deposit(amount, now)?;
    }

    // Token transfer: deployer -> bull_treasury_vault.
    {
        let cpi_accounts = TransferChecked {
            from:      ctx.accounts.deployer_wbull_account.to_account_info(),
            mint:      ctx.accounts.wbull_mint.to_account_info(),
            to:        ctx.accounts.bull_treasury_vault.to_account_info(),
            authority: ctx.accounts.deployer.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.wbull_token_program.key(),
            cpi_accounts,
        );
        token_interface::transfer_checked(cpi_ctx, amount, decimals)?;
    }

    // Track the deposit for the public /launch stat strip. Note: not
    // total_wbull_BURNED -- the field rename signals the model shift
    // away from deflationary burn and toward treasury accrual.
    {
        let cfg = &mut ctx.accounts.factory_config;
        cfg.total_wbull_deposited = cfg.total_wbull_deposited.saturating_add(amount);
    }

    // ============================================================
    // 3. Mint 1 of the collection NFT to deployer's collection ATA.
    //    Signed by the per-token collection_authority PDA.
    // ============================================================
    let token_mint_key = ctx.accounts.token_mint.key();
    let coll_auth_bump = ctx.bumps.collection_authority;
    let coll_signer_seeds: &[&[&[u8]]] = &[&[
        b"collection_authority",
        token_mint_key.as_ref(),
        &[coll_auth_bump],
    ]];

    {
        let cpi_accounts = MintTo {
            mint: ctx.accounts.collection_mint.to_account_info(),
            to: ctx.accounts.deployer_collection_ata.to_account_info(),
            authority: ctx.accounts.collection_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            cpi_accounts,
            coll_signer_seeds,
        );
        token::mint_to(cpi_ctx, 1)?;
    }

    // ============================================================
    // 4. Create Metaplex metadata for the collection NFT.
    //    collection_details = Some(CollectionDetails::V1 { size: 0 })
    //    marks this as a SIZED collection -- size auto-increments as
    //    wrap NFTs verify into it later.
    // ============================================================
    {
        let data = DataV2 {
            name:                    args.name.clone(),
            symbol:                  args.ticker.clone(),
            uri:                     args.collection_uri.clone(),
            seller_fee_basis_points: 0,
            creators:                None,
            collection:              None,
            uses:                    None,
        };
        let cpi_accounts = CreateMetadataAccountsV3 {
            metadata:         ctx.accounts.collection_metadata.to_account_info(),
            mint:             ctx.accounts.collection_mint.to_account_info(),
            mint_authority:   ctx.accounts.collection_authority.to_account_info(),
            payer:            ctx.accounts.deployer.to_account_info(),
            update_authority: ctx.accounts.collection_authority.to_account_info(),
            system_program:   ctx.accounts.system_program.to_account_info(),
            rent:             ctx.accounts.rent.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_metadata_program.key(),
            cpi_accounts,
            coll_signer_seeds,
        );
        metadata::create_metadata_accounts_v3(
            cpi_ctx,
            data,
            true,                                    // is_mutable
            true,                                    // update_authority_is_signer
            Some(CollectionDetails::V1 { size: 0 }), // sized collection
        )?;
    }

    // ============================================================
    // 5. Create master edition for the collection NFT (caps supply at 1).
    // ============================================================
    {
        let cpi_accounts = CreateMasterEditionV3 {
            edition:          ctx.accounts.collection_master_edition.to_account_info(),
            mint:             ctx.accounts.collection_mint.to_account_info(),
            update_authority: ctx.accounts.collection_authority.to_account_info(),
            mint_authority:   ctx.accounts.collection_authority.to_account_info(),
            payer:            ctx.accounts.deployer.to_account_info(),
            metadata:         ctx.accounts.collection_metadata.to_account_info(),
            token_program:    ctx.accounts.token_program.to_account_info(),
            system_program:   ctx.accounts.system_program.to_account_info(),
            rent:             ctx.accounts.rent.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_metadata_program.key(),
            cpi_accounts,
            coll_signer_seeds,
        );
        metadata::create_master_edition_v3(cpi_ctx, Some(0))?;
    }

    // ============================================================
    // 6. Initialize the WrappedCollection PDA with everything wrap and
    //    unwrap will need to operate on this deployment.
    // ============================================================
    let collection = &mut ctx.accounts.collection;
    collection.token_mint       = ctx.accounts.token_mint.key();
    collection.deployer         = ctx.accounts.deployer.key();
    collection.name             = args.name.clone();
    collection.ticker           = args.ticker.clone();
    collection.art_source       = args.art_source.clone();
    collection.max_supply       = args.max_supply;
    collection.tokens_per_wrap  = args.tokens_per_wrap;
    collection.collection_mint  = ctx.accounts.collection_mint.key();
    collection.total_wrapped    = 0;
    collection.total_unwrapped  = 0;
    collection.in_circulation   = 0;
    collection.next_tier        = 1;
    collection.free_tiers       = Vec::new();
    collection.created_at       = Clock::get()?.unix_timestamp;
    collection.bump             = ctx.bumps.collection;
    collection.verified         = false; // flipped to true by set_verified ix
    collection.reserved         = [0u8; 63];

    // ============================================================
    // 7. Bump deployment counter.
    //    (total_wbull_burned was bumped together with the burn CPI above
    //    so the counter reflects only burns that actually succeeded.)
    // ============================================================
    let cfg = &mut ctx.accounts.factory_config;
    cfg.total_deployments = cfg.total_deployments.saturating_add(1);

    msg!(
        "WrappedCollection deployed: name={} ticker={} token_mint={} deployer={} collection_mint={}",
        collection.name,
        collection.ticker,
        collection.token_mint,
        collection.deployer,
        collection.collection_mint
    );

    Ok(())
}
