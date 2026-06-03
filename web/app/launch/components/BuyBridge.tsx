// BuyBridge: client island for /launch/[slug].
//
// When a visitor lands on a deployment page and their wallet doesn't
// hold enough of the deployment's target token to wrap, we surface a
// Jupiter swap card "buy X tokens for Y SOL" right above the Wrap CTA.
// Closes the discoverability loop: instead of bouncing them to pump.fun
// or telling them to "go acquire the token first," they swap inline,
// the page refreshes, and Wrap is one click away.
//
// Two transactions, not one:
//   1. Jupiter swap tx (VersionedTransaction). Wallet signs + sends.
//   2. Wrap tx (legacy Transaction, built by /api/factory/wrap-tx).
//      User signs that in a second wallet popup via the existing
//      WrapButton component, which automatically becomes clickable
//      once the swap settles (router.refresh re-reads balance).
//
// Mixing VersionedTransaction + legacy Transaction in one
// signAllTransactions is fragile across wallet adapter versions; two
// signs is an acceptable trade off for v1.

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";
import { getQuote, buildSwapTx, type QuoteResponse } from "@/lib/jupiter";

const SOL_MINT = "So11111111111111111111111111111111111111112";
// pump.fun tokens use 6 decimals. We assume the same here for display.
// If a Factory deployment ever targets a non pump.fun mint with different
// decimals, the UI numbers will look off until we read decimals from chain.
const ASSUMED_DECIMALS = 6;
const DECIMAL_FACTOR = 1_000_000n; // 10^6

interface Props {
  tokenMint: string;
  tokensPerWrap: string; // base units stringified bigint
  collectionTicker: string;
}

