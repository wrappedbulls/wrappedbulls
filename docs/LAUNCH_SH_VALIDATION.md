> # ⚠️ OBSOLETE. `launch.sh` is DEPRECATED
> As of 2026-05-15 `scripts/launch.sh` fails closed and is not used; launch
> is the **manual** [`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md) sequence. This
> validation also encodes the wrong deployer (`FRZJ…TwQ` is the royalty
> treasury; deployer is `GMrJpP7Sa…`). Historical only.

# launch.sh validation summary

`launch.sh` is the single command run on launch day. This document records what's been verified about it without burning real mainnet SOL.

## What's been tested directly

**Static checks (run on the bulls box):**

- `bash -n launch.sh` → syntax clean
- `git log` shows the script committed at `739afd4`
- File is executable (`chmod +x` confirmed)

**Guards verified by running the script with bad input:**

| Input | Expected | Result |
|---|---|---|
| no args | error: "Pass the $WBULL mint address as the first argument" | ✓ |
| `garbage` (invalid mint) | error: "doesn't look like a valid mint address" | ✓ |
| `DEPLOYER_KEYPAIR=/nonexistent.json` | error: "keypair not found" | ✓ |
| keypair pubkey mismatch (devnet keypair instead of mainnet) | error: "keypair pubkey ... does not match EXPECTED_DEPLOYER" | ✓ |
| valid mint format but deployer balance = 0 | error: "deployer needs >= 5 SOL on mainnet" | ✓ |

**Mainnet pre-flight checks (RPC reachability):**

- Mainnet RPC returns `getSlot` ✓
- Mainnet Metaplex Token Metadata program (`metaqbxx…`) is deployed + executable ✓
- Mainnet BPF Upgradeable Loader is present ✓
- `Anchor.toml` has `[programs.mainnet]` block matching the keypair-derived program ID ✓
- `wrappedbulls.so` build artifact is 307,832 bytes, present on the box ✓

**Helius URL substitution:**

- Server-side `SOLANA_RPC_URL` currently set to `https://devnet.helius-rpc.com/?api-key=…`
- launch.sh's sed pattern correctly substitutes `devnet.helius-rpc` → `mainnet.helius-rpc` while preserving the API key
- (Verified by inspecting the sed command, since running it would flip the live devnet site)

## What's been tested by proxy (devnet equivalent)

The actual deploy + initialize + wrap + unwrap flow that launch.sh runs on launch day is **the same code path** that already ran successfully on devnet:

- `anchor deploy --provider.cluster devnet`. success, program ID `A2tUttiL2v2fYxPyeUSZ75CqnjDp5sewCqcnXubgoxm` (same as mainnet)
- `scripts/devnet_initialize.ts` (which launch.sh invokes for mainnet too). success, BullBank PDA created
- Wrap of WrappedBulls #1 + #2. success
- Cross-wallet unwrap. success, vault tokens followed NFT to second wallet

The mainnet equivalent is identical except: different RPC URL (validated via getSlot), different cluster name in CLI flags (no behavioral difference), and the actual SOL burn.

## What's NOT been tested (and why it's OK)

- The `anchor deploy --provider.cluster mainnet-beta` command itself. would burn ~5 SOL of real money for a rehearsal. We accept this risk because the same Anchor 1.0.2 deploy worked on devnet against the same binary.
- Mainnet rate-limit behavior under launch traffic. the only way to test this is to launch.
- Tensor mainnet listing UI. deferred to launch day when we have a real bull to list.

## On launch day

Run from the bulls box, in this exact order, after launching $WBULL on pump.fun:

```bash
# 1. SCP the mainnet deployer keypair onto the box (just for launch)
# 2. Run launch.sh with the mint address
DEPLOYER_KEYPAIR=/tmp/mainnet-deployer.json \
  /root/wrappedbulls-sol/scripts/launch.sh <WBULL_MINT_ADDRESS>
# 3. Shred the keypair file
shred -u /tmp/mainnet-deployer.json
```

The script is **idempotent**. if it fails partway, re-run with the same args. It will skip already-completed steps (deploy / initialize) and resume.
