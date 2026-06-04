# Launch announcement package

Pre staged comms for the WrappedFactory mainnet launch. All copy is drafted, scoped, and ready to fire so launch hour is execution, not authoring.

**Standing rules embedded in this copy:**

- No dashes (em, en, or punctuation hyphens).
- Upgrade language, not creation language. WrappedBulls invented this tech; no mention of any prior or sibling project on any public surface.
- No Claude attribution anywhere.

---

## Mainnet artifacts (single source of truth for the announcement)

These are the on chain receipts that the announcement tweets cite. Paste them into the X thread, Discord blurb, partner DMs, and explorer / Solscan links.

| Artifact | Value |
|---|---|
| Factory program ID | `WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh` |
| Program data PDA | `Ebq5bBNW1nUg41mUEM9zEBsZ8Hr8P9jHyieMWENqu8BQ` |
| Upgrade authority | `9ZDrkF9a8bMHPeDhe3oiDDUC1616C3vtTGozBgMxhWtn` |
| Deploy tx | `64sMRKm1rGjoyXpspCMKVixfF7Y4DGnBfsKsrHr1DnPZnWXjMT2yXBxNfECEAA3Q2sj9fdHJuy5kYeGYHsyMDJ5V` |
| IDL metadata account | `4b74kxVEtr1wf9DpSncsNPpQKAKfFPDXQ2yb2Jsrac6b` |
| Initialize tx | `4EJNUQtqM8kTb1Mjy2V2ZmDcQSELsdiynLjVvbv8ZGdL9umArkueqvmSfhD1SZEtjSN9woG8DYRL6cqohnAZQTSx` |
| FactoryConfig PDA (singleton) | `3xJpf9ZtXT157khTkXHXBwfKdFafjEnPdadkaMV9Fw2t` |
| BullTreasuryState PDA (singleton) | `Hx1fLGE8RrtKdB21FFW1QeDFbAM6oA3WjV8RaGHbT4RL` |
| Bull treasury vault (WBULL ATA) | `Hpox3NqYcRVcrKDA62f3BXzDnCgJskk7kh3QaeJwYHT7` |
| Mainnet $WBULL mint | `gAhvUSC7XamFqt6gr1JwHU2tEZFYQMEQYEsyKBSpump` |
| Verifiable build hash | `f2ce0ac4f4d70b84e4abb622f31125dc32320ed5aa7723f6b7744546600ef0d2` |
| Source commit | `release/v1.0` tip (see GitHub) |
| Mainnet deployed in slot | (filled in at deploy time via `solana program show`) |

### Solscan quick links (paste into tweets)

- Program: https://solscan.io/account/WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh
- Deploy tx: https://solscan.io/tx/64sMRKm1rGjoyXpspCMKVixfF7Y4DGnBfsKsrHr1DnPZnWXjMT2yXBxNfECEAA3Q2sj9fdHJuy5kYeGYHsyMDJ5V
- Initialize tx: https://solscan.io/tx/4EJNUQtqM8kTb1Mjy2V2ZmDcQSELsdiynLjVvbv8ZGdL9umArkueqvmSfhD1SZEtjSN9woG8DYRL6cqohnAZQTSx
- Treasury vault: https://solscan.io/account/Hpox3NqYcRVcrKDA62f3BXzDnCgJskk7kh3QaeJwYHT7

---

## A. X launch thread (fires the moment canary lifts)

Post as a thread on @wrappedbulls. Each numbered block is one tweet (max 280 chars each).

### 1/ Pin tweet

> The WrappedFactory is live on Solana mainnet.
>
> Any holder of any pump.fun token can now deploy a permissionless wrap layer in 30 seconds. Lock the token, mint an NFT, the vault follows the NFT.
>
> wrappedbulls.com/launch
>
> 🧵

### 2/

