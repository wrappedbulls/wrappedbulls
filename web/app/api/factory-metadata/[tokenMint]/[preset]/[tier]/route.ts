// Factory algorithmic art metadata endpoint.
//
// URL shape:
//   /api/factory-metadata/<tokenMint>/<preset>/<tier>
//
// The Factory program writes per NFT metadata URI as
// `<art_source.uri()><tier_index>`. For an Algorithmic deployment the
// art_source is `RendererUrl("/api/factory-metadata/<tokenMint>/<preset>/")`
// so a wrapped tier 5 NFT lands at
// `/api/factory-metadata/<tokenMint>/<preset>/5`.
//
// This route resolves that to a Metaplex style metadata JSON. The
// `image` field is the per mint URL `/api/render/factory/<preset>/<tokenMint>/<nft_mint>`,
// looked up from the on chain BullAsset PDA for that tier. Same pattern
// as wrappedbulls `/api/metadata/<tier>`: tier keyed metadata URL,
// per mint image URL, so marketplace caches don't go stale when a
// tier is unwrapped + re wrapped.

import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  getConnection,
  fetchWrappedCollection,
  bullAssetPda,
  PENDING_LOCK_SECONDS,
} from "@/lib/factory";
import { getPreset } from "@/lib/art-presets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ tokenMint: string; preset: string; tier: string }>;
}

function getOrigin(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = fwd || req.headers.get("host") || "wrappedbulls.com";
  return `${proto}://${host}`;
}

// Mirrors state.rs BullAsset layout: 8 disc + nft_mint(32) + tier(u16) + wrapped_at(i64) + bump(1).
function decodeBullAsset(data: Buffer): {
  nftMint: PublicKey;
  tierIndex: number;
  wrappedAt: number;
} {
  const nftMint = new PublicKey(data.slice(8, 40));
  const tierIndex = data.readUInt16LE(40);
  const wrappedAt = Number(data.readBigInt64LE(42));
  return { nftMint, tierIndex, wrappedAt };
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { tokenMint: tokenMintStr, preset: presetSlug, tier: tierStr } =
    await ctx.params;

  // Validate inputs.
  let tokenMint: PublicKey;
  try {
    tokenMint = new PublicKey(tokenMintStr);
  } catch {
    return NextResponse.json(
      { error: "invalid tokenMint pubkey" },
      { status: 400 },
    );
  }
  const preset = getPreset(presetSlug);
  if (!preset) {
    return NextResponse.json(
      { error: `unknown preset: ${presetSlug}` },
      { status: 404 },
    );
  }
  const tier = parseInt(tierStr, 10);
  if (!Number.isInteger(tier) || tier < 0) {
    return NextResponse.json({ error: "invalid tier" }, { status: 400 });
  }

  const conn = getConnection();

  // Read the collection so we have name + ticker for the metadata.
  let collection;
  try {
    collection = await fetchWrappedCollection(conn, tokenMint);
  } catch {
    return NextResponse.json(
      { error: "rpc error reading collection" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!collection) {
    return NextResponse.json(
      { error: "collection not found" },
      { status: 404 },
    );
  }

  // Read the BullAsset PDA so we can put the current nft_mint into the
  // image URL. If the tier is not currently wrapped, the PDA doesn't
  // exist and we surface a 404.
  const [bullAssetAddress] = bullAssetPda(tokenMint, tier);
  let bullAssetInfo;
  try {
    bullAssetInfo = await conn.getAccountInfo(bullAssetAddress, "confirmed");
  } catch {
    return NextResponse.json(
      { error: "rpc error reading bull asset" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!bullAssetInfo) {
    return NextResponse.json(
      { error: `${collection.name} #${tier} is not currently wrapped` },
      { status: 404 },
    );
  }
  const bullAsset = decodeBullAsset(bullAssetInfo.data);

  const origin = getOrigin(req);
  const imageUrl = `${origin}/api/render/factory/${preset.slug}/${tokenMint.toBase58()}/${bullAsset.nftMint.toBase58()}`;
  const externalUrl = `${origin}/launch/${tokenMint.toBase58()}/${tier}`;

  const metadata = {
    name: `${collection.name} #${tier}`,
    symbol: collection.ticker,
    description: `${collection.name} is a permissionless wrap layer launched on the WrappedFactory. Each NFT locks ${collection.tokensPerWrap.toString()} ${collection.ticker} in an NFT owned vault; the tokens follow the NFT through every transfer.`,
    image: imageUrl,
    external_url: externalUrl,
    attributes: [
      { trait_type: "Tier", value: tier },
      { trait_type: "Ticker", value: collection.ticker },
      { trait_type: "Art preset", value: preset.name },
      { trait_type: "Wrapped at", value: bullAsset.wrappedAt, display_type: "date" },
    ],
    properties: {
      files: [{ uri: imageUrl, type: "image/svg+xml" }],
      category: "image",
    },
  };

  return NextResponse.json(metadata, {
    headers: {
      // Same pattern as wrappedbulls metadata route: short positive cache,
      // since a re wrap of the same tier produces a fresh nft_mint and a
      // different image URL. Per mint image URLs are themselves immutable.
      "Cache-Control":
        "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// Re export the lock constant so the bundler picks it up; not actually
// used in this file but ensures the factory lib doesn't get tree shaken
// when this is the only consumer.
void PENDING_LOCK_SECONDS;
