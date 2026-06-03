# Launch Runbook. Zero Phantom Warnings

**Goal:** go from pre-launch to a live mainnet wrap/unwrap with **no Phantom
"malicious" / "transaction reverted" warnings**, confirmed privately before
any public announcement.

## Why warnings happened pre-launch (root cause, 2026-05-15)

The wrappedbulls program is deployed on **devnet only**. On **mainnet** the
program ID `F7qXskG73efUwbDo2B97tZgpPAqX7zHMApXbPUimcFdS` is a plain
non-executable system account. The deployed site was running in
`LAUNCH_STATE=live` pointed at that devnet-only program, so any visitor on
Phantom-mainnet who clicked Wrap built a transaction calling a non-program
address. a textbook scam pattern that Phantom **correctly** flags as
"could be malicious." Every such attempt also fed Blowfish a
malicious-interaction signal for wrappedbulls.com, degrading the domain's
reputation.

This was never a transaction-mechanics bug. The `signAndSendTransaction`,
pre-simulation, blockhash, and balance-gate work is all correct and stays , 
but it was never the cause of the mainnet warning.

## Wallet roles (DO NOT CONFUSE. different keys, different jobs)

| Role | Address | Used for |
|---|---|---|
| **Deployer / upgrade authority** | `9ZDrkF9a8bMHPeDhe3oiDDUC1616C3vtTGozBgMxhWtn` (bulls-box keypair `/root/deployer-keypair.json`) | Signs `anchor deploy`, `anchor idl init`, `initialize`, `initialize_collection`. Must be funded with mainnet SOL at launch. |
| **Royalty treasury / on-chain creator** | `8HoMgnUbDRvPZN1M9jPxXPqE63tRbChGzvdEe3ethzTD` | Hardcoded in `wrap_bull.rs` as `ROYALTY_TREASURY`; written into every NFT's on-chain metadata as the creator (share 100, `verified:false` by design). Magic Eden / Tensor route the 5% secondary royalty here. Does NOT sign anything; just receives. |

These are intentionally two different wallets. The treasury is independent
of the upgrade authority. it only needs to be a normal wallet the user
controls so marketplaces can pay royalties to it.

## Token-address handoff protocol

$WBULL is not launched. The mint address does not exist yet.

1. **Before launch:** user provides the pump.fun $WBULL mint address. It
   goes into `NEXT_PUBLIC_TOKEN_MINT` (display) and is passed to
   `initialize` (locks it into BullBank. immutable after).
2. **At launch:** user explicitly notifies "it's live." Only then run the
   launch sequence. Do not deploy/initialize against a guessed or
   placeholder mint. `initialize` locks the mint permanently.

## Royalty / creator (baked into the program. 2026-05-15)

- `wrap_bull.rs`: `seller_fee_basis_points: 500` (5%), `creators:
  Some([{address: ROYALTY_TREASURY, verified: false, share: 100}])`.
- This is set in the Metaplex `CreateMetadataAccountsV3` CPI. it is NOT
  part of the Anchor IDL or the wrap_bull instruction signature, so
  `web/lib/idl.json` and the web client need NO changes for it.
- It applies to every NFT minted by the **deployed** program. The mainnet
  program MUST be built+deployed from this updated source (the change is
  already compiled clean and test-verified on devnet. see below).
- Creator is `verified:false` by design: wrap is permissionless so the
  treasury can't sign every mint. Collection trust comes from the verified
  MCC, not creator verification. ME/Tensor still honor the 5% and route to
  the treasury. (Optional post-launch hardening: a consistent verified
  program-PDA creator. not required for royalties to function.)

## Current state (pre-launch, safe)

- `NEXT_PUBLIC_LAUNCH_STATE=pre-launch` in both the build (`web/.env.production`)
  and the systemd unit on the box. `/wrap` and `/unwrap` show "goes live at
  launch" cards. No public transaction can be attempted → no warnings, no
  further domain-reputation poisoning. (Local dev-only live config lives in
  `web/.env.development.local`, which `next build` never reads.)
- Devnet program exists and its **Anchor IDL is already published on devnet**
  (`anchor idl fetch ... --provider.cluster devnet` returns the wrappedbulls IDL).
  This proves the IDL-publish mechanism and confirms the upgrade authority
  keypair on the DO box (`9ZDrkF9a8bMHPeDhe3oiDDUC1616C3vtTGozBgMxhWtn`)
  is correct.
