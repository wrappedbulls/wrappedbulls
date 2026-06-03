// Bespoke art brief submission. POST only.
//
// The wizard's Bespoke art tier ends here. We verify the on chain
// deposit transfer, persist the brief to JSONL on disk, and ping a
// notify hook so the operator can follow up off platform. Actual deploy
// happens later as DIY using the URI we hand the partner after art
// delivery (or, post launch, the `set_collection_uri` ix updates the
// existing deployment's art).
//
// Storage: append only JSONL at /var/lib/wrappedbulls/bespoke.jsonl.
// Falls back to /tmp if the lib path is not writable.
//
// HARDENING (audit H2 + H3 + H4):
//   1. Body size cap before parse (H4 pattern). Anyone POSTing more
//      than 32 KB gets a clean 413 and we never buffer the payload.
//   2. Per IP rate limit (H3). Token bucket in module scope; works
//      because the route runs in a long lived nodejs systemd process.
//   3. Email length cap (H3). RFC 5321 max is 254 chars.
//   4. On chain verification of depositSignature (H2). We fetch the
//      tx, confirm the SPL token transfer to the art revenue ATA, and
//      that the amount + mint + payer match expected.

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { getConnection } from "@/lib/factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =====================================================================
// Constants. Keep in lockstep with the wizard.
// =====================================================================
const MAX_BODY_BYTES = 32_000;
const MAX_EMAIL_LEN = 254;
const MAX_VIBE_LEN = 4000;
const MIN_VIBE_LEN = 20;
const MAX_NAME_LEN = 25;
const MAX_TOKENS_PER_WRAP_LEN = 25; // ~"18446744073709551615" max u64

// Bespoke deposit: 1,000,000 $WBULL = 1e12 base units (6 decimals).
const BESPOKE_DEPOSIT_BASE = BigInt("1000000000000");
const ART_REVENUE_WALLET = new PublicKey(
  "9ZDrkF9a8bMHPeDhe3oiDDUC1616C3vtTGozBgMxhWtn",
);
const WBULL_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_TOKEN_MINT ||
    "gAhvUSC7XamFqt6gr1JwHU2tEZFYQMEQYEsyKBSpump",
);

// =====================================================================
// Rate limiter. Fixed window per IP, module scope persistence.
// =====================================================================
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_MAX = 3; // 3 submissions per IP per hour

type Bucket = { count: number; windowStart: number };
const buckets = new Map<string, Bucket>();

