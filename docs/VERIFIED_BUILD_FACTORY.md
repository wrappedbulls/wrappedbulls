# WrappedFactory Verified Build Manifest

This is the canonical record of the `wrappedfactory` program build that ships to mainnet. Anyone can independently reproduce the build from source and compare the bytecode hash to what is recorded here and to what is on chain.

The methodology is documented in [`VERIFIABLE_BUILD.md`](VERIFIABLE_BUILD.md). This file is the as applied snapshot.

---

## Canonical hash

The `wrappedfactory.so` executable hash (computed via `solana-verify get-executable-hash`, which normalizes BPF trailing zero padding before hashing):

```
f2ce0ac4f4d70b84e4abb622f31125dc32320ed5aa7723f6b7744546600ef0d2
```

The raw SHA256 of the same file (different number because raw sha256 does not normalize padding):

```
58134a913303b983328a8052e9e4a5c1d15102596de93876cb1a3a3b475eba6a
```

Use the `solana-verify get-executable-hash` value for any on chain comparison. Use the raw SHA256 for file integrity checks during transfer.

## Source pinning

| | |
|---|---|
| Repo | https://github.com/wrappedbulls/wrappedbulls |
| Branch | `release/v1.0` (tag `v1.0-rc1` and forward) |
| Commit (latest at build time) | `56b78d4fc46753022a6ecc8c2d4c941625397c5e` (includes on chain pause ix + launch hardening + CI workflow) |
| Crate | `programs/wrappedfactory` |
| Cargo.toml version | `0.1.0` |
| Anchor.toml `declare_id!` | `WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh` |

## Build environment used to produce this hash

| | |
|---|---|
| Host | DigitalOcean Ubuntu VPS, the bulls box (165.22.167.96) |
| Rust toolchain | 1.95.0 (pinned via rustup) |
| Anchor CLI | 1.0.2 |
| Solana CLI | 3.1.14 (Agave; src:3134055b feat:534737035) |
| Build command | `anchor build -p wrappedfactory` |
| Output file | `target/deploy/wrappedfactory.so` |
| File size | 542,792 bytes (was 532,368 pre v1.0; pause ix + state.paused field + new instruction added ~10 KB) |
| Build date | 2026-06-03 |

This is a build environment record, not a reproducible build claim. A reproducible build via `solana-verify build` requires Docker. The plan is:

1. Use this hash as the pre mainnet check (mainnet deploy must produce the same hash).
2. Post mainnet, install Docker on the build box and rerun via `solana-verify build` so a third party can match the on chain bytecode against the public commit.

## Cross check: on chain devnet program

The devnet program at `WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh` currently runs the pre v1.0 bytecode `80b52f33...` (deployed 2026-06-02). The on chain devnet image is STALE relative to release/v1.0; the operator drill at [`scripts/factory_devnet_pause_drill.ts`](../scripts/factory_devnet_pause_drill.ts) requires a fresh devnet redeploy of the v1.0 bytecode before it can exercise the new pause ix. That redeploy is runbook Step 4.5.

| | |
|---|---|
| Program ID | `WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh` |
| Cluster | devnet |
| Pre v1.0 deploy tx | `5y445MxDj1rMN3PeGZKzaBuAE21LPw7sVPJq9eJ5nrMpQUgznvsb4XwVoJRpfBasyQp2MWu8qdqdfJxhjWgTBqVd` |
| Pre v1.0 deploy authority | `9APFjBFh2ipnFnyjisJVUWPuo8d89Fi1SPWMqfbSYWqe` (devnet only) |
| Pre v1.0 on chain hash | `80b52f335a1c9e2b4301bb7186707313e099a8dc4d5f054b508d48a36b9553c9` |
| v1.0 local hash | `f2ce0ac4f4d70b84e4abb622f31125dc32320ed5aa7723f6b7744546600ef0d2` |
| v1.0 devnet redeploy | PENDING (runbook Step 4.5) |

## How to verify this build yourself

After mainnet launch, you can prove the on chain mainnet program is the exact bytecode we publish here.

```
git clone https://github.com/wrappedbulls/wrappedbulls
cd wrappedbulls
git checkout 56b78d4fc46753022a6ecc8c2d4c941625397c5e

# Same toolchain as above
rustup install 1.95.0
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --tag v0.32.1

# Build
anchor build -p wrappedfactory

# Confirm hash
cargo install solana-verify --version 0.4.4
solana-verify get-executable-hash target/deploy/wrappedfactory.so
# Expected: f2ce0ac4f4d70b84e4abb622f31125dc32320ed5aa7723f6b7744546600ef0d2

# Confirm on chain mainnet matches
solana-verify get-program-hash WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh --url mainnet-beta
# Expected: same hash
```

If your local build differs, the cause is almost always a Rust toolchain or Anchor CLI version mismatch. The Docker based `solana-verify build` eliminates that variance (deferred to post launch).

## Post mainnet checklist

After Runbook Step 2 (mainnet program deploy):

1. Run `solana-verify get-program-hash WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh --url mainnet-beta`
2. Compare to the canonical hash above. Must match exactly. If it does not match: do not proceed with the launch announcement until it is investigated.
3. Add the mainnet tx signature and `Last Deployed In Slot` to this doc, in a new "## Mainnet record" section.
4. Install Docker on the build box. Run `solana-verify build --library-name wrappedfactory` and confirm the same hash. This unlocks third party reproducibility.
5. Run `solana-verify verify-from-repo --library-name wrappedfactory --commit-hash c8cfcbd https://github.com/wrappedbulls/wrappedbulls WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh --url mainnet-beta`. This publishes the verification claim so explorers display the green badge.

## See also

- [`VERIFIABLE_BUILD.md`](VERIFIABLE_BUILD.md) — the broader methodology doc (originally for wrappedbulls, same process applies)
- [`FACTORY_LAUNCH_RUNBOOK.md`](FACTORY_LAUNCH_RUNBOOK.md) — Step 8 references this file
- [`PRE_MORTEM_FACTORY.md`](PRE_MORTEM_FACTORY.md) — Failure modes 2.x cover deploy mismatches
