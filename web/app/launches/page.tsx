// /launches — directory of every Factory deployment on the cluster.
//
// Server-rendered for SEO + fast first paint. Reads all WrappedCollection
// PDAs via lib/factory's bulk reader (single getProgramAccounts call,
// filtered by dataSize so it only returns deployment PDAs, not the
// singleton FactoryConfig/BullTreasuryState).
//
// Sort modes (client-side filtering would come via search params in v2):
//   default: by lifetime locked (descending) -- the busiest layers first
//
// Mascot pick: until each project's renderer publishes a real preview, we
// pick a stable mascot per collection by hashing the token_mint pubkey.
// Once Week 3's renderer integration lands, this swaps for the actual
// chain-deterministic NFT art.

import Link from "next/link";
import {
  fetchAllWrappedCollections,
  getConnection,
  type WrappedCollection,
} from "@/lib/factory";
import WrapLayerCard, {
  type Mascot,
} from "@/app/launch/components/WrapLayerCard";

export const metadata = {
  title: "WRAPPEDBULLS // all wrap layers",
  description:
    "Every wrap layer deployed via the WrappedFactory. Permissionless. One protocol.",
};

// Force server-side render on every request -- the directory MUST reflect
// the latest on-chain state immediately, not a 30s-old cache (the rate
// limiting at the RPC layer is the right place for cache, not here).
export const dynamic = "force-dynamic";

// Map a deployed collection to a UI card. Pure derivation, no chain calls.
function collectionToCard(c: WrappedCollection) {
  const tokenMint = c.tokenMint.toBase58();
  return {
    name: c.name,
    ticker: `$${c.ticker}  //  community`,
    badge: c.totalWrapped > 0n ? "LIVE" : "DEPLOYED",
    mascot: pickMascot(tokenMint),
    supply: c.maxSupply,
    wrapped: c.inCirculation,
    lockedDisplay: `${formatLocked(c.totalWrapped * c.tokensPerWrap)} per token`,
    href: `/launch/${tokenMint}`,
    verified: c.verified,
    // marketplaceHref is added later in v1.1 once we resolve the MCC
    // address into a Magic Eden / Tensor URL per cluster.
  };
}

// Deterministic mascot pick from the token_mint. Stable across renders
// without storing anything off chain.
function pickMascot(tokenMint: string): Mascot {
  const mascots: Mascot[] = ["bull", "doge", "pepe", "shib", "bonk", "pudgy"];
  let sum = 0;
  for (let i = 0; i < tokenMint.length; i++) sum = (sum + tokenMint.charCodeAt(i)) % 256;
  return mascots[sum % mascots.length];
}

// Format a bigint of base-unit tokens into a human-readable amount with
// SI suffix. Decimals aren't known per-token without an extra fetch, so
// we present the raw amount with separators -- precise but verbose.
function formatLocked(n: bigint): string {
  const s = n.toString();
  if (s === "0") return "0";
  // Add thousands separators by walking from the right.
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ",";
    out += s[i];
  }
  return out;
}

export default async function LaunchesDirectoryPage() {
  const conn = getConnection();
  let collections: WrappedCollection[] = [];
  let rpcError: string | null = null;
  try {
    collections = await fetchAllWrappedCollections(conn);
  } catch (e) {
    rpcError = (e as Error).message;
  }

  // Sort: busiest first (lifetime locked = total_wrapped * tokens_per_wrap).
  collections.sort((a, b) => {
    const al = a.totalWrapped * a.tokensPerWrap;
    const bl = b.totalWrapped * b.tokensPerWrap;
    if (bl > al) return 1;
    if (bl < al) return -1;
    return 0;
  });

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
          factory / directory
        </div>
        <h1 className="h1">ALL WRAP LAYERS</h1>
        <p className="text-[var(--bull-dim)] mt-3 text-sm" style={{ maxWidth: 720 }}>
          every Factory deployment ever made. permissionless. one engine, many
          communities. click any layer to open its dashboard.
        </p>
      </div>

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
          <strong style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>RPC error:</strong>{" "}
          {rpcError}
        </div>
      )}

      {collections.length === 0 && !rpcError && (
        <div className="card text-center" style={{ padding: 48 }}>
          <div className="h2" style={{ marginBottom: 12 }}>NO DEPLOYMENTS YET</div>
          <p className="text-[var(--bull-dim)] mb-6" style={{ maxWidth: 480, marginInline: "auto" }}>
            be the first community to deploy a wrap layer on top of pump.fun.
            the bull treasury is waiting.
          </p>
          <Link href="/launch/new" className="btn btn-primary">
            [ LAUNCH THE FIRST ONE → ]
          </Link>
        </div>
      )}

      {collections.length > 0 && (
        <>
          <div
            style={{
              fontSize: 12,
              color: "var(--bull-dim)",
              marginBottom: 16,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {collections.length} wrap layer{collections.length === 1 ? "" : "s"} live · sorted by lifetime locked
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {collections.map((c) => {
              const card = collectionToCard(c);
              return <WrapLayerCard key={c.tokenMint.toBase58()} {...card} />;
            })}
          </div>
        </>
      )}
    </main>
  );
}
