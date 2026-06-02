// EconomyLive: small client island that polls /api/economy every 30s and
// swaps in the latest numbers without a full page reload. Same pattern as
// /deflation/DeflationLive.tsx.
//
// Only the *number cells* re-render -- the surrounding markup is the
// server-rendered initial paint, so first load is fast and the live update
// is invisible (the numbers just tick).

"use client";

import { useEffect, useState } from "react";
import type { EconomyStats } from "@/lib/economy";

interface Props {
  initial: EconomyStats;
}

// Format a base-unit bigint string into a human number with $WBULL decimals.
// e.g. "1000000000000" with 6 decimals -> "1,000,000"
function formatUi(baseUnits: string, decimals: number): string {
  let s = baseUnits;
  if (s === "0") return "0";
  // Pad with leading zeros so slicing works for small numbers.
  while (s.length <= decimals) s = "0" + s;
  const whole = s.slice(0, s.length - decimals);
  // We display rounded-to-whole; the fractional part is irrelevant at these scales.
  let out = "";
  for (let i = 0; i < whole.length; i++) {
    if (i > 0 && (whole.length - i) % 3 === 0) out += ",";
    out += whole[i];
  }
  return out;
}

export default function EconomyLive({ initial }: Props) {
  const [stats, setStats] = useState<EconomyStats>(initial);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/economy", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as EconomyStats;
        if (alive) setStats(j);
      } catch { /* swallow transient errors; next tick retries */ }
    };
    const id = setInterval(tick, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const w = stats.wbull;
  const p = stats.protocol;

  // Compute the four slice percentages for the pie + bar visualization.
  const total = BigInt(w.totalSupply);
  const lockedBulls = BigInt(w.lockedInWrappedBulls);
  const treasury = BigInt(w.treasuryBalance);
  const liquid = BigInt(w.liquid);

  const slices = [
    { label: "LIQUID", value: liquid, color: "#d4a017" },
    { label: "LOCKED IN BULLS", value: lockedBulls, color: "#0a6b2c" },
    { label: "BULL TREASURY", value: treasury, color: "#0a0a0a" },
  ];
  // Percentages, scale to 4 decimals so they round consistently.
  const pcts = slices.map((s) => {
    if (total === 0n) return 0;
    return Number(s.value * 10_000n / total) / 100; // pct, e.g. 12.34
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* ============= $WBULL pie / bar ============= */}
      <div className="card" style={{ padding: 24 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--bull-dim)", marginBottom: 12 }}>
          $WBULL · 1,000,000,000 total · fixed supply
        </div>

        {/* Bar (simpler than pie; reads well at any size) */}
        <div
          style={{
            display: "flex",
            height: 36,
            border: "2px solid var(--bull-ink)",
            marginBottom: 16,
            overflow: "hidden",
          }}
        >
          {slices.map((s, i) => (
            <div
              key={s.label}
              style={{
                width: `${pcts[i]}%`,
                background: s.color,
                minWidth: pcts[i] > 0 ? 4 : 0,
              }}
              title={`${s.label}: ${pcts[i].toFixed(2)}%`}
            />
          ))}
        </div>

        {/* Legend with live numbers */}
        <div style={{ display: "grid", gap: 12 }}>
          {slices.map((s, i) => (
            <div key={s.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--bull-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                <span style={{ display: "inline-block", width: 12, height: 12, background: s.color }} />
                {s.label}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                  {formatUi(s.value.toString(), w.decimals)} $WBULL
                </div>
                <div style={{ fontSize: 11, color: "var(--bull-dim)" }}>
                  {pcts[i].toFixed(2)}% of supply
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "2px dashed var(--bull-soft)", display: "flex", justifyContent: "space-between" }}>
          <div style={{ fontSize: 12, color: "var(--bull-dim)" }}>
            Total off-market (locked + treasury):
          </div>
          <div style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
            {(w.pctLockedOrTreasury * 100).toFixed(2)}%
          </div>
        </div>
      </div>

      {/* ============= Bull Treasury breakdown ============= */}
      <div className="card" style={{ padding: 24 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--bull-dim)", marginBottom: 12 }}>
          Bull Treasury · funded by every Factory deployment
        </div>

        <Row label="CLAIMABLE (multisig sweepable)" value={`${formatUi(w.treasuryClaimable, w.decimals)} $WBULL`} gold />
        <Row label="PENDING (7-day lock)"           value={`${formatUi(w.treasuryPending, w.decimals)} $WBULL`} />
        <Row label="LIFETIME DEPOSITED (monotonic)" value={`${formatUi(w.treasuryLifetimeDeposited, w.decimals)} $WBULL`} />
        <Row label="LIFETIME CLAIMED"               value={`${formatUi(w.treasuryLifetimeClaimed, w.decimals)} $WBULL`} />

        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px dashed var(--bull-soft)" }}>
          <Row label="CURRENT VAULT BALANCE" value={`${formatUi(w.treasuryBalance, w.decimals)} $WBULL`} bold />
        </div>
      </div>

      {/* ============= Protocol counters ============= */}
      <div className="card" style={{ padding: 24, gridColumn: "1 / -1" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--bull-dim)", marginBottom: 12 }}>
          Protocol activity · across WrappedBulls + every Factory deployment
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="WrappedBulls live" value={p.wrappedBullsInCirculation.toLocaleString()} sub={`of 1,000 capacity`} />
          <Stat label="WrappedBulls lifetime wraps" value={p.wrappedBullsLifetimeWraps} sub={`${p.wrappedBullsLifetimeUnwraps} unwraps`} />
          <Stat label="Factory deployments" value={p.factoryDeploymentCount.toLocaleString()} sub="permissionless launches" />
          <Stat label="Factory NFTs live" value={p.factoryNftsInCirculation.toLocaleString()} sub={`across ${p.factoryDeploymentCount} deployments`} />
        </div>
      </div>

      {/* ============= Per-deployment table ============= */}
      <div className="card" style={{ padding: 0, gridColumn: "1 / -1", overflow: "hidden" }}>
        <div style={{ padding: 24, paddingBottom: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--bull-dim)" }}>
            Tokens locked per Factory deployment
          </div>
          <div style={{ fontSize: 12, color: "var(--bull-dim)", marginTop: 4 }}>
            Each deployment custodies its own token mint; the locked amounts can&apos;t be summed across different tokens. Sorted by tokens locked (descending).
          </div>
        </div>
        {stats.deployments.length === 0 ? (
          <div style={{ padding: 24, paddingTop: 0, color: "var(--bull-dim)", fontSize: 13 }}>
            no Factory deployments yet.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--bull-very-soft)", textAlign: "left" }}>
                <Th>name</Th>
                <Th>ticker</Th>
                <Th>token</Th>
                <Th align="right">in circulation</Th>
                <Th align="right">tokens locked</Th>
              </tr>
            </thead>
            <tbody>
              {stats.deployments.map((d) => (
                <tr key={d.tokenMint} style={{ borderTop: "1px dashed var(--bull-soft)" }}>
                  <Td bold>{d.name}</Td>
                  <Td>${d.ticker}</Td>
                  <Td><code style={{ fontSize: 11 }}>{d.tokenMint.slice(0, 8)}…{d.tokenMint.slice(-4)}</code></Td>
                  <Td align="right">{d.inCirculation} / {d.maxSupply}</Td>
                  <Td align="right" mono>{formatUi(d.tokensLocked, 6 /* assume 6 decimals for pump.fun tokens */)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ gridColumn: "1 / -1", fontSize: 11, color: "var(--bull-dim)", textAlign: "right" }}>
        Auto-refreshes every 30s · last update {new Date(stats.ts).toLocaleTimeString()}
      </div>
    </div>
  );
}

// =====================================================================
// Helpers
// =====================================================================
function Row({ label, value, gold, bold }: { label: string; value: string; gold?: boolean; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 0" }}>
      <div style={{ fontSize: 11, color: "var(--bull-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div
        style={{
          fontWeight: bold || gold ? 800 : 600,
          fontVariantNumeric: "tabular-nums",
          color: gold ? "#d4a017" : undefined,
          fontSize: bold ? 18 : 14,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--bull-dim)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, fontVariantNumeric: "tabular-nums", marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--bull-dim)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th style={{ padding: "10px 16px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--bull-dim)", textAlign: align ?? "left", fontWeight: 800 }}>
      {children}
    </th>
  );
}

function Td({ children, mono, bold, align }: { children: React.ReactNode; mono?: boolean; bold?: boolean; align?: "left" | "right" }) {
  return (
    <td style={{
      padding: "10px 16px",
      fontFamily: mono ? "inherit" : undefined,
      fontVariantNumeric: mono ? "tabular-nums" : undefined,
      fontWeight: bold ? 700 : undefined,
      textAlign: align ?? "left",
    }}>
      {children}
    </td>
  );
}