- Balance + SOL gates are deployed: a wrap/unwrap is never built if the
  wallet lacks the $WBULL / SOL the chain would require.
- Server RPC = dedicated WrappedBulls Helius key (systemd `SOLANA_RPC_URL`
  only; never committed, never in client bundle). Pre-launch: Helius
  **devnet** endpoint. Launch: flip the one systemd line devnet→mainnet.
- Metadata/render API hardened (single-flight + stale-while-revalidate,
  no immutable-by-tier bug, graceful 503 on RPC failure). survives a
  full marketplace crawl of 1000 tiers.
- Client tx flow audited launch-ready: legacy `Transaction` +
  `connection.simulateTransaction(tx)` (NO config arg. the
  "Invalid arguments" footgun is gone) + `wallet.sendTransaction`
  (= Phantom `signAndSendTransaction`). Token mint read from on-chain
  `fetchBank().tokenMint`, so it auto-picks the real $WBULL at launch.

## Pre-launch confirmation (do anytime, no risk)

**Rehearsal 1. local devnet, isolates domain-rep from program/tx.**
`localhost` is not a Blowfish-flagged domain, so a clean result here means
the program/tx is fine and any wrappedbulls.com warning was domain-rep only.

```
cd web
npm install
npm run dev          # uses web/.env.development.local → live mode, devnet
```                  # (.env.local was deleted; next build never reads .development.local)

1. Open http://localhost:3000/wrap
2. Phantom → Devnet mode. Fund the test wallet with devnet SOL
   (`solana airdrop 2 <addr> -u devnet`) and devnet test $WBULL.
3. Click Wrap. Open dev console.
4. Expected: Phantom modal **clean**, Advanced view shows
   `wrappedbulls: wrapBull` (NOT "Unknown program", since the devnet IDL is
   published). `[wrappedbulls-tx:wrapBull]` logs `simulationErr: null`.
   - Clean here → program/tx is correct; any wrappedbulls.com warning was
     pure domain reputation, which the pre-launch gate now lets recover.
   - Warning here → program/tx issue independent of domain; capture the
     `[wrappedbulls-tx:wrapBull]` object + Phantom screenshot and stop; do not
     proceed to launch until resolved.

## Launch day sequence (produces zero warnings)

Do these IN ORDER. Steps 0 to 9 are private; do not announce until step 10
confirms clean. The bulls box `/root/wrappedbulls-sol` is NOT a git clone. it
is a working copy; the program source there must be the royalty-bearing
version (already synced + built + 12/12 tests pass on devnet as of
2026-05-15).

0. **Pre-flight (do the moment $WBULL launches, before anything else):**
   - User confirms "$WBULL is live" and provides the **mainnet mint
     address**.
   - Sanity: `solana account <MINT> -u mainnet-beta` shows a real SPL
     mint (decimals 6 for pump.fun), mint authority null.
   - Confirm the program source on the box still has
     `ROYALTY_TREASURY = 8HoMgnUbDRvPZN1M9jPxXPqE63tRbChGzvdEe3ethzTD`
     and `ROYALTY_BPS = 500` in `programs/wrappedbulls/src/instructions/wrap_bull.rs`.
1. **Fund the deployer/upgrade-authority wallet** `GMrJpP7Sa...`
   (`/root/deployer-keypair.json`) with **~9 SOL on mainnet**. Evidence-
   based (verified 2026-05-18, .so = 417,920 bytes): ProgramData is
   allocated at 2× the binary, rent-exempt minimum **5.82 SOL** (permanent),
   PLUS a transient deploy **buffer of ~5.82 SOL** held during upload
   (refunded when the buffer closes), + IDL account ≈ 0.15 + initialize +
   fees + retry margin. **~5 SOL is NOT enough. it fails mid-deploy and
   strands SOL in a buffer.** Fund ~9 SOL (absolute floor ~7). Any excess
   is recoverable. This is the DEPLOYER key, not the royalty treasury , 
   see the wallet-roles table above.
2. **Build fresh from the royalty-bearing source:**
   ```
   cd /root/wrappedbulls-sol && anchor build
   ```
   Confirm `target/deploy/wrappedbulls.so` + `target/idl/wrappedbulls.json` are
   freshly timestamped and the build log has 0 errors.
