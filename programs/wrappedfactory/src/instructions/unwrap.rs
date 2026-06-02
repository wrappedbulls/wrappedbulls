// unwrap: drain the locked tokens back to the NFT holder and burn the
// NFT. Mirrors wrappedbulls::unwrap_bull one-for-one but reads
// tokens_per_wrap from the WrappedCollection PDA (not a compile-time
// constant) and namespaces every PDA by the collection's token_mint.
//
// Sequence:
//   1. Verify caller's NFT ATA holds 1 of nft_mint
//   2. Verify vault holds AT LEAST tokens_per_wrap (donated extras above
//      the threshold flow to the holder, just like wrappedbulls)
//   3. Drain the FULL vault balance to caller (so donated grief tokens
//      cannot strand)
//   4. Close the vault token account; rent flows to caller
//   5. Burn the NFT via Metaplex burn_nft (closes mint + ATA + metadata
//      + master_edition; also decrements collection_details.size on the
//      parent MCC)
//   6. Close BullAsset PDA; rent flows to caller
//   7. Push tier_index back to collection.free_tiers; bump
//      total_unwrapped; decrement in_circulation

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint as TokenMint, Token, TokenAccount as TokenAccountClassic};
use anchor_spl::token_interface::{
    self,
    CloseAccount as CloseAccountIf,
    Mint as MintIf,
    TokenAccount as TokenAccountIf,
    TokenInterface,
    TransferChecked,
};
use anchor_spl::metadata::{self, BurnNft, Metadata};

use crate::state::{BullAsset, WrappedCollection};
use crate::errors::WrappedFactoryError;

#[derive(Accounts)]
#[instruction(tier_index: u16)]
pub struct Unwrap<'info> {
    /// The deployment's WrappedCollection PDA. Mutated at the end for
    /// tier reuse + counter updates.
    #[account(
        mut,
        seeds = [b"collection", collection.token_mint.as_ref()],
        bump = collection.bump,
    )]
    pub collection: Box<Account<'info, WrappedCollection>>,

    /// The unwrapping wallet. Receives the drained tokens AND the rent
    /// reclaimed from closing the vault + BullAsset accounts.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Caller's token account (destination of the unwrapped tokens).
    /// InterfaceAccount for Token-2022 compatibility.
    #[account(
        mut,
        constraint = payer_token_account.owner == payer.key(),
        constraint = payer_token_account.mint == collection.token_mint
            @ WrappedFactoryError::WrongTokenMint,
    )]
    pub payer_token_account: Box<InterfaceAccount<'info, TokenAccountIf>>,

    /// Target token mint (must match collection.token_mint).
    #[account(
        constraint = token_mint.key() == collection.token_mint
            @ WrappedFactoryError::WrongTokenMint,
    )]
    pub token_mint: Box<InterfaceAccount<'info, MintIf>>,

    /// The bull's NFT mint. Must match the BullAsset record. After
    /// burn_nft, this account is closed.
    #[account(
        mut,
        constraint = nft_mint.key() == bull_asset.nft_mint
            @ WrappedFactoryError::NftMintMismatch,
    )]
    pub nft_mint: Box<Account<'info, TokenMint>>,

    /// Vault authority + NFT mint authority. PDA derived from nft_mint.
    /// Used to sign the vault drain + close.
    /// CHECK: PDA, no data.
    #[account(
        seeds = [b"vault", nft_mint.key().as_ref()],
        bump,
    )]
    pub nft_mint_authority: UncheckedAccount<'info>,

    /// Vault token account holding the locked tokens. ATA owned by
    /// nft_mint_authority. The constraint requires >= tokens_per_wrap
    /// (not == exactly): if a griefer mints/transfers extra tokens to
    /// this canonical ATA to try to brick a strict-equality check, we
    /// still proceed and drain the FULL balance to the holder. Donating
    /// tokens to the vault is a gift to the holder, not a brick.
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = nft_mint_authority,
        associated_token::token_program = bulls_token_program,
        constraint = vault.amount >= collection.tokens_per_wrap
            @ WrappedFactoryError::VaultBalanceMismatch,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccountIf>>,

    /// Caller's NFT ATA. Must hold 1 of nft_mint (proves ownership).
    /// Closed by burn_nft.
    #[account(
        mut,
        associated_token::mint = nft_mint,
        associated_token::authority = payer,
        constraint = payer_nft_account.amount == 1
            @ WrappedFactoryError::NotNftHolder,
    )]
    pub payer_nft_account: Box<Account<'info, TokenAccountClassic>>,

    /// BullAsset record. Closed at the end of this ix; rent flows to
    /// caller.
    #[account(
        mut,
        seeds = [
            b"bull",
            collection.token_mint.as_ref(),
            &tier_index.to_le_bytes()
        ],
        bump = bull_asset.bump,
        constraint = bull_asset.tier_index == tier_index
            @ WrappedFactoryError::TierMismatch,
        close = payer,
    )]
    pub bull_asset: Box<Account<'info, BullAsset>>,

    /// Metaplex metadata account (closed by burn_nft).
    /// CHECK: address verified by Metaplex during CPI.
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,

    /// Metaplex master edition (closed by burn_nft).
    /// CHECK: address verified by Metaplex during CPI.
    #[account(mut)]
    pub master_edition: UncheckedAccount<'info>,

    // -------- collection (MCC) accounts for burn_nft on verified collection --------

    /// Collection NFT mint (must equal collection.collection_mint).
    /// CHECK: pubkey-equality validated via constraint.
    #[account(
        constraint = collection_mint.key() == collection.collection_mint
            @ WrappedFactoryError::WrongCollection,
    )]
    pub collection_mint: UncheckedAccount<'info>,

    /// Collection NFT's metadata. mut because burn_nft decrements the
    /// sized-collection size counter.
    /// CHECK: validated by Metaplex during the burn CPI.
    #[account(mut)]
    pub collection_metadata: UncheckedAccount<'info>,

    // -------- programs --------

    /// Classic SPL Token program. Used by Metaplex BurnNft on the NFT side.
    pub token_program: Program<'info, Token>,
    /// Target-token side (Interface). Used for the vault drain (transfer)
    /// + close.
    pub bulls_token_program: Interface<'info, TokenInterface>,
    pub token_metadata_program: Program<'info, Metadata>,
}

