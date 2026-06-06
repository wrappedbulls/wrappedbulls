# Algorithmic art generator design

The Factory's "Algorithmic" art tier was shipped behind a `coming soon` badge. This document captures the architecture decisions that drive its V1 implementation so the wizard, render endpoint, metadata endpoint, and theme packs all fit together.

## Goal

Deployers select Algorithmic art, pick a theme, click deploy. Their wrap layer mints NFTs that look professional and cohesive. No commissions, no per token revisions, no art skill required.

The deployer effort is concentrated in ONE decision (which theme). The visual quality is concentrated in the theme pack design (done once per theme by us, reused by every deployer).

## Non goals (V1)

- Per project custom palettes. V1 themes ship with one fixed palette each. V2 can let deployers tune.
- AI generated art (diffusion models). Quality variance, content moderation overhead, ongoing inference cost.
- Animated / video art. Static PNG only.
- Deployer uploaded layer assets. Sticking to curated theme packs.

## Theme architecture

A theme is a self contained module under `web/lib/algo_art/themes/<theme_slug>/`. It exports:

```ts
export interface Theme {
  slug: string;                 // url segment, e.g. "orb"
  name: string;                 // display name, e.g. "Orb"
  description: string;          // 1 sentence pitch shown in the wizard
  preview: { tier: number }[];  // sample tier indices for live preview grid (typically [1, 7, 23, 51, 99])
  render(seed: bigint, tier: number, size: number): Promise<Buffer>;
  metadata(seed: bigint, tier: number, collectionTicker: string): TraitMetadata;
}

export interface TraitMetadata {
  attributes: Array<{ trait_type: string; value: string }>;
}
```

The `render` function is the single source of truth. It MUST be:

1. **Deterministic** — same `(seed, tier, size)` always returns identical bytes.
2. **Self contained** — no network calls, no external state. Pure CPU and the theme's bundled assets.
3. **Fast** — under 200ms per call so the render endpoint can serve marketplace requests without timing out.

## Seed derivation

The seed is `keccak256(collection_mint || tier_index_le)` truncated to 64 bits:

```
seed = BigInt.from(keccak256(concat(collection_mint.toBuffer(), u32_le(tier))).slice(0, 8))
```

Why this hash, why these inputs:
- `collection_mint` is the per deployment MCC mint pubkey. Unique per wrap layer. Two layers with the same theme produce different art.
- `tier_index` is the per NFT identifier. Two NFTs in the same layer with the same tier are impossible by program design, so seed collisions are impossible too.
- The hash mixes both to avoid trivially predictable progressions (`tier=1`, `tier=2` looking nearly identical).
- 64 bits is plenty for theme PRNGs and keeps URL params and cache keys small.

The seed is computed by the render endpoint, not stored on chain. The `art_source.uri` field that the program persists is the metadata endpoint URL prefix; the metadata endpoint pulls the tier from the URL path and derives the seed at request time.

## URL structure

Render endpoint (returns PNG):
```
/api/render/algorithmic/<theme_slug>/<collection_mint>/<tier_index>[.png]
```

Metadata endpoint (returns JSON conformant with Metaplex Token Metadata v3):
```
/api/metadata/algorithmic/<theme_slug>/<collection_mint>/<tier_index>
```

The metadata JSON's `image` field points back at the render endpoint, so marketplaces fetch metadata first, then the image.

For Factory `deploy_collection`, the deployer's `art_source` becomes:
```
artSource = { kind: "baseUri", uri: "https://wrappedbulls.com/api/metadata/algorithmic/<theme_slug>/<collection_mint>/" }
```

The program appends `<tier_index>` per NFT. The metadata route parses `<theme>/<collection_mint>/<tier_index>` from the URL.

## Render pipeline

V1 uses `@napi-rs/canvas` server side. It is the canvas API node binding with no system deps (unlike `node-canvas` which requires Cairo). Themes draw with the same Canvas API a browser exposes.

V1 size: **1024 x 1024** PNG. This is the modern marketplace target and small enough to render in ~50ms for vector-style themes.

