# Lessons learned — for the next pump.fun-style launch

Companion to [`POSTMORTEM.md`](POSTMORTEM.md). This file is the
forward-looking anti-pattern list: rules to enforce on the next project
from day one. Internal reference. NOT for public repo.

Every rule has a **Why** (the incident or constraint that motivates it)
and a **How to apply** (where in the codebase it lives or what script
enforces it).

## Build-time vs runtime

### L1. Never use `NEXT_PUBLIC_*` for state that needs to be toggled live

**Why:** Next.js inlines `NEXT_PUBLIC_*` into the client bundle at
build time. We learned this the hard way when flipping
`NEXT_PUBLIC_LAUNCH_STATE=live` → `pre-launch` did nothing for
browsers that had already loaded the bundle, and the only "rollback"
was a rebuild — which 502'd the site.

**How to apply:** any value that may need to be flipped without a
rebuild must be served from a runtime API endpoint. `/api/launch-state`
reads from a JSON file the operator writes (P3.1). The UI fetches it
on every page load.

### L2. Pre-build BOTH UIs in one bundle; runtime picks

**Why:** even with `/api/launch-state`, if you ship a bundle that only
contains the "live" wrap UI, a flag-flip back to pre-launch still
requires shipping a different bundle. The flag must select between
already-shipped components.

**How to apply:** every launch-state-dependent page renders one of two
branches based on the runtime flag. Both branches are in the bundle.
See P3.8.

## On-chain / Solana-specific

### L3. Test against Token-2022 with the **exact** extension set pump.fun uses

**Why:** $WBULL was Token-2022. Our tests used a vanilla classic SPL
mint. The launch-hour wrap reverted with no on-chain logs the test
suite had ever seen.

**How to apply:** the test harness creates a Token-2022 mint with
`metadataPointer` + `tokenMetadata` extensions before running wrap
tests (P5.3). Mirror pump.fun's actual mint shape, not a simplified
mock.

### L4. Build with `InterfaceAccount` + `transfer_checked`, not classic SPL types

**Why:** even if the token you initially target is classic SPL, the
universe of mints you may want to wrap in the future may include
Token-2022. The interface variant accepts both at trivial code cost.
`transfer` is also deprecated in favor of `transfer_checked` because
the latter verifies decimals on-chain.

**How to apply:** all program account structs use
`Box<InterfaceAccount<'info, Mint/TokenAccount>>` for the token side.
A separate `bulls_token_program: Interface<TokenInterface>` account is
the actual token program at runtime — never hardcode.

### L5. Anchor CLI cluster names are NOT Solana CLI cluster names

**Why:** `solana config set --url mainnet-beta` is correct. `anchor
deploy --provider.cluster mainnet-beta` is **NOT** — Anchor wants
`mainnet`. The mismatch is a silent no-op in some code paths and cost
us 30+ minutes of fake-successful deploys.

**Mainnet:** Solana CLI `mainnet-beta`, Anchor `mainnet`.
**Devnet:** both use `devnet`. **Testnet:** both use `testnet`.
**Localnet:** Solana `localhost`, Anchor `localnet`.

**How to apply:** `scripts/cluster_flag_lint.sh` greps the working
tree for any `anchor.*mainnet-beta` or `--provider.cluster mainnet-beta`
and exits non-zero (P4.3).

### L6. Singleton PDAs are permanent

**Why:** the `bank` PDA at `seeds = ["bank"]` is one-shot. If you
initialize it with the wrong token mint, the wrong royalty BPS, the
wrong tier count — your only recovery is a new program ID. We hardened
the program by removing `init-if-needed`, which means init **really**
cannot be retried.

**How to apply:** `mainnet_sim_gate.sh` (P4.2) simulates the
initialize-bank tx against the actual deployed bytecode and verifies
the resulting state. The simulation must show the expected token mint,
royalty BPS, tier list, and total_wrapped == 0 before the real init
runs.

### L7. Reclaim stranded buffer SOL

**Why:** every failed `anchor deploy` leaves a buffer account with
~2.91 SOL. Across our 3 failed launch-hour deploys, ~9 SOL was
stranded. Recoverable but only if you remember to do it.

**How to apply:** preflight script (P4.1) lists all program-buffer
accounts owned by the deployer and recovers them with
`solana program close <BUFFER> --recipient <DEPLOYER>` before deploy.

### L8. SOL accidentally sent to a program keypair as a System account blocks deploy

**Why:** during one of the launch-hour attempts, ~0.5 SOL got
delivered to the program keypair address before deploy ran. The
address held a System account instead of a Program account. Anchor
rejected the deploy with "not an upgradeable program."

**How to apply:** preflight script asserts the program-keypair pubkey
either doesn't exist on-chain yet OR is already a BPFLoaderUpgradeable
program. Anything else aborts the deploy with a clear recovery
command.

## Browser / RPC

### L9. Never let the browser talk to public Solana RPC directly