pub fn handler(ctx: Context<Unwrap>, tier_index: u16) -> Result<()> {
    let max_supply = ctx.accounts.collection.max_supply;
    require!(
        tier_index >= 1 && tier_index <= max_supply,
        WrappedFactoryError::TierOutOfBounds
    );

    // Prepare vault PDA signer seeds (used for drain + close CPIs).
    let nft_mint_key = ctx.accounts.nft_mint.key();
    let auth_bump = ctx.bumps.nft_mint_authority;
    let signer_seeds: &[&[&[u8]]] = &[&[b"vault", nft_mint_key.as_ref(), &[auth_bump]]];

    // ============================================================
    // 1. Drain the FULL vault balance to the caller.
    //    Vault balance is guaranteed >= tokens_per_wrap by the account
    //    constraint above; any extra is donation (gift to holder).
    //    Draining everything is what lets the close below always succeed.
    // ============================================================
    {
        let decimals = ctx.accounts.token_mint.decimals;
        let drain_amount = ctx.accounts.vault.amount;
        let cpi_accounts = TransferChecked {
            from:      ctx.accounts.vault.to_account_info(),
            mint:      ctx.accounts.token_mint.to_account_info(),
            to:        ctx.accounts.payer_token_account.to_account_info(),
            authority: ctx.accounts.nft_mint_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.bulls_token_program.key(),
            cpi_accounts,
            signer_seeds,
        );
        token_interface::transfer_checked(cpi_ctx, drain_amount, decimals)?;
    }

    // ============================================================
    // 2. Close the vault token account; rent -> caller.
    // ============================================================
    {
        let cpi_accounts = CloseAccountIf {
            account:     ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.payer.to_account_info(),
            authority:   ctx.accounts.nft_mint_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.bulls_token_program.key(),
            cpi_accounts,
            signer_seeds,
        );
        token_interface::close_account(cpi_ctx)?;
    }

    // ============================================================
    // 3. Burn the NFT (closes mint, ATA, metadata, master_edition).
    //    Since metadata.collection.verified = true (set during wrap),
    //    Metaplex's burn_nft requires:
    //      - collection_metadata pubkey passed as the Option<Pubkey> arg
    //      - collection_metadata AccountInfo in remaining_accounts (mut)
    //    so it can decrement collection_details.size on the parent MCC.
    // ============================================================
    {
        let cpi_accounts = BurnNft {
            metadata:  ctx.accounts.metadata.to_account_info(),
            owner:     ctx.accounts.payer.to_account_info(),
            mint:      ctx.accounts.nft_mint.to_account_info(),
            token:     ctx.accounts.payer_nft_account.to_account_info(),
            edition:   ctx.accounts.master_edition.to_account_info(),
            spl_token: ctx.accounts.token_program.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_metadata_program.key(),
            cpi_accounts,
        )
        .with_remaining_accounts(vec![
            ctx.accounts.collection_metadata.to_account_info(),
        ]);
        metadata::burn_nft(cpi_ctx, Some(ctx.accounts.collection_metadata.key()))?;
    }

    // ============================================================
    // 4. Update collection state: push tier back + bump counters.
    //    BullAsset is closed automatically by Anchor (close = payer
    //    constraint above).
    // ============================================================
    let collection = &mut ctx.accounts.collection;
    collection.push_tier(tier_index);
    collection.total_unwrapped = collection.total_unwrapped.saturating_add(1);
    collection.in_circulation = collection.in_circulation.saturating_sub(1);

    msg!(
        "Unwrap: token_mint={} tier={} nft_mint={} payer={}",
        collection.token_mint,
        tier_index,
        nft_mint_key,
        ctx.accounts.payer.key()
    );

    Ok(())
}
