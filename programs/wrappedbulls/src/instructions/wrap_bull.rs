use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{
    self, Mint, MintTo, Token, TokenAccount,
};
use anchor_spl::token_interface::{
    self,
    Mint as MintIf,
    TokenAccount as TokenAccountIf,
    TokenInterface,
    TransferChecked,
};
use anchor_spl::metadata::{
    self,
    mpl_token_metadata::types::{Collection, Creator, DataV2},
    CreateMasterEditionV3, CreateMetadataAccountsV3, Metadata,
    VerifySizedCollectionItem,
};

use crate::state::{BullAsset, BullBank};
use crate::errors::WrappedbullsError;
use crate::{
    MAX_BULLS, TOKENS_PER_BULL,
    ROYALTY_TREASURY, ROYALTY_BPS,
    PROJECT_NAME, TICKER, NFT_URI_BASE,
};

// Treasury wallet, royalty BPS, and NFT name/symbol/URI now come from
// config/launch.toml via build.rs codegen. The creator is intentionally
// `verified: false` (wrap_bull is permissionless, so the treasury
// cannot sign every mint to self-verify). Collection trust comes from
// the verified Metaplex Certified Collection (MCC), not from creator
// verification; ME/Tensor still honor `seller_fee_basis_points` and
// route the royalty to ROYALTY_TREASURY regardless of the verified flag.

