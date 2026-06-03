use anchor_lang::prelude::*;

// =====================================================================
// Hard caps on user-supplied String fields. Account size is computed at
// `init` time from `space = ...`, so every variable-length field has a
// budgeted maximum that we pad for. Going over these limits is rejected
// in the deploy_collection handler before any state is written.
// =====================================================================

// Limits are tightened below Metaplex's raw DataV2 caps because every wrap
// composes per-NFT strings from the deployment's stored values:
//   name = "<collection.name> #<tier_index>"   <= 32 chars  (Metaplex limit)
//   symbol = "<collection.ticker>"              <= 10 chars  (Metaplex limit)
//   uri  = "<collection.art_source.uri()><tier_index>"  <= 200 chars (Metaplex limit)
//
// Max tier is 10_000 = 5 digits, plus " #" = 7 chars overhead on name and
// 5 chars overhead on uri. Picking caps that leave that headroom means no
// wrap can ever fail at the Metaplex CPI for length reasons.
pub const MAX_NAME_LEN:    usize = 25;
pub const MAX_TICKER_LEN:  usize = 10;
pub const MAX_ART_URI_LEN: usize = 195;

// Solana's CPI account-init limit is 10,240 bytes. Anchor's `init` allocates
// the full `space = ...` budget in one CPI to system_program::create_account,
// so the total WrappedCollection::SIZE must fit under that ceiling.
//
// Worst-case math (everything else fixed at the top of this file):
//   non-vec fields + discriminator + reserved = 450 bytes
//   Vec<u16> header overhead                   = 4 bytes
//   leaves ~9,786 bytes for free_tiers payload = ~4,893 entries max
//
// We pick 2_000 here because:
//   - It matches MAX_SUPPLY exactly, so push_tier never overflows even in
//     the worst-case "every bull unwrapped" scenario.
//   - It's 2x the original wrappedbulls cap of 1,000 (plenty of headroom
//     for meme-coin scale collections).
//   - Total SIZE = 450 + 4 + (2_000 * 2) = 4,454 bytes (comfortably under
//     10,240 with 2x safety margin for a future realloc-driven upgrade).
//
// Larger MAX_SUPPLY (e.g. 10k) is left to V2, which can extend the account
// post-init via realloc CPIs.
pub const FREE_TIERS_CAP:  usize = 2_000;

pub const MIN_SUPPLY: u16 = 100;
pub const MAX_SUPPLY: u16 = 2_000;

// =====================================================================
// FactoryConfig
//
// Singleton PDA: seed = ["factory_config"].
//
// Records the protocol-wide constants that the program cannot derive on
// its own (most importantly the $WBULL mint that every deploy_collection
// pulls from). Written once by `initialize`, gated to the program
// upgrade authority.
//
// Why we don't burn: pump.fun tokens have a fixed total supply (no mint
// authority). Burning $WBULL would shrink the protocol's own working
// capital -- every wrap requires 1M $WBULL of locked supply. Instead
// every deploy fee accrues to the BullTreasuryState PDA where it stays
// available for the protocol to fund development, audits, ecosystem
// grants, or to be re-wrapped into bulls itself.
// =====================================================================
#[account]
pub struct FactoryConfig {
    /// $WBULL mint address. Every deploy_collection transfers 1,000,000 of
    /// this exact mint into the bull treasury atomically. Immutable post-init.
    pub wbull_mint: Pubkey,

    /// Admin who can update non-economic config fields (reserved for V2).
    /// The deploy cost and supply bounds are NOT in this slot; they are
    /// hard-coded constants so a compromised admin cannot silently lower
    /// the deploy fee.
    pub admin: Pubkey,

    /// Total number of WrappedCollection deploys ever created. Counter
    /// for telemetry + the /launch landing page stat strip. Saturating
    /// u32 (4B deploys is comically more than realistic).
    pub total_deployments: u32,

    /// Total $WBULL deposited into the bull treasury across all deploys
    /// (lifetime, base units). Strictly monotonic. The treasury's CURRENT
    /// balance can be lower than this (after multisig claims) but
    /// total_wbull_deposited never decreases. Field name was previously
    /// total_wbull_burned in pre-pivot drafts; layout is unchanged so
    /// existing test fixtures still deserialize correctly.
    pub total_wbull_deposited: u64,

