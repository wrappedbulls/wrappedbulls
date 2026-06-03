// /launch/[slug] — per-deployment dashboard. White-labeled forever home
// for a single wrap layer.
//
// `slug` is the token_mint pubkey (base58). The wizard redirects here
// after a successful deploy, the /launches directory's cards link here,
// and deployers share this URL as their project's wrap homepage.
//
// V1 scope: render the deployment's identity + economics + live stats.
// Wrap / unwrap CTAs are placeholders pointing at the existing /wrap +
// /unwrap pages which are wrappedbulls-specific; week 2.5 wires the
// generic wrap/unwrap-tx routes so any deployment can be wrapped from
// inside its own /launch/[slug] page.

import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import {
  fetchAllWrappedCollections,
  fetchWrappedCollection,
  getConnection,
  type WrappedCollection,
} from "@/lib/factory";
import WrapButton from "@/app/launch/components/WrapButton";
import UnwrapButton from "@/app/launch/components/UnwrapButton";

interface PageProps { params: { slug: string } }

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps) {
  // Best effort: we don't fetch chain in generateMetadata for SEO speed,
  // we just embed the slug (truncated to keep OG titles clean). openGraph
  // image is intentionally a static factory banner; per deployment art
  // requires a chain read which is too expensive for metadata.
  const safe = params.slug.slice(0, 24);
  const title = `WRAPPEDBULLS // launch / ${safe}`;
  return {
    title,
    description:
      "A wrap layer deployed via the WrappedFactory. Wrap, unwrap, gallery, live stats.",
    openGraph: {
      title,
      description: "A wrap layer deployed via the WrappedFactory.",
      images: [{ url: "/wrappedbulls-banner.png" }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      images: ["/wrappedbulls-banner.png"],
    },
  };
}

export default async function LaunchDeploymentPage({ params }: PageProps) {
  const conn = getConnection();
  let collection: WrappedCollection | null = null;
  let tokenMint: PublicKey | null = null;
  let rpcError: string | null = null;

  // Slug resolution: if the slug parses as a Solana pubkey, look up by
  // token_mint directly. Otherwise treat it as a ticker (case-insensitive)
  // and scan the bulk reader. Pre-filter ticker candidates so an attacker
  // can't force a bulk getProgramAccounts call with arbitrary slugs
  // (/launch/aaa, /launch/bbb...) — only valid-looking tickers reach the
  // bulk path.
  try {
    tokenMint = new PublicKey(params.slug);
  } catch {
    tokenMint = null;
  }
  const isTickerShape = /^[A-Za-z0-9]{1,10}$/.test(params.slug);
  try {
    if (tokenMint) {
      collection = await fetchWrappedCollection(conn, tokenMint);
    } else if (isTickerShape) {
      const candidate = params.slug.toUpperCase();
      const all = await fetchAllWrappedCollections(conn);
      collection = all.find((c) => c.ticker.toUpperCase() === candidate) ?? null;
      if (collection) tokenMint = collection.tokenMint;
    }
  } catch (e) {
    rpcError = (e as Error).message;
  }

  if (!collection && !rpcError) {
    return (
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-16">
        <div className="card text-center" style={{ padding: 64 }}>
          <div className="h1 mb-4">NO WRAP LAYER FOUND</div>
          <p className="text-[var(--bull-dim)] mb-6" style={{ maxWidth: 480, marginInline: "auto" }}>
            no deployment exists at token mint{" "}
            <code style={{ wordBreak: "break-all" }}>{params.slug}</code>.
            either the address is wrong, or this token has never been wrapped via the Factory.
          </p>
          <div className="flex justify-center gap-3 flex-wrap">
            <Link href="/launches" className="btn">[ SEE ALL DEPLOYMENTS ]</Link>
            <Link href="/launch/new" className="btn btn-primary">[ LAUNCH THIS TOKEN → ]</Link>
          </div>
        </div>
      </main>
    );
  }

  if (rpcError) {
    return (
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-16">
        <div
          className="card"
          style={{ padding: 24, borderColor: "#b35d00", background: "#fff4e6" }}
        >
          <div className="h2" style={{ color: "#b35d00", marginBottom: 8 }}>RPC ERROR</div>
          <p style={{ fontSize: 13, color: "#b35d00" }}>{rpcError}</p>
        </div>
      </main>
    );
  }

  const c = collection!;
  const remaining = c.maxSupply - c.inCirculation;
  const lockedTotal = c.totalWrapped * c.tokensPerWrap;
  const tokenMintStr = c.tokenMint.toBase58();
  const deployerStr = c.deployer.toBase58();
  const collectionMintStr = c.collectionMint.toBase58();

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
      {/* Page head */}
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
          launch / {c.ticker.toLowerCase()}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 className="h1">{c.name}</h1>
          {c.verified && (
            <span
              title="Verified by WrappedBulls"
              style={{
                fontSize: 12,
                padding: "4px 10px",
                background: "#0a6b2c",
                color: "var(--bull-paper)",
                letterSpacing: "0.12em",
                fontWeight: 800,
                textTransform: "uppercase",
              }}
            >
              ✓ verified
            </span>
          )}
        </div>
        <p className="text-[var(--bull-dim)] mt-3 text-sm" style={{ maxWidth: 720 }}>
          {c.tokensPerWrap.toLocaleString()} of <code>{truncate(tokenMintStr, 24)}</code>{" "}
          wrapped into 1 NFT. the vault follows the NFT through every trade. atomic.
          permissionless. onchain.
        </p>
      </div>

      {/* Live stats strip */}
      <section style={{ paddingTop: 12, paddingBottom: 12 }}>
        <div
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4"
          style={{ border: "2px solid var(--bull-ink)" }}
        >
          <StatCell label="in circulation" value={c.inCirculation.toLocaleString()} sub={lifeline(c)} />
          <StatCell label="token locked" value={formatBig(lockedTotal)} sub="base units, lifetime" />
          <StatCell label="lifetime wraps" value={c.totalWrapped.toString()} sub={`${c.totalUnwrapped} unwraps`} />
          <StatCell label="slots remaining" value={remaining.toLocaleString()} sub={`of ${c.maxSupply.toLocaleString()} max`} last />
        </div>
      </section>

      {/* CTAs -- live, wallet-driven */}
      <section style={{ paddingTop: 24 }}>
        <div className="flex flex-wrap gap-4 items-start">
          <WrapButton
            tokenMint={tokenMintStr}
            collectionTicker={c.ticker}
            tokensPerWrap={c.tokensPerWrap.toString()}
            available={c.inCirculation < c.maxSupply || c.freeTiers.length > 0}
          />
          <UnwrapButton
            tokenMint={tokenMintStr}
            collectionTicker={c.ticker}
            maxSupply={c.maxSupply}
          />
          <Link href="/launches" className="btn btn-secondary">
            [ ALL WRAP LAYERS ]
          </Link>
        </div>
        <p style={{ fontSize: 11, color: "var(--bull-dim)", marginTop: 12 }}>
          wrap fires the Factory&apos;s generic <code>wrap</code> ix (server picks the next tier).
          unwrap targets a specific tier you hold; if you don&apos;t own that tier&apos;s NFT,
          the on-chain ownership check rejects with <code>NotNftHolder</code>.
        </p>
      </section>

      {/* Identity / on chain proof */}
      <section style={{ paddingTop: 48 }}>
        <SectionHead marker="01" title="DEPLOYMENT IDENTITY" />
        <div className="card" style={{ padding: 24 }}>
          <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", rowGap: 10, fontSize: 13 }}>
            <KV label="name" value={c.name} />
            <KV label="ticker" value={`$${c.ticker}`} />
            <KV label="token mint" value={tokenMintStr} mono />
            <KV label="deployer" value={deployerStr} mono />
            <KV label="collection mint (MCC)" value={collectionMintStr} mono />
            <KV label="tokens per wrap" value={`${c.tokensPerWrap.toLocaleString()} base units`} />
            <KV label="max supply" value={c.maxSupply.toLocaleString()} />
            <KV
              label="art source"
              value={`${c.artSource.kind === "baseUri" ? "BaseUri" : "RendererUrl"} ${c.artSource.uri}`}
              mono
            />
            <KV label="created at" value={new Date(Number(c.createdAt) * 1000).toISOString()} />
          </div>
        </div>
      </section>

      {/* The Herd */}
      <section style={{ paddingTop: 48 }}>
        <SectionHead marker="02" title="THE HERD" />
        {c.inCirculation === 0 ? (
          <div className="card text-center" style={{ padding: 48 }}>
            <div className="h2" style={{ marginBottom: 8 }}>NO WRAPS YET</div>
            <p className="text-[var(--bull-dim)]" style={{ maxWidth: 480, marginInline: "auto" }}>
              be the first to wrap a {c.ticker}. the deployer set max supply to{" "}
              {c.maxSupply.toLocaleString()}, so there's plenty of room.
            </p>
          </div>
        ) : (
          <div className="card" style={{ padding: 24 }}>
            <p style={{ fontSize: 13, color: "var(--bull-dim)" }}>
              {c.inCirculation.toLocaleString()} wrapped NFTs currently live. gallery view
              + per-NFT detail pages ship with the wrap/unwrap UI in v1.1.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

// =====================================================================
// Subcomponents
// =====================================================================
function SectionHead({ marker, title }: { marker: string; title: string }) {
  return (
    <div className="flex items-baseline gap-4 mb-4">
      <div style={{ fontWeight: 800 }}>{marker}</div>
      <div className="h2">{title}</div>
      <div style={{ flex: 1, borderTop: "2px solid var(--bull-ink)", height: 0, transform: "translateY(-6px)" }} />
    </div>
  );
}

function StatCell({
  label, value, sub, last,
}: { label: string; value: string; sub?: string; last?: boolean }) {
  return (
    <div style={{ padding: 20, borderRight: last ? undefined : "2px solid var(--bull-ink)" }}>
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "var(--bull-dim)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 800,
          marginTop: 4,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: "var(--bull-dim)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <div style={{ color: "var(--bull-dim)", fontSize: 12, paddingTop: 4 }}>{label}</div>
      <div
        style={{
          fontWeight: 700,
          paddingTop: 4,
          wordBreak: mono ? "break-all" : undefined,
          fontFamily: "inherit",
        }}
      >
        {value || <span style={{ color: "var(--bull-dim)", fontWeight: 400 }}>—</span>}
      </div>
    </>
  );
}

function lifeline(c: WrappedCollection): string {
  if (c.totalUnwrapped === 0n) return "all live";
  return `${c.totalUnwrapped.toString()} returned to the pool`;
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

function truncate(s: string, max: number) {
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, max / 2 - 1) + "…" + s.slice(-max / 2 + 2);
}