> Permissionless means anyone can do it. Anyone can launch a wrap layer for any pump.fun token, with custom name, ticker, supply, lock amount, and art source. The on chain logic is the same for every deployment.
>
> No gatekeepers. No allowlist. 1M $WBULL to deploy.

### 3/

> What a wrap layer does:
>
> 1. Lock N tokens inside a vault
> 2. Mint an NFT that owns that vault
> 3. NFT trades freely on Magic Eden, Tensor, anywhere
> 4. Whoever holds the NFT can burn it and recover the N tokens
>
> The vault travels with the NFT through every trade. Atomic.

### 4/

> Receipts. Open source, internally audited (no external audit), verifiable bytecode.
>
> Program: WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh
>
> Deploy: solscan.io/tx/64sMRKm1
>
> Initialize: solscan.io/tx/4EJNUQtqM8kT
>
> Build hash: f2ce0ac4f4d7...
>
> github.com/wrappedbulls/wrappedbulls

### 5/

> Safety primitives shipped in v1.0:
>
> • on chain circuit breaker (set_factory_paused), unwrap NEVER pauseable
> • 7 day per deposit lock on the bull treasury
> • verified badge to mark the canonical wrap layer for a given token
> • internal audit doc + pre mortem published

### 6/

> Honest disclosures on /terms and /security:
>
> • single hot keypair as upgrade authority during the 30 to 60 day soak
> • no external third party audit
> • permissionless means scam deploys will exist, the verified badge is the signal
>
> Read /terms before wrapping anything.

### 7/

> What's next:
>
> v1.1 in 2 to 3 weeks: BuyBridge (inline Jupiter swap on each deployment page), Lighthouse assertions, set_collection_uri ix, per mint render carryover, algorithmic art tier.
>
> v2 month 2+: lottery, royalty splits, polished art presets.

### 8/

> If you hold a pump.fun token and want to wrap it: wrappedbulls.com/launch/new
>
> If you want to see what's been deployed: wrappedbulls.com/launches
>
> If you want to embed live wrap activity on your site: wrappedbulls.com/launch/embed
>
> If you want to talk: replies are open.

### 9/

> Built by @wrappedbulls.
>
> One operator, public commit history, deployed today.
>
> Wrap responsibly.

---

## B. Discord / Telegram announcement

For announcement channels in third party communities where we have presence.

```
🟢 WrappedFactory v1.0 is live on Solana mainnet.

Permissionless wrap layer deploys for any pump.fun token.

What it does:
• Lock N of your token inside an NFT vault
• NFT trades freely on Magic Eden / Tensor / anywhere
• Whoever holds the NFT can unwrap it back into N tokens
• Vault follows the NFT through every trade, atomic

Deploy: wrappedbulls.com/launch/new
Browse: wrappedbulls.com/launches
Health dashboard: wrappedbulls.com/launch/health
Risk + ToS: wrappedbulls.com/terms

Program: WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh
Deploy tx: 64sMRKm1rGjoyXpspCMKVixfF7Y4DGnBfsKsrHr1DnPZnWXjMT2yXBxNfECEAA3Q2sj9fdHJuy5kYeGYHsyMDJ5V
Initialize tx: 4EJNUQtqM8kTb1Mjy2V2ZmDcQSELsdiynLjVvbv8ZGdL9umArkueqvmSfhD1SZEtjSN9woG8DYRL6cqohnAZQTSx
Build hash: f2ce0ac4f4d70b84e4abb622f31125dc32320ed5aa7723f6b7744546600ef0d2
Source: github.com/wrappedbulls/wrappedbulls

Internally audited, on chain circuit breaker, 7 day treasury lock. No external audit; full risk disclosure on /terms. Permissionless means scam deploys exist; verified badge is the canonical signal.

Built by @wrappedbulls.
```

---

## C. Reply templates for common questions

Pre staged so the launch hour doesn't get bogged down in re explaining the same things. Edit + paste as needed.

### "Is this safe?"

