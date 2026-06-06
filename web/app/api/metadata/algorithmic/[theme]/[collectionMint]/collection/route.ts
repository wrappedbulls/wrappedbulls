// /api/metadata/algorithmic/<theme>/<collectionMint>/collection
//
// Metaplex Token Metadata for the COLLECTION (parent MCC NFT) of an
// algorithmic art wrap layer. The Factory's deploy_collection ix
// records this URL as collection_uri so marketplaces can display a
// collection-level name, description, and cover image.
//
// We use the tier 0 render as the collection cover; it's free of any
// tier-specific narrative and serves as a representative sample of
// the theme's aesthetic.

import { NextRequest, NextResponse } from "next/server";
import { getTheme } from "@/lib/algo_art";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: { theme: string; collectionMint: string };
}

function publicOrigin(req: NextRequest): string {
  const envOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN;
  if (envOrigin) return envOrigin.replace(/\/$/, "");
  const xfHost = req.headers.get("x-forwarded-host");
  const host = (xfHost && xfHost.split(",")[0].trim()) || req.headers.get("host") || req.nextUrl.host;
  const proto =
    req.headers.get("x-forwarded-proto") ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const theme = getTheme(params.theme);
  if (!theme) {
    return NextResponse.json(
      { ok: false, code: "unknown_theme", error: `no theme registered at slug "${params.theme}"` },
      { status: 404 },
    );
  }

  const origin = publicOrigin(req);
  const coverUrl = `${origin}/api/render/algorithmic/${theme.slug}/${params.collectionMint}/0`;

  const body = {
    name: `Algorithmic Wrap Layer (${theme.name})`,
    symbol: "",
    description: `On chain seeded algorithmic art. Theme: ${theme.description}`,
    image: coverUrl,
    external_url: `${origin}/launch/${params.collectionMint}`,
    properties: {
      category: "image",
      files: [
        { uri: coverUrl, type: "image/svg+xml" },
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
    },
  });
}
