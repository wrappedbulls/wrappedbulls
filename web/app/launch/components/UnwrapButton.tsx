// UnwrapButton: client island for the "Unwrap" CTA on /launch/[slug].
//
// Unwrap needs the user to specify which tier they hold + want to drain.
// In v1.1 we keep it simple: a small inline input next to the button. The
// on-chain handler enforces NotNftHolder if the user doesn't actually
// own the NFT, so we don't bother with a separate ownership preflight --
// the unwrap-tx route catches "no BullAsset" before we ever sign.
//
// Optional follow-up (v1.2): auto-list the user's held NFTs by scanning
// getTokenAccountsByOwner filtered to the collection's mints. Out of scope
// for this iteration.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";

interface Props {
  tokenMint: string;
  collectionTicker: string;
  maxSupply: number;
}

type Phase = "idle" | "building" | "awaiting-signature" | "confirming" | "success" | "error";

export default function UnwrapButton({ tokenMint, collectionTicker, maxSupply }: Props) {
  const router = useRouter();
  const { connection } = useConnection();
  const wallet = useWallet();
  const [tierInput, setTierInput] = useState<string>("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const tierIndex = parseInt(tierInput, 10);
  const validTier = Number.isInteger(tierIndex) && tierIndex >= 1 && tierIndex <= maxSupply;

  const run = async () => {
    if (!wallet.publicKey || !wallet.sendTransaction) {
      setError("connect a wallet first");
      setPhase("error");
      return;
    }
    if (!validTier) {
      setError(`enter a tier between 1 and ${maxSupply}`);
      setPhase("error");
      return;
    }
    setError(null);
    setPhase("building");
    try {
      const r = await fetch("/api/factory/unwrap-tx", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          holder: wallet.publicKey.toBase58(),
          tokenMint,
          tierIndex,
        }),
      });
      const json = await r.json();
      if (!json.ok) throw new Error(json.error || "unwrap-tx route returned an error");

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

      setPhase("success");
      router.refresh();
    } catch (e) {
      setError((e as Error).message || "unwrap failed");
      setPhase("error");
    }
  };

  const buttonLabel =
    phase === "idle"               ? `[ UNWRAP ${collectionTicker} #${validTier ? tierIndex : "?"} ]`
  : phase === "building"           ? "[ BUILDING TX… ]"
  : phase === "awaiting-signature" ? "[ AWAITING WALLET… ]"
  : phase === "confirming"         ? "[ CONFIRMING… ]"
  : phase === "success"            ? "[ ✓ UNWRAPPED ]"
  : "[ TRY AGAIN ]";

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <input
        type="text"
        value={tierInput}
        onChange={(e) => setTierInput(e.target.value.replace(/[^\d]/g, ""))}
        placeholder="tier #"
        disabled={phase !== "idle" && phase !== "error"}
        style={{
          width: 80,
          padding: "8px 10px",
          border: "2px solid var(--bull-ink)",
          background: "var(--bull-paper)",
          fontFamily: "inherit",
          fontSize: 13,
        }}
      />
      <button
        type="button"
        onClick={run}
        disabled={(phase !== "idle" && phase !== "error") || !validTier}
        className="btn btn-secondary"
      >
        {buttonLabel}
      </button>
      {error && (
        <div style={{ width: "100%", fontSize: 11, color: "#8a1212", marginTop: 4 }}>
          ✗ {error}
        </div>
      )}
    </div>
  );
}
