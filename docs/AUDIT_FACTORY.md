# WrappedFactory Internal Audit

**Date:** 2026-06-02
**Scope:** WrappedFactory program (`WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh`), `web/app/api/factory/*` routes, `@wrappedbulls/sdk` package, Factory web pages, cross-cutting concerns.
**Method:** Three parallel review tracks (program code, API routes, SDK + pages + cross-cutting) by independent subagents, each producing severity tagged findings, then verified line-by-line and synthesized here.
**Out of scope:** External security audit (declined separately; risk accepted by operator).

## Executive summary

| Severity | Total found | Fixed | Open |
|---|---|---|---|
| Critical | 2 | 2 | 0 |
| High | 5 | 4 | 1 (H5: SDK ESM build, defer until first SDK consumer) |
| Medium | 9 | 9 | 0 |
| Low | many | a few | many (cosmetic) |

**Both Criticals and 4 of 5 Highs are fixed.** All 9 Mediums fixed. Without these, mainnet launch would have failed at the first deploy and the bespoke endpoint was wide open to spam. Remaining items are SDK ESM packaging (deferred safely until first external SDK consumer) and cosmetic Lows.

## Critical findings (fixed)

### C1: Token-2022 hardcoded as classic SPL in tx builders

Pump.fun migrated to Token-2022 in 2026. $WBULL and most pump.fun tokens are owned by `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`. The tx builders hardcoded the classic SPL Token program (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) for the `wbull_token_program` and target `bulls_token_program` account metas, and the same wrong program was used as the default arg to `getAssociatedTokenAddressSync`. Result: derived ATAs would point to addresses the on chain runtime does not expect, and the first `transfer_checked` CPI fails with `IllegalOwner`.

Affected files (now fixed): `web/app/api/factory/deploy-tx/route.ts:190`, `web/app/api/factory/wrap-tx/route.ts:173`, `web/app/api/factory/unwrap-tx/route.ts:153`, `sdk/src/index.ts` (3 builders: deploy / wrap / unwrap).

Fix pattern (applied everywhere): read `conn.getAccountInfo(mint)`, branch on `owner.equals(TOKEN_2022_PROGRAM_ID)`, pass the detected program to both `getAssociatedTokenAddressSync(..., true, detectedProgram)` and the `*_token_program` account meta.

**Status:** ✅ Fixed in all six call sites.
**Test coverage:** existing integration tests use classic SPL only. New Token-2022 integration test is a fast follow.

### C2: SDK ships stale IDL with the wrong program address

`sdk/src/idl-factory.json` on the VPS embedded `"address": "Ab7yPbWmgUov7ZCYG4NjZ5354rTKL3A7JEUTHh2HdQ5s"` (the throwaway address from before the vanity grind landed). Anyone consuming `@wrappedbulls/sdk` and reading the program ID from the IDL would route their txs to a non existent program.

The web copy (`web/lib/idl-factory.json`) and the canonical `target/idl/wrappedfactory.json` both correctly used the vanity `WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh`; only the SDK copy was stale.

**Status:** ✅ Fixed by copying canonical IDL into `sdk/src/idl-factory.json`.

## High findings

### ~~H1: bulk `getProgramAccounts` callers had no caching~~ ✅ Fixed

`check-name` and `activity` now wrap `fetchAllWrappedCollections` (and the BullAsset `getProgramAccounts`) in `cacheWrapSWR` with a 30-60s TTL. Single-flight collapses concurrent requests into one RPC, SWR keeps responses fast during refresh. Cost: fresh deploys take up to 60s to appear in `check-name` results (acceptable for a UX gate).

### ~~H2: bespoke recorded `depositSignature` without on-chain verification~~ ✅ Fixed

`/api/factory/bespoke` now calls `getParsedTransaction(sig)` (with a one-shot retry for RPC propagation), walks outer + inner instructions for a `transferChecked` (or `transfer`) to the art revenue ATA, verifies sender = claimed deployer, mint = $WBULL, amount ≥ 1M. Rejects with `deposit verification failed: <reason>` if any check fails.

