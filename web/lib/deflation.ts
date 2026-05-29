// Shared Vault Deflation stats. Used by both the /deflation page (initial
// server render) and the /api/deflation endpoint (client polling), so the
// numbers match and there is one place to change the math.
//
// Chain reads are protected by the in-process cache: a 15s window with
// single-flight + stale-while-revalidate means many viewers polling share a
// single chain read, and an RPC blip serves the last good value. Total supply
// is fixed for a pump.fun token (mint authority revoked), so it is cached for
// an hour and effectively constant.

import { fetchBullBank, getConnection } from "@/lib/chain";
import { LAUNCH_CONFIG } from "@/lib/launch-config.generated";
import { cacheWrap, cacheWrapSWR } from "@/lib/cache";

const TOKENS_PER_BULL = LAUNCH_CONFIG.supply.tokensPerNft;
const MAX_SUPPLY = LAUNCH_CONFIG.supply.maxSupply;
const FALLBACK_TOTAL_SUPPLY = 1_000_000_000;

export interface DeflationStats {
  inCirculation: number;
  totalWrapped: number;
  totalUnwrapped: number;
  lockedTokens: number;
  totalSupply: number;
  pctLocked: number;
  slotsFilled: number;
  slotsRemaining: number;
  ts: number;
}

async function computeStats(): Promise<DeflationStats | null> {
  const conn = getConnection();
  const bank = await fetchBullBank(conn);
  if (!bank) return null;

  // Supply is constant for a pump.fun token; cache it long so the live poll
  // only ever re-reads the bank counter.
  const totalSupply = await cacheWrap("deflation", "supply", 3_600_000, async () => {
    try {
      const s = await conn.getTokenSupply(bank.tokenMint, "confirmed");
      return s.value.uiAmount && s.value.uiAmount > 0
        ? s.value.uiAmount
        : FALLBACK_TOTAL_SUPPLY;
    } catch {
      return FALLBACK_TOTAL_SUPPLY;
    }
  });

  const lockedTokens = bank.inCirculation * TOKENS_PER_BULL;
  const pctLocked = totalSupply > 0 ? (lockedTokens / totalSupply) * 100 : 0;

  return {
    inCirculation: bank.inCirculation,
    totalWrapped: Number(bank.totalWrapped),
    totalUnwrapped: Number(bank.totalUnwrapped),
    lockedTokens,
    totalSupply,
    pctLocked,
    slotsFilled: bank.inCirculation,
    slotsRemaining: Math.max(0, MAX_SUPPLY - bank.inCirculation),
    ts: Date.now(),
  };
}

export async function loadDeflationStats(): Promise<DeflationStats | null> {
  return cacheWrapSWR(
    "deflation",
    "stats",
    { ttlMs: 15_000, negativeTtlMs: 5_000 },
    computeStats,
  );
}
