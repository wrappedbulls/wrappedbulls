// GET /api/render/mint/[mint] — mint-keyed deterministic bull image.
//
// Background: /api/render/[tier] keys the URL by tier_index, which is
// REUSED on unwrap+rewrap. That means marketplaces (Magic Eden, Tensor,
// solana-fm) and their CDNs cache stale bytes at that URL after every
// re-roll. The art is fundamentally a function of nft_mint (sha256 of
// the mint pubkey base58), not tier_index.
//
// This endpoint takes the nft_mint pubkey directly in the URL path.
// A re-roll always produces a different mint PDA, so the URL is truly
// immutable per mint, and `Cache-Control: immutable, max-age=1yr` is
// finally honest. No chain read required: the renderer is a pure
// function of the mint pubkey.
//
// Used as the `image` field returned by /api/metadata/[tier] so on-chain
// metadata points at a per-mint URL that downstream caches can never
// stale across re-rolls.

import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { renderBullSvg, deriveSeed } from "@/lib/renderer.mjs";
import { svgToPixels, encodePng } from "@/lib/svg_to_png.mjs";

export const runtime = "nodejs";
export const dynamic = "force-static"; // pure function of the mint, no RPC

interface RouteContext {
  params: Promise<{ mint: string }>;
}

const PNG_PIXEL_SCALE = 32; // 24*32 = 768x768

// Cache forever: the mint pubkey is permanently unique. A re-roll mints a
// DIFFERENT mint, which lands at a DIFFERENT URL, so no cache can ever
// be stale here. max-age=1yr + immutable is the strongest possible signal
// to CDNs / browsers / marketplace image proxies that they can hold the
// bytes indefinitely.
const IMMUTABLE_CACHE = "public, max-age=31536000, s-maxage=31536000, immutable";

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { mint: mintStr } = await ctx.params;

  // Validate mint is a parseable solana pubkey. We don't verify the mint
  // actually exists on chain — the renderer is a pure function and a
  // request with a non-existent mint is just garbage-in-garbage-out
  // (still returns a deterministic image, just for a mint nobody owns).
  // This keeps the endpoint zero-RPC and CDN-cacheable.
  try {
    new PublicKey(mintStr);
  } catch {
    return new NextResponse("invalid mint pubkey", { status: 400 });
  }

  const seed: Buffer = deriveSeed(mintStr);
  const { svg } = renderBullSvg(seed, 24);

  const format = new URL(req.url).searchParams.get("format");
  if (format === "svg") {
    return new NextResponse(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": IMMUTABLE_CACHE,
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  const { width, height, rgb } = svgToPixels(svg, PNG_PIXEL_SCALE);
  const png = encodePng(width, height, rgb) as Buffer;
  return new NextResponse(new Blob([new Uint8Array(png)], { type: "image/png" }), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": IMMUTABLE_CACHE,
      "Access-Control-Allow-Origin": "*",
    },
  });
}
