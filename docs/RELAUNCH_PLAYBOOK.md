# Relaunch playbook — pump.fun-style memecoin layer, in <4 hours

Operator-facing runbook for launching a new project using the
templatized baseline. Internal reference. NOT for public repo.

This is the **happy-path** sequence: clone the baseline → configure →
deploy → verify → flip live. If anything goes wrong, see
[`POSTMORTEM.md`](POSTMORTEM.md) §"Root causes" and [`LESSONS_LEARNED.md`](LESSONS_LEARNED.md).

## Glossary

- **Baseline** — the `relaunch-baseline-v1.0` tag in
  [`wrappedbulls-full-history.bundle`](../../wrappedbulls-sol-archive/wrappedbulls-full-history.bundle).
  Token-2022 port + /api/rpc proxy + 13/13 anchor tests + templatized
  config layer.
- **Slug** — short kebab/snake identifier for the new project. Derived
  from `unit_singular` lowercased + "peg" (default), e.g. `rockpeg`.
- **Operator** — you, executing this runbook on a single machine.

## Prerequisites (one-time)

- [ ] Linux box ready (the relaunch's equivalent of bulls-box). SOL CLI,
      Anchor CLI, Node 20+, Rust stable, sed, bash.
- [ ] Helius mainnet RPC key with **paid credits**. Do NOT relaunch on
      the free tier (P-LESSON L10).
- [ ] Domain registered + DNS A record pointing at the box.
- [ ] TLS cert via Caddy auto-provision.
- [ ] **Deployer wallet** funded with at least 9 SOL on mainnet. This
      is the wallet that signs `anchor deploy`. NOT the same as the
      royalty treasury wallet (P-LESSON L17 — last launch briefly
      conflated them).
- [ ] **Royalty treasury wallet** generated, pubkey written down. Will
      receive 5% of secondary sales forever. Cold-backed.
- [ ] X account warmed up (>= 30 days old, some posting history,
      followed by ≥ a few wallets). Set the avatar + banner. Do NOT
      use a brand-new account — Phantom Blowfish flags those.
- [ ] Optional: Magic Eden Creator Hub account, Tensor account.

## Step 0 — Restore baseline + clone

```bash
mkdir -p ~/projects
cd ~/projects

# Restore the archive bundle (path adjusted to wherever yours lives).
git clone /path/to/wrappedbulls-full-history.bundle <slug>
cd <slug>

# Fresh git history. Critical for the "first ever" narrative on the
# new project — preserves no link to the previous repo. See
# POSTMORTEM.md "Conclusion".
rm -rf .git
git init
git checkout -b main 2>/dev/null || true
git add -A
git commit -m "init: <Name> baseline (from relaunch-baseline-v1.0)"
```

**Time:** ~2 minutes.

## Step 1 — Run clone_to_new_project.sh

```bash
./scripts/clone_to_new_project.sh \
  --name "<Project Name>" \
  --ticker "<TICKER>" \
  --unit-singular "<Unit>" \
  --domain "<host>" \
  --royalty-bps 500 \
  --treasury "<treasury pubkey>" \
  --twitter "@<handle>"
```

This:
- Generates a new program keypair at `target/deploy/<slug>-keypair.json`
- Rewrites `config/launch.toml` + `web/config/brand.json`
- Regenerates `web/lib/launch-config.generated.ts`
- Re-runs the build.rs codegen
- Sed-rebrands all source files
- Updates `Cargo.toml`, `Anchor.toml`, `web/package.json` names
- Runs `cargo test --lib` + `tsc --noEmit` as verification
- Prints a "manual review" report

**Time:** ~3 minutes (most of it cargo test compile).

## Step 2 — Manual review of script output

Read the "MANUAL REVIEW REPORT" the script prints. Apply edits as
needed:

- [ ] Rust struct names (`WrapBull`, `UnwrapBull`, `BullBank`,
      `BullAsset`, `MAX_BULLS`, `TOKENS_PER_BULL`) — the script does
      NOT rename these because they propagate to tests + IDL. Rename
      them if you want the new project's struct names to match its
      theme, OR leave them as-is (they don't affect on-chain
      behavior).
- [ ] File names containing "bull" — none currently, but check.
- [ ] Stray lowercase "bull" references in comments / strings — pick
      apart with `grep -rin bull programs/ web/`.

**Time:** 10–30 minutes depending on how thorough you want to be.

## Step 3 — Art assets

Replace the brand image files under `web/public/`:

```
web/public/mascot.png       ← collection NFT image
web/public/banner.png       ← X/twitter banner + site hero
web/public/og.png           ← Open Graph card (1200x630)
web/public/favicon.ico      ← browser tab icon
```

If you have a renderer to generate the NFT trait visuals, hook it into
`web/app/api/render/[tier]/route.ts`. Otherwise leave the existing
SVG renderer (the visuals will still be unique-per-NFT, just less
themed).

**Time:** depends on art readiness. Aim for assets prepared in advance.

## Step 4 — Local end-to-end test on devnet

```bash
# Point Solana CLI + Anchor at devnet.
solana config set --url devnet
solana airdrop 5  # devnet faucet, retry if rate-limited

# Anchor build + deploy + test.
anchor build
anchor deploy --provider.cluster devnet
anchor test  # uses devnet by default since Anchor.toml [provider]

# Smoke-test the web side.
cd web
npm install
npm run dev
# Open http://localhost:3000, connect a devnet wallet, click Wrap.
```

All 13 anchor tests must pass. Wrap+Unwrap must visibly work in the
browser end-to-end. If anything fails, **stop**. Diagnose. Do not move
to mainnet.

**Time:** 30–60 minutes.

## Step 5 — Phantom + marketplace pre-submission

Submit the dApp domain + collection mint **48–72h before** trading
trading begins. Phantom + Blowfish + ME + Tensor all have queue
windows.

- [ ] Phantom developer dApp submission with `domain`, `program ID`,
      `solana:network`, `dapp:source` (GitHub or null), `dapp:twitter`.
- [ ] Phantom token submission with the future mint address (you can
      provide it after Step 8 since the mint is created on pump.fun
      and the bank PDA stores it on-chain).
- [ ] Magic Eden Creator Hub: pre-submit the collection mint pubkey
      as soon as `initialize_collection` runs in Step 7. ME indexes
      verified collections automatically but pre-submission speeds
      it up.
- [ ] Tensor: same.

**Time:** 30 minutes of clicking.

## Step 6 — Deploy lockfile + preflight (P3.3 / P4.1)

```bash
# Single-operator lock — second concurrent run aborts.
flock /var/run/<slug>-deploy.lock || {
  echo "deploy already in progress, aborting"
  exit 1
}

# Preflight: verifies deployer wallet balance, no stranded buffers,
# program keypair is unused on mainnet, anchor cluster is the right
# one (NOT mainnet-beta — see L5).
./scripts/preflight.sh "<mint>"  # mint is the future $TICKER mint
```

If preflight fails, fix and retry. Do NOT bypass.

**Time:** 5 minutes if green.

## Step 7 — Mainnet deploy

```bash
# Switch to mainnet via the CORRECT cluster name for each CLI.
solana config set --url mainnet-beta   # Solana CLI value
# Anchor uses "mainnet" (NOT mainnet-beta — L5). Always pass it
# explicitly. The Anchor.toml fallback is "localnet" by design.
anchor deploy --provider.cluster mainnet
```

Watch for stranded buffer accounts on failure. Recover with
`solana program close <BUFFER> --recipient $(solana address)`.

Initialize bank + collection. The mint address is the pump.fun token
which you will create in Step 8 — so DEFER the bank initialization
until Step 8 finishes. The program can sit deployed-but-uninitialized
indefinitely; the bank PDA only gets created when you call
`initialize`.

**Time:** 5 minutes for `anchor deploy`. Initialize step waits on Step 8.

## Step 8 — pump.fun launch + sim gate

1. Launch the token on pump.fun. Get the mint address.
2. Write the mint into `config/launch.toml`:
   ```toml
   [token]   # optional section, may not exist yet — add if so
   mint = "<new mint address>"
   ```
3. Run `anchor build` + redeploy (this is allowed because the program
   data is upgradeable; the program ID stays the same).
4. Initialize bank + collection:
   ```bash
   # See scripts/init_bank.ts and scripts/init_collection.ts.
   # Both protected by the upgrade-authority gate (L8 + P5.1).
   anchor run init-bank
   anchor run init-collection
   ```
5. **HARD GATE**: run the sim gate against mainnet state with a
   funded test wallet holding ≥ 1M of the new token:
   ```bash
   ./scripts/mainnet_sim_gate.sh "<mint>" "<sim_payer pubkey>"
   ```
   Required: `simulationErr: null` and a `Wrapped <unit> tier=1 success`
   log line. If the gate fails, **stop**. Do NOT announce.

**Time:** 30 minutes including pump.fun creation + sim verification.

## Step 9 — REAL first wrap from operator's wallet

Operator's primary wallet (NOT the deployer, NOT the treasury — the
operator's personal/marketing wallet) wraps the first NFT on mainnet.

This is the **"first ever"** moment that the relaunch narrative depends
on. The tx confirms, the NFT appears in Phantom, and within ~15
minutes it surfaces on Magic Eden + Tensor + the site gallery.

**Time:** 5 minutes for the wrap, 15-30 for marketplace propagation.

## Step 10 — Flip state.json from pre-launch → live

When P3.1 (runtime launch-state) is wired up:

```bash
# Single-file write, picked up by /api/launch-state on the next page
# load. No rebuild. Rollback by writing "pre-launch" back.
echo '{"state":"live"}' > /var/lib/<slug>/state.json
```

If P3.1 is not yet implemented and the site still has the build-time
`PRE_LAUNCH = true` constant: blue-green deploy a fresh build with
`PRE_LAUNCH = false`. Caddy upstream swap is atomic and zero-downtime
(P3.2).

**Time:** 10 seconds with P3.1; 5 minutes with blue-green.

## Step 11 — Announce

Only AFTER Steps 8 (sim gate green) and 9 (real first wrap on-chain)
have succeeded. Tweet from the warmed account with:
- Link to `https://<domain>/`
- Link to the first NFT on Magic Eden / Tensor / Phantom
- Mint address + program ID

Tag pump.fun if appropriate. Do NOT tag wallet teams (Phantom etc) —
they've already received your dApp/token submissions.

## Step 12 — Post-launch monitoring (P8.1)

- Watch `/api/health` (P3.5). Page on red.
- Watch the live wrap feed. First 100 wraps are the highest-risk
  window for any UX glitch to surface publicly.
- 24h playbook (P8.2): pause/rollback procedures, support DM template.

## Total time budget

| Step | Description                          | Time         |
|------|--------------------------------------|--------------|
| 0    | Restore baseline + clone             | 2 min        |
| 1    | clone_to_new_project.sh              | 3 min        |
| 2    | Manual review                        | 10–30 min    |
| 3    | Art assets                           | (pre-prepared) |
| 4    | Devnet end-to-end                    | 30–60 min    |
| 5    | Phantom + marketplace pre-submit     | 30 min       |
| 6    | Deploy lock + preflight              | 5 min        |
| 7    | Mainnet deploy                       | 5 min        |
| 8    | pump.fun launch + sim gate           | 30 min       |
| 9    | REAL first wrap                      | 5 min        |
| 10   | state.json flip                      | 10s–5min     |
| 11   | Announce                             | 5 min        |
|      | **Total active time**                | **~2–4h**    |

Plus a 48–72h waiting period for Phantom/marketplace queues between
Step 5 and Step 7.

## What this playbook assumes is already done

Status of the items the playbook references but doesn't itself execute:

| Reference | Status (as of 2026-05-21)        |
|-----------|----------------------------------|
| Templatized configs (P2.1–P2.4)  | ✅ done in baseline |
| Clone script (P2.6)              | ✅ done in baseline |
| Runtime /api/launch-state (P3.1) | ✅ done — `set_launch_state.sh` flips it |
| Blue-green deploy (P3.2)         | ✅ done — `deploy/` templates + `blue_green_deploy.sh` + `docs/DEPLOY.md` |
| Deploy lockfile (P3.3)           | ✅ done — `with_deploy_lock.sh`; `blue_green_deploy.sh` self-locks |
| Hardened /api/rpc (P3.4)         | ✅ done — method allowlist + per-IP rate limit + metrics |
| /api/health (P3.5)               | ✅ done — augmented with launchState + version |
| UI state machine (P3.6)          | ✅ done — explicit `rpc-error` state (`RpcErrorCard`) |
| /status page (P3.7)              | ✅ done — renders `/api/health` + `/api/rpc` metrics |
| Dual UI bundle (P3.8)            | ✅ done — satisfied by P3.1 (both UI branches in one bundle) |
| preflight.sh (P4.1)              | ✅ done — mint program/decimals/extensions + deployer checks |
| mainnet_sim_gate.sh (P4.2)       | ✅ done — RESULT:CLEAN + Wrapped-tier + success hard gate |
| cluster_flag_lint.sh (P4.3)      | ✅ done — caught + fixed a real bug in `launch.sh` |
| no_concurrent_agents.sh (P4.4)   | ✅ done — process scan + advisory operator lock |
| New program keypair gen (P5.1)   | ✅ done by clone script |
| Admin pause (P5.2)               | ❌ todo — on-chain program change; needs a validator to test |
| Token-2022 extension tests (P5.3)| ❌ todo — do in the P6.3 devnet drill (needs a validator) |
| Verifiable build (P5.4)          | ✅ documented — `docs/VERIFIABLE_BUILD.md` + `verified_build.sh` (registration waits on the public repo) |

The remaining ❌ items (P5.2 admin pause, P5.3 Token-2022 tests)
don't BLOCK a relaunch — they're hardening to be done on a machine
with a Solana validator (the P6.3 devnet drill environment), not in a
pure code-edit session.
