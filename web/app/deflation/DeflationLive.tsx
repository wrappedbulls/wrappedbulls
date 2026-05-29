"use client";

// Live numbers for the Vault Deflation dashboard. Seeded with the server
// rendered values so the first paint is instant and accurate, then polls
// /api/deflation every 30s and updates ONLY these figures in place. No full
// page reload, no scroll jump. On a failed poll it keeps the last good values
// and never flashes an error or a zero.

import { useEffect, useState } from "react";
import type { DeflationStats } from "@/lib/deflation";

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export default function DeflationLive({
  initial,
  ticker,
  maxSupply,
}: {
  initial: DeflationStats;
  ticker: string;
  maxSupply: number;
}) {
  const [stats, setStats] = useState<DeflationStats>(initial);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/deflation", { cache: "no-store" });
        if (!r.ok) return; // keep last good values
        const data = await r.json();
        if (alive && data && typeof data.pctLocked === "number") {
          setStats(data as DeflationStats);
        }
      } catch {
        // network blip: keep showing the last good numbers
      }
    };
    const id = setInterval(poll, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <>
      {/* HERO: percent of supply locked */}
      <div className="card mb-6 text-center py-12">
        <div className="text-xs uppercase tracking-wider text-[var(--bull-dim)] mb-3">
          ${ticker} supply locked in vaults
        </div>
        <div
          className="font-extrabold leading-none text-[var(--bull-accent)]"
          style={{ fontSize: "clamp(48px, 12vw, 110px)" }}
        >
          {stats.pctLocked.toFixed(2)}%
        </div>
        <div className="text-[var(--bull-dim)] mt-4 text-sm">
          {fmt(stats.lockedTokens)} ${ticker} sealed away and out of circulation
        </div>
      </div>

      {/* STAT GRID */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <Stat label="Locked in vaults" value={fmt(stats.lockedTokens)} sub={`$${ticker}`} />
        <Stat label="Bulls in circulation" value={`${stats.slotsFilled}`} sub={`of ${maxSupply} max`} />
        <Stat label="Slots remaining" value={fmt(stats.slotsRemaining)} sub="open to wrap" />
        <Stat label="Herd floor" value={fmt(stats.lockedTokens)} sub={`$${ticker} redeemable backing`} />
        <Stat label="Total wrapped" value={fmt(stats.totalWrapped)} sub="lifetime" />
        <Stat label="Total unwrapped" value={fmt(stats.totalUnwrapped)} sub="lifetime" />
      </div>
    </>
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
