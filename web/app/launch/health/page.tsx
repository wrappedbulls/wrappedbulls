// /launch/health - operator + public health dashboard for the WrappedFactory.
//
// Server rendered. Surfaces the metrics that matter for trust in the
// protocol at a glance: pause status, total deployments, lifetime
// treasury volume, recent wrap rate, recent deploy rate, factory program
// identity. Bookmarked by us during launch, public to anyone evaluating
// the protocol before integrating.
//
// This page deliberately overlaps with /launch/treasury (treasury
// specifics live there) and /security (program identity + audit links
// live there). Health is the at a glance synthesis: is the protocol up,
// is anything paused, what is moving.

import Link from "next/link";
import {
  factoryConfigPda,
  fetchAllWrappedCollections,
  fetchBullTreasuryState,
  fetchFactoryConfig,
  getConnection,
  type WrappedCollection,
} from "@/lib/factory";

export const metadata = {
  title: "WRAPPEDBULLS // factory health",
  description:
    "Live operator dashboard for the WrappedFactory: pause status, deploy " +
    "rate, wrap rate, treasury volume, on chain identity.",
};

export const dynamic = "force-dynamic";

const PROGRAM_ID_STR = "WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh";

export default async function FactoryHealthPage() {
  const conn = getConnection();

  // Pull everything in parallel. Three reads are independent.
  const [cfg, treasury, collections] = await Promise.all([
    fetchFactoryConfig(conn).catch(() => null),
    fetchBullTreasuryState(conn).catch(() => null),
    fetchAllWrappedCollections(conn).catch(() => [] as WrappedCollection[]),
  ]);

  const now = Math.floor(Date.now() / 1000);
  const DAY = 24 * 60 * 60;

  // Activity rates derived from on chain timestamps. Created_at is the
  // canonical deploy timestamp; for wraps we use the WrappedCollection's
  // total_wrapped counter only (we cannot derive per wrap timestamps
  // without enumerating BullAsset PDAs, which is too expensive for an
  // SSR page).
  const deploys24h = collections.filter((c) => Number(c.createdAt) >= now - DAY).length;
  const deploys7d = collections.filter((c) => Number(c.createdAt) >= now - 7 * DAY).length;
  // total_wrapped / total_unwrapped are u64 stored as bigint. For a count
  // display we only care about rough magnitude; Number() conversion is
  // safe for the wrap counts we'll plausibly see in V1 (well below 2^53).
  const lifetimeWraps = collections.reduce((sum, c) => sum + Number(c.totalWrapped), 0);
  const lifetimeUnwraps = collections.reduce((sum, c) => sum + Number(c.totalUnwrapped), 0);
  const inCirculation = collections.reduce((sum, c) => sum + c.inCirculation, 0);

  // Health flags. Each one drives a colored chip in the UI.
  const paused = cfg?.paused ?? false;
  const factoryInitialized = cfg !== null;
  const treasuryHealthy = treasury !== null;
  const queueWarning = treasury ? treasury.pending.length > 200 : false; // PRE_MORTEM 1.4 threshold

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-6">
        <div
          style={{
            color: "var(--bull-dim)",
            fontSize: 12,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          factory / health
        </div>
        <h1 className="h1">FACTORY HEALTH</h1>
        <p className="text-[var(--bull-dim)] mt-3 text-sm" style={{ maxWidth: 720 }}>
          live read of the WrappedFactory's status, activity, and on chain
          identity. bookmarked by the operator during launch; public to
          anyone evaluating the protocol.
        </p>
      </div>

      {/* Status chips */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <StatusChip
            label="protocol"
            value={paused ? "paused" : factoryInitialized ? "live" : "uninitialized"}
            ok={!paused && factoryInitialized}
            warning={paused}
          />
          <StatusChip
            label="treasury"
            value={treasuryHealthy ? "ok" : "unreachable"}
            ok={treasuryHealthy && !queueWarning}
            warning={queueWarning}
          />
          <StatusChip
            label="upgrade authority"
            value="hot key (soak)"
            ok={true}
            note="single hot keypair during 30-60d soak per /terms"
          />
          <StatusChip
            label="audit"
            value="internal complete"
            ok={true}
            note="no external third party audit; see /terms"
          />
        </div>
      </section>

      {/* Activity strip */}
      <section style={{ marginBottom: 32 }}>
        <SectionHead marker="01" title="ACTIVITY" />
        <div
          className="grid grid-cols-2 sm:grid-cols-4"
          style={{ border: "2px solid var(--bull-ink)" }}
        >
          <StatCell label="deploys 24h" value={deploys24h.toLocaleString()} />
          <StatCell label="deploys 7d" value={deploys7d.toLocaleString()} />
          <StatCell label="total deployments" value={(cfg?.totalDeployments ?? 0).toLocaleString()} />
          <StatCell label="in circulation (all)" value={inCirculation.toLocaleString()} last />
        </div>
        <div
          className="grid grid-cols-2 sm:grid-cols-4"
          style={{ border: "2px solid var(--bull-ink)", borderTop: "none" }}
        >
          <StatCell label="lifetime wraps" value={String(lifetimeWraps)} />
          <StatCell label="lifetime unwraps" value={String(lifetimeUnwraps)} />
          <StatCell
            label="treasury claimable"
            value={treasury ? formatBig(treasury.claimable) : "—"}
            sub="base units"
          />
          <StatCell
            label="treasury pending"
            value={treasury ? `${treasury.pending.length} / 256` : "—"}
            sub={queueWarning ? "queue near cap, action soon" : "<7d lock window"}
            last
          />
        </div>
      </section>

      {/* Pause notice (only when paused) */}
      {paused && (
        <section style={{ marginBottom: 32 }}>
          <div
            className="card"
            style={{
              padding: 20,
              borderColor: "#b35d00",
              background: "#fff4e6",
            }}
          >
            <div style={{ color: "#b35d00", fontWeight: 800, marginBottom: 6 }}>
              CIRCUIT BREAKER ACTIVE
            </div>
            <p style={{ fontSize: 13, color: "var(--bull-ink)", marginBottom: 8 }}>
              The Factory is paused. New wraps, new deploys, and treasury
              claims are temporarily rejected by the on chain program.{" "}
              <strong>Unwraps remain fully available.</strong> If you hold a
              wrapped NFT, your locked tokens are recoverable at any time.
            </p>
            <p style={{ fontSize: 12, color: "var(--bull-dim)" }}>
              See <a href="https://x.com/wrappedbulls" className="text-[var(--bull-accent)] hover:underline" target="_blank" rel="noopener">@wrappedbulls</a>{" "}
              for the live incident status and the planned resolution timeline.
            </p>
          </div>
        </section>
      )}

      {/* Identity */}
      <section style={{ marginBottom: 32 }}>
        <SectionHead marker="02" title="ON CHAIN IDENTITY" />
        <div className="card" style={{ padding: 24 }}>
          <KV label="program id" value={PROGRAM_ID_STR} mono />
          <KV label="cluster" value="mainnet beta" />
          <KV label="factory config" value={cfg ? factoryConfigPda()[0].toBase58() : "(uninitialized)"} mono />
          <KV label="$wbull mint" value={cfg ? cfg.wbullMint.toBase58() : "(uninitialized)"} mono />
          <KV label="paused" value={paused ? "TRUE" : "false"} />
          <KV label="upgrade authority" value="hot keypair (soak period)" />
          <KV
            label="verifiable build"
            value="docs/VERIFIED_BUILD_FACTORY.md"
            link="https://github.com/wrappedbulls/wrappedbulls/blob/release/v1.0/docs/VERIFIED_BUILD_FACTORY.md"
          />
          <KV
            label="audit document"
            value="docs/AUDIT_FACTORY.md"
            link="https://github.com/wrappedbulls/wrappedbulls/blob/release/v1.0/docs/AUDIT_FACTORY.md"
          />
          <KV
            label="incident runbook"
            value="docs/INCIDENT_RESPONSE.md"
            link="https://github.com/wrappedbulls/wrappedbulls/blob/release/v1.0/docs/INCIDENT_RESPONSE.md"
          />
        </div>
      </section>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 24 }}>
        <Link href="/launch" className="btn btn-secondary">[ ← FACTORY HOME ]</Link>
        <Link href="/launch/treasury" className="btn btn-secondary">[ TREASURY DETAIL → ]</Link>
        <Link href="/launches" className="btn btn-secondary">[ ALL DEPLOYMENTS → ]</Link>
        <Link href="/security" className="btn btn-secondary">[ SECURITY → ]</Link>
      </div>
    </main>
  );
}

