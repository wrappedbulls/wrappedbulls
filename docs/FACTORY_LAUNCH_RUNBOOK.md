# WrappedFactory Launch Runbook

**Goal:** go from `factory-v1` branch to mainnet live `deploy_collection` ix without losing the deployer keypair or its cold backup at any point.

This is the Factory's sibling to [`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md). The parent wrappedbulls program is already mainnet live; deploying the Factory does NOT touch it.

## Two programs, one repo, one authority

| Program | Status | Program ID | Upgrade authority on mainnet |
|---|---|---|---|
| `wrappedbulls` | LIVE | `F7qXskG73efUwbDo2B97tZgpPAqX7zHMApXbPUimcFdS` | Single deployer keypair `9ZDrkF9a8bMHPeDhe3oiDDUC1616C3vtTGozBgMxhWtn` |
| `wrappedfactory` | PENDING DEPLOY | `WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh` | Same single deployer keypair (default), or a fresh keypair if you prefer operational isolation |

Both programs share the same `cargo` workspace and the same `Anchor.toml`. Factory deploy does NOT modify wrappedbulls in any way. Upgrade authority posture is **single hot keypair** (solo operator); see `PRE_MORTEM_FACTORY.md` § Upgrade authority posture for the full risk read.

## Wallet roles

| Role | Wallet | Used for |
|---|---|---|
| **Deployer + upgrade authority + admin** | The bulls box keypair at `/root/.config/solana/id.json` (`9ZDrkF9a8bMHPeDhe3oiDDUC1616C3vtTGozBgMxhWtn`) | Signs `anchor deploy`, `anchor idl init`, `initialize(wbull_mint)`. Holds upgrade authority indefinitely. Also gates `claim_treasury` and `set_verified`. Must be funded with ~3 SOL mainnet for buffer + rent. |
| **Bull treasury** | Per program PDA, NOT a wallet | `bull_treasury_state` PDA holds the accounting + signs `bull_treasury_vault` token transfers via seeds. No human owns this directly. |

Critical: the Factory does NOT have a separate "royalty treasury" wallet.
Royalties on Factory-deployed NFTs are zero (the Factory writes
`seller_fee_basis_points: 0` for the MCC parent NFT). Per-deployment
royalty splits are deferred to V2.

## Pre-flight checklist

Run through this BEFORE the deploy command. Each item must be a clean ✓
or you stop and fix.

### Source state

- [ ] Vanity grind landed: `/root/vanity-grind/wrappedfactory/Wrap*.json` exists
- [ ] `declare_id!` in `programs/wrappedfactory/src/lib.rs` matches the vanity pubkey
- [ ] `Anchor.toml` `[programs.mainnet] wrappedfactory = "<VANITY>"` matches
- [ ] `target/deploy/wrappedfactory-keypair.json` matches the vanity keypair (same `solana-keygen pubkey ...`)
- [ ] `git status` is clean OR all uncommitted changes are intentional
- [ ] `git log --oneline -10` shows the build we're about to deploy
- [ ] `SECURITY-FACTORY.md` reflects the final invariants (no last-minute changes)

### Build state

- [ ] `cargo test -p wrappedfactory --lib` passes 12/12 (5 tier + 7 treasury)
- [ ] `anchor test -- --grep wrappedfactory` passes 5/5 integration tests
- [ ] `anchor test -- --grep wrappedbulls` regression pass remains 16/16
- [ ] `target/deploy/wrappedfactory.so` exists and is the release-profile binary
- [ ] `ls -la target/deploy/wrappedfactory.so` shows size in 500-550 KB range
  (anything dramatically different = wrong build)
- [ ] `sha256sum target/deploy/wrappedfactory.so` recorded for the verified-build step

### Cluster + RPC

