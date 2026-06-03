// /api/factory/check-name
//
// Wizard step 2 calls this to ensure the user's chosen `ticker` is not
// already in use by another live wrap layer. The on-chain program does
// NOT enforce ticker uniqueness (only the token_mint PDA is unique), so
// this is purely a UX gate to prevent two collections from advertising
// the same $SYMBOL on Magic Eden / Tensor.
//
// We do a one-shot getProgramAccounts scan filtered by dataSize so it
// only pulls WrappedCollection PDAs, then linearly check tickers. With
// the 2_000-supply cap and realistic Factory volume, this stays cheap.
// If volume gets large the future cache wrapper (lib/cache.ts) can
// memoize the ticker set with a short TTL.

import { NextRequest, NextResponse } from "next/server";
import { fetchAllWrappedCollections, getConnection } from "@/lib/factory";
import { cacheWrapSWR } from "@/lib/cache";

export const dynamic = "force-dynamic";

// H1 fix: cache the getProgramAccounts result for 60s. Single flight
// collapses concurrent requests into one RPC, SWR keeps responses fast
// even during refresh. Cost: a freshly deployed ticker takes up to 60s
// to show up as taken. Acceptable for a UX gate.
const CACHE_TTL_MS = 60_000;

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker")?.trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json(
      { ok: false, error: "ticker is required", code: "missing_ticker" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  // Reject obviously malformed tickers BEFORE hitting RPC -- the wizard's
  // client-side validation should catch these, but defense in depth keeps
  // a manual API caller from forcing a scan with garbage input.
  if (!/^[A-Z0-9]{1,10}$/.test(ticker)) {
    return NextResponse.json(
      {
        ok: false,
        error: "ticker must be 1-10 uppercase letters + digits",
        code: "invalid_ticker",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const conn = getConnection();
  let collections;
  try {
    collections = await cacheWrapSWR(
      "factory-collections",
      "all",
      { ttlMs: CACHE_TTL_MS },
      () => fetchAllWrappedCollections(conn),
    );
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: (e as Error).message || "rpc failure",
        code: "rpc_error",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const taken = collections.find(
    (c) => c.ticker.toUpperCase() === ticker,
  );
  if (taken) {
    return NextResponse.json(
      {
        ok: true,
        available: false,
        conflict: {
          name:      taken.name,
          ticker:    taken.ticker,
          deployer:  taken.deployer.toBase58(),
          tokenMint: taken.tokenMint.toBase58(),
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return NextResponse.json(
    { ok: true, available: true, ticker },
    { headers: { "cache-control": "no-store" } },
  );
}
