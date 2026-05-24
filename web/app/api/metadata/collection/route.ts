// GET /api/metadata/collection - Metaplex JSON for the collection NFT itself.
// The on-chain metadata account for the Metaplex Certified Collection (MCC)
// parent points at this URI, so Magic Eden / Tensor / Phantom resolve the
// collection's display name, banner, and description from here.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getOrigin(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = fwd || req.headers.get("host") || "wrappedbulls.com";
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  const origin = getOrigin(req);
  // The collection NFT itself: mascot is the on-chain `image` field
  // (256x256, used as marketplace tile / wallet thumbnail).
  // Banner is exposed as a sibling file for marketplaces / Creator Hub
  // to pick up.
  const image = `${origin}/mascot.png`;
  const banner = `${origin}/banner.png`;

  const metadata = {
    name: "WrappedBulls",
    symbol: "WBULL",
    description:
      "WrappedBulls is a hybrid token-NFT layer for pump.fun-launched " +
      "memecoins. Each bull NFT locks 1,000,000 $WBULL in a vault PDA " +
      "whose authority is derived from the NFT's mint address - sell the " +
      "NFT, the tokens follow. Tradeable on Magic Eden and Tensor; " +
      "unwrap any time to redeem the underlying $WBULL.",
    image,
    external_url: origin,
    // Marketplaces look for a banner via Creator Hub claim (separate
    // upload) but expose it here so it's discoverable from the on-chain
    // metadata too.
    banner_image: banner,
    properties: {
      category: "image",
      files: [
        { uri: image, type: "image/png" },
        { uri: banner, type: "image/png" },
      ],
    },
  };

  return NextResponse.json(metadata, {
    headers: {
      // Collection JSON is mutable in principle (we can update via Metaplex
      // update_metadata_accounts_v2 if we ever change the description),
      // so don't mark as immutable. 1h cache is fine.
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
