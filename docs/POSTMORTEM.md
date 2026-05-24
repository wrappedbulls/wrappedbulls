# Postmortem — WrappedBulls / $WBULL launch (2026-05)

Internal reference for the next launch. NOT for public repo.

This is a no-blame postmortem. The token shipped, the program shipped,
the wrap mechanic works on-chain (proven by sim). The project died for
a single root cause: **the launch sequence had no margin for any one
of a dozen latent defects to surface during a live, high-attention
window.** Each defect on its own was survivable. Several arriving
simultaneously during the launch hour was not.

## Timeline

- Pre-launch: program built + tested on devnet against a classic SPL
  mock mint. Tests passed (10/10 + 7/7 anchor). Web stack built on
  Next.js 14 with `NEXT_PUBLIC_*` env vars inlined at build time.
- Launch hour: pump.fun token created with mint
  `XfY2XBcgY8QSLtGHnmwYrMT4CQt5mVMj55tXRWHpump`. This mint is
  **Token-2022** (pump.fun's standard), not classic SPL.
- Wrap attempts fail. Browser console shows 403s from
  `api.mainnet-beta.solana.com`. UI shows "Need 1M $WBULL" to users who
  hold $WBULL — actually an RPC failure misrendered as zero balance.
- Operator attempts to flip the site back to pre-launch state via env
  var. The Next.js build had inlined the launch state at build time;
  flipping the env doesn't take effect. Site goes to 502 during
  rebuild.
- "GET THE WEBSITE UP ONLINE IMMEDIATELY, THE 502 IS KILLING THE
  PROJECT PEOPLE ARE THINKING ITS A SCAM" — emergency restart with
  old bundle.
- Parallel agents flip `PRE_LAUNCH` flag back and forth in
  `web/app/wrap/page.tsx` and `web/app/unwrap/page.tsx`. Site
  oscillates between states.
- Token-2022 vs classic SPL mismatch identified as the program-level
  root cause. Emergency parallel-agent port of `wrap_bull` /
  `unwrap_bull` to `InterfaceAccount<Mint/TokenAccount>` +
  `transfer_checked` + separate `bulls_token_program: Interface<TokenInterface>`.
  Mainnet upgrade at slot 421046372 (data length 431,696).
- `/api/rpc` proxy built: browser POSTs same-origin to
  `wrappedbulls.com/api/rpc`, which forwards to paid Helius server-side.
  Public RPC 403 problem solved.
- High-fidelity simulation against live mainnet state (SIM_PAYER =
  funded deployer holding 6.4M $WBULL) returns
  `simulationErr: null`, `unitsConsumed: 221123`,
  `Wrapped bull tier=1 nft_mint=GxCWcPgEBxB2URwAFUzjKvNMMxVxuRGFWu76Whdx8G5X`.
  Program proven correct.
- By the time the program was provably correct, market trust was gone
  and the project was declared dead.

## Root causes

### 1. Token-2022 mismatch — primary

The program was built and tested against classic SPL token accounts.
$WBULL is Token-2022. The wrap CPI `transfer` against a Token-2022
account reverts at the SPL token program level. No amount of
client-side polish would have fixed this — the on-chain program had to
be ported.

**Why we missed it:** Tests used a vanilla classic SPL mint. Pump.fun's
mint extensions (`metadataPointer`, `tokenMetadata`) were never in the
test matrix. The Token-2022 program ID
(`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) and the classic SPL
program ID (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) are
different, so a hardcoded classic SPL `tokenProgram` will fail closed
against any Token-2022 account.

**Mitigation baked into the baseline:** the deployed program now uses
`InterfaceAccount` + `transfer_checked` with a separate
`bulls_token_program` account. Both SPL variants are accepted.

**Mitigation for next launch:** test against a Token-2022 mint with
`metadataPointer` + `tokenMetadata` extensions enabled, mirroring
pump.fun's exact mint shape. See P5.3.

### 2. Public RPC IP/region 403 — high-impact

`api.mainnet-beta.solana.com` 403s many browser IPs and regions. This
is well-documented but easy to forget when devnet works fine. During
launch, wrap-balance reads failed with 403 → React caught the throw
and rendered the empty-balance branch → users with $WBULL saw
"Need 1M $WBULL".

**Mitigation baked into the baseline:** `web/app/api/rpc/route.ts`
proxies all browser JSON-RPC through `wrappedbulls.com/api/rpc` to
Helius server-side. Browser never hits public RPC directly.

**Mitigation for next launch:** the proxy is permanent. See P3.4 for
hardening (rate limit, method allowlist, metrics).

### 3. `NEXT_PUBLIC_*` inlining defeats runtime rollback — high-impact

Next.js inlines `NEXT_PUBLIC_*` env vars into the client bundle at
**build time**. When `NEXT_PUBLIC_LAUNCH_STATE=live` was baked into
the deployed bundle, flipping the systemd env to `pre-launch` did
nothing for the JS that the browser already had. The only way to roll
back was to rebuild — which took the site to 502.

**Mitigation for next launch:** runtime `/api/launch-state` endpoint
reading from `/var/lib/<project>/state.json`. UI fetches launch state
on every page load. State flip is a single-file write, zero rebuild.
See P3.1.

### 4. Anchor CLI vs Solana CLI cluster names — process failure

`solana config set --url mainnet-beta` is valid. `anchor deploy
--provider.cluster mainnet-beta` is **NOT** — Anchor wants `mainnet`.
The CLIs silently no-op on the wrong cluster name in some code paths.
30+ minutes were lost watching deploys "succeed" against the wrong
target.

**Mitigation for next launch:** `scripts/cluster_flag_lint.sh` rejects
any Anchor invocation with `mainnet-beta`. See P4.3.

### 5. Parallel agent races on shared files — process failure

Two parallel agents were independently flipping `const PRE_LAUNCH =
true | false` in [`web/app/wrap/page.tsx`](../web/app/wrap/page.tsx) and
[`web/app/unwrap/page.tsx`](../web/app/unwrap/page.tsx) during the
chaos window. The site oscillated. The fix in one agent's session was
undone by the other's.

**Mitigation for next launch:** single operator, single machine,
single branch during launch (P7.1). `scripts/no_concurrent_agents.sh`
checks for other in-flight Claude sessions touching the repo before
proceeding (P4.4).

### 6. Stranded SOL across failed deploy attempts

Failed `anchor deploy` runs leave buffer accounts holding ~2.91 SOL
each. Across multiple attempts during the cluster-flag chaos, ~6 SOL
was stranded. Recoverable with `solana program close <BUFFER>
--recipient <YOU>`, but the operator did not know this in the moment.
Separately, ~0.5 SOL got stuck at the program-keypair address as a
plain System account, blocking the first real deploy with "not an
upgradeable program."

**Mitigation for next launch:** preflight script audits all SOL
positions belonging to the deployer + program keypair before deploy.
Documented recovery commands in the runbook (already done).

### 7. Singleton PDA immutability surprise

The `bank` PDA at `seeds = ["bank"]` is initialized exactly once per
program ID. If `initialize_bank` is called with wrong parameters
(wrong token mint, wrong royalty BPS, wrong tier count, etc.), the
**only** remedy is to redeploy under a new program ID. The init
function does not support `init_if_needed` (intentionally — it was
removed as a hardening pass).

**Mitigation for next launch:** `mainnet_sim_gate.sh` (P4.2) hard-gates
the bank initialization on a simulation showing the resulting state
matches expectations. The simulation runs against the actual bytecode
that would be invoked, so any param error surfaces before the
permanent on-chain write.

### 8. Stale `.next/export` directory

After several failed builds, `ENOTEMPTY: directory not empty,
rename .next/export → .next/.export.bak` blocked the next build.
Resolved by `rm -rf .next .next-build`. Cost: minutes during the
emergency window.

**Mitigation for next launch:** the deploy script always blows away
build artifacts before building (already done in
`stage_b_flip_live.sh`).

### 9. Hardcoded brand strings everywhere

`WrappedBulls`, `$WBULL`, `wrappedbulls.com`, `wrappedbulls`, and `wrappedbulls`
appear inline in dozens of files. Rebranding the codebase for the
relaunch requires touching all of them. The cost of doing this
manually is high enough to delay a relaunch by a day or two.

**Mitigation for next launch:** templatize via `config/launch.toml`
(P2.1) + `web/config/brand.json` (P2.3) + a clone script (P2.6).

### 10. No `/api/health` endpoint, no `/status` page

When the site was 502'ing during the chaos, there was no machine-
checkable health endpoint and no operator-checkable status page. Each
operator (and the user) was tailing systemd logs to figure out what
was actually broken.

**Mitigation for next launch:** `/api/health` (P3.5) + `/status` page
that reads it (P3.7).

## Decisions that held up

- Vault PDA design `PDA(["vault", nft_mint])` — the vault is owned by
  the NFT, not the wrapper wallet. This is what enables anyone holding
  a Bull NFT to unwrap it, not just the original wrapper. Cross-wallet
  unwrap test passed on devnet during pre-launch.
- Upgrade-authority gate on `initialize` — no one but the deployer
  could front-run the bank init. Singleton PDA + auth gate together
  made init unstealable.
- 5% royalty (500 BPS) to a separate treasury — clean separation from
  deployer wallet.
- Verifying-sized-collection MCC pattern — collection is verifiable on
  Magic Eden / Tensor / Phantom collectibles without per-NFT
  additional CPIs.

These design decisions transfer to the next project without change.

## What we proved at the end

[`docs/MAINNET_PROOF.md`](MAINNET_PROOF.md) — the program is correct.
The simulation against live mainnet state with a funded payer shows
`simulationErr: null` and the on-chain log
`Wrapped bull tier=1 nft_mint=GxCWcPgEBxB2URwAFUzjKvNMMxVxuRGFWu76Whdx8G5X`.
Anchor tests: 13/13 passing (3 adversarial + cross-wallet unwrap +
upgrade-authority init guard).

## Conclusion

Every defect above is now either fixed in the baseline or has a
documented mitigation in the [relaunch todo list](RELAUNCH_PLAYBOOK.md).
The single biggest learning is structural: **never let any aspect of
launch state depend on a build artifact.** Launch is a runtime event;
every toggle, every state change, every rollback must be a runtime
write to a flag a running process reads — not a rebuild.
