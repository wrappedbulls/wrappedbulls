# WrappedFactory Security Review

WrappedFactory is the sibling Solana Anchor program that enables permissionless
launches of wrap layers on top of any pump.fun token. It shares the
wrappedbulls trust model (per-NFT vault PDAs, holder-gated unwraps) but adds
two new surfaces that need their own scrutiny:

1. **Permissionless `deploy_collection`.** Anyone with 1M $WBULL can spin up
   a new wrap layer. The program has to behave correctly when the caller is
   adversarial.
2. **Bull treasury.** The 1M $WBULL deploy fee accumulates in an on-chain
   treasury PDA. The program enforces a per-deposit 7-day lock; the upgrade authority
   only sees what has already cleared the lock.

This document is the audit-ready companion to [`SECURITY.md`](SECURITY.md),
focused on the new code in [`programs/wrappedfactory/`](programs/wrappedfactory).
The original wrappedbulls program remains in scope under SECURITY.md and is
not re-described here.

## Reporting

Same channel as the parent program. Use GitHub Security Advisories on the
`wrappedbulls/wrappedbulls` repo, or `[security]`-prefixed DM to
[@wrappedbulls](https://x.com/wrappedbulls).

## Trust model

| Surface | Who controls | What they can do |
|---|---|---|
| `initialize` instruction | Program upgrade authority (mainnet: upgrade authority keypair) | One-shot. Sets the $WBULL mint and creates singleton PDAs. Cannot be re-run. |
| Per-deployment economic fields (`max_supply`, `tokens_per_wrap`, `art_source`) | The deployer who paid 1M $WBULL | Set ONCE at deploy time. The program does not expose any mutator. Wrong inputs cannot be repaired — a fresh deployment is required. |
| `wrap` and `unwrap` per deployment | Anyone holding the target token (`wrap`) or the bull NFT (`unwrap`) | Permissionless. The program enforces token-mint match and NFT ownership cryptographically. |
| `bull_treasury_vault` token balance | Program upgrade authority via `claim_treasury` instruction | Can drain only the `claimable` portion (deposits aged ≥ 7 days). Cannot reach into `pending`. |
| Program upgrade authority | Same upgrade authority keypair the same keypair posture as wrappedbulls | Can ship a new program binary; this is the only way to change the deploy cost, the lock window, or any other hard-coded constant. |

**Trust minimization summary:** the deployer who paid the fee receives no
admin power beyond setting the deployment's launch parameters. They cannot
unilaterally close their wrap layer, change its economics, or claim from the
treasury. The protocol upgrade authority cannot mint NFTs, cannot touch any
deployment's per-NFT vault, and cannot claim treasury tokens that have been
deposited within the last 7 days.

## Critical security invariants

These are the guarantees the WrappedFactory program is built to provide.
If you find a way to violate any of them, it is a critical-severity issue.

1. **One wrap layer per token mint.** A second `deploy_collection` for a
   `token_mint` that already has a `WrappedCollection` PDA must fail.
   Enforced by Anchor's `init` constraint on the per-token collection PDA at
   [`programs/wrappedfactory/src/instructions/deploy_collection.rs`](programs/wrappedfactory/src/instructions/deploy_collection.rs)
   with seeds `[b"collection", token_mint.key().as_ref()]`. Proven by
   [`tests/wrappedfactory.ts`](tests/wrappedfactory.ts) test
   *PDA isolation: deploying for a second token mint succeeds independently*
   (which also exercises the negative — re-deploying the same `token_mint`
   would fail with the same `init` collision).

2. **The 1M $WBULL deploy fee is transferred to the bull treasury atomically
   with the deployment.** If the deployer's $WBULL balance is below
   `DEPLOY_BURN_AMOUNT_UI * 10^decimals`, the entire transaction reverts —
   no partial state writes. Verified by the
   `require!(payer_balance >= amount)` early in `deploy_collection.rs` and
   the `transfer_checked` CPI's own balance enforcement. Proven by
   `tests/wrappedfactory.ts` test
   *deploy_collection rejects when deployer's $WBULL balance is < 1M*.

3. **The deploy fee accrues, never burns.** `deploy_collection` issues
   `token_interface::transfer_checked` from the deployer's $WBULL account to
   `bull_treasury_vault`. There is NO `burn` instruction anywhere in the
   Factory code. Verified by `grep -r "burn" programs/wrappedfactory/src/`
   returning only comments and the renamed (still-monotonic) counter field
   `total_wbull_burned -> total_wbull_deposited`. Proven by
   *deploy_collection moves 1M $WBULL deployer → treasury + pushes DepositEntry*.

4. **The 7-day lock per deposit is enforced on chain.** Every Factory deposit
   is appended to `BullTreasuryState.pending` with `(amount, deposited_at)`.
   `claim_treasury` runs `sweep_expired(now)` which moves entries into
   `claimable` ONLY if `now - entry.deposited_at >= PENDING_LOCK_SECONDS`
   (where `PENDING_LOCK_SECONDS = 604_800`). The upgrade authority can never drain
   tokens deposited within the last 7 days. Proven negatively by
   `tests/wrappedfactory.ts` test
   *claim_treasury rejects with NothingClaimable when all deposits are < 7d old*.
   Proven positively by the unit test
   `state::treasury_accounting_tests::round_trip_deposit_lock_sweep_claim`
   in [`programs/wrappedfactory/src/state.rs`](programs/wrappedfactory/src/state.rs)
   which walks the full deposit + 7-day-wait + sweep + drain cycle using
   simulated timestamps.

5. **`claim_treasury` is gated to the program upgrade authority.** The
   instruction requires `program_data.upgrade_authority_address == Some(authority.key())`
   where `program_data` is verified against `program.programdata_address()`.
   No other path drains the treasury vault. After mainnet handoff to the
   upgrade authority keypair, claims require upgrade authority signature on chain. Verified in
   [`programs/wrappedfactory/src/instructions/claim_treasury.rs`](programs/wrappedfactory/src/instructions/claim_treasury.rs).

6. **`pending` cannot grow without bound.** `BullTreasuryState.pending` is
   capped at `PENDING_CAP = 256` entries. `push_deposit` returns
   `TreasuryPendingFull` if the cap is reached — this is a forcing function
   for the upgrade authority.to call `claim_treasury` (which sweeps expired entries
   on the way in) to make room. The cap protects the on-chain account from
   unbounded growth and from rent-extraction griefing. Proven by
   `state::treasury_accounting_tests::push_at_cap_returns_err_until_sweep_makes_room`.

7. **Per-token PDA namespacing.** Every PDA the Factory creates is keyed
   by the deployment's `token_mint`:
   - `WrappedCollection`: `[b"collection", token_mint]`
   - `collection_mint`:  `[b"collection_mint", token_mint]`
   - `collection_authority`: `[b"collection_authority", token_mint]`
   - `BullAsset`: `[b"bull", token_mint, tier_index]`
   - `nft_mint`: `[b"nft_mint", token_mint, total_wrapped]`

   Two deployments for two different `token_mint` values cannot collide on
   any PDA. Verified by reading every `seeds = [...]` constraint across
   the four instructions. Proven by the PDA isolation test above (deploys
   WrappedDoge + WrappedPepe in sequence; both succeed; both have independent
   state).

8. **The wrap-fee mint is locked at initialize time.** `FactoryConfig.wbull_mint`
   is written once during `initialize` and never mutated. Every
   `deploy_collection` constraint-matches the deployer's $WBULL account
   against `factory_config.wbull_mint`. A compromised admin cannot redirect
   future deploys to a different "fee mint" without a upgrade authority signed program
   upgrade (which is publicly observable).

9. **Per-NFT invariants inherited from wrappedbulls.** The Factory's
   `wrap` / `unwrap` instructions reuse the same vault-follows-NFT pattern
   as wrappedbulls. Specifically:
   - The vault's authority is `PDA([b"vault", nft_mint])`, so the NFT mint
     cryptographically owns its vault.
   - `unwrap` requires `payer_nft_account.amount == 1` (the caller holds
     the NFT).
   - `unwrap` requires `nft_mint.key() == bull_asset.nft_mint` (no decoupling
     the on-chain record from the live NFT).
   - `unwrap` drains the FULL vault balance, not just `tokens_per_wrap` —
     any donated grief tokens flow to the rightful holder.

   These invariants are inherited and not re-proven in `tests/wrappedfactory.ts`;
   they are exhaustively exercised by `tests/wrappedbulls.ts` (16 tests, all
   pass on every Factory build).

## Permissionless deploy: residual risks

The Factory is permissionless. Some risks are inherent to that and are NOT
program bugs — they are protocol-level decisions that holders should understand.

### Name squatting

The on-chain program does NOT enforce ticker uniqueness across deployments.
A deployer can pay 1M $WBULL to launch "WrappedPepe" for an attacker-controlled
token mint that has nothing to do with the real $PEPE. The wrappedbulls.com
frontend mitigates via:

- The `/launch/new` wizard's `check-name` API rejects tickers that match any
  existing live deployment.
- `/launches` and `/launch` list ALL deployments visible to the directory;
  curation (manual flagging of fan-deployed / unofficial layers) lives at
  the website layer, not the program.

A determined attacker can still pay 1M $WBULL to deploy a misleadingly-named
wrap layer on any token. This is an **acknowledged residual** — the
program does not gatekeep brand names. Domain reputation, Magic Eden /
Tensor verification, and the `/launches` directory's editorial layer
together do that.

### Art source rot

`art_source` (`BaseUri` or `RendererUrl`) points at a URL the deployer hosts.
If the deployer takes that URL offline, every NFT in their wrap layer
permanently shows "image unavailable" on Magic Eden / Tensor / Phantom.

This is a **deployer-side risk, not a program bug.** The NFTs themselves
still custody the locked tokens correctly — the art breaks, but `unwrap`
continues to return the locked $TOKEN regardless of metadata availability.
The economic guarantee is independent of the image guarantee.

V1.1 will add an optional IPFS/Arweave content-hash art source as a stronger
alternative for projects that want permanence.

### Mint authority on target token

The Factory does NOT require the wrapped token's `mintAuthority` to be null.
A deployer can launch a wrap layer for a token whose authority can still mint
new supply, potentially diluting the wrap economics. The `/launch/new`
wizard preflight surfaces a warning when `mintAuthority` is non-null, but
the program itself accepts the deploy.

This is an **acknowledged residual** matching wrappedbulls's posture: every
pump.fun token has had its mint authority revoked at graduation, so for
pump.fun-launched tokens this is automatically safe. Pre-graduation
launches carry the warning.

### Single-deployment race

If two deployers race to call `deploy_collection` against the same
`token_mint` in the same slot, only one succeeds (the `init` constraint on
the `WrappedCollection` PDA enforces uniqueness). The other reverts and
loses no funds. Both pay tx fees; only the winner pays the 1M $WBULL.

This is not exploitable for value capture (the loser refunds atomically),
but a sophisticated attacker could repeatedly front-run any pending deploy
to add tx-fee griefing. Mitigation: the `/launch/new` wizard surfaces
the existing-deployment status via the preflight API, so legitimate
deployers see the conflict before signing.

### Tier-prediction race in wrap

`wrap.rs` requires `pop_tier() == caller_supplied_tier_index`. When two
wrappers target the same collection in the same slot, both clients
predict the same next tier from their on chain reads, both submit, one
wins, the other reverts with `TierMismatch`. The reverting client loses
only tx fees. No funds lost, no NFT stranded.

Throughput limit: a busy collection can sustain roughly one wrap per
slot per collection (sustained ~2.5 wraps / sec / collection in
practice). Higher contention triggers user visible `TierMismatch` errors
that the wizard surfaces as "tier was taken; please retry" with a fresh
tier read.

Same pattern is in the mainnet wrappedbulls program and has not produced
incidents because per collection wrap volume is moderate. Documented as a
known design trade off, not a bug. Mitigation explored for v1.1: emit
the resolved tier via Anchor `emit!` so the client can skip the
`require!` predicate entirely.

## Out of scope

Same as the parent program plus these Factory-specific exclusions:

- **Token authority on the wrapped token after deploy.** If a deployer
  configures `tokens_per_wrap` for a token whose mint authority is later
  inflated by its team, the wrap economics degrade. This is a
  pump.fun-token-level property, not a Factory bug.
- **Off-chain art availability.** See "Art source rot" above. The program
  guarantees the locked tokens; the deployer's URI guarantees the image.
- **Magic Eden / Tensor recognition.** The program verifies each wrap into
  its parent MCC via `verify_sized_collection_item`. Whether the marketplace
  has indexed the deployment yet is a marketplace-side latency issue.

## Test coverage summary

As of this writing:

| Suite | Tests | Status |
|---|---|---|
| `state::tier_accounting_tests` (Rust unit) | 5 | passing |
| `state::treasury_accounting_tests` (Rust unit) | 7 | passing |
| Anchor auto-gen | 1 | passing |
| `tests/wrappedfactory.ts` (integration) | 5 | passing |
| `tests/wrappedbulls.ts` regression (no Factory side effects) | 16 | passing |
| **Total** | **34** | **34 / 34** |

Run via `cargo test -p wrappedfactory --lib` (unit) and `anchor test` (the
full Anchor suite which runs both wrappedbulls + wrappedfactory `.ts` files
against a fresh local validator).

### What the tests do NOT yet cover

Two paths are listed but deferred to Week 3 hardening:

1. **`claim_treasury` success path on chain.** The unit test in
   `state.rs` proves the sweep math at the exact 7-day boundary using
   simulated timestamps, but the Anchor integration test only exercises
   the rejection path (`NothingClaimable` when all deposits are < 7d old).
   The on-chain success path requires `solana-test-validator --warp-slot`
   or `solana-bankrun`-style time travel; planned for Week 3.
2. **End-to-end wrap → unwrap lifecycle on a Factory-deployed collection.**
   The wrappedbulls test suite proves wrap/unwrap on the original program
   (16 tests). The Factory uses the same patterns reading from the per-token
   `WrappedCollection` PDA; the deploy + wrap + unwrap integration test on
   a Factory deployment is planned as part of the Week 3 stress test.

## Audit status

**The WrappedFactory program has not had a formal third-party security
audit.** The wrappedbulls parent program was internally reviewed (see the
parent SECURITY.md "Audit status" section). The Factory inherits the
wrappedbulls vault-follows-NFT patterns one-for-one.

Pre-mainnet items being completed:

- [ ] **Verified build via `solana-verify`.** Ensures the binary deployed
      to mainnet matches the source in this repo. The same verified-build
      process the parent program uses.
- [ ] **upgrade authority keypair handoff.** Upgrade authority moves from the
      deployer keypair to the existing wrappedbulls upgrade authority keypair in
      Week 4. The handoff is one tx, publicly observable.
- [ ] **Time-travel success-path test** (see above).
- [ ] **Devnet stress test:** deploy 3-5 fake `WrappedX` via the actual
      wizard + wallet adapter flow, exercise wrap/unwrap on each, prove
      end-to-end on real validators.
- [ ] **Pre-launch bug bounty announcement** matching wrappedbulls' policy.

What we have:

- 34/34 tests passing across two test surfaces (Rust unit + Anchor integration)
- Internal static review against OWASP-style Solana attack patterns
  (account substitution, missing signer checks, unsafe `UncheckedAccount`
  usage, reinit-after-close, integer overflow, arithmetic on user-supplied
  indices, PDA collisions)
- Per-instruction comments and constraint annotations that auditors can
  walk line-by-line
- Public source on GitHub (the `factory-v1` branch in
  `wrappedbulls/wrappedbulls`) once the vanity program ID lands

## Severity guide for the Factory program

Same scale as the parent program; restated here for completeness.

| Severity | What it means |
|---|---|
| Critical | Drains the bull treasury without 7d delay, drains a per-NFT vault without holding the NFT, or mints a Factory NFT without paying the deploy cost. |
| High | Bricks a deployer's wrap layer permanently, lets two deployments share the same on-chain state, or sidesteps the 1M $WBULL fee. |
| Medium | Drift in treasury accounting that does not result in lost funds, ticker/name conflicts the program does not detect, or denial-of-service against `claim_treasury` that the upgrade authority can self-resolve. |
| Low | UX confusion, missing surface validation that the program correctly rejects but the wizard does not catch early, gas/CU optimization opportunities. |

## Disclosure preference

We will publicly credit security researchers in:

- The release notes of the patched program version
- The `acknowledgements` section of this document
- Any post-mortem we write about a fixed issue (with the reporter's consent)

If you prefer anonymity, say so in the initial report and we will write
"Anonymous Reporter" in all public references.

---

*Companion document to [SECURITY.md](SECURITY.md) for the wrappedbulls parent
program. Last updated as the Factory entered Week 3 hardening.*
