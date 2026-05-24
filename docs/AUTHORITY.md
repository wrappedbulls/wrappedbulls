# Program upgrade authority — policy

## Decision

**Keep the upgrade authority for the first 30-60 days post-launch. Freeze (`solana program set-upgrade-authority --final`) after the soak period.**

## Why this trade-off

A Solana program deployed via the BPF Upgradeable Loader has an `Authority` pubkey that controls future upgrades. The WrappedBulls program currently has its authority set to the deployer wallet.

Two options at launch:

| Option | Pros | Cons |
|---|---|---|
| **Keep authority (mutable)** | Can patch bugs. Can add v2 features (auto-wrap, etc.) | Lower trust. Holders rely on the authority not rugging. |
| **Freeze authority (immutable)** | Highest trust. No rug possible at the program level. The mechanic becomes a fixed law. | Bugs are permanent. Cannot add features. |

A hybrid policy fits WrappedBulls' positioning:

- The first 30-60 days are the highest-risk window. Edge cases that didn't surface in tests (Tensor escrow patterns, Magic Eden delegate paths, indexer corner cases, weird wallet behaviors) will appear in this window. Keeping the authority means we can patch them.
- After 30-60 days of mainnet activity, if no critical bugs surface, freezing the authority converts the program into a permanent immutable fixture and signals to holders that it cannot be tampered with.
- This is the same pattern Uniswap, Pudgy Penguins (mainnet), and most credible DeFi/NFT projects follow.

## Concrete plan

### At mainnet deploy (Day 0)

1. Deploy program with deployer wallet as authority.
2. Run `initialize` with the real $WBULL mint.
3. Tweet the program ID and a notice: *"The program is currently upgradeable for the first 30 days while we monitor mainnet behavior. Authority will be frozen at the end of the soak period — receipts will be public on-chain."*

### During the soak period (Day 1-30)

1. Monitor for any of:
   - Failed unwraps (vault state inconsistency)
   - Marketplace edge cases (NFT listed but unwrap won't authorize the buyer)
   - Indexer / metadata server desync
2. If a bug surfaces: deploy a fix, communicate the change publicly, increment a version counter (e.g. embed `BULLPEG_VERSION = "1.0.1"` in `lib.rs` so on-chain state can be verified).
3. If no bugs: continue monitoring.

### Soak period end (Day 30-60, soft target Day 30)

1. Confirm no open bugs.
2. Run:
   ```bash
   solana program set-upgrade-authority \
     <PROGRAM_ID> \
     --new-upgrade-authority none \
     --keypair ~/.config/solana/mainnet-deployer.json
   ```
   This sets the authority to the system program (1111...11), which is non-revertible.
3. Tweet the transaction signature. Holders can verify on-chain that the program is now immutable forever.
4. Update `wrappedbulls.com/about` to reflect immutable status.

## What this does NOT cover

- **The deployer wallet itself.** Even after the program is frozen, the deployer wallet still holds the launch supply (or whatever it minted). The wallet is a separate trust assumption.
- **The website + cranker.** The website code is mutable (we can deploy any frontend). The trust assumption is that the on-chain program enforces all the safety rules — the website is just a UI.
- **The Metaplex Token Metadata program** (CPI'd into during wrap). That program has its own upgrade authority controlled by the Metaplex Foundation. Out of our hands.

## Failsafe: if a critical bug surfaces post-freeze

If a critical bug is found *after* the program is frozen:

1. The program cannot be patched. Period.
2. Wraps may need to be paused via off-chain coordination (the website removes the wrap button, but on-chain wraps remain available to anyone with a CLI client).
3. A new program would have to be deployed with a migration path for existing wraps. This is highly disruptive and should be avoided.

This is why the 30-day soak matters — we want any critical bug to surface *before* freeze, not after.

## Alternative: never freeze (rejected)

Keeping upgrade authority indefinitely caps the project's trust ceiling. Memecoin/NFT communities expect immutability as a credibility signal. A "we'll freeze eventually" posture without an actual freeze date is worse than committing to a date.

The 30-day soak is a balance: short enough that holders see a credible commitment, long enough to catch real edge cases.
