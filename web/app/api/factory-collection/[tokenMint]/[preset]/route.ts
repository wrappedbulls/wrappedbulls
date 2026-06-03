// Factory algorithmic collection-level metadata.
//
// Metaplex MCC parent NFT points at this URL. It contains the
// collection's name, description, and a representative image (uses
// the algorithmic preset's "preview-a" seed so the collection card on
// marketplaces shows the preset's signature look).
//
// Static dependency: only on the on chain WrappedCollection PDA (for
// name + ticker). Returns the same bytes for a given (tokenMint, preset)
// pair, safe to cache aggressively.

import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getConnection, fetchWrappedCollection } from "@/lib/factory";
import { getPreset } from "@/lib/art-presets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ tokenMint: string; preset: string }>;
}

function getOrigin(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = fwd || req.headers.get("host") || "wrappedbulls.com";
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { tokenMint: tokenMintStr, preset: presetSlug } = await ctx.params;

  let tokenMint: PublicKey;
  try {
    tokenMint = new PublicKey(tokenMintStr);
  } catch {
    return NextResponse.json({ error: "invalid tokenMint pubkey" }, { status: 400 });
  }
  const preset = getPreset(presetSlug);
  if (!preset) {
    return NextResponse.json({ error: `unknown preset: ${presetSlug}` }, { status: 404 });
  }

  let collection;
  try {
    collection = await fetchWrappedCollection(getConnection(), tokenMint);
  } catch {
    return NextResponse.json(
      { error: "rpc error reading collection" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!collection) {
    return NextResponse.json({ error: "collection not found" }, { status: 404 });
  }

  const origin = getOrigin(req);
  // Use a fixed deterministic seed for the collection cover so the parent
  // card never changes after deploy.
  const coverImage = `${origin}/api/render/factory/${preset.slug}/${tokenMintStr}/${tokenMintStr}-cover`;
  const externalUrl = `${origin}/launch/${tokenMintStr}`;

  const metadata = {
    name: collection.name,
    symbol: collection.ticker,
    description: `${collection.name} is a permissionless wrap layer launched on the WrappedFactory, using the ${preset.name} algorithmic preset. Each NFT in the collection has unique art derived from its mint pubkey.`,
    image: coverImage,
    external_url: externalUrl,
    properties: {
      files: [{ uri: coverImage, type: "image/svg+xml" }],
      category: "image",
    },
  };

  return NextResponse.json(metadata, {
    headers: {
      // Collection metadata is effectively immutable per (tokenMint, preset).
      "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