    /// PDA bump.
    pub bump: u8,

    /// Global circuit breaker. When true, the program rejects new wraps,
    /// new deploy_collections, and treasury claims. Unwraps remain
    /// permissionless and unaffected: user-locked tokens are always
    /// drainable regardless of pause state (paused unwrap would be fund
    /// capture). Flipped via the set_factory_paused ix, gated to the
    /// program upgrade authority. Default false at initialize.
    pub paused: bool,

    /// Forward-compat slack for fields we have not designed yet (V2 keeper
    /// reward params, governance, etc). Keeps the account size stable so
    /// existing deserializers keep working when we add fields here later.
    /// One byte was carved from the original 96 for `paused` above; total
    /// FactoryConfig::SIZE is unchanged.
    pub reserved: [u8; 95],
}

impl FactoryConfig {
    pub const SIZE: usize = 8                     // anchor discriminator
        + 32                                       // wbull_mint
        + 32                                       // admin
        + 4                                        // total_deployments
        + 8                                        // total_wbull_deposited
        + 1                                        // bump
        + 1                                        // paused (NEW; carved from reserved)
        + 95;                                      // reserved (was 96; net SIZE unchanged)
}

// =====================================================================
// ArtSource
//
// Per-deployment art source. The Factory does NOT host metadata; the
// deployer points at their own canonical metadata location and we read
// from there in the off-chain /api/metadata route.
//
// BaseUri      a prefix; we append `{tier_index}` to get each NFT's URI.
//              e.g. "https://wrappeddoge.com/api/metadata/" + "47"
//              The deployer is responsible for the per-tier JSON+image.
//
// RendererUrl  a single endpoint; we POST/GET with the tier index as a
//              query/path parameter. Same shape as BaseUri but signals
//              that the URL serves dynamically (no per-tier file).
//
// Both store one bounded String; the wire shape stays the same so the
// off-chain renderer can branch on the variant cheaply.
// =====================================================================
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum ArtSource {
    BaseUri(String),
    RendererUrl(String),
}

impl ArtSource {
    /// Maximum serialized size: 1 byte variant tag + 4 byte string len prefix
    /// + MAX_ART_URI_LEN bytes of payload.
    pub const MAX_SIZE: usize = 1 + 4 + MAX_ART_URI_LEN;

    /// The borrow accessor every reader uses; both variants store the same
    /// String shape.
    pub fn uri(&self) -> &str {
        match self {
            ArtSource::BaseUri(s) | ArtSource::RendererUrl(s) => s.as_str(),
        }
    }
}

// =====================================================================
// WrappedCollection
//
// Per-deployment PDA: seed = ["collection", token_mint].
//
// Sandboxes every Factory deployment. Two deployments for two different
// pump.fun tokens cannot collide (different token_mint -> different PDA).
// Reading any deployment's state requires only its token_mint.
//
// The wrap/unwrap instructions for this deployment read tokens_per_wrap,
// max_supply, art_source from here -- so the same on-chain handler code
// serves every WrappedX without changes.
// =====================================================================
#[account]
pub struct WrappedCollection {
    // -------- identity --------
    pub token_mint: Pubkey,
    pub deployer:   Pubkey,       // wallet that paid the deploy + burn
    pub name:       String,       // "WrappedDoge", 1..=32
    pub ticker:     String,       // "WDOGE",       1..=12
    pub art_source: ArtSource,

    // -------- wrap economics --------
    pub max_supply:       u16,    // 100..=10_000
    pub tokens_per_wrap:  u64,    // base units of token_mint

    // -------- collection NFT (MCC) --------
    pub collection_mint: Pubkey,  // parent NFT for marketplace recognition

    // -------- live counters --------
    pub total_wrapped:   u64,
    pub total_unwrapped: u64,
    pub in_circulation:  u16,
    pub next_tier:       u16,     // lowest never-wrapped tier
    pub free_tiers:      Vec<u16>,// LIFO stack of unwrapped-then-reusable tiers

    // -------- bookkeeping --------
    pub created_at: i64,
    pub bump:       u8,

    /// Protocol-multisig-set "this is the canonical wrap layer for this
    /// token" badge. Visible on /launches + via @wrappedbulls/sdk so
    /// holders can distinguish founding-cohort deployments from fan
    /// deploys / scam squats. Default false; flipped via set_verified
    /// gated to the program upgrade authority (= Squads multisig post
    /// mainnet handoff).
    pub verified: bool,

