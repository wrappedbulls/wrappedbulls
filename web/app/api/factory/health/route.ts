// /api/factory/health
//
// Machine readable health snapshot for the WrappedFactory. Mirrors the
// data surfaced on /launch/health but returns JSON so external monitors,
// uptime services, status pages, or operator scripts can poll without
// scraping HTML.
//
// Returns 200 with a snapshot under normal conditions, 503 if any
// critical read failed (FactoryConfig unreachable, treasury unreachable).
// The HTTP code lets uptime services trigger alerts.
//
// Cache: no-store. Polling callers should hit this no more than once a
// minute; we don't rate limit beyond what the underlying RPC layer
// imposes.

import { NextResponse } from "next/server";
import {
  fetchAllWrappedCollections,
  fetchBullTreasuryState,
  fetchFactoryConfig,
  getConnection,
  type WrappedCollection,
} from "@/lib/factory";

export const dynamic = "force-dynamic";

const PROGRAM_ID = "WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh";

interface HealthResponse {
  programId: string;
  cluster: "mainnet";
  factoryInitialized: boolean;
  paused: boolean;
  treasury: {
    reachable: boolean;
    claimable: string;
    lifetimeDeposited: string;
    lifetimeClaimed: string;
    pendingCount: number;
    pendingCap: number;
    queueWarning: boolean;
  } | null;
  activity: {
    totalDeployments: number;
    inCirculation: number;
    lifetimeWraps: number;
    lifetimeUnwraps: number;
    deploys24h: number;
    deploys7d: number;
  };
  snapshotAt: number;
}

export async function GET() {
  const conn = getConnection();
  const now = Math.floor(Date.now() / 1000);
  const DAY = 24 * 60 * 60;

  let cfg = null;
  let treasury = null;
  let collections: WrappedCollection[] = [];
  let degradedReason: string | null = null;

  try {
    [cfg, treasury, collections] = await Promise.all([
      fetchFactoryConfig(conn).catch(() => null),
      fetchBullTreasuryState(conn).catch(() => null),
      fetchAllWrappedCollections(conn).catch(() => [] as WrappedCollection[]),
    ]);
  } catch (e) {
    degradedReason = (e as Error).message;
  }

  if (!cfg) degradedReason = degradedReason ?? "factory_config unreachable";
  if (!treasury) degradedReason = degradedReason ?? "bull_treasury_state unreachable";

  const deploys24h = collections.filter(
    (c) => Number(c.createdAt) >= now - DAY,
  ).length;
  const deploys7d = collections.filter(
    (c) => Number(c.createdAt) >= now - 7 * DAY,
  ).length;
  const lifetimeWraps = collections.reduce(
    (sum, c) => sum + Number(c.totalWrapped),
    0,
  );
  const lifetimeUnwraps = collections.reduce(
    (sum, c) => sum + Number(c.totalUnwrapped),
    0,
  );
  const inCirculation = collections.reduce(
    (sum, c) => sum + c.inCirculation,
    0,
  );

  const PENDING_CAP = 256;
  const body: HealthResponse = {
    programId: PROGRAM_ID,
    cluster: "mainnet",
    factoryInitialized: cfg !== null,
    paused: cfg?.paused ?? false,
    treasury: treasury
      ? {
          reachable: true,
          claimable: treasury.claimable.toString(),
          lifetimeDeposited: treasury.lifetimeDeposited.toString(),
          lifetimeClaimed: treasury.lifetimeClaimed.toString(),
          pendingCount: treasury.pending.length,
          pendingCap: PENDING_CAP,
          queueWarning: treasury.pending.length > 200,
        }
      : null,
    activity: {
      totalDeployments: cfg?.totalDeployments ?? 0,
      inCirculation,
      lifetimeWraps,
      lifetimeUnwraps,
      deploys24h,
      deploys7d,
    },
    snapshotAt: now,
  };

  return NextResponse.json(body, {
    status: degradedReason ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
