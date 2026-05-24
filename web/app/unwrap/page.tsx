"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  fetchBank,
  fetchUserOwnedBulls,
  getProgram,
  SimulationError,
  unwrapBull,
} from "@/lib/program";
import { useLaunchState } from "@/lib/use-launch-state";
import RpcErrorCard from "@/app/components/RpcErrorCard";

// Launch state is a RUNTIME fact, fetched from /api/launch-state on
// mount (see web/lib/launch-state.ts). The old build-time PRE_LAUNCH
// constant could not be rolled back without a rebuild.

function PreLaunchCard() {
  return (
    <div className="card text-center py-12">
      <div className="text-xs uppercase tracking-[0.25em] text-[var(--bull-dim)] mb-3">
        Pre-launch
      </div>
      <div className="text-2xl font-bold mb-3">Unwrap goes live at launch</div>
      <p className="text-[var(--bull-dim)] mb-6 max-w-md mx-auto leading-relaxed">
        Unwrapping activates the moment $WBULL launches on pump.fun and the
        program is initialized.
      </p>
      <div className="flex justify-center gap-3 flex-wrap">
        <Link href="/thesis" className="btn btn-primary">Read the thesis</Link>
        <Link href="/art" className="btn btn-secondary">See the art</Link>
      </div>
    </div>
  );
}

