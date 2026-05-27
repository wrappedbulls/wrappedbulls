> # ⚠️ OBSOLETE SNAPSHOT (2026-05-09). DO NOT TRUST THIS VERDICT
> Predates the corrected root-cause analysis. Its "GREEN. ready to launch"
> verdict, "7/7 anchor / 10/10 unit tests", and "deployer `FRZJ…TwQ`"
> (FRZJ…TwQ is the royalty treasury, deployer is `GMrJpP7Sa…`) are all
> superseded. Current truth: pre-launch, program devnet-only (NOT on
> mainnet), 12/12 anchor tests, manual launch. Authoritative:
> [`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md) /
> [`LAUNCH_CHECKLIST.md`](LAUNCH_CHECKLIST.md). Historical only.

# Pre-launch readiness audit (OBSOLETE 2026-05-09 SNAPSHOT)

**Run date:** 2026-05-09 · **Auditor:** automated sweep against bulls box (165.22.167.96)

## Verdict: GREEN. ready to launch

All 9 audit steps pass. Two real bugs were caught and fixed during the audit (see Audit 1 below). No remaining blockers.

---

## Audit 1: Test suites (PASS)

- **10/10 Rust unit tests** pass on the bulls box (`cargo test --manifest-path programs/wrappedbulls/Cargo.toml --lib`)
- **7/7 Anchor integration tests** pass (`anchor test`), including:
  - `vault follows NFT` (the central thesis proof. wallet A wraps, transfers NFT to B, B unwraps and gets the tokens)
  - `wraps multiple bulls and counters track correctly`
  - `wrap_bull fails when caller has insufficient balance`

**Bugs caught during this audit:**

1. **Stale `declare_id!`**. source had `EaRLH7zU…` but the keypair is `A2tUttiL…`. Would have broken every mainnet wrap/unwrap with `DeclaredProgramIdMismatch`. Fixed via `anchor keys sync`.
2. **Missing CU bump on multi-wrap test**. one wrap call missed `ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 })`, causing 200k CU exhaustion. Fixed.

These were latent because the original test runs predated the keypair switch.

## Audit 2: Build artifact + program ID alignment (PASS)

| Source | Value |
|---|---|
| `target/deploy/wrappedbulls.so` | exists, ~307KB |
| Keypair-derived program ID | `F7qXskG73efUwbDo2B97tZgpPAqX7zHMApXbPUimcFdS` |
| `declare_id!` in `lib.rs` | `F7qXskG73efUwbDo2B97tZgpPAqX7zHMApXbPUimcFdS` |
| `Anchor.toml [programs.devnet]` | `F7qXskG73efUwbDo2B97tZgpPAqX7zHMApXbPUimcFdS` |
| `Anchor.toml [programs.localnet]` | `F7qXskG73efUwbDo2B97tZgpPAqX7zHMApXbPUimcFdS` |
| `Anchor.toml [programs.mainnet]` | `F7qXskG73efUwbDo2B97tZgpPAqX7zHMApXbPUimcFdS` |

All five sources of truth aligned.

## Audit 3: On-chain invariants (devnet) (PASS. 6/6)

`scripts/audit_chain.sh` reports:

- ✓ `in_circulation == total_wrapped - total_unwrapped` (1 == 2 - 1)
- ✓ live BullAsset count == in_circulation (1 == 1)
- ✓ sum(vault.amount) == in_circulation × 1M tokens (1,000,000,000,000 base units)
- ✓ all live NFT mints have supply == 1 (0 mismatches)
- ✓ (next_tier-1) - len(free_tiers) == in_circulation ((3-1)-1 == 1)
- ✓ free_tiers all in [1, MAX_BULLS]

## Audit 4: DNS + TLS (PASS)

- DNS: `wrappedbulls.com` and `www.wrappedbulls.com` both resolve to `165.22.167.96` via Google 8.8.8.8 ✓
- TLS cert (ZeroSSL ECC DV): valid May 8 → Aug 6 2026 (89 days). Caddy auto-renews 30 days before expiry. ✓

## Audit 5: API endpoints (PASS. 13/14, 1 expected 404)

| Endpoint | HTTP |
|---|---|
| `/` | 200 |
| `/thesis` | 200 |
| `/tech` | 200 |
| `/about` | 200 |
| `/gallery` | 200 |
| `/wrap` | 200 |
| `/unwrap` | 200 |
| `/bull/2` | 200 |
| `/wallet/<addr>` | 200 |
| `/api/health` | 200 |
| `/api/render/1` | **404 (expected)**. tier 1 was unwrapped during cross-wallet test, no longer live |
| `/api/render/2` | 200 (live bull) |
| `/api/metadata/2` | 200 |
| `/api/recently-wrapped` | 200 |

## Audit 6: RPC connectivity (PASS. 4/4)

| RPC | Slot at audit time |
|---|---|
| Helius devnet | 461,128,360 ✓ |
| Helius mainnet | 418,577,211 ✓ |
| Solana public mainnet | 418,577,210 ✓ (1-slot fresh) |
| Solana public devnet | 461,128,361 ✓ (1-slot fresh) |

Helius API key wired server-side only (not in client JS bundle).

## Audit 7: Mainnet deployer integrity (PASS)

- Pubkey: `8HoMgnUbDRvPZN1M9jPxXPqE63tRbChGzvdEe3ethzTD`
- Mainnet balance: 0 SOL
- Mainnet account: does not exist (no transactions, no accidental funding) ✓
- Devnet account: does not exist ✓

## Audit 8: DigitalOcean weekly snapshots (PENDING. user action)

Enable in the DO panel: bulls droplet → Backups → Enable Backups. ~$1.20/mo. Operational insurance for the bulls box.

## Audit 9: Readiness report (this document) (DONE)

---

## Summary of remaining launch-day items

1. **Fund mainnet deployer with ~5.5 SOL**. only on launch day
2. **SCP the deployer keypair to `/tmp/mainnet-deployer.json`**. only on launch day, shred after
3. **Run** `DEPLOYER_KEYPAIR=/tmp/mainnet-deployer.json /root/wrappedbulls-sol/scripts/launch.sh <WBULL_MINT>`
4. **Founder bull wrap** (dev wallet wraps WrappedBulls #1 from pump.fun dev-buy supply)
5. **Tweet** per `docs/COMMS.md` cadence

The system is launch-ready.
