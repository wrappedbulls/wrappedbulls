import Link from "next/link";
import { fetchBullBank, getConnection, getCluster } from "@/lib/chain";
import { isPreLaunch, getTokenMint } from "@/lib/launch-state";
import RecentlyWrapped from "./components/RecentlyWrapped";

export const dynamic = "force-dynamic";
export const revalidate = 30;

async function loadStats() {
  try {
    const bank = await fetchBullBank(getConnection());
    if (!bank) return null;
    return {
      inCirculation: bank.inCirculation,
      totalWrapped: bank.totalWrapped.toString(),
      totalUnwrapped: bank.totalUnwrapped.toString(),
      nextTier: bank.nextTier,
    };
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const preLaunch = isPreLaunch();
  // In pre-launch mode, never read or expose chain stats (avoids leaking
  // devnet test state to the public).
  const stats = preLaunch ? null : await loadStats();
  const cluster = getCluster();
  const tokenMint = getTokenMint();
  const featuredTiers = !preLaunch && stats && stats.inCirculation > 0
    ? Array.from({ length: Math.min(stats.inCirculation, 6) }, (_, i) => i + 1)
    : [];

  return (
    <main>
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 md:pt-20 pb-16 md:pb-24 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs bg-[#15151a] border border-[#2a2a32] mb-6">
              <span className={`w-2 h-2 rounded-full ${preLaunch ? "bg-[var(--bull-accent)]" : "bg-[var(--bull-success)]"} animate-pulse`} />
              <span className="text-[var(--bull-dim)]">
                {preLaunch ? "Wrap/Mint Soon" : `${cluster.toUpperCase()} · Program live`}
              </span>
            </div>
            <h1 className="h1 mb-5">
              Pump.fun, <span style={{ color: "var(--bull-accent)" }}>upgraded.</span>
            </h1>
            <p className="text-lg leading-relaxed mb-8 text-[var(--bull-dim)]">
              The first hybrid token-NFT layer for pump.fun-launched memecoins. Wrap{" "}
              <span className="text-[var(--bull-accent)] font-bold">1,000,000 $WBULL</span> into a
              tradeable Bull NFT. The vault follows the NFT through every marketplace transfer.
            </p>
            <div className="flex flex-wrap gap-3">
              {preLaunch ? (
                <>
                  <Link href="/tech" className="btn btn-primary">How it works</Link>
                  <Link href="/art" className="btn btn-secondary">See the art</Link>
                </>
              ) : (
                <>
                  <Link href="/wrap" className="btn btn-primary">Wrap a Bull →</Link>
                  <Link href="/tech" className="btn btn-secondary">How it works</Link>
                </>
              )}
            </div>
            {tokenMint && (
              <div className="mt-6 inline-flex items-center gap-2 px-3 py-2 rounded-md bg-[#15151a] border border-[#2a2a32] text-xs">
                <span className="text-[var(--bull-dim)]">$WBULL:</span>
                <span className="font-mono text-[var(--bull-ink)] break-all">{tokenMint}</span>
                <a
                  href={`https://pump.fun/${tokenMint}`}
                  target="_blank"
                  rel="noopener"
                  className="text-[var(--bull-accent)] hover:underline shrink-0"
                >
                  pump.fun ↗
                </a>
              </div>
            )}
            <div className="mt-8 text-xs text-[var(--bull-dim)]">
              Same launchpad. Same PumpSwap graduation. Native NFT primitive.
            </div>
          </div>
          <div className="flex justify-center md:justify-end">
            <div className="relative w-[60vw] max-w-[400px] aspect-square">
              <div className="absolute inset-0 bg-[var(--bull-accent)] blur-3xl opacity-20" />
              <img
                src="/mascot.png"
                alt="WrappedBulls mascot"
                className="pixelated rounded-2xl border-2 border-[#2a2a32] relative z-10 shadow-2xl w-full h-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* TICKER */}
      <section className="border-y border-[#1a1a22] py-3 overflow-hidden bg-[#0e0e12]">
        <div className="ticker">
          {Array.from({ length: 2 }).map((_, k) => (
            <div key={k} className="flex gap-12 text-sm font-bold">
              <span className="text-[var(--bull-accent)]">$WBULL</span>
              <span className="text-[var(--bull-dim)]">1B SUPPLY</span>
              <span className="text-[var(--bull-accent)]">1M PER BULL</span>
              <span className="text-[var(--bull-dim)]">1000 MAX</span>
              <span className="text-[var(--bull-accent)]">VAULT FOLLOWS NFT</span>
              <span className="text-[var(--bull-dim)]">PUMP.FUN UPGRADED</span>
              <span className="text-[var(--bull-accent)]">VAULT FOLLOWS NFT</span>
              <span className="text-[var(--bull-dim)]">METAPLEX</span>
              <span className="text-[var(--bull-accent)]">WRAPPEDBULLS.FUN</span>
            </div>
          ))}
        </div>
      </section>

      {/* STATS / FEED. only when live */}
      {!preLaunch && (
        <>
          <section className="section">
            <div className="max-w-6xl mx-auto px-4 sm:px-6">
              <h2 className="h2 mb-8">Live on-chain</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Stat label="In circulation" value={stats?.inCirculation ?? "-"} sub="bulls right now" />
                <Stat label="Total wrapped" value={stats?.totalWrapped ?? "-"} sub="lifetime" />
                <Stat label="Total unwrapped" value={stats?.totalUnwrapped ?? "-"} sub="redeemed" />
                <Stat label="Next tier" value={`#${stats?.nextTier ?? "-"}`} sub="up for grabs" />
              </div>
            </div>
          </section>
          <RecentlyWrapped />
        </>
      )}

      {/* PRE-LAUNCH TEASER (replaces live stats + feed before launch) */}
      {preLaunch && (
        <section className="section">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
            <div className="text-xs uppercase tracking-[0.25em] text-[var(--bull-dim)] mb-4">
              Pre-launch
            </div>
            <h2 className="h2 mb-4">Goes live when $WBULL launches on pump.fun.</h2>
            <p className="text-[var(--bull-dim)] leading-relaxed mb-8">
              The wrap, unwrap, and gallery activate the moment the token mints
              and the program is initialized. Until then, dig into the tech and
              the art - everything is open source.
            </p>
            <div className="flex justify-center gap-3 flex-wrap">
              <Link href="/thesis" className="btn btn-primary">Read the thesis</Link>
              <Link href="/art" className="btn btn-secondary">See the art</Link>
              <Link href="/tech" className="btn btn-secondary">Tech walkthrough</Link>
            </div>
          </div>
        </section>
      )}

      {/* FEATURED WBULL */}
      {featuredTiers.length > 0 && (
        <section className="section pt-0">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="flex items-end justify-between mb-6">
              <h2 className="h2">The herd</h2>
              <Link href="/gallery" className="btn btn-ghost text-sm">View all →</Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {featuredTiers.map((tier) => (
                <Link key={tier} href={`/bull/${tier}`} className="card card-hover group">
                  <div className="aspect-square rounded-lg overflow-hidden bg-[#0a0a0c] mb-3">
                    <img src={`/api/render/${tier}`} alt={`WrappedBulls #${tier}`} className="w-full h-full pixelated" />
                  </div>
                  <div className="text-xs text-[var(--bull-dim)]">WrappedBulls</div>
                  <div className="text-sm font-bold group-hover:text-[var(--bull-accent)]">#{tier}</div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* HOW IT WORKS */}
      <section className="section bg-[#0e0e12] border-y border-[#1a1a22]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="h2 mb-2">How it works</h2>
          <p className="text-[var(--bull-dim)] mb-10 text-lg">Three steps. Fully on-chain. No middleman.</p>
          <div className="grid md:grid-cols-3 gap-6">
            <Step n={1} title="Wrap" body="Lock 1,000,000 $WBULL into a fresh Bull NFT. The tokens go into a vault PDA whose authority is derived from the NFT mint." />
            <Step n={2} title="Trade" body="The bull is a standard Metaplex NFT. List it on Magic Eden or Tensor. Whoever buys it controls the vault -the locked tokens follow atomically." />
            <Step n={3} title="Unwrap" body="Anytime. The current NFT holder burns it and the program releases the 1,000,000 $WBULL back to them. Tier slot frees up for the next wrapper." />
          </div>
          <div className="mt-10">
            <Link href="/tech" className="btn btn-secondary">Read the full mechanic →</Link>
          </div>
        </div>
      </section>

      {/* WHY IT'S NOVEL */}
      <section className="section">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <h2 className="h2 mb-4">First of its kind</h2>
            <p className="text-[var(--bull-dim)] text-lg leading-relaxed mb-4">
              SPL-404 already exists on Solana -but it requires Token-2022, which is fundamentally
              incompatible with pump.fun's standard SPL launches. SPL-404 forces you to abandon the
              launchpad.
            </p>
            <p className="text-[var(--bull-dim)] text-lg leading-relaxed mb-6">
              WrappedBulls bridges that gap with an NFT-owned vault PDA: each Bull NFT has a
              vault account whose authority is derived from the NFT's mint pubkey itself. The
              tokens are bound to the NFT without modifying the underlying SPL token.
              <span className="text-[var(--bull-ink)] font-bold"> We extend pump.fun rather than replacing it.</span>
            </p>
            <Link href="/about" className="btn btn-secondary">About the project →</Link>
          </div>
          <div className="card">
            <div className="text-xs uppercase text-[var(--bull-dim)] tracking-wider mb-3">Defensible claim</div>
            <div className="text-2xl font-bold leading-tight mb-4">
              The <span style={{ color: "var(--bull-accent)" }}>first</span> hybrid token-NFT upgrade for pump.fun-launched tokens.
            </div>
            <ul className="space-y-2 text-sm text-[var(--bull-dim)]">
              <li className="flex gap-2"><span className="text-[var(--bull-accent)]">✓</span> Standard SPL token (pump.fun-native)</li>
              <li className="flex gap-2"><span className="text-[var(--bull-accent)]">✓</span> No transfer hooks, no Token-2022</li>
              <li className="flex gap-2"><span className="text-[var(--bull-accent)]">✓</span> Tradeable on Magic Eden + Tensor day one</li>
              <li className="flex gap-2"><span className="text-[var(--bull-accent)]">✓</span> Vault tokens follow the NFT atomically</li>
              <li className="flex gap-2"><span className="text-[var(--bull-accent)]">✓</span> 1B supply / 1M per bull / 1000 bulls</li>
            </ul>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="section pt-0">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="card text-center py-12">
            <h2 className="h2 mb-3">Ready to wrap?</h2>
            <p className="text-[var(--bull-dim)] text-lg mb-6">
              Hold 1M+ $WBULL to mint your bull. Hold less? Buy on{" "}
              <a className="text-[var(--bull-accent)]" href="https://pump.fun" target="_blank" rel="noopener">pump.fun</a>.
            </p>
            <div className="flex justify-center gap-3 flex-wrap">
              <Link href="/wrap" className="btn btn-primary">Wrap a Bull</Link>
              <Link href="/gallery" className="btn btn-secondary">Browse gallery</Link>
              <a href="https://x.com/wrappedbulls" target="_blank" rel="noopener" className="btn btn-secondary">Follow on X ↗</a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card">
      <div className="text-xs uppercase text-[var(--bull-dim)] tracking-wider mb-2">{label}</div>
      <div className="text-3xl font-extrabold text-[var(--bull-accent)]">{value}</div>
      {sub && <div className="text-xs text-[var(--bull-dim)] mt-1">{sub}</div>}
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="card">
      <div className="text-[var(--bull-accent)] font-bold text-xl mb-3">{String(n).padStart(2, "0")}</div>
      <div className="font-bold text-xl mb-2">{title}</div>
      <p className="text-sm text-[var(--bull-dim)] leading-relaxed">{body}</p>
    </div>
  );
}
