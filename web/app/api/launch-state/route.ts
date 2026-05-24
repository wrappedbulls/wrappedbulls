// /api/launch-state. runtime launch-state endpoint.
//
// Client components ("use client" pages like /wrap and /unwrap) cannot
// read the server-side state file directly, so they fetch this. The
// route reads the file fresh on every request (force-dynamic + no
// cache) so a state flip is visible immediately, with no rebuild.
//
// See web/lib/launch-state.ts for the file-resolution + safe-default
// behavior and the operator flip commands.

import { NextResponse } from "next/server";
import { readLaunchState } from "@/lib/launch-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const data = readLaunchState();
  return NextResponse.json(data, {
    headers: {
      // Never cache. the whole point is instant rollback.
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
