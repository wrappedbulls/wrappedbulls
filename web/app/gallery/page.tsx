import Link from "next/link";
import { fetchBullBank, fetchBullAsset, getConnection } from "@/lib/chain";
import { isPreLaunch } from "@/lib/launch-state";

export const metadata = {
  title: "Gallery - All wrapped WrappedBulls",
};

// `force-dynamic` runs the page on every request; `revalidate` would conflict
// (Next.js prefers revalidate, which would 30s-cache the gallery and make
// freshly-wrapped bulls take up to 30s to appear).
export const dynamic = "force-dynamic";

// Same example slugs the /art page uses, for the pre-launch teaser grid.
const PRE_LAUNCH_EXAMPLES = [
  "bull_01", "bull_04", "bull_07", "bull_10", "bull_13",
  "bull_16", "bull_19", "bull_22", "bull_25", "bull_28",
];

async function loadAllBulls() {
  const conn = getConnection();
  const bank = await fetchBullBank(conn);
  if (!bank) return { tiers: [] as number[], bank: null };
  // Tiers 1..nextTier-1 minus those currently in free_tiers (unwrapped, awaiting reuse)
  const allMinted = new Set<number>();
  for (let t = 1; t < bank.nextTier; t++) allMinted.add(t);
  for (const t of bank.freeTiers) allMinted.delete(t);
  const tiers = Array.from(allMinted).sort((a, b) => a - b);
  return { tiers, bank };
}

export default async function GalleryPage() {
  const preLaunch = isPreLaunch();
  // In pre-launch mode, don't read chain state (avoids leaking devnet stats).
  const { tiers, bank } = preLaunch
    ? { tiers: [] as number[], bank: null }
    : await loadAllBulls();

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="h1 mb-3">The herd</h1>
          <p className="text-[var(--bull-dim)] text-lg">
            Every bull currently in circulation. Each holds 1,000,000 $WBULL.
          </p>
        </div>
        {!preLaunch && bank && (
          <div className="card flex gap-6">
            <Stat label="Live" value={bank.inCirculation} />
            <Stat label="Wrapped lifetime" value={bank.totalWrapped.toString()} />
            {/* Capacity = 1000 - in-circulation. Tiers in free_tiers (unwrapped)
                are reusable, so they count as available, not consumed. */}
            <Stat label="Slots remaining" value={Math.max(0, 1000 - bank.inCirculation)} />
          </div>
        )}
      </div>

      {preLaunch ? (
        <>
          <div className="card text-center py-10 mb-8">
            <div className="text-xs uppercase tracking-[0.25em] text-[var(--bull-dim)] mb-3">
              Pre-launch
            </div>
            <div className="text-2xl font-bold mb-2">The herd populates at launch</div>
            <p className="text-[var(--bull-dim)] max-w-md mx-auto leading-relaxed">
              When $WBULL launches on pump.fun and the first holders wrap,
              every bull will appear here, live. Until then, here's a sample
              of what the renderer produces.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {PRE_LAUNCH_EXAMPLES.map((slug) => (
              <div key={slug} className="card p-3">
                <div className="aspect-square rounded-lg overflow-hidden bg-[#0a0a0c]">
                  <img
                    src={`/art/${slug}.png`}
                    alt="Sample CryptoBull"
                    className="w-full h-full pixelated"
                    loading="lazy"
                  />
                </div>
                <div className="text-xs text-[var(--bull-dim)] mt-2 text-center">sample</div>
              </div>
            ))}
          </div>
        </>
      ) : tiers.length === 0 ? (
        <div className="card text-center py-16">
          <div className="text-2xl font-bold mb-3">
            {bank && bank.totalWrapped > 0n
              ? "No bulls in circulation right now"
              : "No bulls wrapped yet"}
          </div>
          <p className="text-[var(--bull-dim)] mb-6">
            {bank && bank.totalWrapped > 0n
              ? "Every wrapped bull has been unwrapped. Wrap one to bring the herd back."
              : "Be the first holder to mint a CryptoBull."}
          </p>
          <Link href="/wrap" className="btn btn-primary">Wrap a bull →</Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {tiers.map((tier) => (
            <Link key={tier} href={`/bull/${tier}`} className="card card-hover group p-3">
              <div className="aspect-square rounded-lg overflow-hidden bg-[#0a0a0c] mb-2">
                <img
                  src={`/api/render/${tier}`}
                  alt={`WrappedBulls #${tier}`}
                  className="w-full h-full pixelated"
                  loading="lazy"
                />
              </div>
              <div className="text-xs text-[var(--bull-dim)]">WrappedBulls</div>
              <div className="text-sm font-bold group-hover:text-[var(--bull-accent)]">#{tier}</div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs uppercase text-[var(--bull-dim)] tracking-wider mb-1">{label}</div>
      <div className="text-2xl font-extrabold text-[var(--bull-accent)]">{value}</div>
    </div>
  );
}
