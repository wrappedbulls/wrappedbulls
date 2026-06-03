// /api/factory/activity
//
// Returns a snapshot of recent Factory activity:
//   - newest deployments (sorted by WrappedCollection.created_at desc)
//   - newest wraps      (sorted by BullAsset.wrapped_at desc, across all collections)
//
// This is a SNAPSHOT, not a true event stream. Unwraps don't appear here
// because they close their BullAsset (which is the only on-chain record
// of a wrap). Tracking unwraps would require parsing tx logs via
// getSignaturesForAddress + getTransaction, which is rate-limit-heavy
// against public RPCs; deferred to V2.
//
// The embeddable widget at /embed.js polls this endpoint every 30s and
// renders the freshest items. Cache header is no-store so polling clients
// always see the latest.

import { NextRequest, NextResponse } from "next/server";
import {
  fetchAllWrappedCollections,
  getConnection,
  getFactoryProgramId,
} from "@/lib/factory";
import { PublicKey } from "@solana/web3.js";
import { cacheWrapSWR } from "@/lib/cache";

// H1 fix: cache both bulk getProgramAccounts calls. /embed.js polls every
// 30s per widget; without caching every poll hits Helius. 30s TTL keeps
// activity feeling live while collapsing concurrent polls.
const ACTIVITY_CACHE_MS = 30_000;

export const dynamic = "force-dynamic";

interface DeployEvent {
  kind: "deploy";
  name: string;
  ticker: string;
  tokenMint: string;
  deployer: string;
  createdAt: number; // unix seconds
}

interface WrapEvent {
  kind: "wrap";
  tierIndex: number;
  nftMint: string;
  collectionName: string;
  collectionTicker: string;
  tokenMint: string;
  wrappedAt: number;
}

type Event = DeployEvent | WrapEvent;

export async function GET(req: NextRequest) {
  const conn = getConnection();
  const programId = getFactoryProgramId();

  // Optional: filter to a specific deployment by ?ticker= or ?mint=
  const tickerFilter = req.nextUrl.searchParams.get("ticker")?.toUpperCase() ?? null;
  const mintFilter = req.nextUrl.searchParams.get("mint") ?? null;
  const limit = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get("limit") || "20", 10), 1),
    100,
  );

  let collections;
  try {
    collections = await cacheWrapSWR(
      "factory-collections",
      "all",
      { ttlMs: ACTIVITY_CACHE_MS },
      () => fetchAllWrappedCollections(conn),
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message, code: "rpc_error" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  // Apply filter if any.
  if (tickerFilter) {
    collections = collections.filter((c) => c.ticker.toUpperCase() === tickerFilter);
  }
  if (mintFilter) {
    collections = collections.filter((c) => c.tokenMint.toBase58() === mintFilter);
  }

  // Collect deploy events.
  const events: Event[] = [];
  for (const c of collections) {
    events.push({
      kind: "deploy",
      name: c.name,
      ticker: c.ticker,
      tokenMint: c.tokenMint.toBase58(),
      deployer: c.deployer.toBase58(),
      createdAt: Number(c.createdAt),
    });
  }

  // Collect wrap events by reading BullAsset PDAs. Cheaper than scanning
  // all program accounts twice: we filter getProgramAccounts by the
  // BullAsset size to only get those records. Size = 8 + 32 + 2 + 8 + 1 = 51.
  try {
    const bullAssets = await cacheWrapSWR(
      "factory-bull-assets",
      "all",
      { ttlMs: ACTIVITY_CACHE_MS },
      () => conn.getProgramAccounts(programId, {
        commitment: "confirmed",
        filters: [{ dataSize: BULL_ASSET_SIZE }],
      }),
    );
    for (const ba of bullAssets) {
      const d = ba.account.data;
      // 8 disc + nft_mint(32) + tier(u16) + wrapped_at(i64) + bump(1)
      const nftMint = new PublicKey(d.slice(8, 40)).toBase58();
      const tierIndex = d.readUInt16LE(40);
      const wrappedAt = Number(d.readBigInt64LE(42));

      // Resolve the parent collection from the PDA seeds. BullAsset PDA =
      // ["bull", token_mint, tier_index_le], so we can't recover the token
      // mint from the BullAsset alone. We have to match against our known
      // collections by checking if the PDA derives from one of them.
      let parent = null;
      for (const c of collections) {
        const expectedSeed = derive("bull", c.tokenMint, tierIndex, programId);
        if (expectedSeed.equals(ba.pubkey)) {
          parent = c;
          break;
        }
      }
      if (!parent) continue; // belongs to a collection not in our filter
      events.push({
        kind: "wrap",
        tierIndex,
        nftMint,
        collectionName: parent.name,
        collectionTicker: parent.ticker,
        tokenMint: parent.tokenMint.toBase58(),
        wrappedAt,
      });
    }
  } catch (e) {
    // Soft-fail: if BullAsset scan fails, we still return the deploy events.
    // The widget surfaces a warning but doesn't break.
    return NextResponse.json(
      {
        ok: true,
        events: events.sort((a, b) => eventTime(b) - eventTime(a)).slice(0, limit),
        warning: `bull_asset scan failed: ${(e as Error).message}`,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  // Sort everything by time (most recent first) and trim to `limit`.
  events.sort((a, b) => eventTime(b) - eventTime(a));
  return NextResponse.json(
    { ok: true, events: events.slice(0, limit) },
    { headers: { "cache-control": "no-store" } },
  );
}

function eventTime(e: Event): number {
  return e.kind === "deploy" ? e.createdAt : e.wrappedAt;
}

// Mirrors state.rs BullAsset::SIZE.
const BULL_ASSET_SIZE = 8 + 32 + 2 + 8 + 1;

// Re-derive a BullAsset PDA for matching against found accounts. Saves
// us from including the bullAssetPda helper that requires a PublicKey
// parameter.
function derive(seedTag: string, tokenMint: PublicKey, tierIndex: number, programId: PublicKey): PublicKey {
  const tierBuf = Buffer.alloc(2);
  tierBuf.writeUInt16LE(tierIndex, 0);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(seedTag), tokenMint.toBuffer(), tierBuf],
    programId,
  );
  return pda;
}
