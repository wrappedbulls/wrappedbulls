// /api/metadata/algorithmic/<theme>/<collectionMint>/<tier>
//
// Metaplex Token Metadata v3 JSON for an algorithmic art NFT. The
// image field points back at the render endpoint, so a marketplace
// fetches metadata first then the image. Both routes are content
// addressed and immutable for a given (theme, collection_mint, tier).
//
// Returns a single JSON object. The Factory's deploy_collection ix
// records the metadata endpoint URL prefix as the collection's
// art_source.uri, and the program appends "<tier>" to it for each NFT.

import { NextRequest, NextResponse } from "next/server";
import { deriveSeed, getTheme } from "@/lib/algo_art";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: { theme: string; collectionMint: string; tier: string };
}

// Origin used for the image URL in the JSON. Read from env so dev /
// staging / preview environments can override. Defaults to the live
// production origin.
function publicOrigin(req: NextRequest): string {
  const envOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN;
  if (envOrigin) return envOrigin.replace(/\/$/, "");
  // Fall back to the request host (so dev curls work) and force https
  // for any non-localhost host.
  const host = req.nextUrl.host;
  const proto = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const rawTier = params.tier.replace(/\.(json|png|svg)$/i, "");
  const tier = parseInt(rawTier, 10);
  if (!Number.isInteger(tier) || tier < 0 || tier > 0xFFFFFFFF) {
    return jsonErr(400, "bad_tier", `tier must be an integer in [0, 2^32). got: ${params.tier}`);
  }

  const theme = getTheme(params.theme);
  if (!theme) {
    return jsonErr(404, "unknown_theme", `no theme registered at slug "${params.theme}"`);
  }

  let seed: bigint;
  try {
    seed = deriveSeed(params.collectionMint, tier);
  } catch (e) {
    return jsonErr(400, "bad_mint", String((e as Error).message ?? e));
  }

  const origin = publicOrigin(req);
  const imageUrl = `${origin}/api/render/algorithmic/${theme.slug}/${params.collectionMint}/${tier}`;

  const body = {
    name: `Tier #${tier}`,
    symbol: "",
    description: `Algorithmic art (theme: ${theme.name}). Generated deterministically from collection ${params.collectionMint} + tier ${tier}.`,
    image: imageUrl,
    external_url: `${origin}/launch/${params.collectionMint}`,
    attributes: theme.attributes(seed, tier),
    properties: {
      category: "image",
      files: [
        { uri: imageUrl, type: "image/svg+xml" },
      ],
    },
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
      "X-Algo-Art-Theme": theme.slug,
      "X-Algo-Art-Seed": seed.toString(),
    },
  });
}

function jsonErr(status: number, code: string, message: string): Response {
  return NextResponse.json({ ok: false, code, error: message }, { status });
}
