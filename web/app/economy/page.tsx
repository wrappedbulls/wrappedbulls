// /economy — the $WBULL economy + protocol-wide state.
//
// One page that tells the FULL token story:
//   - What slice of supply is liquid, locked in bulls, or sitting in treasury
//   - Bull Treasury breakdown (claimable vs pending vs lifetime totals)
//   - Cross-protocol activity (WrappedBulls + every Factory deployment)
//   - Per-deployment table of locked tokens
//
// Server-side initial render (so first paint is fast + SEO-clean),
// then a small client island polls /api/economy every 30s for live updates.

import Link from "next/link";
import { loadEconomyStats } from "@/lib/economy";
import EconomyLive from "./EconomyLive";

export const metadata = {
  title: "WRAPPEDBULLS // $WBULL economy",
  description:
    "Live $WBULL supply breakdown: liquid, locked in wrapped bulls, in the bull treasury. Cross-protocol stats across every Factory deployment.",
};

export const dynamic = "force-dynamic";

export default async function EconomyPage() {
  const stats = await loadEconomyStats();

  if (!stats) {
    return (
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <div className="card text-center" style={{ padding: 48 }}>
          <div className="h1 mb-4">ECONOMY UNAVAILABLE</div>
          <p className="text-[var(--bull-dim)]">
            The wrappedbulls bank hasn&apos;t been initialized yet on this cluster.
            Check back once the protocol is live.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-8">
        <div
          style={{
            color: "var(--bull-dim)",
            fontSize: 12,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          protocol / economy
        </div>
        <h1 className="h1">$WBULL ECONOMY</h1>
        <p className="text-[var(--bull-dim)] mt-3 text-sm" style={{ maxWidth: 760 }}>
          live supply breakdown for $WBULL across the wrappedbulls product family.
          fixed total supply (1B, pump.fun mint-authority null), continuously
          shifting between liquid float, wrapped-bull vaults, and the bull treasury
          accumulator. cross-protocol counters at the bottom.
        </p>
        <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link href="/deflation" className="btn btn-secondary" style={{ fontSize: 11, padding: "6px 12px" }}>
            [ wrappedbulls deflation detail ]
          </Link>
          <Link href="/launch/treasury" className="btn btn-secondary" style={{ fontSize: 11, padding: "6px 12px" }}>
            [ bull treasury detail ]
          </Link>
          <Link href="/launches" className="btn btn-secondary" style={{ fontSize: 11, padding: "6px 12px" }}>
            [ all wrap layers ]
          </Link>
        </div>
      </div>

      <EconomyLive initial={stats} />
    </main>
  );
}
