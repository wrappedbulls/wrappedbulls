# WrappedFactory Verified Build Manifest

This is the canonical record of the `wrappedfactory` program build that ships to mainnet. Anyone can independently reproduce the build from source and compare the bytecode hash to what is recorded here and to what is on chain.

The methodology is documented in [`VERIFIABLE_BUILD.md`](VERIFIABLE_BUILD.md). This file is the as applied snapshot.

---

> **STATUS: hash below is for the c8cfcbd pre v1.0 build. STALE.** The release/v1.0 branch added the on chain circuit breaker (`set_factory_paused` ix) and other v1.0 hardening; the deployed bytecode hash will change. Regenerate the hash from `release/v1.0` tip immediately before mainnet deploy (see "How to verify this build yourself" below) and update both the "Canonical hash" and "Source pinning" blocks with the new values before running [`FACTORY_LAUNCH_RUNBOOK.md`](FACTORY_LAUNCH_RUNBOOK.md) Step 8.

## Canonical hash

The `wrappedfactory.so` executable hash (computed via `solana-verify get-executable-hash`, which normalizes BPF trailing zero padding before hashing):

```
80b52f335a1c9e2b4301bb7186707313e099a8dc4d5f054b508d48a36b9553c9
```
(stale; pre release/v1.0)

The raw SHA256 of the same file (different number because raw sha256 does not normalize padding):

```
97c24b0d8be3e67f9164636eb86d31774b2da52988826d30cc14a5eb18f87f0f
```

Use the `solana-verify get-executable-hash` value for any on chain comparison. Use the raw SHA256 for file integrity checks during transfer.

## Source pinning

| | |
|---|---|
| Repo | https://github.com/wrappedbulls/wrappedbulls |
| Branch | `factory-v1` |
| Commit (latest at build time) | `c8cfcbd` (rebased onto current main, includes `web/lib/idl-factory.json`) |
| Crate | `programs/wrappedfactory` |
| Cargo.toml version | `0.1.0` |
| Anchor.toml `declare_id!` | `WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh` |

## Build environment used to produce this hash

| | |
|---|---|
| Host | DigitalOcean Ubuntu VPS, hosted at the bulls box |
| Rust toolchain | 1.95.0 (pinned via rustup) |
| Anchor CLI | 1.0.2 |
| Solana CLI | active release (matches Anchor 1.0.2) |
| Build command | `anchor build -p wrappedfactory` |
| Output file | `target/deploy/wrappedfactory.so` |
| File size | 532,368 bytes |
| Build date | 2026-06-02 |

This is a build environment record, not a reproducible build claim. A reproducible build via `solana-verify build` requires Docker. The plan is:

1. Use this hash as the pre mainnet check (mainnet deploy must produce the same hash).
2. Post mainnet, install Docker on the build box and rerun via `solana-verify build` so a third party can match the on chain bytecode against the public commit.

## Cross check: on chain devnet program

The Factory was deployed to devnet on 2026-06-02 from the exact `wrappedfactory.so` file referenced above.

| | |
|---|---|
| Program ID | `WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh` |
| Cluster | devnet |
| Deploy tx | `5y445MxDj1rMN3PeGZKzaBuAE21LPw7sVPJq9eJ5nrMpQUgznvsb4XwVoJRpfBasyQp2MWu8qdqdfJxhjWgTBqVd` |
| Deploy authority | `9APFjBFh2ipnFnyjisJVUWPuo8d89Fi1SPWMqfbSYWqe` (devnet only deployer; mainnet uses the bulls box keypair) |
| Program data size on chain | 532,368 bytes |
| `solana-verify get-program-hash` output | `80b52f335a1c9e2b4301bb7186707313e099a8dc4d5f054b508d48a36b9553c9` |

**Match status: on chain devnet hash == local executable hash.** The .so on disk was deployed to devnet bit perfect.

## How to verify this build yourself

After mainnet launch, you can prove the on chain mainnet program is the exact bytecode we publish here.

```
git clone https://github.com/wrappedbulls/wrappedbulls
cd wrappedbulls
git checkout c8cfcbd

# Same toolchain as above
rustup install 1.95.0
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --tag v0.32.1

# Build
anchor build -p wrappedfactory

# Confirm hash
cargo install solana-verify --version 0.4.4
solana-verify get-executable-hash target/deploy/wrappedfactory.so
# Expected: 80b52f335a1c9e2b4301bb7186707313e099a8dc4d5f054b508d48a36b9553c9

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
