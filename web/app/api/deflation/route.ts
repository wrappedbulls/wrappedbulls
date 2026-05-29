// JSON Vault Deflation stats for client-side polling on /deflation.
// Server-side cached (see lib/deflation.ts): chain reads stay flat no matter
// how many tabs poll, so this never strains the RPC key.

import { NextResponse } from "next/server";
import { loadDeflationStats } from "@/lib/deflation";

export const dynamic = "force-dynamic";

export async function GET() {
  const stats = await loadDeflationStats();
  if (!stats) {
    return NextResponse.json(
      { error: "unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  return NextResponse.json(stats, { headers: { "cache-control": "no-store" } });
}