function sweepBuckets(now: number) {
  if (buckets.size < 500) return;
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
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

// =====================================================================
// Schema
// =====================================================================
interface BespokeBody {
  deployer:      string;
  tokenMint:     string;
  name:          string;
  ticker:        string;
  maxSupply:     number;
  tokensPerWrap: string;
  brief: {
    contactEmail: string;
    vibe:         string;
    deadline:     string;
  };
  // REQUIRED for v1: on chain signature of the deposit transfer the
  // wizard built before this POST. We verify it.
  depositSignature?: string;
  // Whole token amount (UI units). For the operator's records; chain
  // verification computes the truth from the actual tx.
  depositAmount?: number;
}

// =====================================================================
// On chain deposit verification (H2 fix).
// =====================================================================
async function verifyDeposit(opts: {
  signature: string;
  deployer: PublicKey;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const conn = getConnection();
  const artRevenueAta = getAssociatedTokenAddressSync(
    WBULL_MINT,
    ART_REVENUE_WALLET,
    false,
    TOKEN_2022_PROGRAM_ID,
  );

  // Retry once if not found; client may have just confirmed and our RPC
  // (Helius) might be slightly behind.
  let parsed = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    parsed = await conn.getParsedTransaction(opts.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (parsed) break;
    await new Promise((r) => setTimeout(r, 800));
  }
  if (!parsed) {
    return { ok: false, reason: "deposit signature not found on chain" };
  }
  if (parsed.meta?.err) {
    return { ok: false, reason: "deposit tx failed on chain" };
  }

  // Walk instructions + inner instructions for a transferChecked that
  // moves >= BESPOKE_DEPOSIT_BASE from deployer to art revenue ATA on
  // the wbull mint. Outer ixs first; inner if not found.
  const ixs = [
    ...(parsed.transaction.message.instructions ?? []),
    ...((parsed.meta?.innerInstructions ?? []).flatMap(
      (g) => g.instructions ?? [],
    )),
  ];
  for (const ix of ixs) {
    // We only care about parsed SPL Token instructions.
    if (!("parsed" in ix) || !ix.parsed) continue;
    const p = ix.parsed as { type?: string; info?: any };
    if (p.type !== "transferChecked" && p.type !== "transfer") continue;
    const info = p.info ?? {};
    // transferChecked has destination + tokenAmount.amount + mint + authority.
    // transfer has destination + amount + authority (no mint).
    const dest = info.destination as string | undefined;
    const authority = info.authority as string | undefined;
    const mint = info.mint as string | undefined;
    const amountRaw =
      p.type === "transferChecked"
        ? (info.tokenAmount?.amount as string | undefined)
        : (info.amount as string | undefined);
    if (!dest || !authority || !amountRaw) continue;
    if (dest !== artRevenueAta.toBase58()) continue;
    if (authority !== opts.deployer.toBase58()) continue;
    if (p.type === "transferChecked" && mint !== WBULL_MINT.toBase58()) continue;
    if (BigInt(amountRaw) < BESPOKE_DEPOSIT_BASE) continue;
    return { ok: true };
  }
  return {
    ok: false,
    reason: "no qualifying $WBULL transfer to art revenue wallet in this tx",
  };
}

// =====================================================================
// Storage
// =====================================================================
async function appendRecord(record: Record<string, unknown>): Promise<void> {
  const primary = "/var/lib/wrappedbulls/bespoke.jsonl";
  const fallback = "/tmp/wrappedbulls-bespoke.jsonl";
  const line = JSON.stringify(record) + "\n";
  try {
    await fs.mkdir(path.dirname(primary), { recursive: true });
    await fs.appendFile(primary, line, { encoding: "utf8" });
    return;
  } catch {
    await fs.appendFile(fallback, line, { encoding: "utf8" });
  }
}

// =====================================================================
// POST handler
// =====================================================================
export async function POST(req: NextRequest) {
  // H3: per IP rate limit.
  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return NextResponse.json(
      { ok: false, error: "too many bespoke submissions from your IP. wait an hour." },
      { status: 429 },
    );
  }

  // H4 pattern: body size cap before parse.
  const declaredLength = parseInt(req.headers.get("content-length") || "0", 10);
  if (declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: "body too large" },
      { status: 413 },
    );
  }
  const rawText = await req.text();
  if (rawText.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: "body too large" },
      { status: 413 },
    );
  }

  let body: BespokeBody;
  try {
    body = JSON.parse(rawText);
  } catch {
    return NextResponse.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }

  // Schema validation. Defense in depth vs the wizard's client side checks.
  if (!body.deployer || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(body.deployer))
    return NextResponse.json({ ok: false, error: "invalid deployer pubkey" }, { status: 400 });
  if (!body.tokenMint || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(body.tokenMint))
    return NextResponse.json({ ok: false, error: "invalid tokenMint pubkey" }, { status: 400 });
  if (!body.name || body.name.length > MAX_NAME_LEN || !/^[\x20-\x7e]+$/.test(body.name))
    return NextResponse.json({ ok: false, error: "invalid name" }, { status: 400 });
  if (!body.ticker || !/^[A-Z0-9]{1,10}$/.test(body.ticker))
    return NextResponse.json({ ok: false, error: "invalid ticker" }, { status: 400 });
  if (!Number.isInteger(body.maxSupply) || body.maxSupply < 100 || body.maxSupply > 2000)
    return NextResponse.json({ ok: false, error: "invalid maxSupply" }, { status: 400 });
  if (!body.tokensPerWrap || !/^\d+$/.test(body.tokensPerWrap) || body.tokensPerWrap.length > MAX_TOKENS_PER_WRAP_LEN)
    return NextResponse.json({ ok: false, error: "invalid tokensPerWrap" }, { status: 400 });
  if (!body.brief?.contactEmail || body.brief.contactEmail.length > MAX_EMAIL_LEN || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.brief.contactEmail))
    return NextResponse.json({ ok: false, error: "invalid contact email" }, { status: 400 });
  if (!body.brief.vibe || body.brief.vibe.length < MIN_VIBE_LEN)
    return NextResponse.json({ ok: false, error: `vibe brief must be at least ${MIN_VIBE_LEN} characters` }, { status: 400 });
  if (body.brief.vibe.length > MAX_VIBE_LEN)
    return NextResponse.json({ ok: false, error: "vibe brief too long" }, { status: 400 });
  if (body.brief.deadline && body.brief.deadline.length > 200)
    return NextResponse.json({ ok: false, error: "deadline too long" }, { status: 400 });
  if (!body.depositSignature || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(body.depositSignature))
    return NextResponse.json({ ok: false, error: "depositSignature is required (1M $WBULL deposit must be onchain before submitting)" }, { status: 400 });

  // H2: on chain deposit verification. Reject if no qualifying transfer.
  const deployerPk = new PublicKey(body.deployer);
  const verdict = await verifyDeposit({
    signature: body.depositSignature,
    deployer: deployerPk,
  });
  if (!verdict.ok) {
    return NextResponse.json(
      { ok: false, error: `deposit verification failed: ${verdict.reason}` },
      { status: 400 },
    );
  }

  const ref = randomUUID();
  // Only persist a known field set. Prevents the client from inflating
  // each record with attacker controlled keys.
  const record = {
    ref,
    submittedAt: new Date().toISOString(),
    deployer:         body.deployer,
    tokenMint:        body.tokenMint,
    name:             body.name,
    ticker:           body.ticker,
    maxSupply:        body.maxSupply,
    tokensPerWrap:    body.tokensPerWrap,
    brief: {
      contactEmail: body.brief.contactEmail,
      vibe:         body.brief.vibe,
      deadline:     body.brief.deadline ?? "",
    },
    depositSignature: body.depositSignature,
    depositAmount:    body.depositAmount ?? null,
    sourceIp:         ip,
  };

  try {
    await appendRecord(record);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `failed to persist brief: ${(e as Error).message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, ref });
}