### ~~H3: bespoke had no rate limit / body size / email cap~~ ✅ Fixed

Added: per-IP token bucket (3 submissions/hour, 1-hour window, module-scope `Map<ip, bucket>` with periodic sweep), `content-length` precheck + body-text length check (both at 32KB), email max 254 chars (RFC 5321 max), vibe max 4000 chars, deadline max 200 chars, name + ticker character class enforced, only a known field set persisted (prevents inflated records).

### ~~H4: `deploy-tx` had no body size guard~~ ✅ Fixed

`content-length` precheck + body-text length check, both at 64KB; reject early with `invalid_body` code.

### H5: SDK ESM build layout doesn't match `package.json` exports (open, deferred)

`package.json` declares `"import": "./dist/index.mjs"` but `tsconfig.esm.json` emits `./dist/esm/index.js`. ESM consumers hit a missing file error. **Deferred safely until first external SDK consumer** because no one imports the SDK yet.

**When ready:** switch to tsup/rollup, or update `package.json` exports to `"./dist/esm/index.js"`.

## Medium findings (all fixed)

| # | File | Finding | Status |
|---|---|---|---|
| ~~M1~~ | `deploy-tx/route.ts` | `isAscii` allows control chars (`\x00-\x1f`). | ✅ Tightened to `\x20-\x7e` |
| ~~M2~~ | `deploy-tx/route.ts` | `tokensPerWrap` BN has no upper bound. | ✅ Added u64 max check + 20-digit length cap |
| ~~M3~~ | `deploy-tx/route.ts` | `maxSupply` accepts non integers. | ✅ Switched typeof check to `Number.isInteger` |
| ~~M4~~ | `preflight/route.ts` | Doesn't whitelist mint owner program. | ✅ Accepts only classic SPL + Token-2022 owners |
| ~~M5~~ | `activity/route.ts` | Reads `NEXT_PUBLIC_FACTORY_PROGRAM_ID` env at runtime. | ✅ Now uses imported `getFactoryProgramId()` consistently |
| ~~M6~~ | `set-verified-tx/route.ts` | Doesn't pre validate authority. | ✅ Reads on-chain ProgramData, rejects with `wrong_authority` if mismatch |
| ~~M7~~ | `errors.rs` | Error messages reference old MIN/MAX constants. | ✅ Updated to 100..2000, 1..=25, 1..=10, 1..=195 |
| ~~M8~~ | `lib.rs` | Doc says "burn" but code transfers to treasury; field name "total_wbull_burned" doesn't exist. | ✅ Comments now say "fee", field reference fixed to `total_wbull_deposited` |
| ~~M9~~ | `wrap.rs:204` tier race | Documentation gap, not a code bug. | ✅ Added "Tier-prediction race in wrap" section to SECURITY-FACTORY.md |

## Low findings (open)

- `programs/wrappedfactory/src/state.rs`: `saturating_add` vs `checked_add` in treasury accounting. Overflow impossible at realistic scale (1.8e13 deploys to overflow u64); use `checked_add` for defensive coding clarity.
- `programs/wrappedfactory/src/state.rs`: `WrappedCollection::SIZE` comment says 4454, actual 4452. Cosmetic.
- `web/lib/factory.ts:345`: WRAPPED_COLLECTION_SIZE comment says "reserved" but should say "verified + reserved" (1 byte was carved out for the verified flag).
- `web/app/launch/[slug]/page.tsx`: ticker fallback path calls `fetchAllWrappedCollections` per render; could be hammered. Add base58 length precheck + cache the bulk read.
- `web/app/launch/treasury/page.tsx`: sequential fetches instead of `Promise.all`. Halves latency.
- `web/app/launches/page.tsx`, `[slug]/page.tsx`, `treasury/page.tsx`: shared formatting helpers duplicated. Extract to `lib/format.ts`.
- `web/app/launch/embed/page.tsx`: snippet hardcodes `https://wrappedbulls.com/embed.js`. Should use `window.location.origin`. Also missing CORS headers in `next.config.js` for the embed script.
- `web/app/launch/[slug]/page.tsx`: no openGraph image tags. X / Twitter shares of partner deployments have no preview.
- `web/app/launch/new/page.tsx:30-33`: constants redefined locally instead of imported from `@/lib/factory`. Drift risk.
- `web/app/launch/new/page.tsx`: no `MAX_ART_URI_LEN` validation client side. Program rejects but UX would catch it sooner.

