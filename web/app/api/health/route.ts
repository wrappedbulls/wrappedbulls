// GET /api/health - lightweight health check.
// Pings Solana RPC, returns process info, exposes cache stats. UptimeRobot
// can keyword-check `"ok":true` to detect deeper failures than just 200.

import { NextResponse } from "next/server";
import { getConnection, getCluster } from "@/lib/chain";
import { cacheStats } from "@/lib/cache";
import { readLaunchState } from "@/lib/launch-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const t0 = Date.now();
  let chainOk = false;
  let chainSlot: number | null = null;
  let chainErr: string | null = null;
  try {
    const conn = getConnection();
    const slot = await conn.getSlot("confirmed");
    chainSlot = slot;
    chainOk = true;
  } catch (e: any) {
    chainErr = String(e?.message ?? e).slice(0, 200);
  }
  const chainMs = Date.now() - t0;

  const mem = process.memoryUsage();
  const launch = readLaunchState();

  return NextResponse.json(
    {
      ok: chainOk,
      cluster: getCluster(),
      version: process.env.GIT_SHA || "unknown",
      launchState: launch.state,
      tokenMint: launch.tokenMint,
      chain: {
        ok: chainOk,
        slot: chainSlot,
        rttMs: chainMs,
        error: chainErr,
      },
      process: {
        uptimeSec: Math.round(process.uptime()),
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        nodeVersion: process.version,
      },
      cache: cacheStats(),
      timestamp: new Date().toISOString(),
    },
    {
      status: chainOk ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}