    /// Forward-compat slack. Used for fields added in future upgrades
    /// (royalty splits, buy-and-lock treasury balances, governance flags,
    /// etc) without changing the on-chain account size. One byte was
    /// carved out of the original 64 for `verified` above.
    pub reserved: [u8; 63],
}

impl WrappedCollection {
    /// Total serialized size of the account. `init` reserves exactly this many
    /// bytes; the free_tiers Vec is pre-sized to its maximum capacity so the
    /// account never needs to be reallocated.
    pub const SIZE: usize = 8                                    // anchor discriminator
        + 32                                                      // token_mint
        + 32                                                      // deployer
        + 4 + MAX_NAME_LEN                                        // name (String)
        + 4 + MAX_TICKER_LEN                                      // ticker (String)
        + ArtSource::MAX_SIZE                                     // art_source
        + 2                                                       // max_supply
        + 8                                                       // tokens_per_wrap
        + 32                                                      // collection_mint
        + 8                                                       // total_wrapped
        + 8                                                       // total_unwrapped
        + 2                                                       // in_circulation
        + 2                                                       // next_tier
        + 4 + (FREE_TIERS_CAP * 2)                                // free_tiers (Vec<u16>)
        + 8                                                       // created_at
        + 1                                                       // bump
        + 1                                                       // verified (NEW; 1 byte carved from reserved)
        + 63;                                                     // reserved (was 64; net SIZE unchanged)

    /// Pop the next available tier (free stack first, then fresh counter).
    /// Caller is responsible for incrementing total_wrapped and in_circulation.
    /// Mirrors BullBank::pop_tier in wrappedbulls so the audit pattern is
    /// identical across both programs.
    pub fn pop_tier(&mut self) -> Result<u16> {
        if let Some(t) = self.free_tiers.pop() {
            return Ok(t);
        }
        if self.next_tier as u32 > self.max_supply as u32 {
            return Err(crate::errors::WrappedFactoryError::MaxSupplyReached.into());
        }
        let t = self.next_tier;
        self.next_tier = self.next_tier
            .checked_add(1)
            .ok_or(crate::errors::WrappedFactoryError::MaxSupplyReached)?;
        Ok(t)
    }

    /// Return an unwrapped tier to the free stack.
    pub fn push_tier(&mut self, tier: u16) {
        self.free_tiers.push(tier);
    }
}

// =====================================================================
// BullAsset
//
// Per-NFT PDA: seed = ["bull", token_mint, tier_index_le].
//
// The token_mint in the seed namespaces this PDA into its parent
// WrappedCollection, so the same tier_index value across different
// collections never collides.
// =====================================================================
#[account]
pub struct BullAsset {
    /// The NFT mint address (Metaplex NFT representing this bull). The
    /// off-chain renderer reads from here when art_source is BaseUri /
    /// RendererUrl that embeds the mint or tier.
    pub nft_mint: Pubkey,

    /// Tier index 1..=max_supply (the "WrappedDoge #N" public identifier).
    pub tier_index: u16,

    /// Wrap timestamp (unix seconds).
    pub wrapped_at: i64,

    /// PDA bump.
    pub bump: u8,
}

impl BullAsset {
    pub const SIZE: usize = 8     // anchor discriminator
        + 32                       // nft_mint
        + 2                        // tier_index
        + 8                        // wrapped_at
        + 1;                       // bump
}

// =====================================================================
// BullTreasuryState
//
// Singleton PDA: seed = ["bull_treasury"].
//
// Holds two responsibilities:
//
//   1. Accounting for the trickle-claim mechanic. Every deploy_collection
//      pushes a DepositEntry(amount, deposited_at) into `pending`. The
//      multisig can only sweep entries whose deposited_at is at least
//      PENDING_LOCK_SECONDS in the past. Visible holder property: the
//      multisig CANNOT drain the entire treasury in one transaction --
//      only the part that has been sitting >= 7 days.
//
//   2. Token authority for the bull_treasury_vault ATA. The vault holds
//      the actual $WBULL; this PDA signs the transfer-out CPI during
//      claim_treasury via seeds = [b"bull_treasury", &[bump]].
//
// Capacity: PENDING_CAP = 256 entries. If 256 deposits accumulate without
// any claim, the next deploy_collection fails with TreasuryPendingFull,
// forcing the multisig to call claim_treasury (which sweeps expired
// entries on the way in). This is a feature: it prevents the pending
// vec from ever growing unbounded. At a realistic deploy rate the cap
// is generous (256 deploys is more than a year of weekly traffic).
// =====================================================================

