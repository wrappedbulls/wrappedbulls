// Same-origin RPC proxy. Forwards browser JSON-RPC POSTs to our paid
// Helius mainnet RPC (server-side env SOLANA_RPC_URL), then returns the
// response with CORS headers. Why this exists:
//   - Solana Labs' public RPC (api.mainnet-beta.solana.com) 403s many
//     user IPs/regions when called from a browser. That broke the wrap
//     flow: balance reads failed → page showed "Need 1M $WBULL" + 403.
//   - Routing through our own domain bypasses IP/region/CORS issues
//     because the browser is calling our domain, not Solana Labs.
//   - The Helius paid key stays server-only (systemd SOLANA_RPC_URL,
//     never NEXT_PUBLIC, never in the client bundle).
//
// HARDENING (P3.4) — the proxy spends our paid Helius credits, so it is
// abuse-attractive. Three guards:
//   1. Method allowlist — only the JSON-RPC methods the dApp actually
//      uses are forwarded. Anything else is rejected before it reaches
//      Helius, so nobody can point our key at expensive calls.
//   2. Per-IP rate limit — a fixed-window counter in module scope.
//      This works because the route runs under `runtime = "nodejs"`
//      in a long-lived systemd process (module state persists across
//      requests). It is a coarse abuse brake, not a precise quota.
//   3. Body size cap — reject oversized payloads outright.
// Plus lightweight in-memory metrics, exposed via GET for ops.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM =
  process.env.SOLANA_RPC_URL ||
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, solana-client",
  "Access-Control-Max-Age": "86400",
};

// --- Method allowlist ------------------------------------------------
// Every JSON-RPC method the dApp legitimately needs. A request whose
// method is not here is rejected without touching Helius. Reads + the
// two write-ish methods (sendTransaction, simulateTransaction). Notably
// ABSENT: getBlock(s), getBlockProduction, getLeaderSchedule, etc. —
// expensive calls we never make and do not want billed to our key.
const ALLOWED_METHODS = new Set<string>([
  "getAccountInfo",
  "getMultipleAccounts",
  "getBalance",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getTokenSupply",
  "getProgramAccounts",
  "getLatestBlockhash",
  "isBlockhashValid",
  "getSlot",
  "getBlockHeight",
  "getEpochInfo",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getTransaction",
  "getMinimumBalanceForRentExemption",
  "getFeeForMessage",
  "getRecentPrioritizationFees",
  "getHealth",
  "getVersion",
  "getGenesisHash",
  "sendTransaction",
  "simulateTransaction",
]);

// --- Rate limiter (fixed window, per IP, in module scope) ------------
const RATE_WINDOW_MS = Number(process.env.RPC_RATE_WINDOW_MS || 10_000);
const RATE_MAX = Number(process.env.RPC_RATE_MAX || 240);
const MAX_BODY_BYTES = Number(process.env.RPC_MAX_BODY_BYTES || 100_000);

type Bucket = { count: number; windowStart: number };
const buckets = new Map<string, Bucket>();

// Periodically drop stale buckets so the map cannot grow unbounded.
function sweepBuckets(now: number) {
  if (buckets.size < 5000) return;
  for (const [ip, b] of buckets) {
    if (now - b.windowStart > RATE_WINDOW_MS * 2) buckets.delete(ip);
  }
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  sweepBuckets(now);
  const b = buckets.get(ip);
  if (!b || now - b.windowStart >= RATE_WINDOW_MS) {
    buckets.set(ip, { count: 1, windowStart: now });
    return false;
  }
  b.count += 1;
  return b.count > RATE_MAX;
}

function clientIp(req: NextRequest): string {
  // Behind Caddy: real IP is the first entry of x-forwarded-for.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

// --- Metrics (in-memory, best-effort) --------------------------------
const metrics = {
  total: 0,
  forwarded: 0,
  rejectedMethod: 0,
  rejectedRate: 0,
  rejectedBadBody: 0,
  upstreamError: 0,
  startedAt: new Date().toISOString(),
};

// --- Helpers ---------------------------------------------------------
function jsonRpcError(
  code: number,
  message: string,
  id: unknown,
  httpStatus: number,
) {
  return NextResponse.json(
    { jsonrpc: "2.0", error: { code, message }, id: id ?? null },
    { status: httpStatus, headers: { ...CORS, "Cache-Control": "no-store" } },
  );
}

// A JSON-RPC payload is either one call or a batch (array). Returns the
// list of methods present, or null if the shape is invalid.
function extractMethods(payload: unknown): string[] | null {
  const one = (p: any): string | null =>
    p && typeof p === "object" && typeof p.method === "string" ? p.method : null;
  if (Array.isArray(payload)) {
    if (payload.length === 0) return null;
    const out: string[] = [];
    for (const item of payload) {
      const m = one(item);
      if (!m) return null;
      out.push(m);
    }
    return out;
  }
  const m = one(payload);
  return m ? [m] : null;
}

export async function POST(req: NextRequest) {
  metrics.total += 1;
  const ip = clientIp(req);

  // Guard 1: rate limit.
  if (rateLimited(ip)) {
    metrics.rejectedRate += 1;
    return jsonRpcError(-32029, "rate limit exceeded — slow down", null, 429);
  }

  // Read + size-cap the body.
  const body = await req.text();
  if (body.length > MAX_BODY_BYTES) {
    metrics.rejectedBadBody += 1;
    return jsonRpcError(-32600, "request body too large", null, 413);
  }

  // Parse + validate JSON-RPC shape.
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    metrics.rejectedBadBody += 1;
    return jsonRpcError(-32700, "parse error — body is not valid JSON", null, 400);
  }
  const methods = extractMethods(payload);
  if (!methods) {
    metrics.rejectedBadBody += 1;
    return jsonRpcError(-32600, "invalid JSON-RPC request", null, 400);
  }

  // Guard 2: method allowlist. Reject if ANY method in a batch is
  // disallowed — a batch is all-or-nothing.
  const bad = methods.find((m) => !ALLOWED_METHODS.has(m));
  if (bad) {
    metrics.rejectedMethod += 1;
    return jsonRpcError(
      -32601,
      `method '${bad}' is not permitted through this proxy`,
      null,
      403,
    );
  }

  // Forward to Helius.
  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
    });
    const text = await upstream.text();
    metrics.forwarded += 1;
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        ...CORS,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    metrics.upstreamError += 1;
    return jsonRpcError(
      -32603,
      e?.message || "rpc proxy upstream failed",
      null,
      502,
    );
  }
}

// GET — lightweight metrics snapshot for ops / the /status page.
// Not sensitive (counts only) but not cached.
export async function GET() {
  return NextResponse.json(
    {
      ...metrics,
      activeRateBuckets: buckets.size,
      config: {
        rateWindowMs: RATE_WINDOW_MS,
        rateMax: RATE_MAX,
        maxBodyBytes: MAX_BODY_BYTES,
        allowedMethods: ALLOWED_METHODS.size,
      },
    },
    { headers: { ...CORS, "Cache-Control": "no-store" } },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
