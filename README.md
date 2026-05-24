![WrappedBulls](wrapped-bulls-banner.png)

# WrappedBulls

The first hybrid token + NFT layer for pump.fun launched memecoins.

[wrappedbulls.com](https://wrappedbulls.com) · [@wrappedbulls](https://x.com/wrappedbulls) · [thesis](https://wrappedbulls.com/thesis) · [tech](https://wrappedbulls.com/tech)

> A new kind of pump.fun token. Not a vanilla memecoin. Not a side NFT drop.
> Wrap 1,000,000 $WBULL into a tradeable Bull NFT. The vault follows the NFT
> through every marketplace transfer.

## Why

Pump.fun ships clean, bare SPL tokens with a bonding curve, graduation to PumpSwap, and creator fees. What it doesn't ship is any NFT primitive. The standard hybrid token + NFT mechanic on Solana, **SPL404**, requires Token2022 transfer hooks and is therefore incompatible with pump.fun's classic SPL launches. Every hybrid project before us had to abandon the launchpad to work.

WrappedBulls is the first hybrid token + NFT layer that works on pump.fun.

The mechanism: an **NFT owned vault PDA**. Each Bull NFT has a vault account holding 1,000,000 $WBULL, with the vault's authority derived from the NFT mint itself (`PDA(["vault", nft_mint])`). When the NFT trades on Magic Eden or Tensor, the vault's address doesn't physically move. What changes is who can drive the program to drain it. Possession of the NFT is possession of the right to redeem the tokens. The underlying SPL token never had to be modified. The launchpad never had to be replaced.

**Peer reference:** uPeg uses Uniswap v4 hooks to bind a token to a generative NFT on Ethereum. WrappedBulls uses Solana PDAs to bind a token to a separately tradeable NFT on pump.fun. Different problems, same instinct: use a chain primitive instead of a hybrid token standard.

Full thesis: [wrappedbulls.com/thesis](https://wrappedbulls.com/thesis).
Tech walkthrough: [TECH_WALKTHROUGH.md](TECH_WALKTHROUGH.md).

## Mechanic

```
1. Holder runs wrap_bull            → 1,000,000 $WBULL locked in vault
                                    → 1 Bull NFT minted to wallet
                                    → Vault authority = PDA(["vault", nft_mint])

2. NFT lists on Magic Eden / Tensor → buyer becomes new holder
                                    → vault unchanged onchain
                                    → only the NFT moved

3. New holder runs unwrap_bull      → program checks NFT ownership
                                    → vault drains to caller (1M $WBULL)
                                    → NFT burns, tier returns to free pool
```

## Repository layout

```
.
├── programs/wrappedbulls/      Anchor program (3 instructions: initialize, wrap_bull, unwrap_bull)
│   ├── src/
│   │   ├── lib.rs              Entrypoint, constants, dispatch
│   │   ├── state.rs            BullBank (singleton) + BullAsset (per bull) PDAs
│   │   ├── errors.rs           Program error codes
│   │   └── instructions/
│   │       ├── initialize.rs   One time: lock the $WBULL mint into the bank
│   │       ├── wrap_bull.rs    Lock 1M tokens, mint NFT, create metadata
│   │       └── unwrap_bull.rs  Verify NFT ownership, drain vault, burn NFT
│   └── Cargo.toml
│
├── tests/                      Anchor mocha test suite
│   └── wrappedbulls.ts         Includes the critical vault follows NFT proof
│
├── cranker/                    Offchain renderer + indexer
│   └── src/
│       ├── renderer.mjs        Deterministic 24×24 SVG generator (sha256(nft_mint) → bull)
│       ├── svg_to_png.mjs      Pure Node PNG encoder + SVG→pixels rasterizer
│       ├── index.mjs           Express server: /api/metadata, /api/render
│       ├── mascots.mjs         Generate curated PFP candidates
│       ├── banner.mjs          Generate 1500×500 X header
│       ├── showcase.mjs        Per trait visual catalog
│       └── check_conflicts.mjs Trait overlay collision check
│
├── web/                        Next.js website (wrappedbulls.com)
│   ├── app/
│   │   ├── page.tsx               Landing
│   │   ├── thesis/page.tsx        The thesis statement
│   │   ├── tech/page.tsx          Long form mechanic doc + rarity model
│   │   ├── about/page.tsx         Project background
│   │   ├── art/page.tsx           Trait gallery, math, five tier rarity bands
│   │   ├── gallery/page.tsx       Live grid of every wrapped bull
│   │   ├── bull/[tier]/page.tsx   NFT detail page
│   │   ├── wrap/page.tsx          Wallet connected wrap UI
│   │   ├── unwrap/page.tsx        Wallet connected unwrap UI
│   │   ├── security/page.tsx      Security model
│   │   └── api/
│   │       ├── metadata/[tier]/route.ts        Per bull Metaplex JSON
│   │       ├── metadata/collection/route.ts    Collection NFT metadata (MCC parent)
│   │       └── render/[tier]/route.ts          PNG (default) or SVG
│   ├── lib/
│   │   ├── chain.ts            Lightweight onchain account reader
│   │   ├── program.ts          Anchor client + explicit build → simulate → sign → send wrap/unwrap helpers (Phantom compliant)
│   │   ├── renderer.mjs        Mirror of cranker/src/renderer.mjs
│   │   └── idl.json            Anchor program IDL (with MCC fields)
│   └── public/mascot.png
│
├── scripts/                    Devnet deploy + E2E test scripts
│   ├── deploy_devnet.sh
│   ├── devnet_initialize.ts
│   └── devnet_wrap_bull.ts
│
├── Anchor.toml                 Anchor config (devnet program ID baked in)
├── Cargo.toml                  Workspace
├── TECH_WALKTHROUGH.md         Mechanical explanation for technical readers
└── package.json                ts-mocha + chai for the anchor test suite
```

## Constants

| Name              | Value             | Purpose                                       |
|-------------------|-------------------|-----------------------------------------------|
| `TOKENS_PER_BULL` | 1,000,000,000,000 | Base units per bull (1M whole tokens × 10⁶)   |
| `MAX_BULLS`       | 1,000             | Hard cap on bulls in circulation              |

Pump.fun tokens use 6 decimals. 1B token supply ÷ 1M per bull = 1,000 bulls max.

## Running locally

### Anchor program tests

```bash
# Need: Rust 1.95+, Solana CLI 3.1.14+, Anchor CLI 1.0.2+, Node 20+, Surfpool
anchor test
```

### Render samples

```bash
cd cranker
node src/showcase.mjs       # one bull per trait variant → samples/showcase/
node src/mascots.mjs        # 11 curated PFP candidates → samples/mascots/
node src/banner.mjs         # 1500×500 X header → samples/banners/
```

### Website (devnet)

```bash
cd web
npm install
npm run dev                 # → http://localhost:3000
```

The chain reader is configured for devnet by default (env: `NEXT_PUBLIC_PROGRAM_ID`,
`NEXT_PUBLIC_SOLANA_RPC_URL`). Override in `.env.local` for mainnet.

## Status

**Prelaunch.** The program is on devnet only and $WBULL has not launched on pump.fun. The public site at [wrappedbulls.com](https://wrappedbulls.com) is a prelaunch overview until the launch sequence in [`docs/LAUNCH_RUNBOOK.md`](docs/LAUNCH_RUNBOOK.md) is executed.

Done:

- [x] Anchor program complete (initialize / wrap_bull / unwrap_bull / initialize_collection)
- [x] Full anchor test suite passing including the vault follows NFT proof and adversarial vault security tests
- [x] **Devnet deployed**: `A2tUttiL2v2fYxPyeUSZ75CqnjDp5sewCqcnXubgoxm` (executable on devnet; on mainnet this address is currently an empty system account, see runbook)
- [x] Anchor IDL published **on devnet** (program decodes as `wrappedbulls`, not "Unknown program")
- [x] **Metaplex Certified Collection** (MCC) wired (devnet), verified on each wrap in tests
- [x] **Single signer wrap_bull** (`nft_mint` is a PDA from `["nft_mint", bank.total_wrapped]`)
- [x] Explicit `build → simulate → sign → send` client flow using `signAndSendTransaction`, implementing all four mitigations from [Phantom's docs](https://docs.phantom.com/developer-powertools/domain-and-transaction-warnings), see [`web/lib/program.ts`](web/lib/program.ts)
- [x] Client side hard balance + SOL gates so a doomed tx is never sent
- [x] Metadata/render API hardened for marketplace crawl load (single flight + stale while revalidate cache, no immutable by tier bug, graceful 503 on RPC failure)
- [x] Dedicated Helius RPC (server side only) verified on devnet + mainnet
- [x] Website pages built: `/`, `/thesis`, `/tech`, `/about`, `/art`, `/security`, `/gallery`, `/bull/[tier]`, `/wrap`, `/unwrap` (wrap/unwrap currently gated)
- [x] 23 active accessory traits including **Pump** and **Phantom** (Rare tier additions)

Pending (launch sequence, see [`docs/LAUNCH_RUNBOOK.md`](docs/LAUNCH_RUNBOOK.md)):

- [ ] $WBULL launch on pump.fun
- [ ] **Deploy program to mainnet** + publish IDL on mainnet
- [ ] `initialize` + `initialize_collection` on mainnet with the real $WBULL mint
- [ ] Flip site to `live` / mainnet, private mainnet rehearsal, then announce
- [ ] Verified build via `solana-verify`
- [ ] Helius webhook + indexer for live activity feed

## License

MIT.
