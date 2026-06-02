# WrappedFactory Partnerships

Working doc for outreach to the first 3-10 communities we want as Factory
launch partners. Internal-facing; the public-facing surface is
[`/launch`](https://wrappedbulls.com/launch).

## The 60-second pitch

WrappedBulls built a hybrid token + NFT primitive on pump.fun. We wrapped
1M $WBULL into an NFT whose vault follows the NFT through every trade —
sell the NFT, the tokens move with it. The Factory opens this engine to
any pump.fun token. One transaction, your community gets:

- A Metaplex Certified Collection on Magic Eden + Tensor day one
- Atomic wrap and unwrap with the same battle-tested mechanics
- A live deflation dashboard at `wrappedbulls.com/launch/<your-ticker>`
- A buy-and-lock flywheel for your token (v1.1)
- An embeddable activity widget for your own site

Cost: 1,000,000 $WBULL into the bull treasury (7-day per-deposit lock,
multisig controlled, governance adjustable). Same supply as one
wrapped bull. Not burned — preserved in the protocol's working capital.

## What a launch partner gets

| | |
|---|---|
| **Verified badge on chain** | Your `WrappedCollection` PDA carries a `verified: true` flag set by the WrappedBulls Squads multisig. Visible on `/launches` and via the `@wrappedbulls/sdk`. Signals to holders that this is the canonical wrap layer for your token, not a fan deploy or scam. |
| **Brand co-marketing** | Featured on the front page of `/launch` for the first 30 days. Mentioned in the launch tweet + protocol newsletter. Pinned in the `/launches` directory. |
| **Tech that just works** | You don't write Anchor. You don't audit. You don't deal with Metaplex MCC verification. Magic Eden indexes your collection automatically. |
| **Per-deployment dashboard** | `wrappedbulls.com/launch/<your-ticker>` — live counters, wrap/unwrap activity, gallery, all white-labeled. |
| **Embeddable widget** | `<script src="…/embed.js" data-ticker="WXXX">` drops a live feed into your own project site. |
| **SDK + API access** | `@wrappedbulls/sdk` for any deeper integration your team wants to build on top of your wrap layer. |

## What we'd need from you

| | |
|---|---|
| **The pump.fun token mint address** | Your token must be a graduated pump.fun token (mint authority null). We won't deploy on a pre-graduation token where the team can still inflate the supply. |
| **A name + ticker** | `Wrapped<X>` is our preferred convention. Three to ten ASCII characters. We can iterate on the exact form. |
| **Per-NFT art** | You host the metadata + image at any URL of your choice. We point Metaplex at it. We can also help with art if it's a blocker — DM us. |
| **A signing wallet** | The wallet that signs `deploy_collection` becomes the deployer of record on chain. It pays the 1M $WBULL deploy fee. |
| **A genesis wrap** | Strongly encouraged: the deployer (or a senior team member) wraps the first bull themselves. Sets the floor on Magic Eden and signals confidence to your community. |

## Three steps from yes to live

1. **Spec call (15 min)** — confirm token, ticker, max supply, art URL, wrap amount. Lock the parameters.
2. **Deploy** — your team walks `wrappedbulls.com/launch/new` with their wallet. ~2 minutes of signing.
3. **Verified badge + co-marketing** — once we see the deployment on chain, the multisig flips the `verified` flag and we ship the launch tweet within 24 hours.

## Pricing flexibility

The 1M $WBULL deploy fee is a program constant. It's locked at v1 to
keep the upgrade authority's discretion bounded. Future governance can
adjust it. If $WBULL becomes very valuable, the protocol will likely
lower the unit count to keep the dollar cost reasonable for smaller
projects.

For founding-cohort partners (first 3-5 deployments), we are willing to
**fund the deploy from the wrappedbulls treasury** in exchange for a
genesis wrap and one tweet of acknowledgment. Reach out before deploying
if that's relevant.

## Honest things we'd want a partner to know

- The Factory is new. v1 ships in the next 4 weeks. You'd be among the first deployments — the canonical case study.
- The wrappedbulls program itself has been mainnet-live since 2026-05; the Factory is its sibling, sharing the same audit lineage and patterns. See [`SECURITY-FACTORY.md`](../SECURITY-FACTORY.md).
- We do not have a third-party audit yet. We do have 34/34 tests passing across the program and an internal security review against OWASP-style Solana attack patterns. A pre-launch bug bounty announcement is on the roadmap.
- The 7-day per-deposit lock on the bull treasury means the multisig cannot drain your 1M $WBULL for 7 days after you deploy. It's a holder-side safety property, not a deployer one — but worth understanding.
- We will not deploy on a token whose mint authority is non-null. This is a hard pre-flight rejection.

---

## Cold DM template (Twitter / Telegram)

Copy-paste, replace `<X>` with the target project's name + ticker.

> hey — wrappedbulls is shipping the wrap Factory in the next few weeks.
> we built the hybrid token+NFT primitive that lets you wrap 1M tokens
> into a tradeable NFT (vault follows the NFT through every transfer).
>
> we'd love **<X>** as a founding-cohort partner: verified badge on chain,
> magic eden + tensor day one, a dedicated dashboard at
> wrappedbulls.com/launch/w<x>, and a live activity widget for your site.
>
> the deploy fee is 1M $WBULL but for founding partners we're willing to
> fund it from the protocol treasury.
>
> open to a 15-min call? would love to scope this with your team.

## Onboarding follow-up template (after they say yes)

> awesome. three things to lock before deploy:
>
> 1. **token mint:** confirm the pump.fun mint address. needs mint
>    authority null (graduated). we'll verify via solscan.
> 2. **deployment params:**
>    - name: Wrapped<X>
>    - ticker: W<X>
>    - max supply: 100-2000 (slider)
>    - tokens per wrap: how many <X> to lock per NFT
> 3. **art:** a URL where each NFT's metadata JSON lives. v1.1 will
>    accept IPFS / Arweave; for now any HTTPS endpoint that returns
>    valid Metaplex JSON works.
>
> once those are locked, walk wrappedbulls.com/launch/new. it's 5 steps,
> takes about 2 minutes to sign. drop the tx signature in this thread and
> we'll flip the verified badge + push the launch tweet within 24 hours.

---

## Partner tracker (working list)

| Project | Token mint | Status | First contact | Notes |
|---|---|---|---|---|
| _add as we go_ | | | | |

## Outreach principles

- Lead with what they get, not what we get
- DON'T pitch tokens that haven't graduated pump.fun
- DON'T pitch to projects whose communities are obviously dead (zero recent X engagement)
- DO offer the founding-cohort treasury subsidy explicitly — it's our strongest hook for the first 3-5
- DO follow up exactly once if no reply after 5 days; then stop
- DO keep responses warm even if they pass — they may come back later

## After v1 — what we add for partners

V1.1 priorities (in order of how often partners will ask):
1. IPFS + Arweave art source support (for permanence)
2. `update_metadata` ix so deployers can edit name/ticker (rarely; gated to deployer)
3. Per-deployment custom royalty splits
4. Buy-and-lock flywheel that uses each deployment's treasury to buy + lock its OWN token

---

*Living doc. Update the tracker section as outreach happens. Trim or
rotate templates as we learn what gets responses.*
