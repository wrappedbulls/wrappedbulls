// JSON $WBULL economy stats for client-side polling on /economy.
// Server-side cached (see lib/economy.ts): one chain-read pass shared
// across all polling viewers via cacheWrapSWR.

import { NextResponse } from "next/server";
import { loadEconomyStats } from "@/lib/economy";

export const dynamic = "force-dynamic";

export async function GET() {
  const stats = await loadEconomyStats();
  if (!stats) {
    return NextResponse.json(
      { error: "unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  return NextResponse.json(stats, { headers: { "cache-control": "no-store" } });
}