3. **Deploy the program to mainnet:**
   ```
   anchor deploy --provider.cluster mainnet
   ```
   **CAREFUL:** Anchor CLI uses `mainnet` (NOT `mainnet-beta`). Anchor
   accepts `localnet | testnet | mainnet | devnet` or a full URL. `mainnet-beta`
   is the *Solana* CLI value. passing it to `anchor` fails with
   `invalid value 'mainnet-beta' for '--provider.cluster'`. Verified
   2026-05-20 by an exact-string mistake that caused a no-op "successful"
   deploy script.
   Confirm: `solana program show <PROGRAM_ID> -u mainnet-beta` →
   `Executable: true`, owner = BPF upgradeable loader, Authority =
   `GMrJpP7Sa...`. (The `solana` CLI DOES use `mainnet-beta`.)
4. **Publish the IDL on mainnet** (kills the "Unknown program" label):
   ```
   anchor idl init <PROGRAM_ID> --filepath target/idl/wrappedbulls.json \
     --provider.cluster mainnet
   ```
   Confirm: `anchor idl fetch <PROGRAM_ID> --provider.cluster mainnet`
   returns the wrappedbulls IDL.
5. **Initialize on mainnet** with the REAL $WBULL mint:
   ```
   # initialize           → locks the real $WBULL mint into BullBank (immutable)
   # initialize_collection → creates the MCC collection NFT
   ```
   Use the devnet init scripts pointed at mainnet + the real mint.
   `initialize` is one-time and locks the mint forever. triple-check the
   mint address before running.
6. **Repoint the site env** (BOTH `web/.env.production` AND the systemd
   unit; remember `.env.local` must NOT exist on the build machine. only
   `.env.development.local`, which `next build` ignores):
   ```
   NEXT_PUBLIC_LAUNCH_STATE=live
   NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta
   NEXT_PUBLIC_PROGRAM_ID=<mainnet program id>   # same id if same keypair
   NEXT_PUBLIC_TOKEN_MINT=<real $WBULL mint>
   NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
   SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<WRAPPEDBULLS_KEY>  # systemd only
   ```
   Rebuild (`npm run build`), redeploy standalone+static, `daemon-reload`,
   restart service. Verify homepage badge no longer says "Launching soon"
   and `/wrap` shows the live UI.
7. **Royalty/creator on-chain verification (private):** do ONE private
   wrap, then check the minted NFT's on-chain metadata:
   ```
   # fetch the Metaplex metadata account for the new nft_mint and confirm:
   #   sellerFeeBasisPoints == 500
   #   creators == [{ address: FRZJ...TwQ, share: 100 }]
   #   collection.verified == true (MCC)
   ```
   If any is wrong, STOP. do not announce; the program must be rebuilt
   /redeployed. (This is why step 7 precedes the public announce.)
   The anchor suite already proves this deterministically on every run:
   `tests/wrappedbulls.ts` `assertRoyalty()` decodes the freshly-minted NFT's
   Metaplex metadata and fails if `sellerFeeBasisPoints != 500` or the
   single creator is not `FRZJ...TwQ` @ share 100. Step 7 is the mainnet
   re-confirmation of an already-test-gated invariant.
8. **Marketplace visibility check:** the wrapped NFT is a standard
   Metaplex NFT in a verified MCC, so Magic Eden and Tensor auto-index it
  . but confirm before announcing:
   - Open the NFT mint on Magic Eden and Tensor; image + traits +
     "WrappedBulls" collection grouping must resolve (they read
     `/api/metadata/<tier>` and the verified collection on-chain).
   - If image/traits don't show: check `/api/metadata/<tier>` and
     `/api/render/<tier>` return 200 on mainnet (the Helius key + cache
     layer must be live), and that `external_url`/`image` resolve.
   - Optional accelerators: submit the collection to Magic Eden / Tensor
     listing forms; claim the Creator Hub for the banner.
9. **Rehearsal 2. private mainnet wrap (the real confirmation gate):**
   With your own wallet holding ≥1,000,000 $WBULL + ≥0.03 SOL, do ONE
   wrap on wrappedbulls.com on Phantom-mainnet, **before any public
   announcement**.
   - Clean (no warning, Advanced shows `wrappedbulls: wrapBull`, tx confirms,
     NFT appears in Phantom Collectibles) → proceed to step 10.
   - Warning → you found out privately. Do not announce. Capture the
     `[wrappedbulls-tx:wrapBull]` console object + Phantom screenshot; the
     remaining factor is domain reputation. pursue verified build +
     Blowfish submission (below) and re-test before announcing.
