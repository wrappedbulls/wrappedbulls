> # ℹ️ Tweet copy below is USABLE; cadence/automation is stale
> The draft tweets are fine to use. Ignore any section that ties posting
> cadence to `launch_preflight.sh`/`launch.sh` (deprecated). sequence
> announcements per [`LAUNCH_CHECKLIST.md`](LAUNCH_CHECKLIST.md) Phase 5
> (announce only after GATE 4 / clean private mainnet rehearsal).

# Launch communication

Three pieces, fired in sequence. Each draft is under Twitter's 280-char limit.

---

## Tweet 1. Pinned launch tweet (fire immediately after `initialize` succeeds)

**Attach: `samples/banners/banner_1500x500.png`**

### Option A. leads with what we solved (recommended)
```
Introducing WrappedBulls 🐂

The first hybrid token-NFT layer for pump.fun-launched memecoins.

Wrap 1,000,000 $WBULL into a Bull NFT.
Sell the NFT, the tokens go with it.
The vault follows the NFT.

SPL-404 needed Token-2022. We built it on standard SPL.

wrappedbulls.com
```

### Option B. punchier
```
A pump.fun token that is also an NFT. 🐂

Wrap 1M $WBULL → a Bull NFT.
Trade the NFT on Magic Eden or Tensor. the tokens follow.
Unwrap to redeem.

1000 supply. 100% on-chain pixel art. Built where nobody else could.

wrappedbulls.com
```

### Option C. confidence flex
```
The mechanic everyone said couldn't work on pump.fun. working on pump.fun. 🐂

WrappedBulls: wrap 1,000,000 $WBULL into an NFT. The vault follows the NFT through every transfer. No Token-2022 required.

1000 supply.

wrappedbulls.com
```

**Recommendation: Option A.** Tells you exactly what it is and what was hard about it. The line "SPL-404 needed Token-2022. We built it on standard SPL." is the meme that should travel. it's the actual differentiator, accurate, and sets up "but how?" curiosity that pulls people into the thesis page.

Pin this on @wrappedbulls. Quote-RT from your personal account.

---

## Tweet 2. "Dev wraps the first bull" (fire 5-15 min after T1, after the dev buy + wrap)

This is the credibility signal. Dev took their own pump.fun supply and wrapped the first bull. Quote-tweet the wrap_bull tx on Solana Explorer.

**Quote-tweet target:** the wrap_bull tx URL on explorer.solana.com.

**Body (one of these. pick the one you like):**

### Option A. clean
```
gm.

WrappedBulls #1 is wrapped.

Founder bull. 1,000,000 $WBULL locked in a vault tied to this NFT mint. Whoever holds the NFT controls the tokens.

If I sell, they go with it. If I unwrap, they come back. That's the whole mechanic.

wrappedbulls.com/bull/1
```

### Option B. punchier
```
🐂 WrappedBulls #1

Wrapped from the dev allocation. 1M $WBULL now live in a vault that follows this NFT through every transfer.

If you want to know whether the mechanic works. go look at the on-chain state right now.

wrappedbulls.com/bull/1
```

### Option C. confidence flex
```
First bull wrapped from the dev supply.

1,000,000 $WBULL locked in a vault that I can't unilaterally drain.
The only way to release them is to burn the NFT. which means I no longer own this bull.

That's the point.

wrappedbulls.com/bull/1
```

**Recommendation: Option A.** Explains the mechanic + signals confidence in one tight package. The line "If I sell, they go with it" is the meme that should travel.

---

## Tweet 3. Mechanic thread (fire ~30 min after launch, when the timeline starts to ask "wait how does this actually work?")

Quote-RT from @wrappedbulls. 5 tweets.

### 1/5
```
A short thread on how WrappedBulls works.

The constraint: pump.fun ships standard SPL tokens, no transfer hooks. SPL-404. the standard hybrid token-NFT mechanic on Solana. requires Token-2022, which is incompatible. Every existing hybrid project had to leave the launchpad.

We didn't. 🐂
```

### 2/5
```
The mechanism: an NFT-owned vault PDA.

When you wrap 1M $WBULL, the program creates a vault token account whose authority is derived from the NFT's mint pubkey itself.

  vault_authority = PDA(["vault", nft_mint])

Pure function. No keypair exists. Only this program can sign for it.
```

### 3/5
```
When the NFT trades on Magic Eden or Tensor, the vault doesn't physically move. Same address. Same authority.

What changes is who can drive the program to drain it.

Possession of the NFT is possession of the right to call unwrap_bull. Authority follows the asset, atomically, no transfer hook needed.
```

### 4/5
```
The underlying SPL token never had to be modified. The launchpad never had to be replaced.

That's why this works on pump.fun where SPL-404 doesn't.

Same bonding curve, same PumpSwap graduation, same wallet UX. with a native NFT primitive on top of the standard token.
```

### 5/5
```
1,000 supply. 1M $WBULL per bull. 100% on-chain pixel art seeded from each NFT's mint pubkey.

Read the thesis: wrappedbulls.com/thesis
Audit: github.com/wrappedbulls/wrappedbulls

Wrap. Trade. Unwrap.

wrappedbulls.com
```

---

## Tweet 4. Reply hooks (have these ready for replies in the first hour)

When people ask predictable questions, fire one of these:

