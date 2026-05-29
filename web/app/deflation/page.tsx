// /deflation. The Vault Deflation dashboard.
//
// Server renders the shell + an accurate first paint from live chain state,
// then a small client island (DeflationLive) keeps just the numbers updating
// every 30s. Chain reads are cached server-side (lib/deflation.ts) so the poll
// is cheap no matter how many viewers are watching.

import Link from "next/link";
import { isPreLaunch } from "@/lib/launch-state";
import { LAUNCH_CONFIG } from "@/lib/launch-config.generated";
import { loadDeflationStats } from "@/lib/deflation";
import DeflationLive from "./DeflationLive";

export const metadata = {
  title: "Vault Deflation · WrappedBulls",
  description:
    "Live Vault Deflation dashboard: how much $WBULL is locked in vaults and out of circulation, the percent of supply removed, and the herd floor.",
};

export const dynamic = "force-dynamic";

const TICKER = LAUNCH_CONFIG.project.ticker;
const MAX_SUPPLY = LAUNCH_CONFIG.supply.maxSupply;

export default async function DeflationPage() {
  const preLaunch = isPreLaunch();
  const stats = preLaunch ? null : await loadDeflationStats();

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
          <DeflationLive initial={stats} ticker={TICKER} maxSupply={MAX_SUPPLY} />

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

          <div className="mt-6 text-xs text-[var(--bull-dim)]">
            Live from chain. Updates every 30 seconds.
          </div>
        </>
      )}
    </main>
  );
}