- [ ] `solana config get` cluster = mainnet-beta
- [ ] `solana config get` keypair = `/root/.config/solana/id.json`
- [ ] `solana balance` shows ≥ 3 SOL (buffer rent + deploy rent + safety)
- [ ] `SOLANA_RPC_URL` env var points at the Helius mainnet endpoint (NOT the public one — rate limits will kill the deploy mid-upload)
- [ ] `solana ping --count 3` succeeds against the configured RPC

### $WBULL mint

- [ ] `NEXT_PUBLIC_FACTORY_PROGRAM_ID` env var prepared with the vanity pubkey
- [ ] $WBULL mint address confirmed: read from `bank.token_mint` on the live wrappedbulls program (it's already locked there). Verify with:
  ```
  solana account -u m F7qXskG73efUwbDo2B97tZgpPAqX7zHMApXbPUimcFdS  # check program exists
  # then fetch BullBank PDA and read token_mint field
  ```

## Deploy sequence

Run each block in order. Stop immediately if any step fails.

### Step 1 — Final build (mainnet feature set)

```bash
cd /root/wrappedbulls
anchor build -p wrappedfactory  # generates IDL + .so
ls -la target/deploy/wrappedfactory.so target/idl/wrappedfactory.json
```

Expected: `.so` ~520 KB, IDL ~57 KB.

### Step 2 — Deploy the program binary

```bash
solana program deploy \
  --program-id /root/wrappedbulls/target/deploy/wrappedfactory-keypair.json \
  --keypair /root/.config/solana/id.json \
  --url https://api.mainnet-beta.solana.com \
  /root/wrappedbulls/target/deploy/wrappedfactory.so
```

Expected output ends with `Program Id: <VANITY>` matching the lib.rs `declare_id!`.

If interrupted: the buffer account is funded but the program isn't deployed.
Resume with:
```bash
solana program deploy --buffer <BUFFER_PUBKEY> ...
```
(`<BUFFER_PUBKEY>` is in the partial-deploy output.)

### Step 3 — Verify the program exists + executable

```bash
solana program show <VANITY> --url mainnet-beta
```

Expected:
```
Program Id: <VANITY>
Owner: BPFLoaderUpgradeab1e11111111111111111111111
ProgramData Address: <SOME_PDA>
Authority: GMrJpP7SaUkfyizsB3b8GeKWgDiqac3g5EaMGnMtkXCj  # bulls-box deployer
...
```

### Step 4 — Publish the IDL on chain

```bash
cd /root/wrappedbulls
anchor idl init \
  --filepath target/idl/wrappedfactory.json \
  <VANITY> \
  --provider.cluster mainnet
```

This lets any client (including ours) fetch the IDL via
`anchor idl fetch <VANITY> --provider.cluster mainnet`. Anchor's own
client checks tools depend on this.

### Step 5 — Run `initialize(wbull_mint)`

Create a one-shot script `scripts/factory_initialize_mainnet.ts`:

```typescript
// Calls initialize(wbull_mint) on the live Factory program.
// Creates FactoryConfig + BullTreasuryState + bull_treasury_vault in
// one atomic tx. Signed by the upgrade authority.
//
// Run via: ts-node scripts/factory_initialize_mainnet.ts
// Reads $WBULL mint from bank.token_mint on the wrappedbulls program.
```

Body: same shape as the integration test's initialize call but pointed at
mainnet. The single arg is the $WBULL mint pubkey.

Run it:
```bash
cd /root/wrappedbulls
npx ts-node scripts/factory_initialize_mainnet.ts
```

Expected: one tx signature printed. Confirm it on Solscan / explorer.

### Step 6 — Smoke-read every PDA

```bash
# Replace <VANITY> with the actual program ID.
solana account -u m \
  $(node -e 'const {PublicKey} = require("@solana/web3.js"); const [pda] = PublicKey.findProgramAddressSync([Buffer.from("factory_config")], new PublicKey("<VANITY>")); console.log(pda.toBase58())')

solana account -u m \
  $(node -e 'const {PublicKey} = require("@solana/web3.js"); const [pda] = PublicKey.findProgramAddressSync([Buffer.from("bull_treasury")], new PublicKey("<VANITY>")); console.log(pda.toBase58())')
```

Each should return a populated account (non-zero data, owned by the Factory program ID).

### Step 7 — Update web app to point at the live Factory

```bash
# Edit the production env file on the VPS
vim /opt/wrappedbulls-web/.env.production
# Add: NEXT_PUBLIC_FACTORY_PROGRAM_ID=<VANITY>

# Rebuild + blue-green flip via the existing deploy script
cd /root/wrappedbulls/web
npm run build
# (use the existing blue/green deploy script under deploy/)
```

Verify on the live site:
- `https://wrappedbulls.com/launch` shows the stat strip with real (zero) Factory deployment counts
- `https://wrappedbulls.com/launch/treasury` shows the treasury at 0 / 0
- `https://wrappedbulls.com/launches` shows "BE THE FIRST DEPLOYMENT"

### Step 8 — Verified build (matches deployed bytecode)

```bash
cd /root/wrappedbulls
solana-verify build --library-name wrappedfactory
solana-verify get-program-hash <VANITY> --url mainnet-beta
# Compare with the locally-built program's hash
solana-verify get-executable-hash target/deploy/wrappedfactory.so
# These two hashes MUST match exactly.
```

If they match, you have a reproducible deploy. Submit the verified build to
`solana-verify upload` so the program shows the green verified-build badge
on explorers.

### Step 9 — Cold backup the upgrade authority keypair

No authority handoff in the single keypair posture; the deployer keypair stays in place as the upgrade authority. What this step IS, instead: ensure a cold backup of the keypair exists and is readable, separately from the VPS.

```bash
# On the VPS, just confirm the file exists + is not zero bytes
ls -la /root/.config/solana/id.json
solana-keygen pubkey /root/.config/solana/id.json
# Expected: 9ZDrkF9a8bMHPeDhe3oiDDUC1616C3vtTGozBgMxhWtn (or whichever pubkey you chose for Factory)
```

Cold backup off-box (do this on a personal device, NOT in chat/pastebin):
1. SCP `/root/.config/solana/id.json` to a personal machine
2. Write it to an offline storage medium (encrypted USB, paper QR via `solana-keygen recover`, etc.)
3. Test reading the backup once
4. Delete the on-host SCP copy

Optional future moves (not required at launch, recorded here so the option is documented):
- Transfer authority to a hardware wallet: `solana program set-upgrade-authority <VANITY> --new-upgrade-authority <LEDGER_PUBKEY> --keypair /root/.config/solana/id.json --url mainnet-beta`. Adds physical-presence requirement for any future upgrade.
- Make program immutable: `solana program set-upgrade-authority <VANITY> --new-upgrade-authority null --keypair /root/.config/solana/id.json --url mainnet-beta`. Locks the program forever; also disables `claim_treasury` (treasury becomes permanently locked). Do NOT do this until the treasury is empty and you genuinely want immutability.

### Step 10 — Mainnet smoke test

Open `https://wrappedbulls.com/launch/new` in Phantom on mainnet. Walk a real deployment through:

1. Paste a pump.fun token mint (use a small / dead one for the test)
2. Enter a name + ticker
3. Set tiny max_supply (e.g. 100) + tokens_per_wrap
4. Use a simple BaseUri pointing at a test metadata server you control
5. Confirm + sign

Expected: the deploy succeeds, you land on `/launch/<your-token-mint>`, the dashboard shows your collection.

If the deploy fails: investigate before launching publicly. Possible causes:
- $WBULL balance < 1M
- Token mint is on Token-2022 but the wbull_token_program arg pointed at classic SPL
- A Phantom domain reputation warning blocked the sign

The program upgrade authority is still the deployer keypair, so any post mortem fix is a `solana program deploy --buffer ...` away.

## Rollback paths

### Buffer-funded but program-deploy interrupted (mid Step 2)

```bash
# Resume from the buffer
solana program deploy --buffer <BUFFER_PUBKEY> --keypair /root/.config/solana/id.json /root/wrappedbulls/target/deploy/wrappedfactory.so
```

Or abandon and reclaim the buffer rent:
```bash
solana program close <BUFFER_PUBKEY> --recipient <YOUR_WALLET>
```

### Step 5 (initialize) failed

The program is deployed but uninitialized. Re-run `factory_initialize_mainnet.ts`
after fixing the cause. No state is stuck. The `init` constraints on the
PDAs will fail if any of them partially-succeeded; in practice this is
all-or-nothing because initialize creates all three accounts atomically.

### Step 7 (web deploy) failed

The Factory program is live but the website doesn't know about it. The
existing wrappedbulls site continues to work unaffected. Roll back to the
prior green build via the standard blue/green deploy script.

### Step 9 (cold backup) skipped or failed

You launched without an off box cold backup of the upgrade authority keypair. This is recoverable: do the cold backup immediately, before any other operation. Until the cold backup exists, treat any VPS event (reboot, ssh drift, accidental file delete) as a treasury risk.

### Discovered critical bug post launch

The upgrade authority keypair still holds upgrade rights, so a fix is operationally fast (single signer):

1. Public disclosure on `@wrappedbulls` X: "pausing Factory deploys while investigating $ISSUE. Existing deployments unaffected."
2. Sign and push the program upgrade with the deployer keypair (`solana program deploy <fixed.so> --program-id /root/wrappedbulls/target/deploy/wrappedfactory-keypair.json --keypair /root/.config/solana/id.json --url mainnet-beta`).
3. If the bug threatens existing per deployment vaults: include a recovery instruction in the upgrade and call it before lifting the pause.

## Post-deploy verification (the first 24 hours)

| Check | Where | Frequency | Owner |
|---|---|---|---|
| Factory program account still executable | Solscan + `solana program show` | Every 6h day 1, then daily | manual |
| `bull_treasury_vault` token balance matches `FactoryConfig.total_wbull_deposited` | `/launch/treasury` page | Every wrap_layer launched | automatic (the page reads both) |
| `pending` queue size in BullTreasuryState | `/launch/treasury` | Daily, alert if > 200 (cap is 256) | automatic |
| First three real-world Factory deployments | `/launches` directory | After each | manual |

## Launch announcement template

Once steps 1-10 complete + 24h smoke window passes:

```
the wrap Factory is live on mainnet.

any pump.fun token can now launch its own wrap layer
in one transaction.

1,000,000 $WBULL per deployment -> bull treasury,
locked 7 days, operator controlled, governance
adjustable.

wrappedbulls.com/launch
```

Reply 1 (after first 3 partner deployments):
```
first three wrap layers deployed:

→ Wrapped[X] ($W[X])
→ Wrapped[Y] ($W[Y])
→ Wrapped[Z] ($W[Z])

3,000,000 $WBULL now in the bull treasury.
```

## See also

- [`SECURITY-FACTORY.md`](../SECURITY-FACTORY.md) — the security review for this program
- [`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md) — the parent wrappedbulls launch runbook
- [`AUTHORITY.md`](AUTHORITY.md) — upgrade authority + treasury role doc (shared)
- [`PRE_MORTEM_FACTORY.md`](PRE_MORTEM_FACTORY.md) — full failure mode walk through, including the single keypair posture
- [`VERIFIED_BUILD_FACTORY.md`](VERIFIED_BUILD_FACTORY.md) — canonical hash + reproducibility record
- [`VERIFIABLE_BUILD.md`](VERIFIABLE_BUILD.md) — solana-verify procedure (shared)

---

*Living document. Update as the Factory hits new constraints in practice.*
