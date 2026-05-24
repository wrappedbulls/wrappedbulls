// GET /api/recently-wrapped?limit=5
// Returns the most recently wrapped WrappedBulls, newest first.
// Uses getProgramAccounts with the BullAsset discriminator filter to fetch
// all active bulls in one RPC, then sorts by wrapped_at descending.

import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { getConnection, getProgramId } from "@/lib/chain";
import { cacheWrap } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL_MS = 30_000;

// BullAsset 8-byte anchor discriminator. Anchor derives this from sha256("account:BullAsset")[..8].
// We pre-compute it once and use it as a memcmp filter in getProgramAccounts so
// we only fetch BullAsset accounts (not BullBank, not anything else).
import { createHash } from "node:crypto";
const BULL_ASSET_DISCRIMINATOR = createHash("sha256")
  .update("account:BullAsset")
  .digest()
  .subarray(0, 8);

interface RecentWrap {
  tier: number;
  nftMint: string;
  wrappedAt: number;
}

async function loadAll(conn: Connection, programId: PublicKey): Promise<RecentWrap[]> {
  const accounts = await conn.getProgramAccounts(programId, {
    commitment: "confirmed",
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: BULL_ASSET_DISCRIMINATOR.toString("base64"),
          encoding: "base64",
        },
      },
    ],
  });

  const out: RecentWrap[] = [];
  for (const a of accounts) {
    const d = a.account.data;
    let off = 8; // skip discriminator
    const nftMint = new PublicKey(d.slice(off, off + 32));
    off += 32;
    const tierIndex = d.readUInt16LE(off);
    off += 2;
    const wrappedAt = Number(d.readBigInt64LE(off));
    out.push({
      tier: tierIndex,
      nftMint: nftMint.toBase58(),
      wrappedAt,
    });
  }
  return out;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "5", 10)));

  const all = await cacheWrap(
    "recently-wrapped",
    "all",
    TTL_MS,
    async () => {
      const conn = getConnection();
      return await loadAll(conn, getProgramId());
    }
  );

  const sorted = [...all].sort((a, b) => b.wrappedAt - a.wrappedAt).slice(0, limit);

  return NextResponse.json(
    { count: all.length, recent: sorted },
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=30, s-maxage=30",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}
