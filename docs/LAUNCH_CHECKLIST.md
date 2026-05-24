# Launch Checklist. Shared Runsheet (You ↔ Claude)

**Authoritative.** Companion to [`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md)
(exact commands). This is the **who-does-what, in-what-order** runsheet so
launch is mechanical and nothing is skipped. Decisions locked 2026-05-15:
**deployer = `GMrJpP7Sa…` (bulls-box keypair); launch = manual runbook
sequence.** Treasury/creator `FRZJ…TwQ` receives royalties and signs
nothing.

Owner tags: **YOU** = Louie · **ME** = Claude. `🔒 GATE` = hard stop;
do not proceed until verified.

> ⚠️ **Superseded. DO NOT USE:** `scripts/launch.sh`,
> `scripts/launch_preflight.sh`, `scripts/web_apply_mcc.sh` and the old
> Phantom-whitelist-form / "fund FRZJ…TwQ to deploy" model. They encode the
> wrong deployer and a root-cause theory we disproved. The runbook + this
> checklist replace them. Treat any other `docs/*.md` that says "fund
> FRZJ…TwQ with SOL to deploy" or "wait for Phantom whitelist" as stale.

---

## Phase 0. Pre-launch (NOW → before $WBULL exists). State: safe.

- [x] ME. Program audited; 5% royalty + creator `FRZJ…TwQ` baked in;
      12/12 anchor tests pass incl. `assertRoyalty` (proven on-chain).
- [x] ME. Client tx flow, metadata/render API, RPC scaling hardened.
- [x] ME. Runbook + this checklist + README + memory consistent with code.
- [ ] ME. Deprecation banners on the superseded scripts (so they can't be
      run by mistake at launch).
- [ ] YOU. *(Optional, recommended, zero-risk)* local devnet rehearsal:
      `cd web && npm run dev` → `localhost:3000/wrap`, Phantom on Devnet,
      fund test wallet (`solana airdrop 2 <addr> -u devnet`) + devnet
      $WBULL, click Wrap. Expect clean modal, Advanced shows
      `wrappedbulls: wrapBull`, console `simulationErr: null`, NFT appears.
      Clean here → program/tx confirmed; any later mainnet warning is
      domain-rep only.
- [ ] YOU. *(Optional)* add a Bash force-push permission rule in Claude
      Code settings if you want the cosmetic `@` subject of commit
      `14cfe2e` fixed. No functional impact; skipping is fine.
- [ ] YOU. Ensure you can fund deployer `GMrJpP7Sa…` with **~9 SOL** on
      mainnet at launch (verified: 5.82 SOL ProgramData rent + ~5.82
      transient deploy buffer + IDL/init/fees; ~5 SOL is NOT enough), and
      that you control treasury `FRZJ…TwQ`.

🔒 **GATE 0:** Do not start Phase 1 until $WBULL is live on pump.fun and
you have the real mint address.

---

## Phase 1. Token launch + handoff (YOU trigger)

- [ ] YOU. Launch $WBULL on pump.fun.
- [ ] YOU. Send me: (a) the **$WBULL mint address**, (b) explicit
      "it's live, proceed."
- [ ] ME. Verify on mainnet: real SPL mint, 6 decimals, mint authority
      null. Report before touching anything.

🔒 **GATE 1:** Mint verified real. A wrong/placeholder mint must NEVER
reach `initialize`. it locks permanently.

---

## Phase 2. Mainnet deploy (ME executes, YOU fund)

- [ ] YOU. Fund deployer `GMrJpP7SaUkfyizsB3b8GeKWgDiqac3g5EaMGnMtkXCj`
      (= bulls-box `/root/.config/solana/id.json`) with **~9 SOL** mainnet
      (5.82 ProgramData rent + ~5.82 transient buffer + IDL/fees; ~5 is
      NOT enough). Tell me when done. *(NOT FRZJ…TwQ.)*
- [ ] ME. `anchor build` on the box from the royalty-bearing source;
      confirm `wrappedbulls.so` + `wrappedbulls.json` fresh, 0 errors.
- [ ] ME. `anchor deploy --provider.cluster mainnet` (Anchor wants `mainnet`, NOT `mainnet-beta`. that's solana CLI; verified 2026-05-20); verify
      `solana program show` → Executable: true, authority `GMrJpP7Sa…`.
- [ ] ME. `anchor idl init` on mainnet; verify `anchor idl fetch` returns
      the wrappedbulls IDL (kills "Unknown program").
- [ ] ME. `initialize` (locks real $WBULL mint) + `initialize_collection`
      (MCC). Triple-check the mint string before running `initialize`.

🔒 **GATE 2:** Program executable on mainnet, IDL published, bank
initialized with the correct mint, MCC created. I verify via on-chain reads.

---

## Phase 3. Site flip to live (ME executes)

- [ ] ME. Repoint `web/.env.production` + systemd: `LAUNCH_STATE=live`,
      mainnet cluster, real program id + token mint, systemd
      `SOLANA_RPC_URL` → Helius **mainnet** endpoint. Confirm no
      `.env.local` exists on the build machine (only `.env.development.local`).
- [ ] ME. Rebuild, redeploy, `daemon-reload`, restart `wrappedbulls-web`.
- [ ] ME. Verify homepage drops "Launching soon", `/wrap` shows live UI,
      `/api/metadata/1` + `/api/render/1` return 200 on mainnet.

🔒 **GATE 3:** Site live on mainnet, serving without errors.

---

## Phase 4. Private verification (SHARED. the no-errors gate)

**No public announcement until every item here is green.**

- [ ] ME. One private wrap; read the new NFT's on-chain metadata:
      `sellerFeeBasisPoints == 500`, creator `FRZJ…TwQ` share 100,
      `collection.verified == true`. (Test-gated already; mainnet re-confirm.)
- [ ] ME. Open the mint on Magic Eden + Tensor; image, traits,
      "WrappedBulls" collection grouping resolve.
- [ ] YOU. **Rehearsal:** with your wallet (≥1,000,000 $WBULL + ≥0.03
      SOL) do ONE wrap on wrappedbulls.com on **Phantom-mainnet**. Expect:
      no warning, Advanced shows `wrappedbulls: wrapBull`, tx confirms, NFT in
      Phantom Collectibles. Screenshot the modal + send the
      `[wrappedbulls-tx:wrapBull]` console object.
- [ ] ME. Any warning/error → diagnose from your capture, fix, redeploy,
      re-test. You do not announce until clean.

🔒 **GATE 4:** Clean private mainnet wrap + royalty on-chain + NFT visible
on both marketplaces. This is the "no errors at launch" guarantee.

---

## Phase 5. Announce (YOU)

- [ ] YOU. Announce only after GATE 4 fully green.
- [ ] ME. Stand by during announce for live triage.

---

## Phase 6. Post-launch monitoring (ME ongoing)

- [ ] ME. Watch Helius RPC health (no `-32429`), metadata/render 200s
      under marketplace crawl, `wrappedbulls-web` uptime.
- [ ] ME. Spot-check wrapped bulls on ME/Tensor as volume grows.
- [ ] ME. Keep README/runbook/this checklist/memory reflecting live state.
- [ ] YOU. Forward any user-reported wallet warning or mint failure with
      screenshot + wallet; I triage same-day.

---

## Rollback (either of us can trigger)

Set `NEXT_PUBLIC_LAUNCH_STATE=pre-launch` in `web/.env.production` +
systemd, rebuild, redeploy, restart → wrap/unwrap revert to gated cards,
no tx possible, no further domain-rep damage. Program is upgradeable
(authority retained) so logic fixes ship via `anchor upgrade` without
changing the program ID. Detail: runbook "Rollback".

---

## The only things ONLY you can do (rest is mine)

1. **Launch $WBULL, send me the verified mint + "go."** (GATE 1)
2. **Fund deployer `GMrJpP7Sa…` with mainnet SOL; do the private Phantom
   rehearsal wrap.** (GATE 2 / GATE 4)

Build, deploy, IDL, initialize, site flip, on-chain royalty + marketplace
verification, and monitoring are mine to execute and prove.
