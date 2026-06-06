// /api/render/algorithmic/<theme>/<collectionMint>/<tier>
//
// Deterministic NFT image renderer for the Factory's algorithmic art
// tier. Same theme, collection mint, and tier always returns the same
// SVG bytes. Marketplace image pipelines and the wizard preview hit
// the same endpoint.
//
// Cache control is `immutable` because the URL is content addressed:
// the bytes for a given (theme, collection_mint, tier) cannot change
// across upgrades except by retiring the theme entirely. A 5 second
// hard timeout protects the route against a misbehaving theme; the
// request returns 504 with a JSON body and marketplaces retry.

import { NextRequest, NextResponse } from "next/server";
import { deriveSeed, getTheme } from "@/lib/algo_art";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RENDER_TIMEOUT_MS = 5000;
const DEFAULT_SIZE = 1024;
const MIN_SIZE = 64;
const MAX_SIZE = 2048;

interface RouteParams {
  params: { theme: string; collectionMint: string; tier: string };
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  // Tier index may carry a .png/.svg suffix from marketplaces that
  // expect file-extension URLs. Strip cleanly so the rest of the path
  // can stay a single integer.
  const rawTier = params.tier.replace(/\.(png|svg)$/i, "");
  const tier = parseInt(rawTier, 10);
  if (!Number.isInteger(tier) || tier < 0 || tier > 0xFFFFFFFF) {
    return jsonErr(400, "bad_tier", `tier must be an integer in [0, 2^32). got: ${params.tier}`);
  }

  const theme = getTheme(params.theme);
  if (!theme) {
    return jsonErr(404, "unknown_theme", `no theme registered at slug "${params.theme}"`);
  }

  // Optional ?size= override; clamp to a safe range so a hostile
  // requester can't force a 1 GB SVG.
  const sizeParam = req.nextUrl.searchParams.get("size");
  let size = DEFAULT_SIZE;
  if (sizeParam !== null) {
    const parsed = parseInt(sizeParam, 10);
    if (!Number.isInteger(parsed) || parsed < MIN_SIZE || parsed > MAX_SIZE) {
      return jsonErr(400, "bad_size", `size must be an integer in [${MIN_SIZE}, ${MAX_SIZE}]`);
    }
    size = parsed;
  }

  let seed: bigint;
  try {
    seed = deriveSeed(params.collectionMint, tier);
  } catch (e) {
    return jsonErr(400, "bad_mint", String((e as Error).message ?? e));
  }

  // Wrap the theme render in a hard timeout. A pathological theme
  // shouldn't be able to hold the route hostage; the renderer is
  // synchronous JS today but future themes may use async work.
  let svg: string;
  try {
    svg = await withTimeout(
      Promise.resolve().then(() => theme.render(seed, tier, size)),
      RENDER_TIMEOUT_MS,
    );
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    const status = msg === "render_timeout" ? 504 : 500;
    return jsonErr(status, msg === "render_timeout" ? "render_timeout" : "render_error", msg);
  }

  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Algo-Art-Theme": theme.slug,
      "X-Algo-Art-Seed": seed.toString(),
    },
  });
}

function jsonErr(status: number, code: string, message: string): Response {
  return NextResponse.json({ ok: false, code, error: message }, { status });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("render_timeout")), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
