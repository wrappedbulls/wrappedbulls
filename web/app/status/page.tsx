"use client";

// /status — operator + public status page. Reads /api/health (chain,
// process, launch state) and /api/rpc (proxy metrics) and renders them.
//
// WHY (docs/POSTMORTEM.md §10): during the last launch's 502 crisis
// there was no human-checkable status surface. Operators tailed
// systemd logs from each component. This page is the one URL to open
// when something looks wrong.
//
// Auto-refreshes every 15s. Client component so it stays live without
// a reload.

import { useEffect, useState, useCallback } from "react";

interface Health {
  ok: boolean;
  cluster?: string;
  version?: string;
  launchState?: string;
  tokenMint?: string | null;
  chain?: { ok: boolean; slot: number | null; rttMs: number; error: string | null };
  process?: { uptimeSec: number; rssMb: number; heapUsedMb: number; nodeVersion: string };
  timestamp?: string;
}

interface RpcMetrics {
  total: number;
  forwarded: number;
  rejectedMethod: number;
  rejectedRate: number;
  rejectedBadBody: number;
  upstreamError: number;
  startedAt: string;
  activeRateBuckets: number;
}

function dot(ok: boolean) {
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full"
      style={{ background: ok ? "var(--bull-success)" : "var(--bull-danger)" }}
    />
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-[#2a2a32] last:border-0">
      <span className="text-[var(--bull-dim)]">{label}</span>
      <span className="font-mono text-right break-all">{value}</span>
    </div>
  );
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function StatusPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [rpc, setRpc] = useState<RpcMetrics | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [hRes, rRes] = await Promise.allSettled([
        fetch("/api/health", { cache: "no-store" }),
        fetch("/api/rpc", { cache: "no-store" }),
      ]);
      if (hRes.status === "fulfilled") {
        setHealth(await hRes.value.json());
        setErr(null);
      } else {
        setErr("could not reach /api/health");
      }
      if (rRes.status === "fulfilled" && rRes.value.ok) {
        setRpc(await rRes.value.json());
      }
      setFetchedAt(new Date().toLocaleTimeString());
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const chainOk = !!health?.chain?.ok;
  const overallOk = !!health?.ok;

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
      <h1 className="h1 mb-2">System status</h1>
      <p className="text-[var(--bull-dim)] mb-8 text-sm">
        Live health of the site, the chain connection, and the RPC proxy.
        Auto-refreshes every 15s{fetchedAt && ` · last checked ${fetchedAt}`}.
      </p>

      {err && (
        <div className="card mb-6">
          <div className="flex items-center gap-2">
            {dot(false)}
            <span className="font-bold">Status endpoint unreachable</span>
          </div>
          <p className="text-[var(--bull-dim)] text-sm mt-2">{err}</p>
        </div>
      )}

      {health && (
        <>
          <div className="card mb-4">
            <div className="flex items-center gap-2 mb-3">
              {dot(overallOk)}
              <span className="font-bold text-lg">
                {overallOk ? "All systems operational" : "Degraded"}
              </span>
            </div>
            <Row label="Launch state" value={health.launchState ?? "—"} />
            <Row label="Cluster" value={health.cluster ?? "—"} />
            <Row label="Build version" value={health.version ?? "unknown"} />
            <Row
              label="Token mint"
              value={health.tokenMint ?? "(not set)"}
            />
          </div>

          <div className="card mb-4">
            <div className="flex items-center gap-2 mb-3">
              {dot(chainOk)}
              <span className="font-bold">Solana RPC connection</span>
            </div>
            <Row label="Reachable" value={chainOk ? "yes" : "no"} />
            <Row label="Slot" value={health.chain?.slot ?? "—"} />
            <Row label="Round-trip" value={`${health.chain?.rttMs ?? "—"} ms`} />
            {health.chain?.error && (
              <Row label="Error" value={health.chain.error} />
            )}
          </div>

          {health.process && (
            <div className="card mb-4">
              <div className="font-bold mb-3">Web process</div>
              <Row label="Uptime" value={fmtUptime(health.process.uptimeSec)} />
              <Row label="Memory (RSS)" value={`${health.process.rssMb} MB`} />
              <Row label="Heap used" value={`${health.process.heapUsedMb} MB`} />
              <Row label="Node" value={health.process.nodeVersion} />
            </div>
          )}

          {rpc && (
            <div className="card">
              <div className="font-bold mb-3">RPC proxy</div>
              <Row label="Requests total" value={rpc.total.toLocaleString()} />
              <Row label="Forwarded" value={rpc.forwarded.toLocaleString()} />
              <Row label="Rejected — bad method" value={rpc.rejectedMethod.toLocaleString()} />
              <Row label="Rejected — rate limit" value={rpc.rejectedRate.toLocaleString()} />
              <Row label="Rejected — bad body" value={rpc.rejectedBadBody.toLocaleString()} />
              <Row label="Upstream errors" value={rpc.upstreamError.toLocaleString()} />
              <Row label="Active rate buckets" value={rpc.activeRateBuckets.toLocaleString()} />
            </div>
          )}
        </>
      )}

      {!health && !err && (
        <div className="card">
          <div className="text-[var(--bull-dim)]">Loading status...</div>
        </div>
      )}
    </main>
  );
}