// Wait for `total_unwrapped` to advance past `target` before continuing.
// Mirrors waitForBankAdvance for unwraps - protects the post-unwrap refresh
// from RPC commitment races that would otherwise show the just-unwrapped
// bull still in the user's list.
async function waitForUnwrapReflected(
  program: any,
  targetTotalUnwrapped: bigint,
  maxWaitMs = 4000
) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const b = await fetchBank(program, "processed");
      if (BigInt(b.totalUnwrapped.toString()) >= targetTotalUnwrapped) return;
    } catch { /* swallow + retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
}
import { PublicKey } from "@solana/web3.js";

export default function UnwrapPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { state: launchState, loading: launchLoading } = useLaunchState();

  const [loading, setLoading] = useState(true);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [tokenMint, setTokenMint] = useState<PublicKey | null>(null);
  const [bulls, setBulls] = useState<{ tier: number; nftMint: PublicKey; bullAsset: PublicKey }[]>([]);
  const [busyTier, setBusyTier] = useState<number | null>(null);
  const [status, setStatus] = useState<string>("");
  const [simLogs, setSimLogs] = useState<string[] | null>(null);

  const refresh = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions || !wallet.sendTransaction) return;
    setLoading(true);
    setRpcError(null);
    try {
      const program = getProgram(connection, wallet as any);
      const bank = await fetchBank(program);
      setTokenMint(bank.tokenMint);
      const owned = await fetchUserOwnedBulls(connection, wallet.publicKey, program);
      setBulls(owned.sort((a, b) => a.tier - b.tier));
    } catch (e: any) {
      console.error(e);
      // An on-chain READ failed. RPC/network problem, not "this
      // wallet owns no bulls". Distinct rpc-error state so the user
      // never sees a misleading empty-wallet message (L11).
      setRpcError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [connection, wallet]);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleUnwrap(tier: number, nftMint: PublicKey) {
    if (!wallet.publicKey || !tokenMint) return;
    if (!wallet.signTransaction || !wallet.signAllTransactions || !wallet.sendTransaction) return;
    setBusyTier(tier);
    setStatus(`Verifying ownership of WrappedBulls #${tier}...`);
    setSimLogs(null);
    try {
      const program = getProgram(connection, wallet as any);

      // HARD OWNERSHIP GATE (Phantom support recommendation, 2026-05-15):
      // never construct or send an unwrap tx the chain will reject for
      // NotNftHolder. Re-verify the connected wallet still holds this
      // bull's NFT before the wallet is ever invoked. A guaranteed-revert
      // tx is what triggers Phantom's malicious / reverted warnings.
      const ownedNow = await fetchUserOwnedBulls(
        connection,
        wallet.publicKey,
        program,
      );
      const stillOwned = ownedNow.some(
        (b) => b.tier === tier && b.nftMint.equals(nftMint),
      );
      if (!stillOwned) {
        setBusyTier(null);
        setStatus(
          `✗ This wallet no longer holds WrappedBulls #${tier}. ` +
          `No transaction was sent.`,
        );
        await refresh();
        return;
      }

      // SOL fee gate. unwrap_bull net-refunds rent (it closes the vault +
      // bull_asset back to the caller) but the wallet still needs lamports
      // up front for the tx fee + priority fee. Require a small 0.005 SOL
      // floor so a fee-starved revert never reaches Phantom's simulation.
      const SOL_FEE_FLOOR = 5_000_000; // 0.005 SOL
      const solLamports = await connection.getBalance(wallet.publicKey);
      if (solLamports < SOL_FEE_FLOOR) {
        setBusyTier(null);
        setStatus(
          `✗ You need at least 0.005 SOL to cover network fees for the ` +
          `unwrap. This wallet holds ` +
          `${(solLamports / 1_000_000_000).toFixed(4)} SOL. ` +
          `Add SOL and try again. No transaction was sent.`,
        );
        return;
      }

      setStatus(`Unwrapping WrappedBulls #${tier}... please approve in your wallet`);
      const preBank: any = await fetchBank(program, "processed");
      const preUnwrap = BigInt(preBank.totalUnwrapped.toString());
      const result = await unwrapBull(
        program,
        connection,
        wallet as any,
        tokenMint,
        tier,
        nftMint,
        (await fetchBank(program, "processed")).collectionMint,
      );
      setStatus(`✓ Unwrapped WrappedBulls #${tier} - syncing...`);
      await waitForUnwrapReflected(program, preUnwrap + 1n);
      await refresh();
      setStatus(`✓ Unwrapped WrappedBulls #${tier} - 1,000,000 $WBULL returned. ${result.signature}`);
    } catch (e: any) {
      console.error(e);
      if (e instanceof SimulationError) {
        setSimLogs(e.logs);
        setStatus(`✗ ${e.message}`);
      } else {
        setStatus(`✗ ${e.message ?? e}`);
      }
    } finally {
      setBusyTier(null);
    }
  }

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-16">
      <h1 className="h1 mb-3">Unwrap your <span style={{ color: "var(--bull-accent)" }}>Bulls</span></h1>
      <p className="text-[var(--bull-dim)] text-lg mb-10">
        Burn the NFT, redeem the 1,000,000 $WBULL. Anyone holding a Bull NFT can unwrap it - you don't need to be the original wrapper.
      </p>

      {launchLoading ? (
        <div className="card">
          <div className="text-[var(--bull-dim)]">Loading...</div>
        </div>
      ) : launchState === "pre-launch" ? (
        <PreLaunchCard />
      ) : !wallet.connected ? (
        <div className="card text-center py-12">
          <div className="text-xl font-bold mb-3">Connect your wallet</div>
          <p className="text-[var(--bull-dim)] mb-6">Phantom, Solflare, or any Solana wallet.</p>
          <p className="text-xs text-[var(--bull-dim)]">Use the <span className="text-[var(--bull-accent)]">Select Wallet</span> button in the top right.</p>
        </div>
      ) : loading ? (
        <div className="card">
          <div className="text-[var(--bull-dim)]">Loading your bulls...</div>
        </div>
      ) : rpcError ? (
        <RpcErrorCard message={rpcError} onRetry={refresh} retrying={loading} />
      ) : bulls.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-xl font-bold mb-3">No bulls in this wallet</div>
          <p className="text-[var(--bull-dim)] mb-6">Wrap your first bull, or buy one on a marketplace.</p>
          <div className="flex gap-3 justify-center">
            <Link href="/wrap" className="btn btn-primary">Wrap a bull →</Link>
            <Link href="/gallery" className="btn btn-secondary">Browse the herd</Link>
          </div>
        </div>
      ) : (
        <>
          <div className="text-sm text-[var(--bull-dim)] mb-4">
            You hold <span className="text-[var(--bull-accent)] font-bold">{bulls.length}</span> bull{bulls.length === 1 ? "" : "s"}, worth <span className="text-[var(--bull-accent)] font-bold">{(bulls.length * 1_000_000).toLocaleString()} $WBULL</span> on unwrap.
          </div>

          {status && (
            <div className="card mb-6 text-sm text-[var(--bull-dim)] break-words">
              {status}
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
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {bulls.map((b) => (
              <div key={b.tier} className="card">
                <div className="aspect-square rounded-lg overflow-hidden bg-[#0a0a0c] mb-3">
                  <img
                    src={`/api/render/${b.tier}`}
                    alt={`WrappedBulls #${b.tier}`}
                    className="w-full h-full pixelated"
                    loading="lazy"
                  />
                </div>
                <div className="text-xs text-[var(--bull-dim)]">WrappedBulls</div>
                <div className="text-lg font-bold mb-3">#{b.tier}</div>
                <button
                  className="btn btn-primary w-full"
                  onClick={() => handleUnwrap(b.tier, b.nftMint)}
                  disabled={busyTier !== null}
                >
                  {busyTier === b.tier ? "Working..." : "Unwrap → 1M $WBULL"}
                </button>
                <Link href={`/bull/${b.tier}`} className="btn btn-ghost w-full mt-2 text-xs">
                  View details →
                </Link>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
