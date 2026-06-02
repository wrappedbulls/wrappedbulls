# Anti-Farming Spec — Commit-Time Entropy for Bull Art Seeds

**Status: DEFERRED (2026-06-02).** Spec retained as a contingency, not
queued for implementation.

**Decision context.** For a 1,000-bull collection at meme-coin scale,
the attack is real but practically bounded: requires (a) > 1M $WBULL of
working capital, (b) a tx-racing setup, (c) the attacker to outpace
every legitimate wrapper for each desired slot. In an active collection,
prediction power doesn't help if you still have to race for tx-land. The
attack self-defeats under healthy wrap volume.

The cost side: every program upgrade carries audit surface, every
two-cohort rendering decision is a story complication, and the mitigation
is unilaterally cheaper than the disease for now.

**Trigger to revisit.** Ship this upgrade if any of the following
become observed-in-the-wild facts:

1. A holder publicly demonstrates a profitable snipe (predicted a
   legendary, raced the wrap, listed it on Magic Eden for the
   predicted premium).
2. Repeated unwrap-then-rewrap cycles by the same wallet within short
   windows (re-roll farming signal).
3. A non-trivial fraction of the legendary-tier bulls are concentrated
   in a single wallet that wraps faster than would be expected by
   chance.

Until then, the residual risk is acknowledged and accepted.

Spec body below retained verbatim so the upgrade is one approve-and-ship
away if the trigger fires.

---

Targets the wrappedbulls program
(not the Factory; the Factory inherits a per-deployment opt-in path —
see "Scope" below). One program upgrade required.

## The attack

WrappedBulls' visual art is rendered from `nft_mint`. The renderer is
open source. `nft_mint` is a PDA derived from a public counter:

```
nft_mint = PDA(["nft_mint", bank.total_wrapped])
```

Both `bank.total_wrapped` and the renderer are public. The attack surface
this opens:

### Attack 1 — Pure snipe

1. Attacker reads `bank.total_wrapped = N` on chain (zero-cost).
2. For each i in 1..K, attacker computes `nft_mint_pda(N + i)` locally.
3. Attacker runs the open-source renderer on each computed mint to see
   what traits a wrap landing at that counter would produce.
4. If wrap #N+3 has a legendary trait combo, the attacker sits on a
   pre-built tx and races to land it the moment `total_wrapped` reaches N+2.

The attacker never needs to interact with the chain until the moment of
attack. No funds are at risk, no on-chain signal precedes it. The
contention is purely tx-landing speed in a single slot.

### Attack 2 — Re-roll grinding

