// Factory algorithmic art renderer.
//
// URL shape:
//   /api/render/factory/<preset_slug>/<collection_pubkey>/<mint_pubkey>
//
// The collection pubkey is accepted for future deployment level styling
// hooks (palette override per deployment, etc). For now it is recorded
// but the rendered SVG depends only on (preset, mint).
//
// Output: SVG with one year immutable cache headers. Same URL always
// yields the same bytes because the renderer is pure on (preset, mint).
// Marketplaces can cache it permanently and never see a stale state.

import { NextRequest, NextResponse } from "next/server";
import { getPreset } from "@/lib/art-presets";

export const dynamic = "force-static";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ preset: string; collection: string; mint: string }> },
) {
  const { preset: presetSlug, mint } = await context.params;
  const preset = getPreset(presetSlug);
  if (!preset) {
    return new NextResponse(`unknown preset: ${presetSlug}`, { status: 404 });
  }
  const svg = preset.render(mint);
  return new NextResponse(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