**"how is this different from SPL-404?"**
```
SPL-404 requires Token-2022 transfer hooks. pump.fun ships standard SPL. no hooks. Different token programs entirely. SPL-404 forces you off the launchpad.

We derive the vault's authority from the NFT mint pubkey via a PDA. No transfer hook needed. Works on standard SPL, which is what pump.fun ships.
```

**"how does this compare to uPeg?"**
```
uPeg uses Uniswap v4 hooks to bind a token to a generative NFT on Ethereum. WrappedBulls uses Solana PDAs to bind a token to a separately-tradeable NFT on pump.fun.

Different problems, same instinct: use a chain primitive instead of a hybrid token standard.
```

**"what stops you from rugging the vaults?"**
```
The program. The vault authority is PDA(["vault", nft_mint]). derived from the NFT mint. No keypair exists for it. The only way to drain a vault is unwrap_bull, which checks payer_nft_account.amount == 1.

Whoever holds the NFT controls the tokens. Not me.
```

**"is the program upgradeable?"**
```
For the first 30 days, yes. for bug-patching only. After 30 days of soak with no critical issues, we freeze the upgrade authority. Tx will be public on-chain.

Source: github.com/wrappedbulls/wrappedbulls/docs/AUTHORITY.md
```

**"why 1M tokens per bull?"**
```
1B supply ÷ 1000 max bulls = 1M per bull. Round number, gives bulls actual fractional ownership of the supply, and creates a clear "wrap threshold". hold 1M+, you can wrap a bull.
```

**"I bought on pump.fun, when can I wrap?"**
```
wrappedbulls.com/wrap. Connect your wallet. If you hold ≥1M $WBULL the wrap button is live. ~3 second tx, your bull appears in /gallery and your Phantom Collectibles.
```

---

## Posting cadence

| T+ | Tweet |
|---|---|
| -0:30 | Run `launch_preflight.sh`, confirm green |
| -0:05 | Dev buys $WBULL on pump.fun |
| 0:00 | Run `launch.sh <WBULL_MINT>` (covers chain + web swap + env flip) |
| 0:05 | Pinned launch tweet (T1) on @wrappedbulls |
| 0:05 | Quote-RT from your personal handle |
| 0:10 | Dev wraps WrappedBulls #1 via website, captures tx |
| 0:15 | Founder bull tweet (T2) quote-tweeting the wrap tx |
| 0:30 | Mechanic thread (T3) |
| 1:00 | Status update tweet (T5) |
| 1:00+ | Reply hooks (T4) as questions roll in |
| 1-2h | Submit Magic Eden Creator Hub claim |
| 1-2h | Submit Tensor Creator Portal claim with @wrappedbulls X auth |
| 24h | T+24h recap tweet (T6) with real numbers from `audit_chain.sh` |
| 24-72h | Marketplace verified-badge tweet (T7) when ME / Tensor approve |

---

## Tweet 5. T+1h status (fire ~60 min after launch, organic update)

Once you have a few wraps + maybe one live listing.

### Option A. clean stat
```
1 hour in.

N bulls wrapped → live in the gallery
Y$ in $WBULL locked across all vaults
First listing live on Tensor: <link>

wrappedbulls.com/gallery
```

### Option B. UX flex
```
Bull #2 just sold on Tensor. The 1,000,000 $WBULL in the vault transferred with the NFT in the same tx.

That's the mechanic. Not a feature, not a hook. the vault's authority is the NFT mint itself.

wrappedbulls.com/bull/2
```

---

## Tweet 6. T+24h recap (next-day momentum tweet)

Wait for actual numbers before posting. Replace `N` / `M` / `K` with real values from `/api/health` + `audit_chain.sh`.

### Option A. numbers + thesis
```
24 hours of WrappedBulls.

  N / 1000 bulls wrapped
  M $WBULL locked in vaults
  K SOL of bull NFT volume on Tensor + Magic Eden

The thesis: a token can also be an NFT, on the standard pump.fun rails, without leaving the launchpad. The chain says yes.

wrappedbulls.com
```

### Option B. story focused
```
Day one: <highest-rarity bull's tier> changed hands K times.
The vault didn't move once.

Same address holding 1,000,000 $WBULL, three different owners.
Whoever held the NFT held the right to drain it.

That's why we built it on standard SPL.
```

### Option C. community shout
```
24 hours in, M wraps + K unwraps + Y SOL of marketplace volume.

Big shoutout to everyone who actually read the thesis before clicking wrap. You're the reason this works.

Tomorrow: <next thing. e.g., custom marketplace feature, new trait drop>.

wrappedbulls.com
```

---

## Tweet 7. Marketplace verified badge (fire when ME or Tensor approves the Creator Hub claim)

```
✓ WrappedBulls is now verified on <Magic Eden | Tensor>.

Listings, search, floor price. fully indexed.

Trade here: <marketplace URL>
```

Plain, factual. The badge does the work.

---

## What NOT to tweet

- "Audited". we have not been audited. We have tests + on-chain proof. Don't claim audit.
- "Rug-proof". say "vault is mint-derived, not deployer-derived" instead. Mechanism, not marketing.
- Any specific holder's wallet address (privacy of others)
- "100x" / price targets / token-price predictions. pump.fun community can sniff that out instantly. Lean into mechanic, not number-go-up.