/// Wrap 1,000,000 $TOKEN into a bull NFT.
///
/// Mechanic (ERC404-style hybrid):
/// 1. Caller's balance must be >= 1M $TOKEN.
/// 2. Pop a tier index from BullBank (free_tiers stack first, then next_tier).
/// 3. Initialize a fresh NFT mint (the caller-provided keypair signs).
/// 4. Initialize a vault token account at the NFT-derived PDA — the vault's
///    authority is `PDA(["vault", nft_mint])`. Whoever holds the NFT controls
///    this PDA (via this program), so the locked tokens follow the NFT
///    through every transfer (Magic Eden / Tensor / direct send).
/// 5. Transfer 1M $TOKEN: caller -> vault.
/// 6. Mint 1 of the new NFT to caller's ATA.
/// 7. Create Metaplex metadata + master edition (locks supply at 1, unique).
/// 8. Init BullAsset PDA recording (nft_mint, tier_index, wrapped_at).
///
/// The visual is generated deterministically from `nft_mint` by the off-chain
/// renderer — locked at wrap time, follows the NFT through transfers.
#[derive(Accounts)]
#[instruction(tier_index: u16)]
pub struct WrapBull<'info> {
    #[account(
        mut,
        seeds = [b"bank"],
        bump = bank.bump,
    )]
    pub bank: Account<'info, BullBank>,

    /// The wrapping wallet. Signs to authorize:
    ///   - 1M $TOKEN transfer out of their token account
    ///   - rent payment for new NFT mint, vault, ATAs, and BullAsset PDA
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Caller's $TOKEN account (source of the 1M tokens being locked).
    /// `InterfaceAccount` so this works for BOTH classic SPL Token AND
    /// Token-2022 mints (pump.fun migrated to Token-2022 in 2026 — the
    /// mint at `bank.token_mint` is owned by the Token-2022 program).
    /// Boxed to keep the WrapBull stack frame under Solana's 4096-byte limit.
    #[account(
        mut,
        constraint = payer_token_account.owner == payer.key(),
        constraint = payer_token_account.mint == bank.token_mint @ WrappedbullsError::WrongMint,
    )]
    pub payer_token_account: Box<InterfaceAccount<'info, TokenAccountIf>>,

    /// $TOKEN mint (must match bank.token_mint — locked at initialize).
    /// `InterfaceAccount` so this transparently supports Token-2022.
    #[account(constraint = token_mint.key() == bank.token_mint @ WrappedbullsError::WrongMint)]
    pub token_mint: Box<InterfaceAccount<'info, MintIf>>,

    /// NFT mint for this bull. PDA derived from the bank's pre-increment
    /// `total_wrapped` value, so each wrap gets a unique mint address
    /// without requiring an external Keypair signer client-side. This is
    /// the single-signer pattern Phantom's docs recommend (Domain and
    /// transaction warnings, bullet 1) and lets Lighthouse simulate the
    /// tx cleanly without flagging it as a suspicious multi-signer pattern.
    ///
    /// Re-roll-on-tier-reuse is preserved: total_wrapped monotonically
    /// increases, so re-wrapped tier #42 (at total_wrapped=42) and
    /// re-wrapped tier #42 (later at total_wrapped=N) have different mint
    /// addresses and therefore different generative visuals.
    #[account(
        init,
        payer = payer,
        mint::decimals = 0,
        mint::authority = nft_mint_authority,
        mint::freeze_authority = nft_mint_authority,
        seeds = [b"nft_mint", bank.total_wrapped.to_le_bytes().as_ref()],
        bump,
    )]
    pub nft_mint: Box<Account<'info, Mint>>,

    /// PDA derived from the NFT mint. This single PDA serves as:
    ///   - the NFT mint's mint+freeze authority (until master edition takes over)
    ///   - the vault token account's authority (so vault tokens follow the NFT)
    /// CHECK: PDA, no data — validated by seeds + bump.
    #[account(
        seeds = [b"vault", nft_mint.key().as_ref()],
        bump,
    )]
    pub nft_mint_authority: UncheckedAccount<'info>,

    /// Vault: ATA owned by `nft_mint_authority` PDA, holding the 1M $TOKEN.
    /// Address is deterministic — anyone can compute it from (nft_mint, $TOKEN).
    /// `InterfaceAccount` + `associated_token::token_program` so the ATA is
    /// created with the SAME program (classic SPL or Token-2022) that owns
    /// the $TOKEN mint. For pump.fun Token-2022 mints this derives the
    /// Token-2022 ATA address, which is different from the classic SPL ATA.
    #[account(
        init,
        payer = payer,
        associated_token::mint = token_mint,
        associated_token::authority = nft_mint_authority,
        associated_token::token_program = bulls_token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccountIf>>,

    /// Caller's ATA for the new NFT — receives 1 of the freshly minted NFT.
    #[account(
        init,
        payer = payer,
        associated_token::mint = nft_mint,
        associated_token::authority = payer,
    )]
    pub payer_nft_account: Box<Account<'info, TokenAccount>>,

    /// BullAsset record — created here, closed on unwrap.
    /// Seed: ["bull", tier_index_le_bytes]. Init failure protects against
    /// race conditions (two simultaneous wraps cannot claim the same tier).
    #[account(
        init,
        payer = payer,
        space = BullAsset::SIZE,
        seeds = [b"bull", tier_index.to_le_bytes().as_ref()],
        bump,
    )]
    pub bull_asset: Box<Account<'info, BullAsset>>,

    /// Metaplex metadata account for the NFT.
    /// CHECK: address is verified by the Metaplex program during CPI
    /// (it requires the standard PDA derivation).
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,

    /// Metaplex master edition account (limits supply to 1).
    /// CHECK: address verified by Metaplex program during CPI.
    #[account(mut)]
    pub master_edition: UncheckedAccount<'info>,

    // ============ Metaplex Certified Collection accounts ============
    //
    // Each wrap_bull verifies its NFT into the program-managed collection
    // so Magic Eden / Tensor / Phantom recognise the bulls as a real
    // collection. The collection is created once by `initialize_collection`
    // and its mint is stored in `bank.collection_mint`.

    /// Collection NFT mint (must equal `bank.collection_mint`).
    /// Constraint blocks any wrap before the collection is initialized
    /// (CollectionNotInitialized — bank.collection_mint == default).
    /// CHECK: pubkey-equality validated via constraint; the Metaplex
    /// verify CPI revalidates everything else.
    #[account(
        constraint = collection_mint.key() != Pubkey::default()
            @ WrappedbullsError::CollectionNotInitialized,
        constraint = collection_mint.key() == bank.collection_mint
            @ WrappedbullsError::WrongCollection,
    )]
    pub collection_mint: UncheckedAccount<'info>,

    /// Collection NFT's Metaplex metadata account.
    /// CHECK: validated by Metaplex during the verify CPI.
    #[account(mut)]
    pub collection_metadata: UncheckedAccount<'info>,

    /// Collection NFT's Metaplex master edition account.
    /// CHECK: validated by Metaplex during the verify CPI.
    pub collection_master_edition: UncheckedAccount<'info>,

    /// Program PDA that signs verify_sized_collection_item as the
    /// collection's update_authority. Same PDA established by
    /// initialize_collection.
    /// CHECK: PDA, no data — validated by seeds + bump.
    #[account(
        seeds = [b"collection_authority"],
        bump,
    )]
    pub collection_authority: UncheckedAccount<'info>,

    /// Classic SPL Token program. Used for the NFT side (mint_to + Metaplex
    /// CreateMasterEditionV3 requires classic SPL).
    pub token_program: Program<'info, Token>,
    /// $WBULL-side token program (`Interface` so it accepts either classic
    /// SPL or Token-2022). pump.fun migrated to Token-2022 in 2026; with
    /// this field the program transparently supports either.
    pub bulls_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_metadata_program: Program<'info, Metadata>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<WrapBull>, tier_index: u16) -> Result<()> {
    // === 1. Validate balance ===
    let balance = ctx.accounts.payer_token_account.amount;
    require!(balance >= TOKENS_PER_BULL, WrappedbullsError::InsufficientBalance);

    // === 2. Validate + pop tier ===
    require!(
        tier_index >= 1 && tier_index <= MAX_BULLS,
        WrappedbullsError::TierOutOfBounds
    );
    let popped = ctx.accounts.bank.pop_tier()?;
    require!(popped == tier_index, WrappedbullsError::TierMismatch);

    // === 3. Transfer 1M $TOKEN: payer -> vault ===
    // Uses `transfer_checked` (required by Token-2022; also accepted by
    // classic SPL Token). The mint + decimals are validated by the program,
    // making the CPI safe against decimals-confusion attacks.
    {
        let decimals = ctx.accounts.token_mint.decimals;
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.payer_token_account.to_account_info(),
            mint: ctx.accounts.token_mint.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.payer.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.bulls_token_program.key(),
            cpi_accounts,
        );
        token_interface::transfer_checked(cpi_ctx, TOKENS_PER_BULL, decimals)?;
    }

    // === Prepare PDA signer seeds (used for mint_to + Metaplex CPIs) ===
    let nft_mint_key = ctx.accounts.nft_mint.key();
    let auth_bump = ctx.bumps.nft_mint_authority;
    let signer_seeds: &[&[&[u8]]] = &[&[b"vault", nft_mint_key.as_ref(), &[auth_bump]]];

    // === 4. Mint 1 NFT to payer's ATA ===
    {
        let cpi_accounts = MintTo {
            mint: ctx.accounts.nft_mint.to_account_info(),
            to: ctx.accounts.payer_nft_account.to_account_info(),
            authority: ctx.accounts.nft_mint_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            cpi_accounts,
            signer_seeds,
        );
        token::mint_to(cpi_ctx, 1)?;
    }

    // === 5. Create Metaplex metadata account ===
    //
    // collection: Some(...) with verified=false at create time. We then
    // call verify_sized_collection_item below, which flips verified=true.
    // (Metaplex requires the unverified→verified transition; you cannot
    // create metadata as already-verified.)
    {
        let data = DataV2 {
            name: format!("{} #{}", PROJECT_NAME, tier_index),
            symbol: TICKER.to_string(),
            uri: format!("{}{}", NFT_URI_BASE, tier_index),
            seller_fee_basis_points: ROYALTY_BPS,
            creators: Some(vec![Creator {
                address: ROYALTY_TREASURY,
                verified: false,
                share: 100,
            }]),
            collection: Some(Collection {
                key: ctx.accounts.collection_mint.key(),
                verified: false,
            }),
            uses: None,
        };
        let cpi_accounts = CreateMetadataAccountsV3 {
            metadata: ctx.accounts.metadata.to_account_info(),
            mint: ctx.accounts.nft_mint.to_account_info(),
            mint_authority: ctx.accounts.nft_mint_authority.to_account_info(),
            payer: ctx.accounts.payer.to_account_info(),
            update_authority: ctx.accounts.nft_mint_authority.to_account_info(),
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
            true,  // is_mutable
            true,  // update_authority_is_signer
            None,  // collection_details
        )?;
    }

    // === 6. Create master edition (max_supply=0 → 1-of-1, locks supply at 1) ===
    {
        let cpi_accounts = CreateMasterEditionV3 {
            edition: ctx.accounts.master_edition.to_account_info(),
            mint: ctx.accounts.nft_mint.to_account_info(),
            update_authority: ctx.accounts.nft_mint_authority.to_account_info(),
            mint_authority: ctx.accounts.nft_mint_authority.to_account_info(),
            payer: ctx.accounts.payer.to_account_info(),
            metadata: ctx.accounts.metadata.to_account_info(),
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

    // === 6.5 Verify the bull's NFT into the Metaplex Certified Collection ===
    //
    // Flips this bull's metadata.collection.verified from false → true and
    // increments collection_details.size on the parent collection NFT.
    // After this CPI, marketplaces (Tensor / Magic Eden) and wallets
    // (Phantom) will recognise this NFT as a verified member of the
    // WrappedBulls collection. Without this step, listings would show
    // DYOR / "unverified collection" warnings.
    //
    // Signed by `collection_authority` PDA, which was set as the
    // collection metadata's update_authority during initialize_collection.
    {
        let coll_auth_bump = ctx.bumps.collection_authority;
        let coll_signer_seeds: &[&[&[u8]]] = &[&[b"collection_authority", &[coll_auth_bump]]];

        let cpi_accounts = VerifySizedCollectionItem {
            payer: ctx.accounts.payer.to_account_info(),
            metadata: ctx.accounts.metadata.to_account_info(),
            collection_authority: ctx.accounts.collection_authority.to_account_info(),
            collection_mint: ctx.accounts.collection_mint.to_account_info(),
            collection_metadata: ctx.accounts.collection_metadata.to_account_info(),
            collection_master_edition: ctx.accounts.collection_master_edition.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_metadata_program.key(),
            cpi_accounts,
            coll_signer_seeds,
        );
        metadata::verify_sized_collection_item(cpi_ctx, None)?;
    }

    // === 7. Initialize BullAsset record ===
    let bull = &mut ctx.accounts.bull_asset;
    bull.nft_mint = ctx.accounts.nft_mint.key();
    bull.tier_index = tier_index;
    bull.wrapped_at = Clock::get()?.unix_timestamp;
    bull.bump = ctx.bumps.bull_asset;

    // === 8. Update bank totals ===
    let bank = &mut ctx.accounts.bank;
    bank.total_wrapped = bank.total_wrapped.saturating_add(1);
    bank.in_circulation = bank.in_circulation.saturating_add(1);

    msg!(
        "Wrapped bull tier={} nft_mint={} payer={}",
        tier_index,
        ctx.accounts.nft_mint.key(),
        ctx.accounts.payer.key()
    );

    Ok(())
}
