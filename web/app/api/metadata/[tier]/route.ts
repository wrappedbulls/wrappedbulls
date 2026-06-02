// GET /api/metadata/[tier] - returns the Metaplex-style JSON metadata
// that the on-chain metadata account points at via its `uri` field.
// Phantom / Magic Eden / Tensor read this to display name, image, and traits.

import { NextRequest, NextResponse } from "next/server";
import { fetchBullAsset, getConnection } from "@/lib/chain";
import { selectTraits, deriveSeed } from "@/lib/renderer.mjs";
import { cacheWrapSWR } from "@/lib/cache";
import { getProvenance } from "@/lib/provenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ tier: string }>;
}

const TRAIT_LABELS = {
  body: ["brown", "black", "white", "red", "golden", "cyan", "pink", "zombie", "holo"],
  horn: ["ivory", "dark", "gold", "crimson", "silver"],
  eye: ["normal", "golden", "void", "green", "closed", "angry", "crying", "ski_mask"],
  bg: ["pasture", "sand", "sunset", "chart", "void", "sky", "crimson"],
  acc: [
    "none", "nose_ring", "bell", "war_paint", "gold_chain", "cowboy_hat",
    "dubai_hat", "strawberry_hat", "apple", "crown", "halo", "devil_aura",
    "diamond_aura", "fire_aura", "beanie", "tinfoil", "headband", "mohawk",
    "top_hat", "sheriff_hat", "tiara", "halo_stars", "earring", "mole",
    "rosy_cheeks", "scar", "Pump", "Phantom",
  ],
  eyewear: [
    "none", "mog", "sunglasses_classic", "clout_shades", "thug_life",
    "3d_glasses", "big_shades", "swag", "lasers",
  ],
  mouth: [
    "none", "cigarette", "cigar", "grill", "smug", "bubblegum", "smile",
    "frown", "tongue_out", "open_shout", "pacifier",
  ],
};

function getOrigin(req: NextRequest): string {
  // Prefer x-forwarded-host (set by Caddy reverse proxy on bulls box)
  const fwd = req.headers.get("x-forwarded-host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = fwd || req.headers.get("host") || "wrappedbulls.com";
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { tier: tierStr } = await ctx.params;
  const tier = parseInt(tierStr, 10);
  if (!Number.isInteger(tier) || tier < 1 || tier > 1000) {
    return NextResponse.json({ error: "invalid tier" }, { status: 400 });
  }

  // Cache policy: see /api/render/[tier] for the full rationale. Tiers are
  // reused (unwrap → re-wrap = new nft_mint = new traits), so metadata must
  // NOT be `immutable` by tier. Short browser cache + longer shared window
  // with stale-while-revalidate; a re-rolled bull's traits self-correct
  // within minutes instead of being frozen wrong for 24h.
  const POSITIVE_CACHE =
    "public, max-age=60, s-maxage=300, stale-while-revalidate=600";
  const NEGATIVE_CACHE = "public, max-age=20, s-maxage=20";

  // Long positive TTL (traits are locked to nft_mint; only change on
  // unwrap+rewrap), short negative TTL. SWR + single-flight collapse a
  // 1000-tier marketplace crawl into ~1 RPC per tier per 10 min.
  let bull;
  try {
    bull = await cacheWrapSWR(
      "bull-asset",
      String(tier),
      { ttlMs: 600_000, negativeTtlMs: 60_000 },
      async () => await fetchBullAsset(getConnection(), tier),
    );
  } catch (e) {
    // RPC blip under marketplace crawl load. controlled 503, not a 500
    // storm, and never let a CDN cache the error.
    return NextResponse.json(
      { error: "temporarily unavailable, retry" },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": "5",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }
  if (!bull) {
    return NextResponse.json(
      { error: `WrappedBulls #${tier} is not currently wrapped` },
      {
        status: 404,
        headers: {
          "Cache-Control": NEGATIVE_CACHE,
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  const origin = getOrigin(req);
  // Image URL is keyed by nft_mint, NOT tier. The tier-keyed render URL is
  // unsafe as a marketplace-facing image: when a tier is unwrapped + re-
  // wrapped, a fresh nft_mint produces a new visual, but the per-tier URL
  // is stable -- so ME/Tensor/solana-fm CDNs serve permanently-cached
  // pre-rewrap bytes. Per-mint URL is immutable (mints don't re-roll),
  // so the CDN bytes are correct forever and a future re-roll naturally
  // moves to a fresh URL. (Fixed 2026-06-02 after a user reported tier 79
  // showing the pre-rewrap art on Magic Eden while the site rendered the
  // post-rewrap art.)
  const imageUrl = `${origin}/api/render/mint/${bull.nftMint.toBase58()}`;
  const externalUrl = `${origin}/bull/${tier}`;

  const seed: Buffer = deriveSeed(bull.nftMint.toBase58());
  const traits = selectTraits(seed) as Record<string, number>;

  // Provenance: derived from the mint + wrap timestamp, read only. Does not
  // affect the image. Surfaced as attributes so Magic Eden / Tensor display
  // and let collectors filter by Serial, Era, and Founding Herd.
  const prov = await getProvenance(
    getConnection(),
    bull.nftMint.toBase58(),
    bull.wrappedAt,
  );

  const attributes: Array<{ trait_type: string; value: string | number; display_type?: string }> = [
    { trait_type: "Tier", value: tier },
    { trait_type: "Body", value: TRAIT_LABELS.body[traits.body] },
    { trait_type: "Horn", value: TRAIT_LABELS.horn[traits.horn] },
    { trait_type: "Eye", value: TRAIT_LABELS.eye[traits.eye] },
    { trait_type: "Background", value: TRAIT_LABELS.bg[traits.bg] },
    { trait_type: "Accessory", value: TRAIT_LABELS.acc[traits.acc] },
    { trait_type: "Eyewear", value: TRAIT_LABELS.eyewear[traits.eyewear] },
    { trait_type: "Mouth", value: TRAIT_LABELS.mouth[traits.mouth] },
  ];
  if (prov.serial !== null) {
    attributes.push({ trait_type: "Serial", value: prov.serial });
    attributes.push({ trait_type: "Era", value: prov.era as number });
    attributes.push({ trait_type: "Founding Herd", value: prov.isOG ? "yes" : "no" });
  }
  if (prov.wrappedAt > 0) {
    attributes.push({ display_type: "date", trait_type: "Wrapped", value: prov.wrappedAt });
  }

  const metadata = {
    name: `WrappedBulls #${tier}`,
    symbol: "WBULL",
    description:
      `WrappedBulls #${tier}. A hybrid token + NFT. Holds 1,000,000 $WBULL ` +
      `locked in a vault whose authority is derived from this NFT's mint ` +
      `address. Sell the NFT, the tokens go with it. Unwrap to redeem.`,
    image: imageUrl,
    external_url: externalUrl,
    attributes,
    properties: {
      category: "image",
      files: [{ uri: imageUrl, type: "image/png" }],
    },
  };

  return NextResponse.json(metadata, {
    headers: {
      "Cache-Control": POSITIVE_CACHE,
      "Access-Control-Allow-Origin": "*",
    },
  });
}
