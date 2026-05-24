use anchor_lang::prelude::*;
use crate::MAX_BULLS;

/// Singleton PDA holding global protocol state.
/// Seed: ["bank"]
///
/// Tracks tier lifecycle (next_tier counter + free_tiers stack), wrap/unwrap
/// counters, and the locked $TOKEN mint that this wrappedbulls deployment wraps.
///
/// Note: no `#[derive(Default)]` because `[u8; 64]` does not implement
/// Default in Rust's std. Anchor's `init` constraint zero-initializes the
/// account, and the handler explicitly populates every field.
#[account]
pub struct BullBank {
    /// $TOKEN mint address (set at initialize, immutable thereafter).
    /// Pump.fun-launched tokens have null mint authority, so this is always
    /// safe to lock — the mint can never be inflated/changed.
    pub token_mint: Pubkey,

    /// Total bulls wrapped across protocol lifetime (lifetime counter).
    pub total_wrapped: u64,

    /// Total bulls unwrapped across protocol lifetime.
    pub total_unwrapped: u64,

    /// Currently in-circulation bulls (= total_wrapped - total_unwrapped).
    pub in_circulation: u16,

    /// Lowest tier that has never been wrapped. Starts at 1; increments after
    /// each wrap that drains a "fresh" tier (i.e., free_tiers is empty).
    /// When `next_tier > MAX_BULLS` and `free_tiers` is empty, no more bulls
    /// can be wrapped (cap reached).
    pub next_tier: u16,

    /// Stack of tiers that were once wrapped, then unwrapped, and are now
    /// awaiting reuse. On wrap: pop here first; if empty, take from
    /// next_tier counter. On unwrap: push tier here. Reused tiers re-roll
    /// their visual because the new wrap creates a fresh NFT mint.
    pub free_tiers: Vec<u16>,

    /// Admin authority (program upgrade only — token side is pump.fun-immutable).
    pub authority: Pubkey,

    /// PDA bump.
    pub bump: u8,

    /// Metaplex Certified Collection (MCC) NFT mint. Set by
    /// `initialize_collection` after `initialize`. Pubkey::default() until
    /// then. Each `wrap_bull` references this and verifies the freshly
    /// minted bull NFT into this collection (so Magic Eden / Tensor /
    /// Phantom recognise the collection).
    ///
    /// Layout note: this slot was carved out of the original 64-byte
    /// `reserved` block, so the on-chain account size is unchanged. Existing
    /// banks deserialize this field as Pubkey::default() (all zeros) until
    /// initialize_collection writes it.
    pub collection_mint: Pubkey,

    /// Reserved for future fields. Do not remove without state migration.
    pub reserved: [u8; 32],
}

impl BullBank {
    /// Account discriminator (8) + fixed fields + free_tiers Vec<u16>
    /// (4 bytes len prefix + 2 bytes per element, capacity == MAX_BULLS).
    pub const SIZE: usize = 8           // anchor discriminator
        + 32                            // token_mint
        + 8                             // total_wrapped
        + 8                             // total_unwrapped
        + 2                             // in_circulation
        + 2                             // next_tier
        + 4 + (MAX_BULLS as usize) * 2  // free_tiers vec (max capacity)
        + 32                            // authority
        + 1                             // bump
        + 32                            // collection_mint
        + 32;                           // reserved (was 64; 32 carved out for collection_mint)

    /// Pop next available tier (free first, then fresh). Caller is responsible
    /// for incrementing in_circulation and total_wrapped.
    pub fn pop_tier(&mut self) -> Result<u16> {
        if let Some(t) = self.free_tiers.pop() {
            return Ok(t);
        }
        if self.next_tier as u64 > MAX_BULLS as u64 {
            return Err(crate::errors::WrappedbullsError::MaxBullsReached.into());
        }
        let t = self.next_tier;
        self.next_tier = self.next_tier.checked_add(1)
            .ok_or(crate::errors::WrappedbullsError::MaxBullsReached)?;
        Ok(t)
    }

    /// Return an unwrapped tier to the free stack.
    pub fn push_tier(&mut self, tier: u16) {
        self.free_tiers.push(tier);
    }
}

/// Per-bull PDA created on wrap, closed on unwrap (rent reclaimed).
/// Seed: ["bull", tier_index_le_bytes]
///
/// Each BullAsset is paired with:
///   - an NFT mint at the address `nft_mint` (Metaplex Token Metadata NFT)
///   - a vault token account at PDA(["vault", nft_mint]) holding 1M $TOKEN
///
/// The vault's authority is the same PDA derived from the NFT mint, so when
/// the NFT trades on a marketplace the vault's tokens follow the new owner
/// (whoever holds the NFT can sign as the vault PDA via this program).
///
/// The deterministic SVG renderer seeds from `nft_mint` so the visual is
/// locked at wrap time and stays consistent through transfers. When a tier
/// is reused after unwrap, a fresh nft_mint is generated → new visual.
#[account]
pub struct BullAsset {
    /// NFT mint address (Metaplex NFT representing this bull).
    /// The vault and visual are both derived from this address.
    pub nft_mint: Pubkey,

    /// Tier index 1..=MAX_BULLS (the "WrappedBulls #N" public identifier).
    pub tier_index: u16,

    /// Wrap timestamp (unix seconds).
    pub wrapped_at: i64,

    /// PDA bump.
    pub bump: u8,
}

impl BullAsset {
    pub const SIZE: usize = 8           // anchor discriminator
        + 32                            // nft_mint
        + 2                             // tier_index
        + 8                             // wrapped_at
        + 1;                            // bump
}

