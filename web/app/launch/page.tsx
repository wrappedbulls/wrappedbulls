// /launch landing page for the wrap Factory.
//
// Reads three chain sources in parallel:
//   FactoryConfig         singleton, totals
//   BullTreasuryState     for the claimable/pending preview
//   all WrappedCollection PDAs for the featured strip + protocol stats
//
// Graceful degrade: if the Factory isn't initialized on this cluster yet
// (early devnet, fresh program upgrade, etc.) we render the landing with
// "coming soon" callouts instead of crashing. RPC errors surface inline.

import Link from "next/link";
import {
  factoryConfigPda,
  fetchAllWrappedCollections,
  fetchBullTreasuryState,
  fetchFactoryConfig,
  getConnection,
  PENDING_LOCK_SECONDS,
  previewClaimableAt,
  previewLockedAt,
  type FactoryConfig,
  type BullTreasuryState,
  type WrappedCollection,
} from "@/lib/factory";
import WrapLayerCard, {
  type Mascot,
} from "./components/WrapLayerCard";

export const metadata = {
  title: "WRAPPEDBULLS // launch a wrap layer",
  description:
    "Launch a wrap layer for any pump.fun token. 1,000,000 $WBULL into the bull treasury per deployment. 7 day lock. governance adjustable.",
};

export const dynamic = "force-dynamic";

