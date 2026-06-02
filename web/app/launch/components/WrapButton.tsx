// WrapButton: client island for the "Wrap" CTA on /launch/[slug].
//
// Flow:
//   1. user clicks
//   2. POST /api/factory/wrap-tx with { wrapper, tokenMint }
//   3. server picks the next tier from on-chain state, builds + returns
//      the unsigned tx
//   4. wallet.sendTransaction()
//   5. confirmTransaction()
//   6. router.refresh() so the surrounding server component re-fetches
//      and shows the new counters
//
// The dashboard page stays a server component; only this little island
// pulls in the wallet adapter + dynamic state.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";

interface Props {
  tokenMint: string;
  collectionTicker: string;
  tokensPerWrap: string;  // base units, stringified bigint
  /** Hide button when collection is fully wrapped. Computed server side. */
  available: boolean;
}

type Phase = "idle" | "building" | "awaiting-signature" | "confirming" | "success" | "error";

export default function WrapButton({ tokenMint, collectionTicker, tokensPerWrap, available }: Props) {
  const router = useRouter();
  const { connection } = useConnection();
  const wallet = useWallet();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [resultTier, setResultTier] = useState<number | null>(null);

  const run = async () => {
    if (!wallet.publicKey || !wallet.sendTransaction) {
      setError("connect a wallet first");
      setPhase("error");
      return;
    }
    setError(null);
    setPhase("building");
    try {
      const r = await fetch("/api/factory/wrap-tx", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          wrapper: wallet.publicKey.toBase58(),
          tokenMint,
        }),
      });
      const json = await r.json();
      if (!json.ok) throw new Error(json.error || "wrap-tx route returned an error");

      const tx = Transaction.from(Buffer.from(json.txB64, "base64"));

      setPhase("awaiting-signature");
      const sig = await wallet.sendTransaction(tx, connection, {
        skipPreflight: false,
        maxRetries: 3,
      });

      setPhase("confirming");
      await connection.confirmTransaction(
        { signature: sig, blockhash: json.blockhash, lastValidBlockHeight: json.lastValidBlockHeight },
        "confirmed",
      );

      setResultTier(json.tierIndex);
      setPhase("success");
      // Re-fetch the server component so counts update.
      router.refresh();
    } catch (e) {
      setError((e as Error).message || "wrap failed");
      setPhase("error");
    }
  };

  if (!available) {
    return (
      <button type="button" disabled className="btn btn-secondary" title="this wrap layer is fully wrapped">
        [ FULLY WRAPPED ]
      </button>
    );
  }

  const label =
    phase === "idle"               ? `[ WRAP ${formatTokens(tokensPerWrap)} → ]`
  : phase === "building"           ? "[ BUILDING TX… ]"
  : phase === "awaiting-signature" ? "[ AWAITING WALLET… ]"
  : phase === "confirming"         ? "[ CONFIRMING… ]"
  : phase === "success"            ? `[ ✓ WRAPPED ${collectionTicker} #${resultTier} ]`
  : "[ TRY AGAIN ]";

  return (
    <div style={{ display: "inline-block" }}>
      <button
        type="button"
        onClick={run}
        disabled={phase !== "idle" && phase !== "error"}
        className="btn btn-primary"
      >
        {label}
      </button>
      {error && (
        <div style={{ marginTop: 8, fontSize: 11, color: "#8a1212", maxWidth: 300 }}>
          ✗ {error}
        </div>
      )}
    </div>
  );
}

// Compact display: show "5,000,000,000,000 base units" as "5M" when it's a
// round million, otherwise show with thousand separators.
function formatTokens(baseUnits: string): string {
  // Heuristic: 6-decimal pump.fun tokens. 1e6 base units = 1 whole.
  // 5e12 base = 5,000,000 whole = "5M". We don't strictly know the
  // decimals here, so fall through to thousand-separator formatting
  // for non-round numbers.
  try {
    const big = BigInt(baseUnits);
    const million = BigInt(1_000_000_000_000); // 1M with 6 decimals
    if (big % million === 0n) {
      const whole = big / million;
      return `${whole.toString()}M`;
    }
  } catch {}
  let s = baseUnits;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ",";
    out += s[i];
  }
  return out;
}
