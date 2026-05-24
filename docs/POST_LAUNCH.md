> # ⚠️ SUPERSEDED — DO NOT FOLLOW
> Replaced 2026-05-15 by [`LAUNCH_CHECKLIST.md`](LAUNCH_CHECKLIST.md)
> (Phases 4–6) + [`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md). Wrong here:
> deployer is `GMrJpP7Sa…` not `FRZJ…TwQ` (FRZJ…TwQ is the royalty
> treasury); the `launch_preflight.sh`/`launch.sh` automation is deprecated
> (manual sequence now); the "Phantom whitelist / email review@phantom.com"
> model was disproved (root cause was program-not-on-mainnet). Marketplace
> royalty is **5%**, not 0%. Historical context only.

# Post-launch sequencing — first 72 hours (SUPERSEDED)

Minute-by-minute plan for launch day and the days that follow.
Update timestamps as you go.

## Pre-launch state (right now)

The site is in **pre-launch mode**: `NEXT_PUBLIC_LAUNCH_STATE=pre-launch`,
`NEXT_PUBLIC_TOKEN_MINT=` blank. Live stats, feed, and herd are hidden;
visitors see explainer content + the art teaser instead of devnet noise.

## What flips when

| Trigger | What changes | Who does it |
|---|---|---|
| **You launch $WBULL on pump.fun** | Mint address exists | You |
| Run `launch.sh <WBULL_MINT>` on bulls box | Program deploys, bank initializes, collection initializes, web rebuilds with `LAUNCH_STATE=live` + `TOKEN_MINT=$WBULL_MINT`, RPC flips to mainnet, web restarts | You / launch.sh |
| Site flips to live mode automatically | Stats + feed + herd visible; contract address pill shows on homepage; /wrap + /unwrap activate | launch.sh |

## T-30 minutes — final preflight

```bash
ssh root@165.22.167.96
DEPLOYER_KEYPAIR=/tmp/mainnet-deployer.json \
  /root/wrappedbulls-sol/scripts/launch_preflight.sh <YOUR_PLANNED_MINT>
```

Must report **0 fails**. Expected passes by this stage:
- ✓ Keypair pubkey matches `FRZJpAtPcWJBRFziY6dZkBHMBSWVi12hXAtAJEHawTwQ`
- ✓ Mainnet balance ≥ 6 SOL
- ✓ build artifact + Anchor.toml alignment + declare_id! match
- ✓ MCC readiness (web `.mcc` alternates + `web_apply_mcc.sh`)
- ✓ DNS + TLS

If anything fails, fix before continuing.

## T-5 minutes — pump.fun launch

You launch `$WBULL` on pump.fun via the standard pump.fun UI:
- Token name: **WrappedBulls**
- Ticker: **$WBULL**
- Supply: **1,000,000,000** (1 billion)
- Decimals: 6
- Description: short copy from [/security](/security) + wrappedbulls.com link
- Image: `web/public/mascot.png`

Once it confirms, copy the **mint address** from pump.fun's URL.

Quick dev-buy now if part of your strategy (creates the founder bull supply
for your first wrap).

## T+0 — run launch.sh

```bash
DEPLOYER_KEYPAIR=/tmp/mainnet-deployer.json \
  /root/wrappedbulls-sol/scripts/launch.sh <WBULL_MINT_ADDRESS>
```

Watch the output. It runs:

0. Preflight (keypair match, balance, build artifact)
0.5. Web MCC swap + rebuild + sync
1. Deploy program to mainnet (~60s, ~5 SOL)
2. `initialize` with the mint
2.5. `initialize_collection` (mints the MCC parent NFT)
3. **Flip web envs to live + rebuild web + restart** ← critical step
   - `NEXT_PUBLIC_SOLANA_CLUSTER` → `mainnet-beta`
   - `NEXT_PUBLIC_LAUNCH_STATE` → `live`
   - `NEXT_PUBLIC_TOKEN_MINT` → the mint
   - RPC URLs flip to mainnet
   - Rebuilds Next.js (NEXT_PUBLIC_* envs bake at build time)
   - systemd restart

Expected duration: **~3-5 minutes** total.

## T+5 — verify the launch landed

```bash
curl -s https://wrappedbulls.com/api/health | jq
# Should show: ok: true, cluster: "mainnet-beta", chain.slot: <recent>
```

Open https://wrappedbulls.com in a fresh tab (or hard refresh). Check:
- [ ] No "Launching soon" / pre-launch teaser anywhere
- [ ] Hero badge says `MAINNET-BETA · Program live`
- [ ] $WBULL contract pill shows the mint with pump.fun link
- [ ] `/wrap`, `/unwrap`, `/gallery` show live UIs (not pre-launch cards)
- [ ] Connect wallet on mainnet → **no Phantom red banner** (if Phantom
      already whitelisted us — otherwise expect the warning until
      review@phantom.com clears us)

If any check fails, see [`RECOVERY.md`](RECOVERY.md) Scenario 1.

## T+10 — founder bull wrap

Connect Phantom with the wallet that did the pump.fun dev-buy. You should
have ≥1M $WBULL. Go to `/wrap`, click **Wrap WrappedBulls #1 →**, confirm
in Phantom. ~3 seconds later you have founder bull #1 in your wallet.

**Capture the tx signature** from the green success banner. You'll
quote-tweet it.

## T+15 — pinned launch tweet (T1)

From `@wrappedbulls`, post Tweet 1 (Option A from `COMMS.md`):

> Introducing WrappedBulls 🐂
>
> The first hybrid token-NFT layer for pump.fun-launched memecoins.
>
> Wrap 1,000,000 $WBULL into a Bull NFT.
> Sell the NFT, the tokens go with it.
> The vault follows the NFT.
>
> SPL-404 needed Token-2022. We built it on standard SPL.
>
> wrappedbulls.com

**Attach `samples/banners/banner_1500x500.png`.** Pin it. Quote-RT from your
personal account.

## T+20 — founder bull tweet (T2)

Quote-tweet the wrap tx URL on Solana Explorer with Option A from COMMS.md:

> gm.
>
> WrappedBulls #1 is wrapped.
>
> Founder bull. 1,000,000 $WBULL locked in a vault tied to this NFT mint.
> Whoever holds the NFT controls the tokens.
>
> If I sell, they go with it. If I unwrap, they come back. That's the
> whole mechanic.
>
> wrappedbulls.com/bull/1

## T+30 — mechanic thread (T3)

5-tweet thread from `@wrappedbulls`. Copy the 5 tweets from
[`COMMS.md`](COMMS.md) section "Tweet 3".

## T+45 to T+90 — submit marketplace claims

Both can be done in parallel.

### Magic Eden Creator Hub
1. Go to https://creators.magiceden.io
2. Connect deployer wallet (`FRZJp…`)
3. The collection should auto-appear (auto-indexed via MCC). Click Claim.
4. Upload:
   - Banner: `web/public/banner.png`
   - Avatar: `web/public/mascot.png`
   - Description: copy from `/api/metadata/collection` on the live site
   - X: `@wrappedbulls`, Website: `https://wrappedbulls.com`
   - Royalty: 0%
5. Submit for review (24-72h to clear DYOR warnings)

### Tensor Creator Portal
1. Go to https://www.tensor.trade/portal
2. Connect deployer wallet
3. Paste the collection mint (from `bank.collection_mint`,
   printed by launch.sh)
4. Click Claim → connect `@wrappedbulls` X account (mandatory)
5. Same banner + avatar + metadata
6. Submit (24-72h review)

If Tensor asks for "Update Authority wallet signature" — use the reply
template in [`MARKETPLACE.md`](MARKETPLACE.md) "Note on update authority".

## T+1 hour — status update (T5)

Fire Tweet 5 from `COMMS.md` once a few wraps have landed:

> 1 hour in.
>
> N bulls wrapped → live in the gallery
> Y$ in $WBULL locked across all vaults
> First listing live on Tensor: <link>
>
> wrappedbulls.com/gallery

Replace N / Y with real numbers from `/api/health` and gallery.

## T+1 to T+6 hours — reply hooks

Have [`COMMS.md`](COMMS.md) "Tweet 4 — Reply hooks" open in a tab.
Predictable questions:
- "how is this different from SPL-404?" → reply template ready
- "what stops you from rugging the vaults?" → reply template ready
- "is the program upgradeable?" → reply template ready

Pin good organic threads, RT smart commentary.

## T+12 hours — first audit

Run on bulls box:
```bash
/root/wrappedbulls-sol/scripts/audit_chain.sh \
  --url https://api.mainnet-beta.solana.com
```
All 7 invariants must pass. If any fail, halt comms and investigate via
`solana program logs` + `RECOVERY.md` Scenario 5.

## T+24 hours — recap tweet (T6)

Once you have day-1 numbers, fire Tweet 6 from COMMS.md. Use real
`audit_chain.sh` output for the numbers.

## T+24 to T+72 hours — marketplace verifications

Watch for approval emails from:
- Magic Eden Creator Hub
- Tensor Creator Portal

When either clears, fire Tweet 7 (verified badge) from COMMS.md.

## T+30 days — upgrade authority decision

Per [`docs/AUTHORITY.md`](AUTHORITY.md), the plan is: 30-60 days of soak
with no critical incidents, then **freeze upgrade authority** on chain.
This makes the program immutable and removes the deployer keypair as a
single point of failure.

Decision criteria at T+30:
- [ ] No critical bugs reported
- [ ] No tx anomalies in `audit_chain.sh` over the 30 days
- [ ] No marketplace integration issues
- [ ] No security disclosures pending

If green across all: run the freeze tx publicly, tweet the tx signature.

## What if Phantom isn't whitelisted yet at launch?

Acceptable. The site can launch with the red banner showing for
unrecognized-dApp visitors. They can still click through to connect,
and the rest of the experience works. We just lose some conversion
in the first hours/days.

Mitigation:
- Don't pin the wrap CTA above the fold while warning is up — replace
  with "Tradeable on Tensor / Magic Eden as soon as your first bull wraps"
- Bump email follow-up to Phantom with concrete launch data (wrap tx
  signature, real users) — this often unstucks reviews

## Quick reference

- **Preflight**: `/root/wrappedbulls-sol/scripts/launch_preflight.sh <MINT>`
- **Launch**: `/root/wrappedbulls-sol/scripts/launch.sh <MINT>`
- **Audit**: `/root/wrappedbulls-sol/scripts/audit_chain.sh --url https://api.mainnet-beta.solana.com`
- **Health**: `curl https://wrappedbulls.com/api/health | jq`
- **Recovery**: [`docs/RECOVERY.md`](RECOVERY.md)
- **Comms**: [`docs/COMMS.md`](COMMS.md)
- **Marketplace**: [`docs/MARKETPLACE.md`](MARKETPLACE.md)