Response headers:
- `Content-Type: image/png`
- `Cache-Control: public, max-age=31536000, immutable` (the seed is content addressed, so the bytes never change)
- `Content-Length` set by the buffer

The renderer is wrapped in a 5 second hard timeout; if a theme misbehaves, the route returns a 504 with a generic JSON body. Marketplaces retry; users see a placeholder once and fresh art on retry.

## V1 themes to ship

For the first launch we need ONE theme of exemplary quality. Subsequent themes get added incrementally.

### Theme "orb" (V1.0)

Pure vector composition. No bundled raster assets.

Visual: a glowing orb centered on a flat background, with seed driven variation in:
- Orb base hue (rotated through a curated palette of 12 colors)
- Orb gradient style (radial, conic, dual gradient)
- Background hue (complementary to orb)
- Particle ring (0, 1, or 2 rings of small dots orbiting the orb)
- Aura intensity (subtle, medium, intense glow)
- Iris pattern (hex tessellation, concentric rings, or none)

Why orb first:
- Pure shape composition, no per trait art needed
- Looks professional at any deployment scale
- Works for any project's brand because it has no narrative
- Easy to verify deterministically (the same seed produces the same pixels every run)
- One file render fn, no asset directory

### Future themes (V1.1+)

- "Pixel mascot" theme (curated 32x32 trait sprites, layered compositionally)
- "Geometric beast" theme (composed shape silhouettes with patterned fills)
- "Retro coin" theme (medallion style with seed driven engraving)

Each future theme is a self contained module. Adding a theme does not change the render endpoint or the metadata endpoint.

## Wizard integration

The Algorithmic art card on `/launch/new` shows a theme picker once selected. Each theme renders a 3 x 3 sample grid (9 sample tiers) right in the wizard so the deployer SEES exactly what their collection looks like before they commit.

Sample art is served by the same `/api/render/algorithmic/...` endpoint, using a placeholder `collection_mint` of `Algorithm1111111111111111111111111111111111111` for the wizard previews. Real deploys use the deployer's actual collection_mint and produce different (but visually consistent) results.

The wizard step writes the chosen theme into the deploy form state. On submit, the deploy tx encodes `art_source = baseUri("https://wrappedbulls.com/api/metadata/algorithmic/<theme>/<collection_mint>/")`. The deploy_collection ix doesn't care about themes; it just records the URI.

## Deployment fee for algorithmic art

V1 charges the same 1,000,000 $WBULL as a BaseUri / RendererUrl deploy. The themes are a free service. Per [`project_wrappedbulls`](.) marketing notes the V1.1 "Algorithmic upcharge mechanism" can add a fee delta later; out of scope for this design.

## Open questions deferred

1. Royalty on Algorithmic NFTs (currently 0 on all Factory NFTs; staking project may revisit).
2. Theme moderation. We control the theme catalog so this is a content decision, not a code surface.
3. Theme retirement. If we retire a theme, existing deployments using it continue to work because the render endpoint keeps the implementation forever.

## File layout

```
web/
  app/
    api/
      render/algorithmic/[theme]/[collectionMint]/[tier]/route.ts
      metadata/algorithmic/[theme]/[collectionMint]/[tier]/route.ts
    launch/new/
      page.tsx       <- existing wizard, gets theme picker
  lib/
    algo_art/
      index.ts       <- THEMES registry + seed derivation
      themes/
        orb/
          index.ts   <- Theme implementation
          README.md  <- theme creator notes
```

## Implementation order (drives the rest of B2..B8)

1. Build `lib/algo_art/index.ts` with seed derivation + Theme interface + THEMES registry (empty).
2. Build the `orb` theme module that implements `render` and `metadata`.
3. Build the render endpoint route. Verify byte determinism (same params -> same hash) and PNG validity.
4. Build the metadata endpoint route. Verify JSON shape.
5. Wire wizard: Algorithmic card becomes selectable, opens theme picker, persists selection in form state.
6. Adjust `deploy-tx` route to accept the algorithmic art_source URI shape.
7. Devnet test deploy.
8. Public HTTPS verification.