**Why:** `api.mainnet-beta.solana.com` 403s many IPs and regions. Devnet
RPC doesn't have this problem, so it's invisible until launch. During
launch, the failure mode is the worst possible: balance reads fail →
React renders the empty-balance branch → users with $WBULL see
"Need 1M $WBULL" while their console fills with 403s.

**How to apply:** `/api/rpc` proxy ([`web/app/api/rpc/route.ts`](../web/app/api/rpc/route.ts))
forwards all browser JSON-RPC through the same origin to Helius
server-side. Browser never sees `api.mainnet-beta.solana.com`.

### L10. Helius paid credits required from day one

**Why:** the free Helius tier 429s on launch traffic. We hit it on the
first call. Free credits are a sandbox-only tool.

**How to apply:** paid credits funded before launch. Server-side key
in systemd env (`SOLANA_RPC_URL`), never in `NEXT_PUBLIC_*`, never
committed.

### L11. Distinguish "RPC down" from "user has zero balance" in the UI

**Why:** the launch-hour UI rendered "Need 1M $WBULL" identically for
"RPC threw" and "user actually has zero." Users with $WBULL in their
wallet read this as a scam.

**How to apply:** UI state machine has an explicit `rpc-error` state
distinct from `insufficient-bulls` (P3.6). Any thrown error from RPC
calls puts the UI in `rpc-error` with a clear "Network connection to
Solana failed" message and a retry button.

## Operational

### L12. Single operator, single machine, single branch during launch

**Why:** parallel agents flipping `PRE_LAUNCH = true | false` in the
same files during the chaos caused the site to oscillate. Two humans
trying to help simultaneously would have the same problem.

**How to apply:** launch protocol mandates one operator at the
keyboard, one machine. `scripts/no_concurrent_agents.sh` (P4.4)
greps the repo for in-flight Claude sessions before any deploy.

### L13. Blue-green deploy or you will eventually 502 during a rebuild

**Why:** single-instance systemd + rebuild-in-place = downtime
window during every build. During the launch chaos, even a 60-second
window felt catastrophic ("PEOPLE ARE THINKING ITS A SCAM").

**How to apply:** two systemd instances, Caddy upstream swap atomic
file-rename (P3.2). The "old" instance keeps serving until the new
instance is healthy. Zero-downtime rebuilds forever.

### L14. Deploy lockfile to prevent concurrent deploys

**Why:** `pkill -f "solana program deploy"` killed its own caller
because the pattern matched the wrapper bash command line. More
importantly, two concurrent `anchor deploy` runs would both consume
buffer-account SOL and one would fail.

**How to apply:** `flock /var/run/wrappedbulls-deploy.lock` wraps every
deploy script (P3.3). Second concurrent invocation aborts cleanly.

### L15. Always have an `/api/health` endpoint

**Why:** during the launch-hour 502, the operator could not tell
machine-readably whether the Next.js process was up, whether Caddy
was up, or whether the upstream RPC was reachable. We tailed systemd
logs from each component.

**How to apply:** `/api/health` returns `{ next: ok, caddy: ok,
rpc: ok|degraded, lastDeploy: <iso>, version: <git-sha> }` (P3.5).
`/status` page renders it (P3.7).

### L16. Process kills must target PIDs, not patterns

**Why:** `pkill -f "solana program deploy"` matched the shell command
line of the wrapper script that invoked it. The wrapper killed itself.

**How to apply:** capture the PID at spawn time: `solana program deploy
... &; PID=$!`. Kill with `kill -9 $PID`, not `pkill -f`.

## Branding / templatization

### L17. Centralize every brand string from day one

**Why:** rebranding `WrappedBulls` → next-name requires touching
dozens of files. Doing this manually delays a relaunch by 1–2 days.

**How to apply:** `config/launch.toml` for on-chain constants
(P2.1), `web/config/brand.json` for UI brand surface (P2.3), build.rs
codegen writes the constants into Rust at compile time (P2.2). No
hardcoded brand strings in `web/lib/` or program code (P2.4).

### L18. Clone script that does the whole rebrand in one command

**Why:** even with config files, a 30-step manual checklist is
error-prone under launch pressure.

**How to apply:** `scripts/clone_to_new_project.sh <name>` (P2.6)
forks the repo, generates a fresh program keypair, scaffolds new
configs, swaps brand assets, runs `anchor test` to confirm green, and
produces a launch-ready directory.

## Tools, not memory

### L19. Codify every "I'll remember next time" into a script

**Why:** the launch hour exposed a dozen latent defects that the team
"would have remembered" individually but did not collectively under
pressure. Memory does not scale across humans, time, and
context-switching.

**How to apply:** every rule above (L1–L18) has either a documented
script (P4.x) or a documented config (P2.x). If a future incident
exposes a new defect, the postmortem step that says "we'll watch for
this next time" must be replaced with "we wrote a script that fails
closed on this."
