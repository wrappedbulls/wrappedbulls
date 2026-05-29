"use client";

// Sortable, filterable herd grid. Data is computed server side and passed in,
// so this only handles client interaction (sort + filter), no fetching.

import Link from "next/link";
import { useMemo, useState } from "react";

export interface HerdCard {
  tier: number;
  rank: number | null; // 1 = rarest
  total: number;
  serial: number | null; // Nth ever wrapped
  era: number | null;
  isOG: boolean;
}

type SortKey = "rarity" | "serial" | "tier";
type FilterKey = "all" | "og";

export default function HerdGrid({ bulls }: { bulls: HerdCard[] }) {
  const [sort, setSort] = useState<SortKey>("rarity");
  const [filter, setFilter] = useState<FilterKey>("all");

  const shown = useMemo(() => {
    let list = bulls.slice();
    if (filter === "og") list = list.filter((b) => b.isOG);
    list.sort((a, b) => {
      if (sort === "rarity") {
        return (a.rank ?? 1e9) - (b.rank ?? 1e9); // rarest first
      }
      if (sort === "serial") {
        return (a.serial ?? 1e9) - (b.serial ?? 1e9); // oldest first
      }
      return a.tier - b.tier;
    });
    return list;
  }, [bulls, sort, filter]);

  const ogCount = useMemo(() => bulls.filter((b) => b.isOG).length, [bulls]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-6 text-xs">
        <span className="text-[var(--bull-dim)] uppercase tracking-wider mr-1">Sort</span>
        <Toggle active={sort === "rarity"} onClick={() => setSort("rarity")}>Rarity</Toggle>
        <Toggle active={sort === "serial"} onClick={() => setSort("serial")}>Serial</Toggle>
        <Toggle active={sort === "tier"} onClick={() => setSort("tier")}>Tier</Toggle>
        <span className="text-[var(--bull-dim)] uppercase tracking-wider ml-3 mr-1">Filter</span>
        <Toggle active={filter === "all"} onClick={() => setFilter("all")}>All ({bulls.length})</Toggle>
        <Toggle active={filter === "og"} onClick={() => setFilter("og")}>OG ({ogCount})</Toggle>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {shown.map((b) => (
          <Link key={b.tier} href={`/bull/${b.tier}`} className="card card-hover group p-3">
            <div className="aspect-square rounded-lg overflow-hidden bg-[#0a0a0c] mb-2 relative">
              <img
                src={`/api/render/${b.tier}`}
                alt={`WrappedBulls #${b.tier}`}
                className="w-full h-full pixelated"
                loading="lazy"
              />
              {b.isOG && (
                <span className="absolute top-1 left-1 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-[var(--bull-ink)] text-[var(--bull-paper)]">
                  OG
                </span>
              )}
            </div>
            <div className="flex items-baseline justify-between">
              <div className="text-sm font-bold group-hover:text-[var(--bull-accent)]">#{b.tier}</div>
              {b.rank !== null && (
                <div className="text-[10px] text-[var(--bull-dim)] uppercase tracking-wider">
                  Rank {b.rank}
                </div>
              )}
            </div>
            {b.serial !== null && (
              <div className="text-[10px] text-[var(--bull-dim)] mt-0.5">
                Serial #{b.serial}
              </div>
            )}
          </Link>
        ))}
      </div>

      {shown.length === 0 && (
        <div className="card text-center py-12 text-[var(--bull-dim)]">
          No bulls match this filter.
        </div>
      )}
    </>
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 border-2 border-[var(--bull-ink)] font-bold uppercase tracking-wider transition-colors ${
        active
          ? "bg-[var(--bull-ink)] text-[var(--bull-paper)]"
          : "bg-transparent text-[var(--bull-ink)] hover:bg-[var(--bull-very-soft)]"
      }`}
    >
      {children}
    </button>
  );
}
