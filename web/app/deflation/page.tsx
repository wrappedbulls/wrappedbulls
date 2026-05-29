// /stats. The Vault Deflation dashboard.
//
// Makes the core mechanic legible and screenshot friendly: how much $WBULL is
// locked in vaults and out of circulation, what percent of total supply that
// is, the herd floor (redeemable backing), and the lifetime wrap counters.
// Server rendered against live chain state, same pattern as the homepage.

import Link from "next/link";
import { fetchBullBank, getConnection } from "@/lib/chain";
import { isPreLaunch } from "@/lib/launch-state";
import { LAUNCH_CONFIG } from "@/lib/launch-config.generated";

export const metadata = {
  title: "Vault Deflation · WrappedBulls",
  description:
    "Live Vault Deflation dashboard: how much $WBULL is locked in vaults and out of circulation, the percent of supply removed, and the herd floor.",
};

export const dynamic = "force-dynamic";

const TOKENS_PER_BULL = LAUNCH_CONFIG.supply.tokensPerNft; // 1,000,000
const MAX_SUPPLY = LAUNCH_CONFIG.supply.maxSupply; // 1,000 bulls
const TICKER = LAUNCH_CONFIG.project.ticker; // WBULL
// pump.fun standard total supply fallback if the live read fails.
const FALLBACK_TOTAL_SUPPLY = 1_000_000_000;

interface DeflationStats {
  inCirculation: number;
  totalWrapped: string;
  totalUnwrapped: string;
  lockedTokens: number; // whole $WBULL locked in vaults right now
  totalSupply: number; // whole $WBULL
  pctLocked: number; // percent of total supply locked
  slotsFilled: number;
  slotsRemaining: number;
}

async function loadStats(): Promise<DeflationStats | null> {
  try {
    const conn = getConnection();
    const bank = await fetchBullBank(conn);
    if (!bank) return null;

    let totalSupply = FALLBACK_TOTAL_SUPPLY;
    try {
      const supply = await conn.getTokenSupply(bank.tokenMint, "confirmed");
      const ui = supply.value.uiAmount;
      if (ui && ui > 0) totalSupply = ui;
    } catch {
      // keep fallback
    }

    const lockedTokens = bank.inCirculation * TOKENS_PER_BULL;
    const pctLocked = totalSupply > 0 ? (lockedTokens / totalSupply) * 100 : 0;

    return {
      inCirculation: bank.inCirculation,
      totalWrapped: bank.totalWrapped.toString(),
      totalUnwrapped: bank.totalUnwrapped.toString(),
      lockedTokens,
      totalSupply,
      pctLocked,
      slotsFilled: bank.inCirculation,
      slotsRemaining: Math.max(0, MAX_SUPPLY - bank.inCirculation),
    };
  } catch {
    return null;
  }
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export default async function StatsPage() {
  const preLaunch = isPreLaunch();
  const stats = preLaunch ? null : await loadStats();

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
      <div className="mb-10">
        <div className="text-xs uppercase tracking-[0.25em] text-[var(--bull-dim)] mb-3">
          $ ./vault-deflation
        </div>
        <h1 className="h1 mb-3">Vault Deflation</h1>
        <p className="text-[var(--bull-dim)] text-lg max-w-2xl">
          Every wrapped bull seals 1,000,000 ${TICKER} inside an onchain vault and
          pulls it out of circulation. The more bulls in the herd, the tighter the
          float. This is that mechanic, live.
        </p>
      </div>

      {preLaunch || !stats ? (
        <div className="card text-center py-16">
          <div className="text-2xl font-bold mb-2">
            {preLaunch ? "Goes live at launch" : "Live stats are warming up"}
          </div>
          <p className="text-[var(--bull-dim)]">
            {preLaunch
              ? "The dashboard activates the moment $WBULL launches and the program is initialized."
              : "Could not read chain state right now. Refresh in a moment."}
          </p>
        </div>
      ) : (
        <>
          {/* HERO: percent of supply locked */}
          <div className="card mb-6 text-center py-12">
            <div className="text-xs uppercase tracking-wider text-[var(--bull-dim)] mb-3">
              ${TICKER} supply locked in vaults
            </div>
            <div
              className="font-extrabold leading-none text-[var(--bull-accent)]"
              style={{ fontSize: "clamp(48px, 12vw, 110px)" }}
            >
              {stats.pctLocked.toFixed(2)}%
            </div>
            <div className="text-[var(--bull-dim)] mt-4 text-sm">
              {fmt(stats.lockedTokens)} ${TICKER} sealed away and out of circulation
            </div>
          </div>

          {/* STAT GRID */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
            <Stat label="Locked in vaults" value={`${fmt(stats.lockedTokens)}`} sub={`$${TICKER}`} />
            <Stat label="Bulls in circulation" value={`${stats.slotsFilled}`} sub={`of ${MAX_SUPPLY} max`} />
            <Stat label="Slots remaining" value={`${fmt(stats.slotsRemaining)}`} sub="open to wrap" />
            <Stat label="Herd floor" value={`${fmt(stats.lockedTokens)}`} sub={`$${TICKER} redeemable backing`} />
            <Stat label="Total wrapped" value={fmt(Number(stats.totalWrapped))} sub="lifetime" />
            <Stat label="Total unwrapped" value={fmt(Number(stats.totalUnwrapped))} sub="lifetime" />
          </div>

          <div className="card">
            <div className="text-[var(--bull-ink)] font-bold text-xs uppercase tracking-wider mb-2">
              How to read this
            </div>
            <p className="text-sm text-[var(--bull-dim)] leading-relaxed">
              Each bull is backed by exactly 1,000,000 ${TICKER} held in a vault whose
              authority is the NFT itself. That backing is redeemable: any holder can
              unwrap and pull the full 1,000,000 ${TICKER} back out, so every bull carries
              a hard floor it can never trade below. While a bull stays wrapped, its
              tokens are out of circulation. Vault Deflation is the net of it: the herd
              growing is the same event as ${TICKER} leaving the market.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/wrap" className="btn btn-primary">Wrap a bull</Link>
            <Link href="/gallery" className="btn btn-secondary">See the herd</Link>
          </div>
        </>
      )}
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card">
      <div className="text-xs uppercase text-[var(--bull-dim)] tracking-wider mb-1">{label}</div>
      <div className="text-2xl md:text-3xl font-extrabold text-[var(--bull-accent)] break-all">{value}</div>
      {sub && <div className="text-xs text-[var(--bull-dim)] mt-1">{sub}</div>}
    </div>
  );
}