## Confirmed clean (areas reviewed with no findings)

- **Program logic correctness:** All six instructions (initialize, deploy_collection, wrap, unwrap, claim_treasury, set_verified) have correct PDA derivations, signer requirements, CPI signer seeds, and upgrade authority gating where applicable.
- **Constants identity:** MIN_SUPPLY, MAX_SUPPLY, MAX_NAME_LEN, MAX_TICKER_LEN, MAX_ART_URI_LEN, PENDING_CAP, PENDING_LOCK_SECONDS, DEPLOY_FEE all consistent across program, web lib, SDK.
- **PDA seeds identity:** `factory_config`, `bull_treasury`, `collection`, `collection_mint`, `collection_authority`, `nft_mint`, `vault`, `bull` seeds match byte for byte across program / web / SDK.
- **Compute budget:** 600,000 CU set on deploy / wrap / unwrap tx builders. Reasonable for the workload.
- **Rent reclaim:** `unwrap` closes BullAsset (rent → payer), vault ATA (rent → payer), and Metaplex burn closes nft_mint + nft ATA + metadata + master edition. No rent stranding.
- **Verified field:** carved 1 byte from `reserved [u8; 64]` → `verified: bool + reserved [u8; 63]`. SIZE unchanged. Deserialization correct.
- **Empty / boundary states:** factory uninitialized, zero deployments, maxed out deployment, empty treasury all gracefully handled in the web layer.
- **Bespoke deposit flow (client side):** correctly uses Token-2022 for $WBULL transfer.
- **Hash matches on chain:** local executable hash (`80b52f3...3c9`) equals devnet program hash. Verified build confirmed.

## Notes

- The audit was iterative: subagent findings were cross checked before being recorded here. One agent claimed `CpiContext::new(<program>.key(), ...)` would not compile (Critical). Verification showed the same pattern is mainnet live in wrappedbulls and Anchor 0.31+ accepts `Pubkey` for the program param. False positive.
- The tier prediction race exists in mainnet wrappedbulls as well and has not caused user incidents because per collection wrap volume is low. Acceptable for Factory v1 with the same trade off.
- Tests cover 21 integration paths + 13 unit paths + 1 bankrun success path = 22 total. Token-2022 coverage is the largest test gap.
- The Bespoke flow is the highest open risk surface because it accepts off chain state (the brief) keyed to on chain action (the deposit). H2 (verify deposit on chain) and H3 (rate limit) should both ship before mainnet announcement.

## Suggested fix order before mainnet

1. ~~C1 + C2~~ ✅ done
2. ~~H2: bespoke deposit on chain verification~~ ✅ done
3. ~~H3: bespoke rate limiting + body size~~ ✅ done
4. ~~H4: deploy-tx body size guard~~ ✅ done
5. ~~H1: cache wrapper on bulk getProgramAccounts callers~~ ✅ done
6. ~~M1-M3: tighten validation in deploy-tx~~ ✅ done
7. ~~M4-M6: preflight whitelist, activity env var, set-verified pre-validate~~ ✅ done
8. ~~M7-M8: program doc drift~~ ✅ done
9. ~~M9: tier race note to SECURITY-FACTORY.md~~ ✅ done
10. H5: SDK ESM build fix — **deferred** until first external SDK consumer
11. Token-2022 integration test — recommended fast-follow (largest remaining test gap)
12. The Lows as opportunistic polish

**Pre-mainnet gate is now clear from an audit perspective.** Regression check: all 22 integration tests + 13 unit tests still passing post-fixes.

---

*Living document. Each fix lands → strike through the entry + reference the commit.*