/// Single entry in BullTreasuryState.pending. AnchorSerialize + Copy so
/// the vec round-trips through the account data cleanly and the
/// sweep math can drain entries without clone overhead.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct DepositEntry {
    pub amount:       u64,
    pub deposited_at: i64,
}

impl DepositEntry {
    pub const SIZE: usize = 8 + 8; // amount + deposited_at
}

pub const PENDING_CAP: usize = 256;

/// The 7-day per-deposit lock window. Centralized here so the constant
/// matches between deploy_collection (writes) and claim_treasury (reads).
pub const PENDING_LOCK_SECONDS: i64 = 7 * 24 * 60 * 60; // 604_800

#[account]
pub struct BullTreasuryState {
    /// Tokens that have already cleared the 7-day lock and are sweepable
    /// by the multisig in a single claim_treasury call.
    pub claimable: u64,

    /// Recent deposits waiting on the 7-day window. Bounded by
    /// PENDING_CAP to keep account size predictable.
    pub pending: Vec<DepositEntry>,

    /// Lifetime sum of every deposit ever made. Monotonically increasing.
    /// Mirrors FactoryConfig.total_wbull_deposited but lives here so a
    /// treasury reader needs only this account.
    pub lifetime_deposited: u64,

    /// Lifetime sum of every successful claim. Monotonically increasing.
    pub lifetime_claimed: u64,

    /// PDA bump.
    pub bump: u8,

    /// Forward-compat slack.
    pub reserved: [u8; 64],
}

impl BullTreasuryState {
    pub const SIZE: usize = 8                               // anchor discriminator
        + 8                                                  // claimable
        + 4 + (PENDING_CAP * DepositEntry::SIZE)             // pending (Vec<DepositEntry>)
        + 8                                                  // lifetime_deposited
        + 8                                                  // lifetime_claimed
        + 1                                                  // bump
        + 64;                                                // reserved

    /// Walk `pending`, move every entry whose age is >= PENDING_LOCK_SECONDS
    /// into the `claimable` accumulator, and drop those entries from the
    /// vec. Returns the amount swept (useful for logging + tests).
    ///
    /// Run by both deploy_collection (before push, to make room) AND
    /// claim_treasury (before transfer, to settle the latest balance).
    /// Idempotent: calling sweep_expired with no expired entries is a no-op.
    pub fn sweep_expired(&mut self, now: i64) -> u64 {
        let cutoff = now.saturating_sub(PENDING_LOCK_SECONDS);
        let mut swept: u64 = 0;
        let mut i = 0;
        while i < self.pending.len() {
            if self.pending[i].deposited_at <= cutoff {
                swept = swept.saturating_add(self.pending[i].amount);
                // swap_remove preserves O(1); order within pending does
                // not matter -- claim eligibility is independent of
                // position.
                self.pending.swap_remove(i);
            } else {
                i += 1;
            }
        }
        self.claimable = self.claimable.saturating_add(swept);
        swept
    }

    /// Append a new deposit. Caller must have invoked `sweep_expired` first
    /// to maximize available room; this method only checks for the hard cap.
    /// Returns Err(TreasuryPendingFull) if the cap is hit even after sweep.
    pub fn push_deposit(&mut self, amount: u64, deposited_at: i64) -> Result<()> {
        if self.pending.len() >= PENDING_CAP {
            return Err(crate::errors::WrappedFactoryError::TreasuryPendingFull.into());
        }
        self.pending.push(DepositEntry { amount, deposited_at });
        self.lifetime_deposited = self.lifetime_deposited.saturating_add(amount);
        Ok(())
    }

    /// Drain `claimable` and book the amount against `lifetime_claimed`.
    /// Returns the amount the caller should transfer out of the vault.
    pub fn drain_claimable(&mut self) -> u64 {
        let amount = self.claimable;
        self.claimable = 0;
        self.lifetime_claimed = self.lifetime_claimed.saturating_add(amount);
        amount
    }
}

