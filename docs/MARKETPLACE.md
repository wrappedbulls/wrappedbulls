> # ⚠️ PARTIALLY STALE. read with the corrections below
> As of 2026-05-15, two claims in this doc are **factually wrong** and would
> cause a real launch mistake if copied into marketplace forms:
> - **ROYALTY IS 5% (500 bps), NOT 0%.** Every wrapped bull's on-chain
>   metadata has `seller_fee_basis_points = 500` and creator
>   `FRZJpAtPcWJBRFziY6dZkBHMBSWVi12hXAtAJEHawTwQ` (share 100). Anywhere
>   below that says "0%" / "no royalty" / "`seller_fee_basis_points = 0`"
>   is WRONG. enter **5%** and the treasury wallet in ME/Tensor forms.
> - The "deployer wallet `FRZJ…TwQ`" references are wrong: `FRZJ…TwQ` is the
>   **royalty/creator treasury**; the deployer is `GMrJpP7Sa…`. For
>   Creator-Hub claims, the wallet that receives royalties / should claim
>   the collection is the treasury `FRZJ…TwQ`.
> - Ignore "launches automatically with `scripts/launch.sh`". that script
>   is deprecated; launch is the manual [`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md)
>   sequence. Authoritative marketplace steps: runbook Phase 4 / step 8.
> The collection-recognition mechanics (MCC auto-indexing) below remain valid.

# Magic Eden + Tensor. pre-launch and launch-day plan

What we have done, what happens automatically, and what you have to do
manually to get full Magic Eden and Tensor recognition for the
WrappedBulls collection.

## How marketplace integration actually works

Both Magic Eden and Tensor use the **Metaplex Certified Collection (MCC)**
standard. When an NFT's on-chain metadata has `collection.verified == true`
pointing at a collection NFT, the marketplaces auto-index it.

There are two levels of recognition:

1. **Auto-indexed (instant)**. happens the moment your first bull is
   wrapped and verified into the collection. NFTs become **tradeable**,
   but listings show DYOR / "unverified collection" warnings. Collections
   are not searchable from the homepage and aren't featured.
2. **Creator-claimed (manual)**. you connect to each marketplace's
   creator portal and prove ownership via X account auth + signature.
   This removes the DYOR warnings, makes the collection searchable, and
   gives it a proper landing page with your banner / description.

We have done (1) on the technical side. (2) is a manual step you do on
launch day or shortly after.

## What we already have (verified live on wrappedbulls.com)

- ✅ MCC implemented in the Anchor program (`verify_sized_collection_item`
      runs on every wrap)
- ✅ Sized collection (`CollectionDetails::V1`). auto-increments size
- ✅ `/api/metadata/<tier>` returns valid Metaplex JSON: name, symbol,
      description, image (absolute HTTPS), external_url, attributes,
      properties.files
- ✅ `/api/metadata/collection` returns collection-level JSON with
      banner_image + properties.files including banner
- ✅ `/api/render/<tier>` serves 768×768 PNG with `Cache-Control:
      max-age=86400, immutable` (visual is locked at wrap time)
- ✅ All metadata + image URLs CORS-enabled (`Access-Control-Allow-Origin: *`)
- ✅ `/banner.png` available at the public root (1500×500)
- ✅ `/mascot.png` available at the public root (256×256)
- ✅ `/security` page + `/.well-known/security.txt` for marketplace review
- ✅ `seller_fee_basis_points = 0` on-chain (no royalty enforcement; we
      do not take royalties for v1)

## What launches automatically with `scripts/launch.sh`

On launch day, after you fund the deployer + run `launch.sh <WBULL_MINT>`:

- Mainnet program deploy (idempotent)
- `initialize`. locks the $WBULL mint into BullBank
- `initialize_collection`. mints the 1-of-1 Collection NFT (sized, MCC)
- Web service env switch from devnet → mainnet
- All wraps from this point verify into the collection automatically

After your founder bull (#1) wraps, both Magic Eden and Tensor crawlers
will start indexing the collection within an hour.

## YOUR launch-day actions (Magic Eden)

After launch + first wrap is on chain:

1. Go to **[Magic Eden Creator Hub](https://creators.magiceden.io)** and
   connect your **deployer wallet** (the one that signed `initialize` , 
   `FRZJpAtPcWJBRFziY6dZkBHMBSWVi12hXAtAJEHawTwQ`).
2. Find the collection (it should auto-appear from MCC) and click
   **Claim Ownership**.
3. Fill the listing application:
   - Collection name: **WrappedBulls**
   - Symbol: **WBULL**
   - Description: copy from `/api/metadata/collection` (the JSON we serve)
   - Banner: upload `wrappedbulls-web/public/banner.png` (1500×500)
   - Avatar: upload `wrappedbulls-web/public/mascot.png` (256×256)
   - X / Twitter: `@wrappedbulls`
   - Discord/Telegram: leave blank or add when ready
   - Website: `https://wrappedbulls.com`
   - Category: PFP / Generative
   - Royalty: 0%
4. Submit for review. Magic Eden's team reviews within 24 to 72 hours.
   Once approved: DYOR warnings clear, search works, collection gets
   a proper landing page.

Reference: [How to Claim Ownership of Your NFT Collection](https://help.magiceden.io/en/articles/6450430-how-to-claim-ownership-of-your-nft-collection-in-creator-hub)

## YOUR launch-day actions (Tensor)

After launch + first wrap is on chain:

1. Go to **[Tensor Creator Portal](https://www.tensor.trade/portal)**.
2. Connect your **deployer wallet** (same as ME above).
3. Find the auto-imported collection or paste the collection NFT mint
   address (you'll get this from `bank.collection_mint` after
   `initialize_collection` runs. `launch.sh` prints it).
4. Click **Claim** → connect **@wrappedbulls** X account when prompted.
   This is the **mandatory** verification step.
5. Fill the metadata:
   - Display name: **WrappedBulls**
   - Banner: upload `banner.png`
   - Avatar: upload `mascot.png`
   - Description, X handle, website (same as ME)
6. Tensor recommends signing with the Update Authority wallet for faster
   review. **See note below**. our collection's update authority is a
   program PDA, not a wallet, by design. If they require a wallet
   signature we'll explain via support.
7. Submit for review.

Reference: [Verifying a new NFT Collection on Tensor](https://docs.tensor.trade/work-with-us/creator-portal/verifying-a-new-nft-collection)

## ⚠️ Note on update authority. read before claiming

The WrappedBulls collection NFT's **Metaplex update authority is a
program-owned PDA** (`PDA(["collection_authority"])`), not a wallet.
This is **intentional and more secure**. it lets the program (and only
the program) sign `verify_sized_collection_item` for every wrap, so you
don't need to manually approve each new bull NFT.

This means the standard "sign with update authority wallet" step on ME
and Tensor's verification flow won't work directly. **It does NOT block
auto-indexing or trading**. only the manual verification badge.

If Tensor's reviewer asks for update authority signature:

> Reply: "Our collection NFT's update authority is a program PDA
> (`PDA(["collection_authority"])`), derived from the wrappedbulls program ID
> `F7qXskG73efUwbDo2B97tZgpPAqX7zHMApXbPUimcFdS`. This is intentional , 
> the program signs `verify_sized_collection_item` on every wrap so each
> NFT auto-verifies into the collection without manual approvals.
> Source: github.com/wrappedbulls/wrappedbulls. Happy to demonstrate the
> on-chain link via any tx where the program signed as
> collection_authority."

If review still fails, we have a fallback (see "If verification fails"
section below).

## What to verify after each marketplace claim

| Check | Magic Eden | Tensor |
|---|---|---|
| Collection appears in search | ✓ after approval | ✓ after approval |
| Collection page has banner + avatar | ✓ after upload | ✓ after upload |
| DYOR warning gone | ✓ after approval | ✓ after approval |
| First bull listable | ✓ from day 1 (instant tradeability) | ✓ from day 1 |
| Floor price shows | once 2+ listings exist | once 2+ listings exist |
| Verified checkmark | ✓ after approval | ✓ after X auth + review |

## If verification fails

If either marketplace rejects the claim because of the PDA update
authority:

**Option A** (recommended, no on-chain change): provide alternative proof
- GitHub source code for the program
- The exact program-ID-derived PDA address
- A devnet tx showing the program signing as `collection_authority`
- Your X account verification

**Option B** (post-launch on-chain change, requires program upgrade):
refactor `initialize_collection.rs` so the deployer wallet is the
update authority and the PDA is approved via
`approve_collection_authority`. This is a ~50 line change and is
fully reversible. Doable post-launch if both marketplaces require it.

## Day-1 monitoring

After launch:

- [ ] Wrap founder bull #1 → confirm tx
- [ ] Check `/api/metadata/1` returns the bull's traits (validates pipeline)
- [ ] Confirm bull #1 appears on Magic Eden via direct URL
      (`magiceden.io/marketplace/<collection_mint>`)
- [ ] Confirm bull #1 appears on Tensor via direct URL
      (`tensor.trade/trade/<collection_mint>`)
- [ ] Submit ME Creator Hub claim
- [ ] Submit Tensor Creator Portal claim
- [ ] Check Phantom NFT view shows bull art correctly
- [ ] Run `scripts/audit_chain.sh --url https://api.mainnet-beta.solana.com`

## Useful URLs (post-launch. collection_mint replaces `<MINT>`)

- Magic Eden: `https://magiceden.io/marketplace/<MINT>`
- Tensor: `https://www.tensor.trade/trade/<MINT>`
- Solana Explorer (collection NFT): `https://explorer.solana.com/address/<MINT>`
- Helius (token holders): `https://helius.dev/account/<MINT>`

## Checklist summary

**Pre-launch (done):**
- [x] MCC + sized collection in program
- [x] Collection metadata endpoint
- [x] Per-NFT metadata endpoint with traits
- [x] PNG render endpoint with long cache
- [x] Banner + avatar at public URLs
- [x] CORS + cache headers correct
- [x] /security + security.txt for reviewers

**Launch day (you):**
- [ ] Run `launch.sh` (does the chain side)
- [ ] Wrap founder bull #1
- [ ] Submit Magic Eden Creator Hub claim
- [ ] Submit Tensor Creator Portal claim with @wrappedbulls X auth
- [ ] Reply to verification questions if any (template above)

**Post-launch (within 24-72h):**
- [ ] Confirm both marketplaces approved the claim
- [ ] Verify search + landing pages work
- [ ] Tweet collection links