function SectionHead({ marker, title }: { marker: string; title: string }) {
  return (
    <div className="flex items-baseline gap-4 mb-4">
      <div style={{ fontWeight: 800 }}>{marker}</div>
      <div className="h2">{title}</div>
      <div style={{ flex: 1, borderTop: "2px solid var(--bull-ink)", height: 0, transform: "translateY(-6px)" }} />
    </div>
  );
}

function StatusChip({
  label, value, ok, warning, note,
}: {
  label: string;
  value: string;
  ok: boolean;
  warning?: boolean;
  note?: string;
}) {
  const bg = warning ? "#fff4e6" : ok ? "var(--bull-very-soft)" : "#ffe5e5";
  const border = warning ? "#b35d00" : ok ? "#0a6b2c" : "#8a1212";
  const dot = warning ? "#b35d00" : ok ? "#0a6b2c" : "#8a1212";
  return (
    <div
      style={{
        border: `2px solid ${border}`,
        background: bg,
        padding: "10px 14px",
        minWidth: 180,
      }}
    >
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--bull-dim)" }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: dot, display: "inline-block" }} />
        <span style={{ fontWeight: 800, fontSize: 14, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {value}
        </span>
      </div>
      {note && (
        <div style={{ fontSize: 10, color: "var(--bull-dim)", marginTop: 4, maxWidth: 200 }}>
          {note}
        </div>
      )}
    </div>
  );
}

function StatCell({
  label, value, sub, last,
}: { label: string; value: string; sub?: string; last?: boolean }) {
  return (
    <div style={{ padding: 16, borderRight: last ? undefined : "2px solid var(--bull-ink)" }}>
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "var(--bull-dim)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 800,
          marginTop: 4,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      {sub && <div style={{ fontSize: 10, color: "var(--bull-dim)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function KV({
  label, value, mono, link,
}: { label: string; value: string; mono?: boolean; link?: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", padding: "6px 0", fontSize: 13 }}>
      <div style={{ color: "var(--bull-dim)", fontSize: 12 }}>{label}</div>
      <div
        style={{
          fontWeight: 700,
          wordBreak: mono ? "break-all" : undefined,
          fontFamily: "inherit",
        }}
      >
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noopener"
            className="text-[var(--bull-accent)] hover:underline"
          >
            {value}
          </a>
        ) : (
          value
        )}
      </div>
    </div>
  );
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
