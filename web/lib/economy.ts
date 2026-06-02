// Shared $WBULL economy + protocol stats.
//
// Aggregates the full state of the wrappedbulls product family in one
// chain-read pass:
//   - wrappedbulls program (BullBank: in_circulation, lifetime wraps/unwraps)
//   - WrappedFactory (FactoryConfig + BullTreasuryState + all WrappedCollections)
//
// Same single-flight + stale-while-revalidate caching as lib/deflation.ts:
// many viewers polling /api/economy share a single chain read window, RPC
// blips serve last-good values.

import { fetchBullBank, getConnection as getBullsConnection } from "@/lib/chain";
import {
  fetchFactoryConfig,
  fetchBullTreasuryState,
  fetchAllWrappedCollections,
  getConnection as getFactoryConnection,
  type WrappedCollection,
} from "@/lib/factory";
import { LAUNCH_CONFIG } from "@/lib/launch-config.generated";
import { cacheWrapSWR } from "@/lib/cache";

const TOKENS_PER_BULL = LAUNCH_CONFIG.supply.tokensPerNft; // base units, 1M * 10^6
const FALLBACK_TOTAL_SUPPLY = BigInt(1_000_000_000) * BigInt(1_000_000); // 1B with 6 decimals
const WBULL_DECIMALS = 6;

export interface DeploymentRow {
  tokenMint:      string;
  name:           string;
  ticker:         string;
  inCirculation:  number;
  maxSupply:      number;
  tokensLocked:   string; // bigint as string for JSON
}

export interface EconomyStats {
  // $WBULL (the native token, custodied by both wrappedbulls + factory treasury)
  wbull: {
    totalSupply:                string;
    decimals:                   number;
    lockedInWrappedBulls:       string;
    treasuryClaimable:          string;
    treasuryPending:            string;
    treasuryBalance:            string; // claimable + pending == current vault balance
    treasuryLifetimeDeposited:  string;
    treasuryLifetimeClaimed:    string;
    liquid:                     string; // totalSupply - locked - treasury
    pctLockedOrTreasury:        number; // (locked + treasury) / totalSupply, [0..1]
  };
  // Cross-protocol counters (counts, not token amounts)
  protocol: {
    wrappedBullsInCirculation:    number;
    wrappedBullsLifetimeWraps:    string;
    wrappedBullsLifetimeUnwraps:  string;
    factoryDeploymentCount:       number;
    factoryNftsInCirculation:     number;
    distinctTokensWrapped:        number;  // 1 (WrappedBulls itself) + Factory count
  };
  // One row per Factory deployment (NOT including original wrappedbulls).
  // Each row shows the deployment's *own* token + its locked amount.
  deployments: DeploymentRow[];
  ts: number;
}

// Single source of truth for the page + API.
export async function loadEconomyStats(): Promise<EconomyStats | null> {
  return cacheWrapSWR("economy", "stats", { ttlMs: 15_000, negativeTtlMs: 5_000 }, compute);
}

async function compute(): Promise<EconomyStats | null> {
  // Two connections because the wrappedbulls + factory libs ship their own
  // getConnection() helpers wrapping different env vars. In practice they
  // resolve to the same RPC URL, but we don't assume that.
  const bullsConn = getBullsConnection();
  const factoryConn = getFactoryConnection();

  const [bank, factoryCfg, treasury, factoryCollections] = await Promise.all([
    fetchBullBank(bullsConn).catch(() => null),
    fetchFactoryConfig(factoryConn).catch(() => null),
    fetchBullTreasuryState(factoryConn).catch(() => null),
    fetchAllWrappedCollections(factoryConn).catch(() => [] as WrappedCollection[]),
  ]);

  if (!bank) return null;

  // ---- $WBULL math ----
  const lockedInWrappedBulls =
    BigInt(bank.inCirculation) * BigInt(TOKENS_PER_BULL);

  // Treasury claimable + pending. If the Factory isn't initialized yet on
  // this cluster, everything's zero.
  let treasuryClaimable = 0n;
  let treasuryPending = 0n;
  let treasuryLifetimeDeposited = 0n;
  let treasuryLifetimeClaimed = 0n;
  if (treasury) {
    treasuryClaimable = treasury.claimable;
    treasuryPending = treasury.pending.reduce(
      (sum, e) => sum + e.amount,
      0n,
    );
    treasuryLifetimeDeposited = treasury.lifetimeDeposited;
    treasuryLifetimeClaimed = treasury.lifetimeClaimed;
  }
  const treasuryBalance = treasuryClaimable + treasuryPending;

  const totalSupply = FALLBACK_TOTAL_SUPPLY;
  const liquid = totalSupply - lockedInWrappedBulls - treasuryBalance;
  const pctLockedOrTreasury =
    Number((lockedInWrappedBulls + treasuryBalance) * 10_000n / totalSupply) / 10_000;

  // ---- Factory aggregates ----
  let factoryNftsInCirculation = 0;
  const deployments: DeploymentRow[] = [];
  for (const c of factoryCollections) {
    factoryNftsInCirculation += c.inCirculation;
    deployments.push({
      tokenMint:      c.tokenMint.toBase58(),
      name:           c.name,
      ticker:         c.ticker,
      inCirculation:  c.inCirculation,
      maxSupply:      c.maxSupply,
      tokensLocked:   (BigInt(c.inCirculation) * c.tokensPerWrap).toString(),
    });
  }
  // Sort by tokens locked desc so the most-loaded deployments lead.
  deployments.sort((a, b) => {
    const al = BigInt(a.tokensLocked), bl = BigInt(b.tokensLocked);
    if (bl > al) return 1;
    if (bl < al) return -1;
    return 0;
  });

  return {
    wbull: {
      totalSupply:               totalSupply.toString(),
      decimals:                  WBULL_DECIMALS,
      lockedInWrappedBulls:      lockedInWrappedBulls.toString(),
      treasuryClaimable:         treasuryClaimable.toString(),
      treasuryPending:           treasuryPending.toString(),
      treasuryBalance:           treasuryBalance.toString(),
      treasuryLifetimeDeposited: treasuryLifetimeDeposited.toString(),
      treasuryLifetimeClaimed:   treasuryLifetimeClaimed.toString(),
      liquid:                    liquid.toString(),
      pctLockedOrTreasury,
    },
    protocol: {
      wrappedBullsInCirculation:   bank.inCirculation,
      wrappedBullsLifetimeWraps:   bank.totalWrapped.toString(),
      wrappedBullsLifetimeUnwraps: bank.totalUnwrapped.toString(),
      factoryDeploymentCount:      factoryCollections.length,
      factoryNftsInCirculation,
      distinctTokensWrapped:       1 + factoryCollections.length,
    },
    deployments,
    ts: Date.now(),
  };
}
