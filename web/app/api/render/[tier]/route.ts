// GET /api/render/[tier] - returns the deterministic bull image.
// Default format: PNG (768x768) - Phantom and most wallets prefer raster.
// ?format=svg returns the vector SVG instead.
//
// Caching: rendered bytes are stored in-memory keyed by (tier, format) for
// 60s. Repeated hits skip both the chain RPC and the SVG/PNG pipeline.

import { NextRequest, NextResponse } from "next/server";
import { fetchBullAsset, getConnection } from "@/lib/chain";
import { renderBullSvg, deriveSeed } from "@/lib/renderer.mjs";
import { svgToPixels, encodePng } from "@/lib/svg_to_png.mjs";
import { cacheWrapSWR } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ tier: string }>;
}

const PNG_PIXEL_SCALE = 32; // 24 * 32 = 768x768
// 10 min: a wrapped bull's visual is locked at wrap time and only
// changes if the tier is unwrapped + re-wrapped (rare). Long TTL +
// SWR + single-flight is what keeps a single RPC key alive under a
// full marketplace crawl of all 1000 tiers.
const TTL_MS = 600_000;

interface RenderedAsset {
  svg: string;
  png: Buffer;
}

async function loadRendered(tier: number): Promise<RenderedAsset | null> {
  const conn = getConnection();
  const bull = await fetchBullAsset(conn, tier);
  if (!bull) return null;
  const seed: Buffer = deriveSeed(bull.nftMint.toBase58());
  const { svg } = renderBullSvg(seed, 24);
  const { width, height, rgb } = svgToPixels(svg, PNG_PIXEL_SCALE);
  const png = encodePng(width, height, rgb) as Buffer;
  return { svg, png };
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { tier: tierStr } = await ctx.params;
  const tier = parseInt(tierStr, 10);
  if (!Number.isInteger(tier) || tier < 1 || tier > 1000) {
    return new NextResponse("invalid tier", { status: 400 });
  }

  // CACHE POLICY (fixed 2026-05-15): the visual is deterministic from
  // nft_mint, but tier NUMBERS are reused. unwrap #42 then re-wrap #42
  // mints a fresh nft_mint and a DIFFERENT bull. Caching `immutable` by
  // tier served stale art for up to 24h on every re-rolled bull and broke
  // the core tier-reuse mechanic. Instead: short browser cache + a longer
  // shared (CDN/marketplace) window with stale-while-revalidate. Burst
  // crawler load is absorbed (by the in-process 60s cacheWrap below + the
  // shared cache), but a re-rolled bull self-corrects within minutes, not
  // a day, and NEVER serves a permanently-frozen wrong image.
  const POSITIVE_CACHE =
    "public, max-age=60, s-maxage=300, stale-while-revalidate=600";
  // Unwrapped tiers can become wrapped at any moment. keep the negative
  // cache short so a freshly-wrapped bull shows up fast, but non-zero so
  // marketplaces probing all 1000 tiers don't cause 1000 uncached RPC
  // reads per crawl.
  const NEGATIVE_CACHE = "public, max-age=20, s-maxage=20";

  let asset: RenderedAsset | null;
  try {
    // Long positive TTL (wrapped bull only changes on unwrap), short
    // negative TTL (a freshly-wrapped tier should surface fast). SWR +
    // single-flight collapse marketplace-crawl bursts into ~1 RPC/tier.
    asset = await cacheWrapSWR(
      "render",
      String(tier),
      { ttlMs: TTL_MS, negativeTtlMs: 60_000 },
      () => loadRendered(tier),
    );
  } catch (e) {
    // RPC blip / rate-limit under marketplace load. Don't 500-storm and
    // don't let a CDN cache an error: controlled 503, no-store, retry.
    return new NextResponse("temporarily unavailable, retry", {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "5",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  if (!asset) {
    return new NextResponse(
      `WrappedBulls #${tier} is not currently wrapped`,
      {
        status: 404,
        headers: {
          "Cache-Control": NEGATIVE_CACHE,
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  const format = new URL(req.url).searchParams.get("format");

  if (format === "svg") {
    return new NextResponse(asset.svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": POSITIVE_CACHE,
        "Access-Control-Allow-Origin": "*",
        "X-Cache-Source": "in-process",
      },
    });
  }

  // Default: PNG - wallets (Phantom in particular) render raster more reliably.
  return new NextResponse(new Blob([new Uint8Array(asset.png)], { type: "image/png" }), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": POSITIVE_CACHE,
      "Access-Control-Allow-Origin": "*",
      "X-Cache-Source": "in-process",
    },
  });
}
