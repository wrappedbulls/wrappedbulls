# Launch Checklist

Paint by numbers playbook for the day you decide to fire on pump.fun. Each step has a single done criterion. Each phase is reversible until you cross into Phase 2 (program deploy).

## Prerequisites (confirm BEFORE launch day)

- [ ] **Treasury wallet pubkey** in [`config/launch.toml`](../config/launch.toml): `8HoMgnUbDRvPZN1M9jPxXPqE63tRbChGzvdEe3ethzTD`. Seed phrase backed up offline on paper, two copies, two locations.
- [ ] **Deployer wallet pubkey**: `9ZDrkF9a8bMHPeDhe3oiDDUC1616C3vtTGozBgMxhWtn`. Separate seed from treasury. Backed up offline. **Fund with ≥9 SOL on mainnet** before Phase 2. Becomes the program upgrade authority at deploy.
- [ ] **Phantom domain submission** in queue (sent 2026-05-24; awaiting first warning evidence after Phase 3).
- [ ] **@wrappedbulls X profile** live (banner, pfp, bio, no pinned tweet yet).
- [ ] **UptimeRobot monitor** green at https://wrappedbulls.com.
- [ ] **GitHub source** at github.com/wrappedbulls/wrappedbulls. `git status` clean before launch.
- [ ] **Solana CLI** local: `solana --version` returns 3.1.14 or newer; `anchor --version` returns 1.0.2 or newer.
- [ ] **Anchor tests passing**: `cargo test --manifest-path programs/wrappedbulls/Cargo.toml --lib` green.

## Phase 1. Token launch on pump.fun (T+0)

Irreversible after this phase. The mint exists forever.

- [ ] Open https://pump.fun in browser. Connect the **dev wallet** you want to receive bonding curve creator fees.
- [ ] Click "Create coin". Fill:
  - Name: `WrappedBulls`
  - Ticker: `WBULL`
  - Description: see X bio for inspiration (132 char version)
  - Image: `wrapped-bull-favorite.png`
- [ ] Optional **dev buy**: ~1 SOL of your own SOL to seed the bonding curve. Skips the very thin initial spread for the first wrappers.
- [ ] Confirm in wallet.
- [ ] **Copy the new mint address** from pump.fun (base58 string typically ending in `pump`). Save it. This is `$WBULL_MINT` for the rest of the checklist.

## Phase 2. Program deploy (T+5 to T+15)

This is the irreversible deploy step. From here forward, the program lives onchain.

- [ ] In repo locally, set Solana CLI to mainnet: `solana config set --url mainnet-beta`.
- [ ] **Build verifiable**:
  ```bash
  solana-verify build
  ```
  (Not plain `anchor build`. The verifiable build is reproducible and lets `solana-verify verify-from-repo` prove the deployed `.so` matches this exact commit.)
- [ ] **Deploy**:
  ```bash
  solana program deploy \
    --program-id target/deploy/wrappedbulls-keypair.json \
    --keypair /path/to/deployer-keypair.json \
    target/deploy/wrappedbulls.so
  ```
- [ ] **Publish the IDL** so block explorers decode txs as `wrappedbulls` not "Unknown program":
  ```bash
  anchor idl init <PROGRAM_ID> \
    --filepath target/idl/wrappedbulls.json \
    --provider.cluster mainnet
  ```
- [ ] **Initialize the bank** (singleton PDA): call `initialize` with `token_mint = $WBULL_MINT`. See `scripts/devnet_initialize.ts` for the script pattern; copy to `scripts/mainnet_initialize.ts` with the mainnet RPC URL.
- [ ] **Initialize the collection** (MCC parent NFT): call `initialize_collection`. Captures `bank.collection_mint` for later marketplace claims.
- [ ] **Submit the verifiable build record** (optional, can be done later):
  ```bash
  solana-verify verify-from-repo \
    --commit-hash <CURRENT_COMMIT> \
    --program-id <PROGRAM_ID> \
    https://github.com/wrappedbulls/wrappedbulls
  ```