// ============================================================
// Unit tests for tier accounting (no on-chain CPIs).
//
// Run with `cargo test --manifest-path programs/wrappedbulls/Cargo.toml`.
// These directly exercise pop_tier / push_tier on a constructed
// BullBank, covering: fresh start, exhaustion, free_tiers preference,
// MAX_BULLS cap, and the post-unwrap reuse cycle.
// ============================================================
#[cfg(test)]
mod tier_accounting_tests {
    use super::*;

    fn fresh_bank() -> BullBank {
        BullBank {
            token_mint: Pubkey::default(),
            total_wrapped: 0,
            total_unwrapped: 0,
            in_circulation: 0,
            next_tier: 1,
            free_tiers: Vec::new(),
            authority: Pubkey::default(),
            bump: 0,
            collection_mint: Pubkey::default(),
            reserved: [0u8; 32],
        }
    }

    #[test]
    fn pop_tier_first_wrap_returns_1() {
        let mut bank = fresh_bank();
        let t = bank.pop_tier().unwrap();
        assert_eq!(t, 1);
        assert_eq!(bank.next_tier, 2);
        assert!(bank.free_tiers.is_empty());
    }

    #[test]
    fn pop_tier_sequential_returns_1_through_5() {
        let mut bank = fresh_bank();
        for expected in 1u16..=5 {
            assert_eq!(bank.pop_tier().unwrap(), expected);
        }
        assert_eq!(bank.next_tier, 6);
    }

    #[test]
    fn pop_tier_prefers_free_tiers_stack_over_next_tier() {
        let mut bank = fresh_bank();
        bank.next_tier = 50;
        bank.push_tier(7);
        bank.push_tier(13);
        // free_tiers is a stack — last pushed comes out first
        assert_eq!(bank.pop_tier().unwrap(), 13);
        assert_eq!(bank.pop_tier().unwrap(), 7);
        // free_tiers exhausted; next pop falls back to next_tier (50)
        assert_eq!(bank.pop_tier().unwrap(), 50);
        assert_eq!(bank.next_tier, 51);
    }

    #[test]
    fn pop_tier_at_max_bulls_succeeds() {
        // next_tier == MAX_BULLS (1000) → wrap should succeed and return 1000
        let mut bank = fresh_bank();
        bank.next_tier = MAX_BULLS;
        let t = bank.pop_tier().unwrap();
        assert_eq!(t, MAX_BULLS);
        assert_eq!(bank.next_tier, MAX_BULLS + 1);
    }

    #[test]
    fn pop_tier_above_max_bulls_fails_with_max_bulls_reached() {
        // next_tier == MAX_BULLS + 1 (1001) → no fresh tiers left, should fail
        let mut bank = fresh_bank();
        bank.next_tier = MAX_BULLS + 1;
        let err = bank.pop_tier().unwrap_err();
        // Anchor wraps errors; we just confirm it errored.
        // Spot-check the error rendering contains MaxBullsReached.
        let msg = format!("{:?}", err);
        assert!(
            msg.contains("MaxBullsReached"),
            "expected MaxBullsReached, got: {}",
            msg
        );
        // State should be unchanged (no consumption on failure)
        assert_eq!(bank.next_tier, MAX_BULLS + 1);
    }

    #[test]
    fn pop_tier_at_cap_can_still_use_free_tiers_after_unwraps() {
        // next_tier exhausted, but unwraps freed some tiers:
        // wrap should still succeed using free_tiers stack
        let mut bank = fresh_bank();
        bank.next_tier = MAX_BULLS + 1; // fresh tiers exhausted
        bank.push_tier(42); // some user unwrapped tier 42
        bank.push_tier(99);
        // pops from stack first, in LIFO order
        assert_eq!(bank.pop_tier().unwrap(), 99);
        assert_eq!(bank.pop_tier().unwrap(), 42);
        // stack now empty, fresh exhausted → next pop must fail
        let err = bank.pop_tier().unwrap_err();
        let msg = format!("{:?}", err);
        assert!(msg.contains("MaxBullsReached"));
    }

    #[test]
    fn full_lifecycle_1000_wraps_then_1001st_fails() {
        // Drain all 1000 fresh tiers. Then 1001st must fail.
        let mut bank = fresh_bank();
        for expected in 1u16..=MAX_BULLS {
            assert_eq!(bank.pop_tier().unwrap(), expected);
        }
        assert_eq!(bank.next_tier, MAX_BULLS + 1);
        // 1001st wrap must fail
        let err = bank.pop_tier().unwrap_err();
        let msg = format!("{:?}", err);
        assert!(
            msg.contains("MaxBullsReached"),
            "expected MaxBullsReached on 1001st wrap, got: {}",
            msg
        );
    }

    #[test]
    fn unwrap_then_rewrap_uses_freed_tier() {
        // After 1000 wraps, push tier 17 (an unwrap). Next pop returns 17.
        let mut bank = fresh_bank();
        for _ in 1u16..=MAX_BULLS {
            bank.pop_tier().unwrap();
        }
        bank.push_tier(17);
        let t = bank.pop_tier().unwrap();
        assert_eq!(t, 17);
        // free_tiers is empty again, fresh tiers still exhausted
        assert!(bank.free_tiers.is_empty());
        // Next pop should fail (fresh exhausted, no more freed)
        assert!(bank.pop_tier().is_err());
    }

    #[test]
    fn push_tier_appends_to_free_stack() {
        let mut bank = fresh_bank();
        assert!(bank.free_tiers.is_empty());
        bank.push_tier(5);
        bank.push_tier(10);
        assert_eq!(bank.free_tiers, vec![5, 10]);
    }
}
