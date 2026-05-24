"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  fetchBank,
  fetchUserTokenBalance,
  getProgram,
  SimulationError,
  wrapBull,
  waitForBankAdvance,
  TOKENS_PER_BULL_BASE,
  TOKENS_PER_BULL_WHOLE,
} from "@/lib/program";
import { useLaunchState } from "@/lib/use-launch-state";
import RpcErrorCard from "@/app/components/RpcErrorCard";

// Launch state is now a RUNTIME fact, fetched from /api/launch-state on
// mount (see web/lib/launch-state.ts for why. the old build-time
// `PRE_LAUNCH` constant could not be rolled back without a rebuild).

function PreLaunchCard({ tokenMint }: { tokenMint: string | null }) {
  const validMint =
    !!tokenMint && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(tokenMint);
  return (
    <div className="card text-center py-12">
      <div className="text-xs uppercase tracking-[0.25em] text-[var(--bull-dim)] mb-3">
        Pre-launch
      </div>
      <div className="text-2xl font-bold mb-3">Wrap goes live at launch</div>
      <p className="text-[var(--bull-dim)] mb-6 max-w-md mx-auto leading-relaxed">
        Wrapping activates the moment $WBULL launches on pump.fun and the
        program is initialized. Read the mechanic in the meantime.
      </p>
      {validMint && (
        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-[#0e0e12] border border-[#2a2a32] text-xs mb-6">
          <span className="text-[var(--bull-dim)]">$WBULL:</span>
          <span className="font-mono break-all">{tokenMint}</span>
        </div>
      )}
      <div className="flex justify-center gap-3 flex-wrap">
        <Link href="/thesis" className="btn btn-primary">Read the thesis</Link>
        <Link href="/tech" className="btn btn-secondary">How it works</Link>
        <Link href="/art" className="btn btn-secondary">The art</Link>
      </div>
    </div>
  );
}

export default function WrapPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { state: launchState, tokenMint: launchTokenMint, loading: launchLoading } =
    useLaunchState();

  const [loading, setLoading] = useState(true);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [bullsBalance, setBullsBalance] = useState<bigint>(0n);
  const [tokenMint, setTokenMint] = useState<string>("");
  const [nextTier, setNextTier] = useState<number>(0);
  const [bullsRemaining, setBullsRemaining] = useState<number>(1000);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [simLogs, setSimLogs] = useState<string[] | null>(null);
  const [lastResult, setLastResult] = useState<{ tier: number; nftMint: string; sig: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions || !wallet.sendTransaction) return;
    setLoading(true);
    setRpcError(null);
    try {
      const program = getProgram(connection, wallet as any);
      const bank = await fetchBank(program);
      setTokenMint(bank.tokenMint.toBase58());
      // Mirror on-chain pop_tier semantics: free_tiers stack pops LIFO before
      // we fall back to next_tier. If the website passes a different tier
      // than the program would pop, wrap_bull reverts with TierMismatch
      // (Phantom still prompts - failure happens after broadcast).
      const tierToWrap = bank.freeTiers.length > 0
        ? bank.freeTiers[bank.freeTiers.length - 1]
        : bank.nextTier;
      setNextTier(tierToWrap);
      // Capacity = 1000 - currently-circulating bulls. Free tiers count as available.
      setBullsRemaining(Math.max(0, 1000 - bank.inCirculation));
      const bal = await fetchUserTokenBalance(connection, wallet.publicKey, bank.tokenMint);
      setBullsBalance(bal);
    } catch (e: any) {
      console.error(e);
      // An on-chain READ failed. RPC/network problem, not a balance
      // problem. Surface it as a distinct rpc-error state so the user
      // never sees a misleading "Need 1M $WBULL" (L11).
      setRpcError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [connection, wallet]);

  useEffect(() => { refresh(); }, [refresh]);

  const eligibleWraps = Number(bullsBalance / TOKENS_PER_BULL_BASE);
  const balanceWhole = Number(bullsBalance) / 1_000_000;

  async function handleWrap() {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions || !wallet.sendTransaction) return;
    if (!tokenMint) return;
    setBusy(true); setStatus("Checking balance...");
    setSimLogs(null);
    try {
      const program = getProgram(connection, wallet as any);
      const tier = nextTier;

      // HARD BALANCE GATE (Phantom support recommendation, 2026-05-15):
      // never construct or send a wrap tx the chain will reject for
      // InsufficientBalance. Phantom simulates every tx in-wallet; a
      // guaranteed-revert tx is what triggers the "this dApp could be
      // malicious" / "transaction reverted" warnings. Re-read the LIVE
      // balance here (not the possibly-stale React state) and bail in-UI
      // before the wallet is ever invoked.
      const liveBalance = await fetchUserTokenBalance(
        connection,
        wallet.publicKey,
        new (await import("@solana/web3.js")).PublicKey(tokenMint),
      );
      if (liveBalance < TOKENS_PER_BULL_BASE) {
        const haveWhole = Number(liveBalance) / 1_000_000;
        setBusy(false);
        setStatus(
          `✗ You need ${TOKENS_PER_BULL_WHOLE.toLocaleString()} $WBULL to wrap. ` +
          `This wallet holds ${haveWhole.toLocaleString(undefined, { maximumFractionDigits: 2 })}. ` +
          `No transaction was sent.`,
        );
        return;
      }

      // HARD SOL GATE (Phantom Advanced view 2026-05-15 showed "you don't
      // have enough SOL for this transaction"). wrap_bull creates nft_mint
      // + vault ATA + payer NFT ATA + Metaplex metadata + master edition +
      // bull_asset. roughly 0.022 SOL of rent, plus fees + priority fee.
      // Require a 0.03 SOL floor so the tx can't revert for lamports and
      // get flagged by Phantom's simulation. Never send a doomed tx.
      const SOL_FLOOR_LAMPORTS = 30_000_000; // 0.03 SOL
      const solLamports = await connection.getBalance(wallet.publicKey);
      if (solLamports < SOL_FLOOR_LAMPORTS) {
        setBusy(false);
        setStatus(
          `✗ You need at least 0.03 SOL to cover account rent + network ` +
          `fees for the wrap. This wallet holds ` +
          `${(solLamports / 1_000_000_000).toFixed(4)} SOL. ` +
          `Add SOL and try again. No transaction was sent.`,
        );
        return;
      }

      // Capture pre-wrap totalWrapped so we can confirm the chain advanced
      // before the next refresh runs. Without this, RPC commitment race can
      // make refresh() see stale state and the UI re-offers the same tier
      // - clicking that re-offers fails with custom error 0x0 (PDA in use).
      const preBank: any = await fetchBank(program, "processed");
      const preTotal = BigInt(preBank.totalWrapped.toString());
      const { PublicKey } = await import("@solana/web3.js");
      setStatus(`Wrapping WrappedBulls #${tier}... please approve in your wallet`);
      const result = await wrapBull(
        program,
        connection,
        wallet as any,
        new PublicKey(tokenMint),
        tier,
        (await fetchBank(program, "processed")).collectionMint,
      );
      setStatus(`✓ Wrapped WrappedBulls #${result.tier} - syncing...`);
      setLastResult({ tier: result.tier, nftMint: result.nftMint.toBase58(), sig: result.signature });
      // Wait for the chain read to reflect the new total before refresh().
      await waitForBankAdvance(program, preTotal + 1n);
      await refresh();
      setStatus(`✓ Wrapped WrappedBulls #${result.tier}`);
    } catch (e: any) {
      console.error(e);
      if (e instanceof SimulationError) {
        setSimLogs(e.logs);
        setStatus(`✗ ${e.message}`);
      } else {
        setStatus(`✗ ${e.message ?? e}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
      <h1 className="h1 mb-3">Wrap a <span style={{ color: "var(--bull-accent)" }}>Bull</span></h1>
      <p className="text-[var(--bull-dim)] text-lg mb-10">
        Lock 1,000,000 $WBULL into a fresh Bull NFT. The vault follows the NFT through every transfer.
      </p>

      {launchLoading ? (
        <div className="card">
          <div className="text-[var(--bull-dim)]">Loading...</div>
        </div>
      ) : launchState === "pre-launch" ? (
        <PreLaunchCard tokenMint={launchTokenMint} />
      ) : !wallet.connected ? (
        <div className="card text-center py-12">
          <div className="text-xl font-bold mb-3">Connect your wallet</div>
          <p className="text-[var(--bull-dim)] mb-6">Phantom, Solflare, or any Solana wallet.</p>
          <p className="text-xs text-[var(--bull-dim)]">Use the <span className="text-[var(--bull-accent)]">Select Wallet</span> button in the top right.</p>
        </div>
      ) : loading ? (
        <div className="card">
          <div className="text-[var(--bull-dim)]">Loading on-chain state...</div>
        </div>
      ) : rpcError ? (
        <RpcErrorCard message={rpcError} onRetry={refresh} retrying={loading} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="card">
              <div className="text-xs uppercase text-[var(--bull-dim)] tracking-wider mb-2">Your $WBULL</div>
              <div className="text-3xl font-extrabold text-[var(--bull-accent)]">
                {balanceWhole.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
              <div className="text-xs text-[var(--bull-dim)] mt-1">tokens</div>
            </div>
            <div className="card">
              <div className="text-xs uppercase text-[var(--bull-dim)] tracking-wider mb-2">Eligible wraps</div>
              <div className="text-3xl font-extrabold text-[var(--bull-accent)]">{eligibleWraps}</div>
              <div className="text-xs text-[var(--bull-dim)] mt-1">at 1M each</div>
            </div>
          </div>

          <div className="card mb-6">
            <div className="text-xs uppercase text-[var(--bull-dim)] tracking-wider mb-3">Next bull</div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-xs text-[var(--bull-dim)]">You will mint</div>
                <div className="text-2xl font-bold">WrappedBulls #{nextTier}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-[var(--bull-dim)]">Slots remaining</div>
                <div className="text-2xl font-bold">{bullsRemaining}</div>
              </div>
            </div>
            <div className="text-xs text-[var(--bull-dim)] leading-relaxed mb-4">
              On wrap: 1,000,000 $WBULL → vault PDA. 1 NFT → your wallet. The visual is generated from the new NFT mint address - locked at wrap time, follows the NFT through marketplace transfers.
            </div>
            <button
              onClick={handleWrap}
              disabled={busy || eligibleWraps < 1 || bullsRemaining < 1}
              className="btn btn-primary w-full"
            >
              {busy ? "Working..." : eligibleWraps < 1 ? "Need 1,000,000 $WBULL to wrap" : bullsRemaining < 1 ? "All bulls are wrapped" : `Wrap WrappedBulls #${nextTier} →`}
            </button>
            {status && (
              <div
                className={`text-sm mt-3 break-words rounded-md px-3 py-2 ${
                  status.startsWith("✗")
                    ? "bg-[#2a1414] border border-[#5a2828] text-[#ff8a8a]"
                    : status.startsWith("✓")
                    ? "bg-[#142a14] border border-[#285a28] text-[#8aff8a]"
                    : "text-[var(--bull-dim)]"
                }`}
              >
                {status}
              </div>
            )}
            {simLogs && simLogs.length > 0 && (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-[var(--bull-dim)] hover:text-[var(--bull-ink)]">
                  Show on-chain simulation logs ({simLogs.length} lines)
                </summary>
                <pre className="mt-2 p-3 rounded-md bg-[#0a0a0e] border border-[#2a2a32] text-[#c0c0c8] overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
{simLogs.join("\n")}
                </pre>
              </details>
            )}
          </div>

          {lastResult && (
            <div className="card mb-6 border-[var(--bull-accent)]">
              <div className="text-xs uppercase text-[var(--bull-accent)] tracking-wider mb-3">✓ Wrapped</div>
              <Link href={`/bull/${lastResult.tier}`} className="block group">
                <div className="text-2xl font-bold mb-1 group-hover:text-[var(--bull-accent)]">WrappedBulls #{lastResult.tier} →</div>
              </Link>
              <div className="text-xs text-[var(--bull-dim)] break-all mb-2">NFT mint: {lastResult.nftMint}</div>
              <a
                href={`https://explorer.solana.com/tx/${lastResult.sig}?cluster=${process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "devnet"}`}
                target="_blank" rel="noopener"
                className="text-xs text-[var(--bull-accent)] hover:underline"
              >
                View transaction on Solana Explorer →
              </a>
            </div>
          )}

          <div className="text-xs text-[var(--bull-dim)] text-center">
            Token mint: <span className="font-mono">{tokenMint}</span>
          </div>
        </>
      )}
    </main>
  );
}
