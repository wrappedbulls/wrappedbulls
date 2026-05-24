# WrappedBulls // Tech Walkthrough

A long form, mechanical explanation of how the project works end to end.

The public name is **WrappedBulls**, the token symbol is **$WBULL**, and the domain is **wrappedbulls.com**. The Anchor crate, directory, and struct names (`BullBank`, `BullAsset`, `wrap_bull`, `unwrap_bull`) use the same `wrappedbulls` / `Bull*` convention throughout; that's the canonical internal naming. The user facing surface is WrappedBulls everywhere.

---

## 1. The problem we're solving

Pump.fun is the dominant memecoin launchpad on Solana. The shape of what it ships is intentionally minimal:

- A **standard SPL token**. Same SPL token program every Solana wallet already supports.
- A **bonding curve** that takes the token from launch to about a $69K market cap.
- An **automatic graduation** to PumpSwap (pump.fun's own AMM) when the curve completes. The LP is burned at graduation, so liquidity is locked forever.
- **Creator fees** baked into both the bonding curve (0.3%) and PumpSwap (up to 0.05% of trading volume).

What pump.fun deliberately does **not** ship is anything related to NFTs. There is no NFT primitive on a pump.fun token. The token is just a token.

This matters because there is an entire culture on Solana, and another, separate one on Ethereum, built around the idea of **hybrid tokens**: instruments where holding a certain amount of the fungible token earns you an NFT, and selling the NFT moves the underlying tokens with it. ERC404 is the Ethereum version (Pandora was the first). SPL404 is the Solana version (Mutantmon, Mall Street, Flyffys).

The catch: **SPL404 requires Token2022**, the newer Solana token standard with transfer hooks. Pump.fun launches **classic SPL tokens** (the older, hookless standard). The two are not interoperable. You cannot retrofit a Token2022 mechanic onto a classic SPL mint. You'd have to abandon pump.fun entirely.

So the obvious interesting question becomes: *can you add ERC404 style hybrid mechanics to a pump.fun launched token without modifying the token?*

That's what this project does.

---

## 2. The mechanic in one paragraph

A holder with at least 1,000,000 of the underlying token can opt in to **wrap** them. Wrapping mints a fresh NFT, transfers the 1M tokens into a vault account, and binds the vault to the NFT's mint address. From that moment, the vault is controlled by whoever holds the NFT. The program enforces it. The NFT is a standard Metaplex Token Metadata NFT, so it lists immediately on Magic Eden, Tensor, and every other Solana marketplace. When someone buys the NFT, the locked 1M tokens come with it (no extra step, no second transaction). The buyer can keep the NFT or **unwrap** it: the program checks they hold the NFT, drains the vault back to them, burns the NFT, and frees the tier slot for the next wrapper.

That's the whole product. Everything below is just how each piece is implemented.

---

## 3. The three onchain accounts

The program is small on purpose. It tracks state across exactly three account types.

### 3.1 `BullBank` (singleton)

There is one `BullBank` per deployment. It is a PDA with seeds `["bank"]`, so it has a fixed, predictable address that any caller can compute.

The bank stores:

- `token_mint`. The address of the underlying token (e.g. the pump.fun launched coin). This is locked at `initialize` time and never changes again. Pump.fun mints have null mint authority, so locking it is safe; nobody can inflate or alter it later.
- `total_wrapped` / `total_unwrapped`. Lifetime counters.
- `in_circulation`. The live count (`total_wrapped - total_unwrapped`).
- `next_tier`. The lowest tier index that has never been wrapped. Starts at 1 and increments each time a fresh tier is taken.
- `free_tiers`. A stack of tier indices that have been wrapped, then unwrapped, and are now available for reuse. When a new wrap arrives the program pops from `free_tiers` first, falling back to `next_tier` only if the stack is empty.
- `authority`. Admin pubkey for the program upgrade authority.
- `bump`, `reserved`. Boilerplate.

The cap is hardcoded at **1,000 bulls** ([lib.rs:41](programs/wrappedbulls/src/lib.rs#L41)). This number is not arbitrary: at 1B token supply and 1M tokens per bull, 1,000 is the maximum that could ever be wrapped simultaneously even if every holder converted everything.

### 3.2 `BullAsset` (one per active bull)

Created on wrap, closed on unwrap. PDA seeds: `["bull", tier_index_le_bytes]`.

Stores only what's needed to identify the bull and its visual:

- `nft_mint`. The address of the Metaplex NFT for this bull.
- `tier_index`. The public facing tier number (`WrappedBulls #1`, `WrappedBulls #2`, …).
- `wrapped_at`. Unix timestamp.
- `bump`.

The seeding choice (`["bull", tier_index]`) is deliberate: it makes simultaneous wrap calls for the same tier impossible. If two wallets both tried to claim tier 17 at the same time, only one of the `init` constraints would succeed. The other would fail at the account creation step. This is the protocol's race condition defense.

### 3.3 The vault token account

Each bull has a dedicated SPL token account holding exactly 1M of the underlying coin. It is an associated token account where:

- The mint is the underlying `$TOKEN`.
- The owner/authority is a PDA at seeds `["vault", nft_mint]`.

That last detail is the project's central trick. The vault's authority is a PDA derived from the **NFT mint address**. The PDA itself doesn't have a private key. It can only be signed for by this program. And the program will only sign for the vault under specific conditions: when a caller is in the `unwrap_bull` instruction and has proven they hold 1 of the corresponding NFT in their wallet.

So the vault is, in effect, owned by whoever holds the NFT. If the NFT is in Alice's wallet, only Alice can drive the program to unlock the vault. If the NFT moves to Bob, only Bob can. This is the property that makes the wrapper "ERC404 like": the locked tokens are inseparable from the NFT.

---

## 4. The three instructions, step by step

The program exposes exactly three entry points: `initialize`, `wrap_bull`, `unwrap_bull`. All three are permissionless (anyone can call them; there's no admin gate on wraps or unwraps).

### 4.1 `initialize`

A one time call by the protocol deployer. Creates the `BullBank` singleton, sets `token_mint` to the address of the underlying coin, sets `next_tier = 1`, and stamps the deployer's pubkey as `authority`.

After this instruction succeeds, the bank is live and the protocol is open for business.

### 4.2 `wrap_bull` (seven steps)

1. **Validate balance.** Caller's $TOKEN account must hold at least 1,000,000 tokens (i.e. `TOKENS_PER_BULL = 1_000_000_000_000` base units, since pump.fun tokens use 6 decimals). If they don't, abort with `InsufficientBalance`.

2. **Pop a tier.** The bank pops a tier index. First from `free_tiers` if non empty, otherwise from `next_tier`. The program also verifies the popped tier matches the `tier_index` the caller passed in; this is a sanity check that the client used a consistent view of bank state.

3. **Initialize the NFT mint.** The caller pre generated a fresh keypair for the NFT mint client side and passes the keypair as a signer. The `init` constraint creates the mint with `decimals = 0`, mint authority and freeze authority both set to the vault PDA (`PDA(["vault", nft_mint])`).

4. **Initialize the vault.** A fresh associated token account is created, owned by the vault PDA. Empty at this point.

5. **Transfer 1M tokens to the vault.** Standard SPL transfer, signed by the caller. The 1M moves from the caller's token account into the vault.

6. **Mint 1 of the NFT.** A `mint_to` CPI mints exactly 1 of the new NFT into the caller's NFT ATA. The vault PDA is the mint authority, so the program signs for it.

7. **Create Metaplex metadata + master edition.** Two CPIs to the Metaplex Token Metadata program. The first creates the metadata account with name `"WrappedBulls #N"`, symbol `"WBULL"`, and a URI pointing at the metadata server (`https://wrappedbulls.com/api/metadata/{tier}`). The second creates a master edition account with `max_supply = 0`, which locks the supply at 1 forever, making it a true unique NFT.

Then the `BullAsset` PDA is initialized with `{nft_mint, tier_index, wrapped_at: now, bump}`, the bank's `total_wrapped` and `in_circulation` counters tick up, and the instruction returns.

The transaction is atomic. Either every step succeeds and the caller has 1 less million tokens plus 1 NFT, or nothing happens.

### 4.3 `unwrap_bull` (four steps)

1. **Verify the caller holds the NFT.** The caller's NFT ATA is checked: `amount == 1` and `owner == payer`. If not, abort with `NotNftHolder`. There is no other gate. Anyone holding the NFT can unwrap, whether they wrapped it themselves or bought it on a marketplace.

2. **Drain the vault.** A signed CPI transfers the full vault balance (1M tokens) from vault → caller. The program signs as the vault PDA. The vault is then closed; rent goes to the caller.

3. **Burn the NFT.** A Metaplex `burn_nft` CPI which closes the mint account, the caller's NFT ATA, the metadata account, and the master edition in one shot.

4. **Update the bank.** The tier index is pushed onto `free_tiers`. `total_unwrapped` ticks up; `in_circulation` ticks down. The `BullAsset` PDA is closed; rent goes to the caller.

Net effect on the caller: gains 1M tokens, gains the rent from three closed accounts (vault, NFT mint, BullAsset), loses 1 NFT.

---

## 5. Why the vault PDA trick works

This is the mechanical insight worth slowing down on. Walk through a concrete trade:

**Time 0.** Alice has 4M tokens in her wallet. She runs `wrap_bull`. The result: she has 3M loose tokens, 1 NFT in her wallet (call it `BULL_42`), and there's a vault at `PDA(["vault", BULL_42])` holding 1M tokens. The vault's authority is a PDA. There is no private key for it anywhere in the world. The only thing that can sign for it is this program, and the program will only do so under the `unwrap_bull` rules.

**Time 1.** Alice lists `BULL_42` on Tensor for 5 SOL.

**Time 2.** Bob buys `BULL_42` on Tensor for 5 SOL. Tensor's atomic swap escrow runs. Net: Bob gets `BULL_42`, Alice gets 4.875 SOL (after Tensor fees), Tensor's escrow program never touches the vault.

The vault's address has not changed. The vault's authority PDA has not changed. Nothing about the vault has changed. It still holds 1M tokens, controlled by `PDA(["vault", BULL_42])`.

What has changed: who can drive the program to sign for the vault.

**Time 3.** Alice tries to call `unwrap_bull` for tier 42. The program checks: does Alice's NFT ATA hold 1 of `BULL_42`? No, she sold it. The instruction fails immediately. The vault is unreachable to her.

**Time 4.** Bob calls `unwrap_bull` for tier 42. The program checks: does Bob's NFT ATA hold 1 of `BULL_42`? Yes. The program signs as the vault PDA, drains the vault to Bob, burns the NFT, frees the tier. Bob now has 1M tokens.

So the tokens "follow the NFT" not because they physically move during a marketplace sale (they don't) but because **only the NFT holder can drive the program to unlock them**. Possession of the NFT is possession of the right to call `unwrap_bull`. That right is the ownership of the underlying tokens.

This is the Solana analogue of ERC404's "redeem on transfer" trick on Ethereum, but the mechanism is different: ERC404 uses transfer hooks to physically move a corresponding NFT every time the fungible token moves. Pump.fun's tokens don't have transfer hooks, so we can't do that. Instead, we move things in the opposite direction: the NFT moves, and the tokens are accessed through the NFT's identity.

---

## 6. What happens during a marketplace sale

It's worth being explicit because every marketplace works the same way:

1. Alice signs a "list" transaction. Tensor (or Magic Eden, or any other marketplace) takes custody of her NFT, usually by moving it to an escrow account they control. Some marketplaces use a delegate model where they don't physically move the NFT but get permission to transfer it on her behalf.

2. Bob signs a "buy" transaction. Inside that transaction, the marketplace program transfers SOL from Bob to Alice (minus marketplace fees and royalties) and transfers the NFT from escrow (or directly from Alice via delegate) to Bob.

3. From this program's perspective, **none of that is special**. The NFT is a vanilla SPL token (with metadata). The vault PDA is bound to the NFT's mint, not its current location. The buyer's identity is whoever now holds 1 of the NFT mint at unwrap time.

That is why the website's job is mostly UX: explaining to a buyer that when they purchase a `BULL` on Tensor, they are also implicitly buying a million token vault that they alone can drain. A surface level NFT buyer might not realize this. Pricing accuracy on the marketplace depends on it being made obvious.

---

## 7. Offchain pieces

The onchain program is the protocol. Offchain, three components serve users.

### 7.1 The cranker (`cranker/src/`)

This is a small Node.js process running on a DigitalOcean droplet. Its responsibilities:

- **Indexer.** Listens to Helius webhooks for transfers of the underlying token and the NFT mints. Maintains an in memory map of `wallet → {looseBalance, ownedBullMints[]}`. Reconciles nightly via `getProgramAccounts` to recover from any missed webhook events.
- **Metadata server.** Hosts `/api/metadata/:tier` and `/api/render/:tier.svg`. The metadata endpoint returns the Metaplex JSON that the onchain `uri` points at. The render endpoint returns the deterministic SVG. Both are CDN cacheable.
- **Health endpoint.** `/health` for uptime monitoring.

Crucially, the cranker is **not on the critical path** for wrapping or unwrapping. Those are pure onchain transactions signed by the user's wallet. The cranker is read only infrastructure: if it goes down, the protocol still works; only the metadata images break.

### 7.2 The renderer (`cranker/src/renderer.mjs`)

A pure function from a 32 byte seed to an SVG. The seed is a SHA256 of the NFT's mint address, so the visual is locked at wrap time and stays with the NFT through every transfer.

The visual is built on a 24×24 chibi bull silhouette: wide horns, broad shoulders, two distinct nostrils. Variation comes from seven independent trait slots:

- **BODY** (9 colors): brown, black, white, red, golden, cyan, pink, zombie, holo
- **HORN** (5 colors): ivory, dark, gold, crimson, silver
- **EYE** (8 variants): normal, golden, void, green, closed, angry, crying, ski_mask
- **BG** (7 backgrounds): pasture, sand, sunset, chart, void, sky, crimson
- **ACC** (head and face accessories): bell, gold chain, cowboy hat, dubai hat, strawberry hat, apple, crown, halo, diamond aura, fire aura, beanie, tinfoil, headband, mohawk, top hat, sheriff hat, tiara, halo stars, earring, scar
- **EYEWEAR**: mog (yellow wraparound visor), classic sunglasses, clout shades, thug life bar, 3d glasses, lasers
- **MOUTH**: cigarette, gold grill, smug, bubblegum, smile, frown, tongue out, open shout

Each rendered SVG is around 1.2 to 1.5 KB. They are entirely server renderable, deterministic from the onchain state, and never need external storage.

### 7.3 The website (`web/`, planned)

A Next.js front end at the project's domain. The user facing surface:

- **Landing page.** Explanation of the mechanic, live circulation count, recent wraps/unwraps.
- **`/wrap`.** Connect wallet, see your token balance, click "Wrap N Bulls", sign once.
- **`/unwrap`.** See your owned bulls, click to redeem.
- **`/gallery`.** Every active bull, sortable by tier and rarity.
- **`/wallet/[addr]`.** Any wallet's bulls plus loose token balance plus dust ratio.
- **`/bull/[tier]`.** A single bull's detail page: visual, traits, owner, vault status, marketplace links.
- **`/feed`.** Live websocket feed of wrap/unwrap/transfer events.

Wallet connection is via Phantom, Solflare, and Backpack (the standard Solana wallet adapter set). RPC is Helius.

---

## 8. Trait and rarity model

Every bull's visual is a deterministic projection of `sha256(nft_mint_pubkey)` into seven trait slots. The bytes of the seed map one to one onto trait categories: byte 0 picks body, byte 1 picks horn, byte 2 picks eye, and so on.

Within each category, traits are bucketed into five rarity tiers:

- **Common** (~50 to 60% of slots). The default look or `none` slot.
- **Uncommon** (~25 to 30%). Everyday flavor.
- **Rare** (~10 to 12%). Distinctive but not headline.
- **Epic** (~3 to 5%). Visual hooks: top hat, tiara, lasers, holo body.
- **Legendary** (~0.5 to 1%). Once per collection grails: holo body, ski mask eyes, halo stars accessory.

Because the cap is 1,000 bulls and the legendary tier is targeted at ~1% per slot, a single legendary trait will typically appear in roughly **10 bulls** of the full collection. A bull with multiple legendaries (e.g. holo body *and* ski mask eyes *and* halo stars) is statistically extreme. The probability is about 1 in 1,000,000. That makes the multi legendary outliers genuinely scarce, which is what gives a 1000 piece NFT collection a coherent rarity story on Tensor and Magic Eden (where rarity scoring drives most secondary trading).

The tiering lives in `cranker/src/renderer.mjs:78-89` as seven `_WEIGHTS` arrays. To rebalance a single trait, change one number in one file.

---

## 9. The lifecycle of a single bull

Pulling everything together, a bull lives through up to four phases:

1. **Birth.** A holder calls `wrap_bull`. A fresh NFT mint is generated client side. The program creates the mint, the vault, the metadata, and the `BullAsset` record in one atomic transaction. The visual is computed from the new mint address. Locked from this moment forward.

2. **Travel.** The NFT is now a regular Metaplex NFT. It can sit in the holder's wallet, be sent to another wallet, listed on Tensor or Magic Eden, used as collateral somewhere, swapped peer to peer, all without touching this program. The vault stays where it is, bound to the mint, accessible only through whoever holds the NFT.

3. **Death.** Whoever currently holds the NFT can call `unwrap_bull`. The vault drains, the NFT burns, the `BullAsset` closes, and the tier index returns to `free_tiers`.

4. **Rebirth (optional).** Some later wrapper claims the same tier index off the `free_tiers` stack. A *new* NFT mint is generated for them. Because the visual seeds from the mint address, the new bull has a *new* visual. Tier 42 in the second cycle looks nothing like Tier 42 in the first cycle. This is why a rare trait combination cannot be "re summoned" by re wrapping. Every wrap is a fresh roll.

---

## 10. What pump.fun gives us for free

The point of this design is that we inherit pump.fun's infrastructure rather than rebuilding it.

- **Bonding curve.** Pump.fun handles the launch. The token starts at zero, tracks a bonding curve to ~$69K market cap, and graduates automatically.
- **PumpSwap LP.** At graduation, an AMM pool is created on PumpSwap and the LP tokens are burned. Liquidity is permanent.
- **Creator revenue.** Pump.fun pays the token creator 0.3% of bonding curve volume and up to 0.05% of PumpSwap volume. This is real, ongoing revenue that funds the cranker, the website hosting, and ops without requiring a fee on wrap/unwrap.
- **Wallet support.** Standard SPL means every Solana wallet handles the token without any custom integration work.

The only thing we add is the wrap/unwrap layer. Everything else, launchpad, AMM, fee economics, wallet UX, is pump.fun's.

---

## 11. What we add on top

The in house tech, the part that is novel and worth a name, has three pieces:

1. **The NFT owned vault PDA pattern.** The mechanic that makes the tokens follow the NFT through any marketplace transfer without modifying the underlying SPL token.

2. **The wrap/unwrap layer.** A small, audited Anchor program (~600 lines) that exposes two user initiated instructions and zero admin gates.

3. **The deterministic visual.** A renderer that maps the NFT mint address to a 24×24 SVG. No offchain images; no IPFS pinning; no centralized art server failure mode. The visual is reproducible from chain state alone.

Combine these with pump.fun's launchpad and PumpSwap, and you have a hybrid token + NFT collection. Solana's first native NFT backed memecoin where the NFTs trade on the regular Solana NFT marketplaces, without abandoning the launchpad culture.

---

## 12. Glossary of names in use

**Public facing surface:**

- **Project name:** WrappedBulls
- **Token symbol:** $WBULL
- **Domain:** wrappedbulls.com
- **NFT name format:** `WrappedBulls #1`, `WrappedBulls #2`, … `WrappedBulls #1000`
- **NFT collection symbol:** WBULL
- **Metadata URI:** `https://wrappedbulls.com/api/metadata/{tier}`

**Codebase internal:**

- Anchor program: `wrappedbulls`
- Program structs: `BullBank` (singleton), `BullAsset` (per bull)
- Instructions: `initialize`, `wrap_bull`, `unwrap_bull`
- PDA seeds: `["bank"]`, `["bull", tier_index_le]`, `["vault", nft_mint]`
- Constants: `TOKENS_PER_BULL = 1_000_000_000_000`, `MAX_BULLS = 1_000`

**Trait vocabulary** (visible to NFT viewers via metadata attributes):

- **Body:** brown, black, white, red, golden, cyan, pink, zombie, holo
- **Horn:** ivory, dark, gold, crimson, silver
- **Eye:** normal, golden, void, green, closed, angry, crying, ski_mask
- **Background:** pasture, sand, sunset, chart, void, sky, crimson
- **Accessory** (23 active): bell, gold_chain, cowboy_hat, dubai_hat, strawberry_hat, apple, crown, halo, diamond_aura, fire_aura, beanie, tinfoil, headband, mohawk, top_hat, sheriff_hat, tiara, halo_stars, earring, scar, **Pump**, **Phantom**
- **Eyewear** (6 active, excluding "none"): mog, sunglasses_classic, clout_shades, thug_life, 3d_glasses, lasers
- **Mouth** (6 active, excluding "none"): cigarette, grill, bubblegum, frown, tongue_out, open_shout

**Five tier rarity model** (per item drop rates across all categories; exact rates vary per category because each has its own weight sum):

| Tier | Per item rate | Examples |
|---|---|---|
| Common | 22 to 68% | brown body, ivory horns, normal eyes, pasture/sand bg, "none" for accessory / eyewear / mouth |
| Uncommon | 5 to 18% | white/red body, dark/gold horns, closed/angry eyes, sky/sunset bg, bell, cowboy_hat, sunglasses, 3d_glasses, frown |
| Rare | 2.7 to 12% | golden/cyan/pink body, crimson/silver horns, crying eyes, chart bg, top_hat, mohawk, tiara, Pump, Phantom, mog, thug_life |
| Epic | 1.8 to 4% | zombie body, void/gold/green eyes, void bg, fire_aura, diamond_aura, halo, scar, dubai_hat, lasers, grill |
| Legendary | ~1% (1/99 to 1/110) | holo body, ski_mask eyes, halo_stars accessory |

Active combination math: 9 (body) × 5 (horn) × 8 (eye) × 7 (bg) × 23 (accessory) × 7 (eyewear) × 7 (mouth) = **2,840,040** unique combinations. Live breakdown plus per trait visuals: [wrappedbulls.com/art](https://wrappedbulls.com/art).

**Cultural references woven in:** ERC404 (Pandora), SPL404 (Mutantmon, Mall Street, Flyffys), CryptoPunks (beanie, top_hat, mohawk, tiara, earring), Moonbirds (diamond_aura, fire_aura), Remilio (clout_shades, dubai_hat), Milady (strawberry_hat), Pudgy Penguins (swag).

The thesis statement: **"WrappedBulls is the first hybrid token + NFT layer for pump.fun launched memecoins. SPL404 requires Token2022 (incompatible with pump.fun). We're the bridge."**
