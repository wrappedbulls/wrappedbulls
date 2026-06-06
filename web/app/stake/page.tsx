"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  PublicKey,
  ComputeBudgetProgram,
  Transaction,
} from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import {
  StakingPool,
  StakerPosition,
  claimRewardsIx,
  computePending,
  detectStakeTokenProgram,
  fetchStakerPosition,
  fetchStakingPool,
  rewardVaultPda,
  stakeIx,
  stakerPositionPda,
  stakerTokenAccountAddress,
  stakingPoolPda,
  unstakeIx,
} from "@/lib/staking";

const ONE_TOKEN = BigInt("1000000"); // 6 decimal $WBULL

function baseToWhole(amount: bigint): number {
  return Number(amount) / Number(ONE_TOKEN);
}

function wholeToBase(whole: string): bigint | null {
  if (!whole) return null;
  const trimmed = whole.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [int, frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "000000").slice(0, 6);
  try {
    return BigInt(int) * ONE_TOKEN + BigInt(fracPadded || "0");
  } catch {
    return null;
  }
}

function fmt(amount: bigint): string {
  const whole = baseToWhole(amount);
  return whole.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export default function StakePage() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [loading, setLoading] = useState(true);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [pool, setPool] = useState<StakingPool | null>(null);
  const [position, setPosition] = useState<StakerPosition | null>(null);
  const [walletBalance, setWalletBalance] = useState<bigint>(BigInt(0));
  const [tokenProgram, setTokenProgram] = useState<PublicKey | null>(null);
  const [stakeAmount, setStakeAmount] = useState("");
  const [unstakeAmount, setUnstakeAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");

  const refresh = useCallback(async () => {
    if (!wallet.publicKey) return;
    setLoading(true);
    setRpcError(null);
    try {
      const fetched = await fetchStakingPool(connection);
      if (!fetched) {
        setRpcError("Staking pool not initialized yet. Check back at launch.");
        setLoading(false);
        return;
      }
      setPool(fetched);
      const program = await detectStakeTokenProgram(connection, fetched.stakeMint);
      setTokenProgram(program);
      const pos = await fetchStakerPosition(connection, wallet.publicKey);
      setPosition(pos);
      const ata = stakerTokenAccountAddress(
        fetched.stakeMint,
        wallet.publicKey,
        program,
      );
      try {
        const acc = await getAccount(connection, ata, "confirmed", program);
        setWalletBalance(acc.amount);
      } catch {
        setWalletBalance(BigInt(0));
      }
    } catch (e: any) {
      setRpcError(e?.message || "RPC error fetching staking state");
    } finally {
      setLoading(false);
    }
  }, [connection, wallet.publicKey]);

  useEffect(() => {
    if (wallet.connected) {
      void refresh();
    } else {
      setLoading(false);
    }
  }, [wallet.connected, refresh]);

  const pending = useMemo(() => {
    if (!pool || !position) return BigInt(0);
    return computePending(pool, position);
  }, [pool, position]);

  // Cumulative yield ratio: lifetime rewards distributed per current
  // staked token. V1 displays this in place of a calendar APY because
  // we have no on chain emission rate; APY is observed, not promised.
  const cumulativeYieldPct = useMemo(() => {
    if (!pool || pool.totalStaked === BigInt(0)) return null;
    const num = Number(pool.lifetimeRewardsDeposited);
    const den = Number(pool.totalStaked);
    if (den === 0) return null;
    return (num / den) * 100;
  }, [pool]);

  const submitStake = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signTransaction || !pool || !tokenProgram) return;
    const amt = wholeToBase(stakeAmount);
    if (!amt || amt <= BigInt(0)) {
      setStatus("Enter a stake amount greater than zero.");
      return;
    }
    if (amt > walletBalance) {
      setStatus("Stake amount exceeds your $WBULL balance.");
      return;
    }
    setBusy(true);
    setStatus("Building transaction...");
    try {
      const [poolPda] = stakingPoolPda();
      const [positionPda] = stakerPositionPda(wallet.publicKey);
      const [rvPda] = rewardVaultPda();
      const ata = stakerTokenAccountAddress(
        pool.stakeMint,
        wallet.publicKey,
        tokenProgram,
      );
      const ix = stakeIx(amt, {
        pool: poolPda,
        position: positionPda,
        stakeMint: pool.stakeMint,
        stakeVault: pool.stakeVault,
        rewardVault: rvPda,
        stakerTokenAccount: ata,
        staker: wallet.publicKey,
        stakeTokenProgram: tokenProgram,
      });
      const tx = new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
        .add(ix);
      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const signed = await wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      setStatus(`Submitted. Waiting for confirmation... ${sig.slice(0, 12)}...`);
      await connection.confirmTransaction(sig, "confirmed");
      setStatus(`Staked ${stakeAmount} $WBULL. ${sig.slice(0, 12)}...`);
      setStakeAmount("");
      await refresh();
    } catch (e: any) {
      setStatus(`Stake failed: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [
    wallet,
    pool,
    tokenProgram,
    stakeAmount,
    walletBalance,
    connection,
    refresh,
  ]);

  const submitUnstake = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signTransaction || !pool || !position || !tokenProgram)
      return;
    const amt = wholeToBase(unstakeAmount);
    if (!amt || amt <= BigInt(0)) {
      setStatus("Enter an unstake amount greater than zero.");
      return;
    }
    if (amt > position.amount) {
      setStatus("Unstake amount exceeds your staked balance.");
      return;
    }
    setBusy(true);
    setStatus("Building transaction...");
    try {
      const [poolPda] = stakingPoolPda();
      const [positionPda] = stakerPositionPda(wallet.publicKey);
      const [rvPda] = rewardVaultPda();
      const ata = stakerTokenAccountAddress(
        pool.stakeMint,
        wallet.publicKey,
        tokenProgram,
      );
      const ix = unstakeIx(amt, {
        pool: poolPda,
        position: positionPda,
        stakerCloseTarget: wallet.publicKey,
        stakeMint: pool.stakeMint,
        stakeVault: pool.stakeVault,
        rewardVault: rvPda,
        stakerTokenAccount: ata,
        staker: wallet.publicKey,
        stakeTokenProgram: tokenProgram,
      });
      const tx = new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
        .add(ix);
      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const signed = await wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      setStatus(`Submitted. Waiting for confirmation... ${sig.slice(0, 12)}...`);
      await connection.confirmTransaction(sig, "confirmed");
      setStatus(`Unstaked ${unstakeAmount} $WBULL. ${sig.slice(0, 12)}...`);
      setUnstakeAmount("");
      await refresh();
    } catch (e: any) {
      setStatus(`Unstake failed: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [
    wallet,
    pool,
    position,
    tokenProgram,
    unstakeAmount,
    connection,
    refresh,
  ]);

  const submitClaim = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signTransaction || !pool || !position || !tokenProgram)
      return;
    if (pending <= BigInt(0)) {
      setStatus("Nothing to claim right now.");
      return;
    }
    setBusy(true);
    setStatus("Building transaction...");
    try {
      const [poolPda] = stakingPoolPda();
      const [positionPda] = stakerPositionPda(wallet.publicKey);
      const [rvPda] = rewardVaultPda();
      const ata = stakerTokenAccountAddress(
        pool.stakeMint,
        wallet.publicKey,
        tokenProgram,
      );
      const ix = claimRewardsIx({
        pool: poolPda,
        position: positionPda,
        stakeMint: pool.stakeMint,
        rewardVault: rvPda,
        stakerTokenAccount: ata,
        staker: wallet.publicKey,
        stakeTokenProgram: tokenProgram,
      });
      const tx = new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
        .add(ix);
      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const signed = await wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      setStatus(`Submitted. Waiting for confirmation... ${sig.slice(0, 12)}...`);
      await connection.confirmTransaction(sig, "confirmed");
      setStatus(`Claimed ${fmt(pending)} $WBULL. ${sig.slice(0, 12)}...`);
      await refresh();
    } catch (e: any) {
      setStatus(`Claim failed: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [wallet, pool, position, pending, tokenProgram, connection, refresh]);

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold mb-2">Stake $WBULL</h1>
        <p className="text-[var(--bull-dim)] leading-relaxed">
          Lock $WBULL into the staking pool. 50% of every Factory deploy fee is
          routed back here and distributed pro rata to stakers. Unstake any time;
          no lock period in V1.
        </p>
      </div>

      {!wallet.connected ? (
        <div className="card text-center py-12">
          <div className="text-xl font-bold mb-3">Connect your wallet</div>
          <p className="text-[var(--bull-dim)] mb-6">
            Phantom, Solflare, or any Solana wallet.
          </p>
          <div className="flex justify-center">
            <WalletMultiButton />
          </div>
        </div>
      ) : loading ? (
        <div className="card">
          <div className="text-[var(--bull-dim)]">Loading staking state...</div>
        </div>
      ) : rpcError ? (
        <div className="card">
          <div className="text-sm text-[var(--bull-dim)]">{rpcError}</div>
          <Link href="/" className="btn btn-secondary mt-4">
            Back to home
          </Link>
        </div>
      ) : (
        pool && (
          <>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="card">
                <div className="text-xs uppercase text-[var(--bull-dim)] tracking-wider mb-2">
                  Pool total staked
                </div>
                <div className="text-2xl font-extrabold text-[var(--bull-accent)]">
                  {fmt(pool.totalStaked)}
                </div>
                <div className="text-xs text-[var(--bull-dim)] mt-1">$WBULL</div>
              </div>
              <div className="card">
                <div className="text-xs uppercase text-[var(--bull-dim)] tracking-wider mb-2">
                  Lifetime rewards
                </div>
                <div className="text-2xl font-extrabold text-[var(--bull-accent)]">
                  {fmt(pool.lifetimeRewardsDeposited)}
                </div>
                <div className="text-xs text-[var(--bull-dim)] mt-1">
                  distributed to stakers
                </div>
              </div>
            </div>

            <div className="card mb-6">
              <div className="text-xs uppercase text-[var(--bull-dim)] tracking-wider mb-2">
                Cumulative yield
              </div>
              <div className="text-2xl font-extrabold">
                {cumulativeYieldPct === null
                  ? "n/a"
                  : `${cumulativeYieldPct.toFixed(2)}%`}
              </div>
              <div className="text-xs text-[var(--bull-dim)] mt-2 leading-relaxed">
                Observed, not promised: lifetime $WBULL distributed divided by
                the current staked total. Calendar APY surfaces once the pool
                accumulates a multi week reward history.
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="card">
                <div className="text-xs uppercase text-[var(--bull-dim)] tracking-wider mb-2">
                  Your stake
                </div>
                <div className="text-xl font-bold">
                  {fmt(position?.amount ?? BigInt(0))}
                </div>
              </div>
              <div className="card">
                <div className="text-xs uppercase text-[var(--bull-dim)] tracking-wider mb-2">
                  Your wallet
                </div>
                <div className="text-xl font-bold">{fmt(walletBalance)}</div>
              </div>
              <div className="card">
                <div className="text-xs uppercase text-[var(--bull-dim)] tracking-wider mb-2">
                  Pending rewards
                </div>
                <div className="text-xl font-bold text-[var(--bull-accent)]">
                  {fmt(pending)}
                </div>
              </div>
            </div>

            <div className="card mb-6">
              <div className="text-xs uppercase text-[var(--bull-dim)] tracking-wider mb-3">
                Stake
              </div>
              <input
                type="text"
                value={stakeAmount}
                onChange={(e) => setStakeAmount(e.target.value)}
                placeholder="Amount in $WBULL"
                className="w-full px-3 py-2 rounded-md bg-[#0e0e12] border border-[#2a2a32] text-sm font-mono mb-3"
              />
              <button
                onClick={submitStake}
                disabled={busy || walletBalance === BigInt(0)}
                className="btn btn-primary w-full"
              >
                {busy ? "Working..." : "Stake"}
              </button>
            </div>

            <div className="card mb-6">
              <div className="text-xs uppercase text-[var(--bull-dim)] tracking-wider mb-3">
                Unstake
              </div>
              <input
                type="text"
                value={unstakeAmount}
                onChange={(e) => setUnstakeAmount(e.target.value)}
                placeholder="Amount in $WBULL"
                className="w-full px-3 py-2 rounded-md bg-[#0e0e12] border border-[#2a2a32] text-sm font-mono mb-3"
              />
              <button
                onClick={submitUnstake}
                disabled={busy || !position || position.amount === BigInt(0)}
                className="btn btn-secondary w-full"
              >
                {busy ? "Working..." : "Unstake"}
              </button>
              <div className="text-xs text-[var(--bull-dim)] mt-3 leading-relaxed">
                Unstake settles pending rewards in the same tx. V1 closes the
                position PDA on every unstake (full or partial), so the next
                stake pays a small fresh rent. No lock period.
              </div>
            </div>

            <div className="card mb-6">
              <div className="text-xs uppercase text-[var(--bull-dim)] tracking-wider mb-3">
                Claim
              </div>
              <button
                onClick={submitClaim}
                disabled={busy || pending === BigInt(0)}
                className="btn btn-primary w-full"
              >
                {busy
                  ? "Working..."
                  : pending === BigInt(0)
                    ? "Nothing to claim"
                    : `Claim ${fmt(pending)} $WBULL`}
              </button>
            </div>

            {status && (
              <div
                className={`text-sm break-words rounded-md px-3 py-2 mb-6 ${
                  status.startsWith("Stake failed") ||
                  status.startsWith("Unstake failed") ||
                  status.startsWith("Claim failed")
                    ? "bg-[#2a1414] border border-[#5a2828] text-[#ff8a8a]"
                    : status.startsWith("Staked") ||
                        status.startsWith("Unstaked") ||
                        status.startsWith("Claimed")
                      ? "bg-[#142a14] border border-[#285a28] text-[#8aff8a]"
                      : "text-[var(--bull-dim)]"
                }`}
              >
                {status}
              </div>
            )}
          </>
        )
      )}
    </main>
  );
}