// =====================================================================
// Page
// =====================================================================
export default async function LaunchLandingPage() {
  const conn = getConnection();
  let factory:  FactoryConfig | null = null;
  let treasury: BullTreasuryState | null = null;
  let collections: WrappedCollection[] = [];
  let rpcError: string | null = null;

  try {
    [factory, treasury, collections] = await Promise.all([
      fetchFactoryConfig(conn),
      fetchBullTreasuryState(conn),
      fetchAllWrappedCollections(conn),
    ]);
  } catch (e) {
    rpcError = (e as Error).message;
  }

  const initialized = factory !== null && treasury !== null;
  const now = Math.floor(Date.now() / 1000);

  // Sort deployments by lifetime locked, descending. Featured = top 6.
  collections.sort((a, b) => {
    const al = a.totalWrapped * a.tokensPerWrap;
    const bl = b.totalWrapped * b.tokensPerWrap;
    if (bl > al) return 1;
    if (bl < al) return -1;
    return 0;
  });
  const featured = collections.slice(0, 6);

  // Aggregate stats across all Factory deployments. Lifetime locked is
  // sum(totalWrapped * tokensPerWrap), live wraps is sum(inCirculation).
  // We don't aggregate the original WrappedBulls collection here -- it
  // lives in a separate program and has its own /deflation surface.
  let totalLifetimeLocked = 0n;
  let totalInCirculation = 0;
  for (const c of collections) {
    totalLifetimeLocked += c.totalWrapped * c.tokensPerWrap;
    totalInCirculation += c.inCirculation;
  }

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
      {/* ============================ HERO ============================ */}
      <section className="text-center py-8">
        <h1 className="h1 mb-4">WRAP FACTORY</h1>
        <p className="text-lg" style={{ marginTop: 12 }}>
          &gt; launch a wrap layer on any pump.fun token in one transaction.
        </p>
        <p className="text-[var(--bull-dim)] text-sm" style={{ marginTop: 8, maxWidth: 720, marginInline: "auto" }}>
          every Factory deployment funds the bull treasury with 1,000,000 $WBULL.
          7 day lock per deposit. governance adjustable. no burn -- tokens stay
          in circulation, where the wrap protocol needs them.
        </p>
        <div className="flex justify-center gap-3 flex-wrap" style={{ marginTop: 24 }}>
          <Link href="/launch/new" className="btn btn-primary">[ LAUNCH YOURS → ]</Link>
          <Link href="/launches" className="btn btn-secondary">[ EXPLORE WRAP LAYERS ]</Link>
          <Link href="/launch/treasury" className="btn btn-secondary">[ BULL TREASURY ]</Link>
        </div>
      </section>

      {/* ============================ RPC ERROR ============================ */}
      {rpcError && (
        <div
          className="card"
          style={{
            padding: 16,
            marginBottom: 24,
            borderColor: "#b35d00",
            background: "#fff4e6",
            fontSize: 12,
            color: "#b35d00",
          }}
        >
          <strong style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>RPC error:</strong> {rpcError}
        </div>
      )}

      {/* ============================ STAT STRIP ============================ */}
      <section style={{ paddingTop: 24, paddingBottom: 24 }}>
        <div className="grid grid-cols-1 md:grid-cols-4" style={{ border: "2px solid var(--bull-ink)" }}>
          <StatCell
            label="live wrap layers"
            value={initialized ? collections.length.toLocaleString() : "—"}
            sub={initialized ? "Factory deployments" : "Factory not initialized"}
          />
          <StatCell
            label="$WBULL into bull treasury"
            value={initialized && treasury ? formatBig(treasury.lifetimeDeposited) : "—"}
            sub={initialized && treasury ? "lifetime, base units" : "—"}
          />
          <StatCell
            label="tokens locked across all layers"
            value={initialized ? formatBig(totalLifetimeLocked) : "—"}
            sub={initialized ? "lifetime base units across all WrappedX" : "—"}
          />
          <StatCell
            label="wrapped NFTs in circulation"
            value={initialized ? totalInCirculation.toLocaleString() : "—"}
            sub={initialized ? "across all Factory deployments" : "—"}
            last
          />
        </div>
      </section>

      {/* ============================ FEATURED ============================ */}
      <section style={{ paddingTop: 24 }}>
        <SectionHead marker="01" title="FEATURED WRAP LAYERS" />
        {featured.length === 0 ? (
          <FeaturedEmpty initialized={initialized} />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {featured.map((c) => {
                const card = collectionToCard(c);
                return <WrapLayerCard key={c.tokenMint.toBase58()} {...card} />;
              })}
            </div>
            {collections.length > featured.length && (
              <p style={{ marginTop: 20, textAlign: "center", fontSize: 12, color: "var(--bull-dim)" }}>
                <Link href="/launches">[ SEE ALL {collections.length} WRAP LAYERS → ]</Link>
              </p>
            )}
          </>
        )}
      </section>

      {/* ============================ BULL TREASURY ============================ */}
      <section style={{ paddingTop: 48 }}>
        <SectionHead marker="02" title="BULL TREASURY" />
        <BullTreasuryPanel treasury={treasury} now={now} initialized={initialized} />
      </section>

      {/* ============================ LAUNCH CTA ============================ */}
      <section style={{ paddingTop: 48 }}>
        <SectionHead marker="03" title="LAUNCH YOUR OWN" />
        <div className="card" style={{ padding: 32 }}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="md:col-span-2">
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.18em", color: "var(--bull-dim)", marginBottom: 8 }}>
                5 steps. one transaction. live in minutes.
              </div>
              <h2 className="h2" style={{ marginBottom: 12 }}>bring your pump.fun token to the wrap protocol.</h2>
              <p style={{ color: "var(--bull-dim)", marginBottom: 18 }}>
                your token gets the wrappedbulls engine: atomic wrap and unwrap,
                verified collection on magic eden and tensor, live deflation dashboard,
                dedicated /launch/&lt;ticker&gt; page, embeddable activity widget.
                all in one signed transaction.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6 text-sm" style={{ marginBottom: 20 }}>
                <div>→ atomic wrap + unwrap, one tx</div>
                <div>→ verified collection out of the box</div>
                <div>→ token vault follows the NFT</div>
                <div>→ dedicated dashboard, white labeled</div>
                <div>→ buy and lock flywheel ready</div>
                <div>→ embeddable activity widget</div>
              </div>
              <Link href="/launch/new" className="btn btn-primary">[ START YOUR DEPLOYMENT → ]</Link>
            </div>
            <div style={{ borderLeft: "2px dashed var(--bull-soft)", paddingLeft: 28 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.18em", color: "var(--bull-dim)", marginBottom: 8 }}>
                cost
              </div>
              <div style={{ fontSize: 36, fontWeight: 800, lineHeight: 1, marginBottom: 4 }}>1,000,000</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>$WBULL</div>
              <div style={{ fontSize: 12, color: "var(--bull-dim)", lineHeight: 1.7 }}>
                → atomic with deploy<br />
                → goes to bull treasury<br />
                → 7 day lock per deposit<br />
                → multisig controlled<br />
                → governance can adjust<br />
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

// =====================================================================
// Helpers
// =====================================================================

function collectionToCard(c: WrappedCollection) {
  const tokenMintStr = c.tokenMint.toBase58();
  return {
    name: c.name,
    ticker: `$${c.ticker}  //  community`,
    badge: c.totalWrapped > 0n ? "LIVE" : "DEPLOYED",
    mascot: pickMascot(tokenMintStr),
    supply: c.maxSupply,
    wrapped: c.inCirculation,
    lockedDisplay: `${formatBig(c.totalWrapped * c.tokensPerWrap)} locked`,
    href: `/launch/${tokenMintStr}`,
    verified: c.verified,
  };
}

// Stable mascot pick from token_mint, deterministic across renders.
function pickMascot(tokenMint: string): Mascot {
  const mascots: Mascot[] = ["bull", "doge", "pepe", "shib", "bonk", "pudgy"];
  let sum = 0;
  for (let i = 0; i < tokenMint.length; i++) sum = (sum + tokenMint.charCodeAt(i)) % 256;
  return mascots[sum % mascots.length];
}

function formatBig(n: bigint): string {
  const s = n.toString();
  if (s === "0") return "0";
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ",";
    out += s[i];
  }
  return out;
}

// =====================================================================
// Subcomponents
// =====================================================================

function SectionHead({ marker, title }: { marker: string; title: string }) {
  return (
    <div className="flex items-baseline gap-4 mb-6">
      <div style={{ fontWeight: 800 }}>{marker}</div>
      <div className="h2">{title}</div>
      <div style={{ flex: 1, borderTop: "2px solid var(--bull-ink)", height: 0, transform: "translateY(-6px)" }} />
    </div>
  );
}

function StatCell({ label, value, sub, last }: { label: string; value: string; sub?: string; last?: boolean }) {
  return (
    <div style={{ padding: 20, borderRight: last ? undefined : "2px solid var(--bull-ink)" }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--bull-dim)" }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--bull-dim)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function FeaturedEmpty({ initialized }: { initialized: boolean }) {
  if (!initialized) {
    return (
      <div className="card text-center" style={{ padding: 48 }}>
        <div className="h2" style={{ marginBottom: 12 }}>FACTORY NOT INITIALIZED</div>
        <p className="text-[var(--bull-dim)]" style={{ maxWidth: 480, marginInline: "auto", marginBottom: 24 }}>
          the WrappedFactory program has not been initialized on this cluster yet.
          once the upgrade authority runs <code>initialize</code>, the first
          deployment can launch.
        </p>
        <Link href="/" className="btn btn-secondary">[ ← BACK TO WRAPPEDBULLS ]</Link>
      </div>
    );
  }
  return (
    <div className="card text-center" style={{ padding: 48 }}>
      <div className="h2" style={{ marginBottom: 12 }}>BE THE FIRST DEPLOYMENT</div>
      <p className="text-[var(--bull-dim)]" style={{ maxWidth: 480, marginInline: "auto", marginBottom: 24 }}>
        no wrap layers have been launched yet. the bull treasury is empty and
        waiting. whoever ships first becomes the genesis Factory deployment.
      </p>
      <Link href="/launch/new" className="btn btn-primary">[ LAUNCH THE GENESIS LAYER → ]</Link>
    </div>
  );
}

function BullTreasuryPanel({
  treasury,
  now,
  initialized,
}: {
  treasury: BullTreasuryState | null;
  now: number;
  initialized: boolean;
}) {
  if (!initialized || !treasury) {
    return (
      <div className="card" style={{ padding: 32 }}>
        <div style={{ fontSize: 11, color: "var(--bull-dim)", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 8 }}>
          total accumulated
        </div>
        <div style={{ fontSize: 44, fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
          —
        </div>
        <div style={{ color: "var(--bull-dim)", fontSize: 13, marginTop: 8 }}>
          treasury not initialized on this cluster yet.
        </div>
      </div>
    );
  }

  const claimable = previewClaimableAt(treasury, now);
  const locked = previewLockedAt(treasury, now);

  return (
    <div className="card" style={{ padding: 32 }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 11, color: "var(--bull-dim)", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 6 }}>
          total accumulated
        </div>
        <div style={{ fontSize: 44, fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
          {formatBig(treasury.lifetimeDeposited)} $WBULL
        </div>
        <div style={{ color: "var(--bull-dim)", fontSize: 13, marginTop: 8 }}>
          1,000,000 $WBULL into the treasury per Factory deployment. governance adjustable.
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6" style={{ paddingTop: 28, borderTop: "2px dashed var(--bull-soft)" }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--bull-dim)", marginBottom: 4 }}>
            CLAIMABLE NOW
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "#d4a017" }}>
            {formatBig(claimable)}
          </div>
          <div style={{ fontSize: 12, color: "var(--bull-dim)", marginTop: 8, lineHeight: 1.6 }}>
            deposits older than 7 days. multisig-controlled.
            funds audits, grants, partnerships, infrastructure.
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--bull-dim)", marginBottom: 4 }}>
            PENDING ({Math.floor(PENDING_LOCK_SECONDS / 86400)}-DAY LOCK)
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
            {formatBig(locked)}
          </div>
          <div style={{ fontSize: 12, color: "var(--bull-dim)", marginTop: 8, lineHeight: 1.6 }}>
            recent deposits. cannot be claimed by anyone until 7 days after each
            on-chain deposit timestamp.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 20, textAlign: "right" }}>
        <Link href="/launch/treasury" style={{ fontSize: 12, color: "var(--bull-dim)" }}>
          [ FULL TREASURY STATUS + PER-DEPOSIT UNLOCK COUNTDOWN → ]
        </Link>
      </div>
    </div>
  );
}