// =====================================================================
// Tests for tier accounting on WrappedCollection. Mirrors the wrappedbulls
// BullBank tier-accounting tests one-for-one so we have audit parity
// across the two programs.
// =====================================================================
#[cfg(test)]
mod tier_accounting_tests {
    use super::*;

    fn fresh_collection(max_supply: u16) -> WrappedCollection {
        WrappedCollection {
            token_mint:       Pubkey::default(),
            deployer:         Pubkey::default(),
            name:             "WrappedTest".to_string(),
            ticker:           "WTEST".to_string(),
            art_source:       ArtSource::BaseUri("https://example.com/m/".to_string()),
            max_supply,
            tokens_per_wrap:  1_000_000,
            collection_mint:  Pubkey::default(),
            total_wrapped:    0,
            total_unwrapped:  0,
            in_circulation:   0,
            next_tier:        1,
            free_tiers:       Vec::new(),
            created_at:       0,
            bump:             0,
            verified:         false,
            reserved:         [0u8; 63],
        }
    }

    #[test]
    fn pop_tier_first_wrap_returns_1() {
        let mut c = fresh_collection(1_000);
        assert_eq!(c.pop_tier().unwrap(), 1);
        assert_eq!(c.next_tier, 2);
    }

    #[test]
    fn pop_tier_sequential() {
        let mut c = fresh_collection(1_000);
        for expected in 1u16..=5 {
            assert_eq!(c.pop_tier().unwrap(), expected);
        }
    }

    #[test]
    fn pop_tier_prefers_free_stack() {
        let mut c = fresh_collection(1_000);
        c.next_tier = 50;
        c.push_tier(7);
        c.push_tier(13);
        // LIFO
        assert_eq!(c.pop_tier().unwrap(), 13);
        assert_eq!(c.pop_tier().unwrap(), 7);
        // falls back to next_tier counter
        assert_eq!(c.pop_tier().unwrap(), 50);
    }

    #[test]
    fn pop_tier_respects_per_collection_cap() {
        let mut c = fresh_collection(100);
        c.next_tier = 100;
        assert_eq!(c.pop_tier().unwrap(), 100);     // last fresh
        assert!(c.pop_tier().is_err());             // 101st must fail
        // unwraps can still fund subsequent wraps via the free stack
        c.push_tier(42);
        assert_eq!(c.pop_tier().unwrap(), 42);
        assert!(c.pop_tier().is_err());
    }

    #[test]
    fn full_lifecycle_max_then_one_more_fails() {
        let cap: u16 = 200;
        let mut c = fresh_collection(cap);
        for expected in 1..=cap {
            assert_eq!(c.pop_tier().unwrap(), expected);
        }
        assert!(c.pop_tier().is_err());
    }
}

// =====================================================================
// Tests for bull treasury accounting. Exercises sweep + push + drain
// math directly on a constructed BullTreasuryState. Critically covers:
//   - sweep moves only entries >= 7d old
//   - sweep is idempotent
//   - push enforces the PENDING_CAP
//   - sweep + push together free room without losing deposits
//   - drain_claimable resets claimable but preserves lifetime totals
// =====================================================================
#[cfg(test)]
mod treasury_accounting_tests {
    use super::*;

    fn fresh_treasury() -> BullTreasuryState {
        BullTreasuryState {
            claimable:          0,
            pending:            Vec::new(),
            lifetime_deposited: 0,
            lifetime_claimed:   0,
            bump:               0,
            reserved:           [0u8; 64],
        }
    }

    /// Reference "now" used throughout tests; pick a far-future timestamp
    /// so we can express both old and recent deposits relative to it
    /// without going negative.
    const NOW: i64 = 10_000_000;

    #[test]
    fn push_records_deposit_and_lifetime() {
        let mut t = fresh_treasury();
        t.push_deposit(1_000_000, NOW).unwrap();
        assert_eq!(t.pending.len(), 1);
        assert_eq!(t.pending[0].amount, 1_000_000);
        assert_eq!(t.pending[0].deposited_at, NOW);
        assert_eq!(t.lifetime_deposited, 1_000_000);
        assert_eq!(t.claimable, 0); // nothing swept yet
    }