export default function BuyBridge({ tokenMint, tokensPerWrap, collectionTicker }: Props) {
  const router = useRouter();
  const { connection } = useConnection();
  const wallet = useWallet();

  const [balance, setBalance] = useState<bigint | null>(null);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");

  const requiredBig = (() => {
    try {
      return BigInt(tokensPerWrap);
    } catch {
      return 0n;
    }
  })();

  // Read user's target token balance whenever the wallet or mint changes.
  useEffect(() => {
    if (!wallet.publicKey) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const mintPk = new PublicKey(tokenMint);
        const mintInfo = await connection.getAccountInfo(mintPk);
        if (!mintInfo) {
          if (!cancelled) setBalance(0n);
          return;
        }
        const tokenProgram = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
          ? TOKEN_2022_PROGRAM_ID
          : TOKEN_PROGRAM_ID;
        const ata = getAssociatedTokenAddressSync(
          mintPk, wallet.publicKey!, false, tokenProgram,
        );
        try {
          const acct = await getAccount(connection, ata, undefined, tokenProgram);
          if (!cancelled) setBalance(acct.amount);
        } catch {
          if (!cancelled) setBalance(0n);
        }
      } catch {
        if (!cancelled) setBalance(0n);
      }
    })();
    return () => { cancelled = true; };
  }, [wallet.publicKey, tokenMint, connection]);

  const needed = balance === null || balance >= requiredBig ? 0n : requiredBig - balance;

  // Auto fetch a Jupiter quote when there's a deficit.
  useEffect(() => {
    if (needed === 0n) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getQuote({
      inputMint: SOL_MINT,
      outputMint: tokenMint,
      amountAtoms: needed,
      slippageBps: 100,
    })
      .then((q) => { if (!cancelled) setQuote(q); })
      .catch((e) => { if (!cancelled) setError(String(e.message ?? e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [needed, tokenMint]);

  async function handleSwap() {
    if (!wallet.publicKey || !wallet.signTransaction || !quote) return;
    setBusy(true);
    setError(null);
    try {
      setStatus("Building swap...");
      const swapTx = await buildSwapTx({
        quote,
        userPublicKey: wallet.publicKey.toBase58(),
      });
      setStatus("Approve the swap in your wallet...");
      const signed = await wallet.signTransaction(swapTx);
      setStatus("Submitting swap to the chain...");
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
      });
      setStatus("Waiting for swap confirmation...");
      const latest = await connection.getLatestBlockhash();
      await connection.confirmTransaction(
        {
          signature: sig,
          blockhash: latest.blockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight,
        },
        "confirmed",
      );
      setStatus(`Swap landed. Refreshing balance...`);
      router.refresh();
      // Soft re-read balance so the card disappears + Wrap button enables
      // without waiting for the server component to round trip.
      try {
        const mintPk = new PublicKey(tokenMint);
        const mintInfo = await connection.getAccountInfo(mintPk);
        if (mintInfo) {
          const tokenProgram = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
            ? TOKEN_2022_PROGRAM_ID
            : TOKEN_PROGRAM_ID;
          const ata = getAssociatedTokenAddressSync(
            mintPk, wallet.publicKey, false, tokenProgram,
          );
          const acct = await getAccount(connection, ata, undefined, tokenProgram);
          setBalance(acct.amount);
        }
      } catch {
        // refresh will catch up; nothing to do here
      }
    } catch (e: any) {
      setError(String(e.message ?? e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  // Render conditions:
  //  - hide if wallet not connected (let the page show "connect wallet")
  //  - hide if balance is still being read (no flashing)
  //  - hide if balance is enough (WrapButton handles it)
  if (!wallet.publicKey || balance === null || balance >= requiredBig) {
    return null;
  }

  const solIn = quote ? Number(BigInt(quote.inAmount)) / 1_000_000_000 : null;
  const needWhole = Number((needed * 10000n) / DECIMAL_FACTOR) / 10000;
  const balanceWhole = Number((balance * 10000n) / DECIMAL_FACTOR) / 10000;
  const priceImpact = quote ? parseFloat(quote.priceImpactPct) : null;

  return (
    <div
      style={{
        border: "3px solid #d4a017",
        background: "var(--bull-very-soft)",
        padding: 16,
        marginBottom: 16,
        maxWidth: 540,
      }}
    >
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "#b35d00", fontWeight: 800, marginBottom: 10 }}>
        Buy bridge (powered by Jupiter)
      </div>
      <div style={{ fontSize: 13, color: "var(--bull-ink)", marginBottom: 12, lineHeight: 1.5 }}>
        Need {needWhole.toLocaleString(undefined, { maximumFractionDigits: 0 })} more ${collectionTicker} to wrap. You hold {balanceWhole.toLocaleString(undefined, { maximumFractionDigits: 2 })}. Buy the rest in one tap, then wrap.
      </div>
      {loading && (
        <div style={{ fontSize: 12, color: "var(--bull-dim)" }}>Fetching best price...</div>
      )}
      {error && (
        <div style={{ fontSize: 12, color: "#8a1212", marginBottom: 8, wordBreak: "break-word" }}>
          {error}
        </div>
      )}
      {quote && solIn !== null && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--bull-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                You pay
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                {solIn.toFixed(4)} SOL
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--bull-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                You receive
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#b35d00", fontVariantNumeric: "tabular-nums" }}>
                {needWhole.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${collectionTicker}
              </div>
            </div>
          </div>
          {priceImpact !== null && priceImpact > 1 && (
            <div style={{ fontSize: 11, color: "#b35d00", marginBottom: 8 }}>
              Price impact: {priceImpact.toFixed(2)}% (low liquidity; consider buying a smaller amount manually first)
            </div>
          )}
          <button
            onClick={handleSwap}
            disabled={busy}
            className="btn btn-primary"
            style={{ width: "100%" }}
          >
            {busy
              ? "Working..."
              : `[ BUY ${needWhole.toLocaleString(undefined, { maximumFractionDigits: 0 })} $${collectionTicker} FOR ${solIn.toFixed(4)} SOL → ]`}
          </button>
          {status && (
            <div style={{ fontSize: 12, color: "var(--bull-dim)", marginTop: 10 }}>
              {status}
            </div>
          )}
        </>
      )}
    </div>
  );
}