A holder of an unsatisfying bull can:
1. `unwrap_bull` — get 1M $WBULL back, NFT is burned, `total_wrapped`
   stays at N (unwrap doesn't decrement it), tier_index returns to
   `free_tiers`.
2. Wait for `total_wrapped` to advance to a position whose next mint
   produces traits they want.
3. `wrap_bull` again — get a fresh visual.

The attacker spends only tx fees per attempt. Over enough cycles, they
can hand-pick whatever trait combo they want.

### Why this is bad

- It transfers value from holders to predictors.
- It degrades the rarity narrative — the "1/100 OG founding herd" story
  weakens when the legendary OGs were all grabbed by snipers.
- It scales linearly with how transparent we make the system (a public
  renderer + public counter = perfect prediction).

## Scope

This spec targets the **wrappedbulls** program directly.

The **WrappedFactory** deployments inherit the issue ONLY if their
deployer chooses a renderer keyed on `nft_mint` or any deterministic
on-chain value. Factory deployments using off-chain renderers
(`BaseUri` or `RendererUrl` pointing at the deployer's own server)
are not affected by this spec — the deployer controls their own art
mechanic and can use whatever entropy source they like.

To make this opt-in for the Factory's deployers, we expose the
new `art_seed` field on `BullAsset` (see Implementation §1). A
Factory deployment's renderer can read it and seed art from there
instead of from `nft_mint`.

## Why Option A (commit-time entropy) wins

We discussed five alternatives earlier in design. Recap:

| Option | What it does | Verdict |
|---|---|---|
| **A. Commit-time entropy** (this spec) | At wrap time, mix `SlotHashes[0]` into the art seed and store on `BullAsset`. Renderer reads from seed, not mint. | **Chosen.** Closes both attacks with zero UX impact. One program upgrade. |
| B. Switchboard VRF | Two-tx wrap (request + callback). Cryptographically perfect randomness. | Rejected. Two-tx UX kills the click-and-wrap flow. External dependency. |
| C. Commit-reveal | First tx commits, second reveals after N slots. | Rejected. Same two-tx UX problem as B. Worse: abandoned commits need GC. |
| D. Wrap fee in SOL | Adds friction cost per attempt. | Half measure. Doesn't prevent snipe, just taxes it. |
| E. Unwrap cooldown | 24h delay between unwrap and re-wrap. | Half measure. Hurts legit sellers; doesn't address snipe at all. |
| F. Flatten rarity | Reduce trait variance so nothing is worth farming. | Regression. Destroys the OG / rarity narrative we already shipped. |

**Why Option A specifically:**

- `SlotHashes` is the only on-chain entropy source that's
  *unpredictable to the attacker before tx land time*. The current
  slot's hash doesn't exist until that slot's leader produces it.
- It's available as a sysvar (`SlotHashes::get()`) — no CPI, no
  external program dependency.
- Simulation can't see it. An attacker who runs
  `simulateTransaction(wrap_bull)` gets back the SimulatedResult with
  whatever the simulator's `SlotHashes` was at sim time — which differs
  from the real value at land time. So predict-via-simulate is dead.
- Zero UX change for normal users. They click Wrap, it lands, the
  bull is theirs. Nothing visible.

## Implementation

### §1 Program changes (wrappedbulls)

Add an `art_seed` field to `BullAsset`:

```rust
// programs/wrappedbulls/src/state.rs
#[account]
pub struct BullAsset {
    pub nft_mint: Pubkey,
    pub tier_index: u16,
    pub wrapped_at: i64,
    pub bump: u8,
    /// New: 32-byte seed for the art renderer.
    /// Pre-upgrade BullAssets do not have this field; the renderer falls
    /// back to nft_mint for them. Set to [0; 32] would be ambiguous, so
    /// we set the high bit of byte 0 to 1 (marker bit) to disambiguate
    /// "has seed" from "no seed (legacy)".
    pub art_seed: [u8; 32],
}
```

**SIZE changes from 51 → 83 bytes (+32).** Existing accounts are 51 bytes;
new ones get the extra space. Anchor's account migration: the `init`
allocation uses the new SIZE, so newly minted bulls get 83-byte accounts;
existing bulls keep their 51-byte accounts and never grow.

**The renderer detects which version it's reading by data length** (51 vs
83). If the data is 51 bytes, use `nft_mint` as the seed (legacy bulls
keep their art exactly the same). If 83 bytes, use `art_seed`.

In `wrap_bull` handler:

```rust
// programs/wrappedbulls/src/instructions/wrap_bull.rs
// ... existing wrap logic up through Metaplex CPIs ...

// Compute art_seed mixing in unpredictable entropy.
let slot_hashes = SlotHashes::get()?;  // 512 most recent slot hashes
let recent_hash = slot_hashes.first()  // most recent
    .ok_or(WrappedbullsError::SlotHashesUnavailable)?
    .hash;

let mut hasher = anchor_lang::solana_program::keccak::Hasher::default();
hasher.hash(ctx.accounts.nft_mint.key().as_ref());
hasher.hash(ctx.accounts.payer.key().as_ref());
hasher.hash(&Clock::get()?.slot.to_le_bytes());
hasher.hash(recent_hash.as_ref());
let mut seed = hasher.result().to_bytes(); // 32 bytes

// Marker bit so "all zeros" (legacy) is distinguishable from a seed.
seed[0] |= 0x80;

let bull = &mut ctx.accounts.bull_asset;
// ... existing field writes ...
bull.art_seed = seed;
```

**Why keccak (not sha256):** keccak is what Solana's syscalls expose most
cheaply. Both have effectively equivalent collision resistance for our
purposes. Either is fine — we just want a one-way mix that's irreversible.

**Why the marker bit:** ed25519 pubkeys have arbitrary first bytes, so
`[0; 32]` is a legitimate seed value the hash could produce. Marker bit
unambiguously means "this seed was written by the new code path."

### §2 Renderer changes (web)

The renderer at `web/lib/renderer.mjs` (and the runtime renderer in
`web/app/api/render/[tier]/route.ts` if it exists) reads `BullAsset`
and feeds the seed into the trait roller:

```typescript
// web/lib/provenance.ts or web/lib/renderer.ts
async function fetchArtSeed(conn: Connection, tier: number): Promise<Uint8Array> {
  const [pda] = bullAssetPda(tier);
  const info = await conn.getAccountInfo(pda, "confirmed");
  if (!info) throw new Error("BullAsset not found");

  // Legacy 51-byte accounts: use nft_mint as the seed.
  // Post-upgrade 83-byte accounts: use art_seed.
  if (info.data.length >= 8 + 32 + 2 + 8 + 1 + 32) {
    return Uint8Array.from(info.data.slice(8 + 32 + 2 + 8 + 1));
  }
  // Legacy: extract nft_mint from offset 8, hash it for the same shape.
  const nftMintBytes = info.data.slice(8, 8 + 32);
  return await sha256(nftMintBytes);
}
```

The trait-rolling function in `renderer.mjs` already takes a 32-byte seed
as input — it doesn't care whether that came from `nft_mint` or `art_seed`.

### §3 Factory deployment opt-in (V2)

A Factory deployment's renderer is the deployer's choice (BaseUri or
RendererUrl pointing at their own server). If the deployer wants
anti-farming protection in their wrap layer, they can:

1. Read the BullAsset PDA for the tier being rendered:
   `PDA([b"bull", token_mint, tier_index])`
2. Read the `art_seed` field at byte offset 8+32+2+8+1
3. Seed their art generation from that 32 bytes

The Factory program's `wrap` instruction will be updated in the same
upgrade to write `art_seed` to BullAssets it creates, so this is
automatic on the program side. The deployer just has to use it in
their renderer.

## Backward compatibility

**Existing wrappedbulls collection bulls are untouched.** Their
`BullAsset` accounts are 51 bytes. The renderer's two-path resolution
keeps their art exactly the same forever — same `nft_mint`, same seed
to the trait roller, same SVG output. The "art locked at wrap time"
promise we made to existing holders holds.

Only NEW wraps (post-upgrade) get the unpredictable seed.

## Test plan

Mirror the existing wrappedbulls test pattern.

### Unit tests (Rust)

Add to `programs/wrappedbulls/src/state.rs` `#[cfg(test)]`:

1. `art_seed_marker_bit_is_set` — call the hash function with fixed inputs,
   verify byte 0's high bit is 1.
2. `art_seed_changes_with_slot_hash` — call with the same inputs but
   different recent slot hashes, verify outputs differ.
3. `art_seed_changes_with_payer` — fixed mint + slot, vary payer, verify
   outputs differ.

### Integration tests (Anchor TS)

Add to `tests/wrappedbulls.ts`:

4. `wrap_bull writes a non-zero art_seed to BullAsset` — wrap, fetch the
   PDA, assert `art_seed != [0; 32]` and `art_seed[0] & 0x80 != 0`.
5. `wrap then unwrap then re-wrap produces a DIFFERENT art_seed` — wrap
   tier 1, capture seed_1, unwrap, wait one slot, wrap tier 1 again,
   capture seed_2, assert `seed_1 != seed_2`. This is the re-roll
   defense proof.
6. `two simultaneous wraps in the same slot have different art_seeds`
   if it's feasible to test; otherwise document that the slot+payer
   inputs make collision astronomically improbable.

### Renderer tests (JS)

7. `renderer reads art_seed from 83-byte BullAsset` — fixture with a
   post-upgrade account, assert the trait roller is called with the
   seed bytes.
8. `renderer falls back to nft_mint for 51-byte BullAsset` — fixture
   with a legacy account, assert legacy code path is taken.
9. `renderer produces stable output for the same seed` — same seed,
   same SVG output. Required for the immutability promise.

## Mainnet upgrade procedure

Follows the existing wrappedbulls upgrade pattern (see
[`AUTHORITY.md`](AUTHORITY.md) and [`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md)).

1. Bump version in `Cargo.toml`.
2. `anchor build -p wrappedbulls`.
3. Run all 16 existing tests + new tests above on devnet.
4. `solana-verify build --library-name wrappedbulls`.
5. Hash check: locally-built `.so` vs `solana-verify get-program-hash`
   for the proposed upgrade.
6. Submit upgrade proposal to the Squads multisig.
7. Multisig signs.
8. After execution, smoke test: wrap a bull on mainnet, fetch its
   BullAsset, verify it's the new 83-byte format with marker bit set.

## Trade-offs

### What this fixes
- ✓ Pure snipe (can't predict art before tx lands)
- ✓ Re-roll grinding (each re-wrap produces a different art_seed)
- ✓ Simulation-based prediction (sim's slot hash ≠ real land-time slot hash)

### What this does NOT fix
- ✗ "Lucky landing" — if you wrap at a slot whose hash happens to roll
  a legendary, you got lucky. That's how it should be.
- ✗ Validator collusion edge case — a validator who happens to lead the
  slot your wrap lands in could (in theory) bias their slot's hash. In
  practice this requires (a) being the slot leader, (b) wrapping in that
  specific slot, and (c) accepting the cost of producing a non-canonical
  block to grind for a favorable hash. The economic cost of this attack
  is far higher than the rare-trait reward; classified as residual.
- ✗ Re-roll on a DIFFERENT tier — if a holder unwraps tier 1 and wraps
  tier 2 next, that's just a normal wrap. The defense kicks in on
  re-wraps of the SAME tier (which is the actual attack pattern).

### Cost
- One program upgrade.
- One renderer update + redeploy.
- New `BullAsset` accounts use 32 more bytes of state (negligible
  per-bull rent cost; existing bulls unchanged).
- Two new compute-unit reads (`SlotHashes`, `Clock`) — ~1k CU each
  according to Solana sysvar docs. Already within our 600k CU bump.

### What we ship as the upgrade

- A program upgrade to the wrappedbulls program (NOT the Factory).
- An updated renderer that handles both 51-byte (legacy) and 83-byte
  (new) `BullAsset` accounts.
- The test suite extended.
- A short user-facing X post explaining the change:
  "wrap-time entropy is now baked into every new bull's art. you can no
  longer predict a bull's traits before its wrap tx confirms. legacy
  bulls (tier 1..N at upgrade time) keep their art exactly as it is now."

## See also

- [`SECURITY.md`](../SECURITY.md) — parent program security policy
- [`AUTHORITY.md`](AUTHORITY.md) — Squads multisig upgrade procedure
- [`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md) — runbook pattern this upgrade follows

---

*Spec only. Implementation queued. Land the Factory v1 first, then this
upgrade, then start drafting the next protocol-level mechanic (Wrap
Lottery).*