    #[test]
    fn sweep_with_no_expired_entries_is_noop() {
        let mut t = fresh_treasury();
        t.push_deposit(1_000_000, NOW).unwrap();
        let swept = t.sweep_expired(NOW + 1); // 1 sec later
        assert_eq!(swept, 0);
        assert_eq!(t.pending.len(), 1);
        assert_eq!(t.claimable, 0);
    }

    #[test]
    fn sweep_moves_only_expired_into_claimable() {
        let mut t = fresh_treasury();
        // 3 deposits at staggered ages
        t.push_deposit(1_000_000, NOW - 10 * 24 * 60 * 60).unwrap(); // 10d old: expired
        t.push_deposit(2_000_000, NOW - 7  * 24 * 60 * 60).unwrap(); // exactly 7d: expired (>=)
        t.push_deposit(3_000_000, NOW - 1  * 24 * 60 * 60).unwrap(); // 1d old: locked
        let swept = t.sweep_expired(NOW);
        assert_eq!(swept, 3_000_000); // 1M + 2M
        assert_eq!(t.claimable, 3_000_000);
        assert_eq!(t.pending.len(), 1); // only the 1d-old entry remains
        assert_eq!(t.pending[0].amount, 3_000_000);
    }

    #[test]
    fn sweep_is_idempotent() {
        let mut t = fresh_treasury();
        t.push_deposit(5_000_000, NOW - 8 * 24 * 60 * 60).unwrap();
        let first = t.sweep_expired(NOW);
        let second = t.sweep_expired(NOW);
        assert_eq!(first, 5_000_000);
        assert_eq!(second, 0); // nothing left to sweep
        assert_eq!(t.claimable, 5_000_000); // unchanged
    }

    #[test]
    fn push_at_cap_returns_err_until_sweep_makes_room() {
        let mut t = fresh_treasury();
        // Fill to capacity at "TODAY". Nothing is sweepable yet.
        for i in 0..PENDING_CAP {
            t.push_deposit(1_000_000, NOW + i as i64).unwrap();
        }
        assert_eq!(t.pending.len(), PENDING_CAP);
        // 257th push must fail.
        let err = t.push_deposit(1_000_000, NOW + 1000).unwrap_err();
        assert!(format!("{:?}", err).contains("TreasuryPendingFull"));

        // Fast-forward past the lock window. sweep_expired should free
        // the whole buffer; the next push succeeds.
        let later = NOW + PENDING_LOCK_SECONDS + (PENDING_CAP as i64) + 1;
        let swept = t.sweep_expired(later);
        assert_eq!(swept as usize, 1_000_000 * PENDING_CAP);
        assert_eq!(t.pending.len(), 0);
        t.push_deposit(1_000_000, later).unwrap();
    }

    #[test]
    fn drain_claimable_resets_balance_and_bumps_lifetime_claimed() {
        let mut t = fresh_treasury();
        t.push_deposit(2_000_000, NOW - 8 * 24 * 60 * 60).unwrap();
        t.sweep_expired(NOW);
        assert_eq!(t.claimable, 2_000_000);
        let drained = t.drain_claimable();
        assert_eq!(drained, 2_000_000);
        assert_eq!(t.claimable, 0);
        assert_eq!(t.lifetime_claimed, 2_000_000);
        // Lifetime deposited is unchanged -- claims do not undo deposits.
        assert_eq!(t.lifetime_deposited, 2_000_000);
    }

    #[test]
    fn round_trip_deposit_lock_sweep_claim() {
        // End-to-end accounting walk: deploy + wait + claim must produce
        // exactly the deposited amount, no slop.
        let mut t = fresh_treasury();
        t.push_deposit(1_000_000, NOW).unwrap();
        // Day 6: nothing sweepable yet.
        assert_eq!(t.sweep_expired(NOW + 6 * 24 * 60 * 60), 0);
        // Day 7: exactly at the cliff.
        assert_eq!(t.sweep_expired(NOW + 7 * 24 * 60 * 60), 1_000_000);
        assert_eq!(t.claimable, 1_000_000);
        // Multisig sweeps.
        let drained = t.drain_claimable();
        assert_eq!(drained, 1_000_000);
        // State is back to clean, with lifetime counters preserved.
        assert!(t.pending.is_empty());
        assert_eq!(t.claimable, 0);
        assert_eq!(t.lifetime_deposited, 1_000_000);
        assert_eq!(t.lifetime_claimed, 1_000_000);
    }
}
