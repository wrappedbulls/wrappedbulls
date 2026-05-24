# Verifiable build

How to produce a verifiable on-chain program and register the
verification, so explorers + Phantom + Blowfish show the program as
"verified" — a real trust signal during wallet/marketplace review.

Internal reference.

## What "verified" means

`solana-verify` builds the program inside a pinned Docker image so the
output bytecode is **deterministic** — anyone can reproduce it. After
deploy, you register a claim that links the on-chain program to a
public source commit. Explorers re-run the build and confirm the hash
matches, then display a verified badge.

This matters for a fresh memecoin: an unverified program is a yellow
flag during Phantom's review. A verified one that anyone can audit is
the opposite.

## Prerequisites

- Docker installed and running (the build runs in a container).
- `solana-verify` CLI: `cargo install solana-verify`.
- The program source committed and **pushed to a public repo** — the
  registration step links to a public commit. (The relaunch uses a
  fresh repo; this step waits until that repo exists and is public.)

## build.rs and determinism

This program has a `build.rs` (codegen from `config/launch.toml`).
That is fine for verifiable builds **as long as the build is
hermetic**:

- `config/launch.toml` is committed — the container build sees it.
- `build.rs` only reads that file and writes to `$OUT_DIR` — no
  network, no clock, no randomness. Deterministic.
- The `toml` + `serde` build-dependencies are pinned in `Cargo.toml`
  and locked in `Cargo.lock` (commit `Cargo.lock`).

If you add anything non-deterministic to `build.rs` (timestamps, env
that varies, network calls), verification will break. Don't.

## Procedure

### 1. Deterministic build

```bash
# From the repo root. Produces target/deploy/<program>.so deterministically.
solana-verify build
```

Or use the wrapper, which also prints the executable hash:

```bash
./scripts/verified_build.sh
```

Record the printed hash — it is the fingerprint you are committing to.

### 2. Deploy the verified artifact

Deploy the `.so` that `solana-verify build` produced (do NOT rebuild
with a plain `anchor build` afterward — that may differ):

```bash
solana program deploy \
  --program-id target/deploy/<slug>-keypair.json \
  target/deploy/<program>.so \
  --url mainnet-beta
```

(Or `anchor deploy` if the Anchor.toml program path points at the
verified `.so`. The key invariant: the bytes you deploy are the bytes
`solana-verify build` produced.)

### 3. Confirm on-chain hash matches

```bash
solana-verify get-program-hash <PROGRAM_ID> --url mainnet-beta
solana-verify get-executable-hash target/deploy/<program>.so
# the two hashes MUST be identical
```

### 4. Register the verification

```bash
solana-verify verify-from-repo \
  --program-id <PROGRAM_ID> \
  --url mainnet-beta \
  https://github.com/<org>/<repo> \
  --commit-hash <COMMIT_SHA> \
  --library-name <crate_name>
```

This submits the verification PDA and (optionally) sends the job to
the remote verifier. After it completes, explorers show the program
as verified.

## Where this fits in the relaunch

`docs/RELAUNCH_PLAYBOOK.md` Step 7 deploys the program. To ship
verified:

- Run step 1 (`solana-verify build`) instead of a plain `anchor build`.
- Deploy that exact artifact in step 7.
- Run steps 3–4 here AFTER the public repo + commit exist.

If the public repo is not ready at launch time, you can still deploy
the deterministic artifact now and run `verify-from-repo` later — the
on-chain program does not change, only the verification record is
added.

## Gotchas

- **Cargo.lock must be committed.** An unlocked dependency tree builds
  differently. (It currently is committed.)
- **Same Rust/Solana toolchain.** `solana-verify` pins this via its
  Docker image — do not override it.
- **One crate.** `verify-from-repo --library-name` must name the
  program crate (the `[package] name` in `programs/<crate>/Cargo.toml`,
  which the clone script rewrites per project).
