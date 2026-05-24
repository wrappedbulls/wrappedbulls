"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface RecentBull {
  tier: number;
  nftMint: string;
  wrappedAt: number;
}

function timeAgo(unixSeconds: number): string {
  const diff = Math.max(1, Math.floor(Date.now() / 1000) - unixSeconds);
  if (diff < 60) return diff + "s ago";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

export default function RecentlyWrapped() {
  const [recent, setRecent] = useState<RecentBull[]>([]);
  const [, setTick] = useState(0); // forces re-render every 15s so timeAgo updates

  useEffect(() => {
    let cancelled = false;
    async function fetchOnce() {
      try {
        const r = await fetch("/api/recently-wrapped?limit=5", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setRecent(j.recent || []);
      } catch { /* ignore */ }
    }
    fetchOnce();
    const poll = setInterval(fetchOnce, 30_000);
    const tickT = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(tickT);
    };
  }, []);

  if (recent.length === 0) return null;

  return (
    <section className="section pt-0">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-[var(--bull-success)] animate-pulse" />
              <span className="text-xs uppercase tracking-wider text-[var(--bull-dim)]">Recently wrapped</span>
            </div>
            <h2 className="h2">Live feed</h2>
          </div>
          <Link href="/gallery" className="btn btn-ghost text-sm">All bulls →</Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          {recent.map((b) => (
            <Link key={b.tier} href={`/bull/${b.tier}`} className="card card-hover group p-3">
              <div className="aspect-square rounded-lg overflow-hidden bg-[#0a0a0c] mb-2">
                <img
                  src={`/api/render/${b.tier}`}
                  alt={`WrappedBulls #${b.tier}`}
                  className="w-full h-full pixelated"
                  loading="lazy"
                />
              </div>
              <div className="text-xs text-[var(--bull-dim)]">WrappedBulls</div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-bold group-hover:text-[var(--bull-accent)]">#{b.tier}</span>
                <span className="text-xs text-[var(--bull-dim)]">{timeAgo(b.wrappedAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