> The program is open source, internally audited (audit doc + pre mortem in the repo), and the on chain bytecode is verifiable against the public commit. It has NOT received an external third party audit; that risk is acknowledged on /terms. Your locked tokens sit in vaults that only the NFT holder can unwrap; we never have control over them.

### "Why no audit?"

> Internal audit is complete (docs/AUDIT_FACTORY.md in the repo). All Critical, High, and Medium findings are closed. We did not commission an external audit pre launch; that's the accepted tradeoff for shipping with a one person team. Bug bounty live at /security. We publish a verifiable build hash so anyone can confirm what's on chain matches the public source.

### "Who controls the upgrade authority?"

> Single hot keypair held by the WrappedBulls operator during the 30 to 60 day soak period. After soak, authority is either moved to a hardware wallet or revoked outright so the program becomes immutable. Full policy on /terms.

### "What if a deployment is a scam?"

> The on chain verified flag is the canonical signal. Only verified deployments carry the green badge on wrappedbulls.com/launches. Unverified deployments are not endorsed by us; the responsibility to evaluate them rests with the user. We can also un verify a deployment that has turned malicious.

### "Can WrappedBulls drain my locked tokens?"

> No. Each wrap layer's vault has its authority derived from the NFT mint, not from any wallet under our control. The program contains no path to move locked tokens to anyone other than the NFT holder. If you hold the NFT, you can unwrap; if you don't, nobody can.

### "Why a pause if you don't have an audit?"

> The pause is the opposite of an audit hole. Audits are pre launch confidence; the pause is a post launch response tool. If we ever observe evidence of an exploit, we can stop new wraps within minutes while we investigate, without preventing existing holders from unwrapping. Unwrap is never pauseable.

### "How does this make money?"

> Each deploy costs 1M $WBULL that goes into the bull treasury vault, subject to a 7 day per deposit lock. The operator multisig can sweep expired entries via claim_treasury. Treasury balance is publicly observable at wrappedbulls.com/launch/treasury. We do not collect royalties from wrap layer trades (each deployment can configure its own per NFT royalty in V2).

---

## D. Partner outreach DM (for the first 5 to 10 target deploys)

Cold but warm. Specific to a project we want to see wrap.

```
Hey, congrats on <recent milestone>.

We just shipped WrappedFactory v1.0 on Solana mainnet, a permissionless wrap layer for any pump.fun token. Holders of <YOUR_TOKEN> could mint NFTs that lock a fixed amount of <YOUR_TOKEN> inside; the NFTs trade on Magic Eden, the vault follows the NFT through every trade.

A few ways it could be a fit for <project>:
• Per tier collectible identity for <YOUR_TOKEN> holders
• An NFT layer that doesn't require any new token launch
• Inline buy and wrap flow via Jupiter (shipping in V1.1)

Deploy fee is 1M $WBULL. Full risk disclosure on /terms. We can verify your deployment once it lands (which gives it the green canonical badge on /launches).

If you want a walk through before deploying, happy to do one. wrappedbulls.com/launch
```

---

## E. The "we're paused" emergency template

Lives in [`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md). Cross referenced here so the operator has one place to find every staged template.

---

## Execution checklist

Tied to the launch runbook.

- [ ] Section A pin tweet drafted + reviewed + ready to copy paste
- [ ] Section A thread tweets numbered and ready as a queue (Twitter doesn't allow scheduling threads directly; use a tool like Hypefury or post sequentially)
- [ ] Section B Discord / Telegram message ready (one per channel)
- [ ] Section C replies pasted into a notes app for fast access during launch hour
- [ ] Section D partner DMs sent 24h before launch to 5 to 10 named targets
- [ ] /terms, /faq, /security all live and reachable from the homepage
- [ ] /launch/health bookmarked on the operator browser
- [ ] @wrappedbulls profile updated with new pinned tweet, bio reflects launch
- [ ] Homepage hero updated to mention the Factory launch