## Phase 3. First wrap (the Phantom evidence step, T+15 to T+20)

This is where you generate the tx that Phantom asked for, and prove the mechanic works end to end on mainnet.

- [ ] Top up a **test wallet** (NOT deployer, NOT treasury) with:
  - 1,000,000 $WBULL bought from pump.fun
  - ~0.05 SOL for tx fees
- [ ] **Wrap option A (UI):** if the Next.js wrap UI is deployed and styled, open https://wrappedbulls.com/wrap, connect the test wallet, click Wrap.
- [ ] **Wrap option B (CLI):** if the UI is not ready, run a wrap_bull tx directly via a TS script mirroring `scripts/devnet_wrap_bull.ts` against mainnet RPC.
- [ ] If Phantom shows "could be malicious" or any warning: click **"Proceed anyway"**, complete the tx, copy the Solscan link.
- [ ] **Send the Solscan link to Phantom** in the existing support thread. This is the evidence they explicitly asked for; it unblocks domain reputation resolution.
- [ ] Verify on Solscan:
  - Program ID matches the deploy
  - Vault PDA holds 1,000,000 $WBULL
  - NFT mint exists with metadata pointing at `https://wrappedbulls.com/api/metadata/1`
  - Collection NFT verified (MCC `verified == true`)

## Phase 4. Announce (T+20 to T+30)

- [ ] **Pinned launch tweet** from `@wrappedbulls`. Draft options in [`COMMS.md`](COMMS.md) Tweet 1.
- [ ] **Quote retweet** from your personal handle to amplify.
- [ ] **First bull wrapped tweet** quoting the Phase 3 Solscan URL (Tweet 2 in COMMS.md).
- [ ] **Mechanic thread** posted ~30 min after T+0 (Tweet 3 in COMMS.md).
- [ ] Ready the reply hooks (Tweet 4 in COMMS.md) for the inevitable questions.

## Phase 5. Marketplace claims (T+1h to T+2h)

After the first wrap is onchain, marketplaces auto index the collection. Then you claim ownership:

- [ ] **Magic Eden Creator Hub**: https://creators.magiceden.io. Connect deployer wallet, find the auto indexed collection, click "Claim Ownership". Fill metadata per [`MARKETPLACE.md`](MARKETPLACE.md).
- [ ] **Tensor Creator Portal**: https://www.tensor.trade/portal. Connect deployer wallet, find the collection, authorize via @wrappedbulls X for verification.

## Phase 6. Monitor (ongoing)

- [ ] UptimeRobot stays green
- [ ] Helius webhook subscription for the $WBULL mint (optional, powers a live activity feed)
- [ ] Daily check on Phantom thread for review status
- [ ] First 30 days: program upgrade authority stays unlocked for hotfix bugs. After 30 day soak with no critical issues, freeze upgrade authority per [`AUTHORITY.md`](AUTHORITY.md).

## Rollback paths

| Phase | Reversible? | If catastrophic |
|---|---|---|
| 1 | NO. The pump.fun token exists forever. | Walk away from the launch; the token graduates to PumpSwap regardless. |
| 2 | Partially. Program can be upgraded (first 30 days). | Deploy a fix as `solana program deploy --program-id <same>` with corrected `.so`. The `BullBank` state survives. |
| 3 onward | Yes. Failed wraps revert atomically. | Investigate the sim error; fix in code if program bug, or fix in client if UX bug. |

## Hard rules (do not violate)

- The live website never goes down. All fixes deploy to standby color and atomically swap. See [`DEPLOY.md`](DEPLOY.md).
- Treasury wallet is never the deployer wallet. They are different keypairs.
- Never paste the deployer or treasury seed phrase into any tool, website, Discord, or terminal session that gets logged.
- After Phase 3 success, never reference any prior project. The narrative is that WrappedBulls invented this technology.
