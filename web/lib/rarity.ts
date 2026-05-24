// Rarity computation across all currently-wrapped bulls.
// Single getProgramAccounts call gets every BullAsset; we derive traits
// from each nft_mint and build a histogram. Each bull's rarity score is
// sum(1/freq) across its 7 traits; lower freq = rarer = higher score.

import { Connection, PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain ESM
import { selectTraits, deriveSeed } from "@/lib/renderer.mjs";
import { cacheWrap } from "@/lib/cache";

const BULL_ASSET_DISCRIMINATOR = createHash("sha256")
  .update("account:BullAsset")
  .digest()
  .subarray(0, 8);

export interface BullRarity {
  tier: number;
  rank: number; // 1 = rarest
  total: number;
  score: number;
  perTrait: {
    [category: string]: { value: number; count: number; pct: number };
  };
}

interface BullEntry {
  tier: number;
  nftMint: string;
  traits: Record<string, number>;
}

const CATEGORIES = ["body", "horn", "eye", "bg", "acc", "eyewear", "mouth"] as const;

async function loadAllBulls(
  conn: Connection,
  programId: PublicKey
): Promise<BullEntry[]> {
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

  const out: BullEntry[] = [];
  for (const a of accounts) {
    const d = a.account.data;
    let off = 8;
    const nftMint = new PublicKey(d.slice(off, off + 32));
    off += 32;
    const tier = d.readUInt16LE(off);
    const seed = deriveSeed(nftMint.toBase58()) as Buffer;
    const traits = selectTraits(seed) as Record<string, number>;
    out.push({ tier, nftMint: nftMint.toBase58(), traits });
  }
  return out;
}

export async function getRarityForTier(
  conn: Connection,
  programId: PublicKey,
  tier: number
): Promise<BullRarity | null> {
  const all = await cacheWrap(
    "rarity-all",
    "v1",
    60_000,
    () => loadAllBulls(conn, programId)
  );
  const me = all.find((b) => b.tier === tier);
  if (!me) return null;

  // Histogram per category: how many bulls have each value
  const hist: Record<string, Map<number, number>> = {};
  for (const cat of CATEGORIES) hist[cat] = new Map();
  for (const b of all) {
    for (const cat of CATEGORIES) {
      const v = b.traits[cat];
      hist[cat].set(v, (hist[cat].get(v) || 0) + 1);
    }
  }

  // Per-trait rarity for this bull
  const total = all.length;
  const perTrait: BullRarity["perTrait"] = {};
  for (const cat of CATEGORIES) {
    const v = me.traits[cat];
    const count = hist[cat].get(v) || 1;
    perTrait[cat] = { value: v, count, pct: (count / total) * 100 };
  }

  // Score: sum of (1/freq) across categories. Higher = rarer.
  function score(b: BullEntry): number {
    let s = 0;
    for (const cat of CATEGORIES) {
      const v = b.traits[cat];
      const c = hist[cat].get(v) || 1;
      s += 1 / c;
    }
    return s;
  }

  const myScore = score(me);
  // Rank: count of bulls with strictly higher score, +1
  let rank = 1;
  for (const b of all) {
    if (b.tier === tier) continue;
    if (score(b) > myScore) rank++;
  }

  return {
    tier,
    rank,
    total,
    score: myScore,
    perTrait,
  };
}