10. **Announce.** Only after steps 7 to 9 are all clean.

## Domain-reputation hardening (do before/around launch)

The hard triggers (no program, Unknown program, doomed tx) are
deterministically removed by the steps above. Domain reputation is the
residual third-party (Blowfish) variable. Reduce it:

- **Stop the bleeding**. done (pre-launch gate; no more malicious-flagged
  interactions from wrappedbulls.com).
- **Verified build**. register the mainnet program build hash so Blowfish
  / explorers can prove the bytecode matches this open-source repo.
- **Blowfish submission**. once the mainnet program is live + IDL
  published, submit the domain + program via Blowfish's intake
  (https://form.typeform.com/to/BHue5Hg0) with the repo, SECURITY.md, and
  the verified-build attestation.
- Phantom support has confirmed they no longer whitelist domains by
  default, so there is no review queue to wait on. reputation is earned
  through clean, decodable, verified on-chain activity, which steps 3 to 7
  produce.

## RPC scaling (launch-critical. discovered 2026-05-15)

At launch, Magic Eden / Tensor / Phantom crawl `/api/metadata/[tier]` and
`/api/render/[tier]` for all 1000 tiers, repeatedly. A single free RPC key
**will** hit "max usage reached" (`-32429`) under that load and the entire
collection renders broken everywhere. This already happened on the devnet
Helius free key.

Mitigations already shipped (web/lib/cache.ts + the two routes):

- **Single-flight**: N concurrent misses for a tier collapse to ONE RPC
  call. Kills the per-60s thundering herd.
- **Long positive TTL (10 min) + stale-while-revalidate**: a wrapped
  bull only changes on unwrap; serve cached/stale instantly and refresh
  in the background. ~1 RPC per tier per 10 min instead of per request.
- **Short negative TTL (60s in-proc / 20s HTTP)**: 1000-tier probes of
  mostly-unwrapped tiers don't storm RPC, but a freshly-wrapped bull
  still surfaces within ~1 min.
- **Controlled 503 + `no-store` on RPC failure**: a blip degrades
  gracefully and is never cached as an error, instead of a 500 storm.
- **No more `immutable` by tier**: tiers are reused (unwrap → re-wrap =
  new nft_mint = new art/traits); immutable-by-tier served stale art for
  24h and broke the core mechanic.

Status:

- [x] **Dedicated Helius key acquired (2026-05-15).** Verified working on
  BOTH devnet and mainnet (`getHealth` ok, `getAccountInfo` returns data).
  Stored ONLY in the systemd `Environment=SOLANA_RPC_URL=` on the box , 
  never committed to the repo, never in the client bundle. Pre-launch it
  is set to the Helius **devnet** endpoint
  (`https://devnet.helius-rpc.com/?api-key=<WRAPPEDBULLS_KEY>`).
  **Launch-day action:** change `devnet` → `mainnet` in that one systemd
  line (same key) and `systemctl daemon-reload && systemctl restart
  wrappedbulls-web`. That is the entirety of step 6's RPC change.
- [ ] **Optional but strong: Cloudflare in front of wrappedbulls.com.**
  There is currently NO CDN (Caddy proxies straight to Node), so the
  `s-maxage` / `stale-while-revalidate` HTTP headers have nothing to
  honor. A CDN would absorb essentially all marketplace read load at the
  edge and make the origin RPC cost negligible. Not required (the
  dedicated Helius key + single-flight + SWR handle launch load) but it
  is the cheapest large headroom multiplier if volume is huge.

Client-side `NEXT_PUBLIC_SOLANA_RPC_URL` deliberately stays on the public
RPC: it is inlined into the public JS bundle, so the paid key must NOT go
there. Client reads (/gallery, /bull/[tier]) are low-volume; the
launch-critical marketplace crawl hits the server routes, which use the
Helius `SOLANA_RPC_URL`.

## Rollback

- Re-gate instantly: set `NEXT_PUBLIC_LAUNCH_STATE=pre-launch` in
  `web/.env.production` + systemd, rebuild, redeploy, restart. Wrap/unwrap
  revert to "goes live at launch" cards; no tx possible.
- IDL is reversible via `anchor idl close <PROGRAM_ID>` (rent refunded to
  authority) if ever needed.
- Program is upgradeable (upgrade authority retained). fixes can be
  shipped via `anchor upgrade` without changing the program ID.
