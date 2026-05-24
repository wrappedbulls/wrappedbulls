// /wallet/[addr] - show a wallet's bulls + loose $WBULL balance.
// Reads chain directly. Server-rendered (no wallet adapter needed; works for any pubkey).

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Connection,
  PublicKey,
  TokenAccountsFilter,
} from "@solana/web3.js";
import { fetchBullBank, getConnection, getCluster, getProgramId } from "@/lib/chain";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";
export const revalidate = 30;

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

const BULL_ASSET_DISCRIMINATOR = createHash("sha256")
  .update("account:BullAsset")
  .digest()
  .subarray(0, 8);

interface OwnedBull {
  tier: number;
  nftMint: string;
}

interface WalletState {
  addr: PublicKey;
  bulls: OwnedBull[];
  bullsBalance: bigint;
  bullsTokenMint: PublicKey;
  exists: boolean;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ addr: string }>;
}) {
  const { addr } = await params;
  return {
    title: `${addr.slice(0, 6)}…${addr.slice(-4)} | WrappedBulls`,
    description: `View this wallet's WrappedBulls collection and $WBULL balance.`,
  };
}

async function loadWalletState(
  conn: Connection,
  addr: PublicKey
): Promise<WalletState | null> {
  const bank = await fetchBullBank(conn);
  if (!bank) return null;
  const tokenMint = bank.tokenMint;

  // 1. $WBULL balance
  const splResp = await conn.getParsedTokenAccountsByOwner(addr, {
    mint: tokenMint,
  } as TokenAccountsFilter);
  let bullsBalance = 0n;
  for (const a of splResp.value) {
    const amount = BigInt(a.account.data.parsed.info.tokenAmount.amount);
    bullsBalance += amount;
  }

  // 2. NFT holdings: enumerate all 1-of-1 token accounts, intersect with BullAssets on-chain
  const allTokens = await conn.getParsedTokenAccountsByOwner(addr, {
    programId: TOKEN_PROGRAM_ID,
  });
  const candidateNfts = new Set<string>();
  for (const a of allTokens.value) {
    const info = a.account.data.parsed.info;
    if (
      Number(info.tokenAmount.amount) === 1 &&
      info.tokenAmount.decimals === 0
    ) {
      candidateNfts.add(info.mint);
    }
  }

  // Fetch BullAssets via getProgramAccounts and filter to those whose nft_mint is in our candidate set
  const bulls: OwnedBull[] = [];
  if (candidateNfts.size > 0) {
    const programId = getProgramId();
    const bullAssetAccts = await conn.getProgramAccounts(programId, {
      commitment: "confirmed",
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: BULL_ASSET_DISCRIMINATOR.toString("base64"),
            encoding: "base64",
          },
        },
      ],
    });
    for (const a of bullAssetAccts) {
      const d = a.account.data;
      let off = 8;
      const nftMint = new PublicKey(d.slice(off, off + 32));
      off += 32;
      const tier = d.readUInt16LE(off);
      if (candidateNfts.has(nftMint.toBase58())) {
        bulls.push({ tier, nftMint: nftMint.toBase58() });
      }
    }
  }

  bulls.sort((a, b) => a.tier - b.tier);

  return {
    addr,
    bulls,
    bullsBalance,
    bullsTokenMint: tokenMint,
    exists: bullsBalance > 0n || bulls.length > 0,
  };
}

export default async function WalletPage({
  params,
}: {
  params: Promise<{ addr: string }>;
}) {
  const { addr: addrStr } = await params;

  let addr: PublicKey;
  try {
    addr = new PublicKey(addrStr);
  } catch {
    notFound();
  }

  const conn = getConnection();
  const state = await loadWalletState(conn, addr);
  if (!state) {
    return (
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
        <h1 className="h1 mb-4">Wallet</h1>
        <p className="text-[var(--bull-dim)]">
          Bank not initialized yet. Cannot enumerate bulls.
        </p>
      </main>
    );
  }

  const cluster = getCluster();
  const explorerCluster =
    cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  const balanceWhole = Number(state.bullsBalance) / 1_000_000;
  const wrapped = state.bulls.length;
  const totalValue = wrapped * 1_000_000 + Number(state.bullsBalance) / 1_000_000;
  const dustRatio =
    totalValue > 0 ? (Number(state.bullsBalance) / 1_000_000) / totalValue : 0;

  return (
    <main className="max-w-5xl mx-auto px-6 py-16">
      <Link
        href="/gallery"
        className="btn btn-ghost text-sm mb-6 -ml-2"
      >
        ← Back
      </Link>

      <div className="mb-10">
        <div className="text-xs uppercase tracking-wider text-[var(--bull-dim)] mb-2">
          Wallet
        </div>
        <h1 className="h2 font-mono break-all">{addr.toBase58()}</h1>
        <a
          href={`https://explorer.solana.com/address/${addr.toBase58()}${explorerCluster}`}
          target="_blank"
          rel="noopener"
          className="text-sm text-[var(--bull-accent)] hover:underline"
        >
          Solana Explorer ↗
        </a>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        <Stat label="Bulls held" value={wrapped} />
        <Stat
          label="$WBULL loose"
          value={balanceWhole.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })}
        />
        <Stat
          label="Total $WBULL"
          value={totalValue.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })}
          sub={`${wrapped}M wrapped + loose`}
        />
        <Stat
          label="Dust ratio"
          value={`${(dustRatio * 100).toFixed(1)}%`}
          sub="loose / total"
        />
      </div>

      {state.bulls.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-xl font-bold mb-3">
            {state.exists ? "No bulls in this wallet" : "Empty wallet"}
          </div>
          <p className="text-[var(--bull-dim)] mb-6">
            {balanceWhole >= 1_000_000
              ? "Has $WBULL but hasn't wrapped yet."
              : "No $WBULL, no bulls. Buy on pump.fun to wrap."}
          </p>
          {balanceWhole >= 1_000_000 && (
            <Link href="/wrap" className="btn btn-primary">
              Wrap a bull →
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-end justify-between mb-6">
            <h2 className="h2">The herd</h2>
            <span className="text-sm text-[var(--bull-dim)]">
              {wrapped} {wrapped === 1 ? "bull" : "bulls"}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {state.bulls.map((b) => (
              <Link
                key={b.tier}
                href={`/bull/${b.tier}`}
                className="card card-hover group p-3"
              >
                <div className="aspect-square rounded-lg overflow-hidden bg-[#0a0a0c] mb-2">
                  <img
                    src={`/api/render/${b.tier}`}
                    alt={`WrappedBulls #${b.tier}`}
                    className="w-full h-full pixelated"
                    loading="lazy"
                  />
                </div>
                <div className="text-xs text-[var(--bull-dim)]">WrappedBulls</div>
                <div className="text-sm font-bold group-hover:text-[var(--bull-accent)]">
                  #{b.tier}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="card">
      <div className="text-xs uppercase text-[var(--bull-dim)] tracking-wider mb-2">
        {label}
      </div>
      <div className="text-2xl font-extrabold text-[var(--bull-accent)]">
        {value}
      </div>
      {sub && (
        <div className="text-xs text-[var(--bull-dim)] mt-1">{sub}</div>
      )}
    </div>
  );
}
