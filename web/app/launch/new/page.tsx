// /launch/new — the 5 step wizard for launching a wrap layer.
//
// Week 2: chain-wired version.
//   step 1 -> /api/factory/preflight (validate token mint, surface
//             existing-deployment conflict)
//   step 2 -> /api/factory/check-name (ticker uniqueness scan)
//   step 5 -> /api/factory/deploy-tx (server-built unsigned tx) +
//             wallet.sendTransaction
//
// Connection: wallet adapter (Phantom / Solflare). The connect-button is
// surfaced as the first ask on step 5 if the wallet isn't already connected.

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";

// Constants mirror the on-chain WrappedFactory program. Keep in lockstep
// with state.rs. If MAX_SUPPLY ever moves (e.g. realloc upgrade), update
// here AND in lib/factory.ts.
const MIN_SUPPLY = 100;
const MAX_SUPPLY = 2_000;
const MAX_NAME_LEN = 25;
const MAX_TICKER_LEN = 10;
const MAX_URI_LEN = 195;
const DEPLOY_COST_WBULL = 1_000_000;

type ArtSourceType = "baseUri" | "rendererUrl";

interface WizardData {
  tokenMint:        string;
  name:             string;
  ticker:           string;
  maxSupply:        number;
  tokensPerWrap:    string;
  artSourceType:    ArtSourceType;
  artSourceUrl:     string;
  collectionUri:    string;
  acknowledged:     boolean;
}

const INITIAL_DATA: WizardData = {
  tokenMint:     "",
  name:          "",
  ticker:        "",
  maxSupply:     500,
  tokensPerWrap: "",
  artSourceType: "baseUri",
  artSourceUrl:  "",
  collectionUri: "",
  acknowledged:  false,
};

// Server response types (mirror the API route shapes). Loosely typed because
// the routes already validate; the client only needs to surface user-friendly
// messages, not exhaustively parse.
interface PreflightOK {
  ok: true;
  mint: string;
  decimals: number;
  supply: string;
  mintAuthority: string | null;
  collectionPda: string;
  collectionExists: boolean;
  existingDeployment?: {
    name: string;
    ticker: string;
    deployer: string;
  };
}
interface PreflightErr { ok: false; error: string; code: string }
type PreflightResponse = PreflightOK | PreflightErr;

interface CheckNameOK { ok: true; available: boolean; conflict?: { name: string; ticker: string } }
interface CheckNameErr { ok: false; error: string }
type CheckNameResponse = CheckNameOK | CheckNameErr;

// =====================================================================
// Page component
// =====================================================================
export default function LaunchWizardPage() {
  const router = useRouter();
  const { connection } = useConnection();
  const wallet = useWallet();

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [data, setData] = useState<WizardData>(INITIAL_DATA);

  // Async-validation state. Each lookup tracks its own loading + result so
  // the user sees green/red signals next to the field they just edited.
  const [preflight, setPreflight] = useState<PreflightResponse | "loading" | null>(null);
  const [checkName, setCheckName] = useState<CheckNameResponse | "loading" | null>(null);

  // Deploy phase state. Distinct "phase" strings simplify the step 5 button.
  const [deployPhase, setDeployPhase] = useState<
    | "idle"
    | "building-tx"
    | "awaiting-signature"
    | "confirming"
    | "success"
    | "error"
  >("idle");
  const [deployError, setDeployError] = useState<string | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);

  const update = <K extends keyof WizardData>(key: K, value: WizardData[K]) =>
    setData((d) => ({ ...d, [key]: value }));

  // ------- Debounced preflight on step 1 (mint) -------
  useEffect(() => {
    if (step !== 1) return;
    if (!data.tokenMint || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(data.tokenMint)) {
      setPreflight(null);
      return;
    }
    setPreflight("loading");
    const handle = setTimeout(async () => {
      try {
        const r = await fetch(`/api/factory/preflight?mint=${encodeURIComponent(data.tokenMint)}`, { cache: "no-store" });
        const json = (await r.json()) as PreflightResponse;
        setPreflight(json);
      } catch (e) {
        setPreflight({ ok: false, error: (e as Error).message, code: "network" });
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [step, data.tokenMint]);

  // ------- Debounced check-name on step 2 (ticker) -------
  useEffect(() => {
    if (step !== 2) return;
    if (!data.ticker || !/^[A-Z0-9]{1,10}$/.test(data.ticker)) {
      setCheckName(null);
      return;
    }
    setCheckName("loading");
    const handle = setTimeout(async () => {
      try {
        const r = await fetch(`/api/factory/check-name?ticker=${encodeURIComponent(data.ticker)}`, { cache: "no-store" });
        const json = (await r.json()) as CheckNameResponse;
        setCheckName(json);
      } catch (e) {
        setCheckName({ ok: false, error: (e as Error).message });
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [step, data.ticker]);

  // ------- Per-step validation -------
  const stepError = useMemo<string | null>(() => {
    switch (step) {
      case 1:
        if (!data.tokenMint) return "paste a pump.fun token mint address to continue";
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(data.tokenMint)) return "this does not look like a valid solana pubkey";
        if (preflight === null) return "still checking…";
        if (preflight === "loading") return "checking on chain…";
        if (!preflight.ok) return preflight.error;
        if (preflight.collectionExists)
          return `this token already has a wrap layer: ${preflight.existingDeployment?.name ?? "?"} (${preflight.existingDeployment?.ticker ?? "?"})`;
        return null;
      case 2:
        if (!data.name) return "give your wrap layer a name";
        if (data.name.length > MAX_NAME_LEN) return `name must be ≤ ${MAX_NAME_LEN} ascii chars`;
        if (!/^[\x20-\x7e]+$/.test(data.name)) return "name must be plain ascii";
        if (!data.ticker) return "give your wrap layer a ticker";
        if (data.ticker.length > MAX_TICKER_LEN) return `ticker must be ≤ ${MAX_TICKER_LEN} ascii chars`;
        if (!/^[A-Z0-9]+$/.test(data.ticker)) return "ticker must be uppercase ascii letters + digits";
        if (checkName === "loading") return "checking ticker availability…";
        if (checkName && checkName.ok && checkName.available === false)
          return `ticker $${data.ticker} is already taken by ${checkName.conflict?.name ?? "another layer"}`;
        if (checkName && checkName.ok === false) return checkName.error;
        return null;
      case 3: {
        if (data.maxSupply < MIN_SUPPLY || data.maxSupply > MAX_SUPPLY)
          return `max supply must be between ${MIN_SUPPLY.toLocaleString()} and ${MAX_SUPPLY.toLocaleString()}`;
        if (!data.tokensPerWrap) return "set how many tokens lock per wrap";
        if (!/^\d+$/.test(data.tokensPerWrap)) return "tokens per wrap must be a positive integer";
        try { if (BigInt(data.tokensPerWrap) <= 0n) return "tokens per wrap must be > 0"; }
        catch { return "tokens per wrap is not a valid number"; }
        return null;
      }
      case 4: {
        if (!data.artSourceUrl) return "provide the URL where your per-NFT metadata lives";
        if (data.artSourceUrl.length > MAX_URI_LEN) return `art URL must be ≤ ${MAX_URI_LEN} chars`;
        if (!/^https?:\/\//.test(data.artSourceUrl)) return "art URL must start with https:// or http://";
        if (/\s$/.test(data.artSourceUrl)) return "art URL must not end with whitespace";
        if (!data.collectionUri) return "provide the URL where your collection-level metadata lives";
        if (data.collectionUri.length > MAX_URI_LEN) return `collection URL must be ≤ ${MAX_URI_LEN} chars`;
        if (!/^https?:\/\//.test(data.collectionUri)) return "collection URL must start with https:// or http://";
        return null;
      }
      case 5:
        if (!wallet.connected) return "connect your wallet to deploy";
        if (!data.acknowledged) return "tick the acknowledgement checkbox before deploying";
        return null;
    }
  }, [step, data, preflight, checkName, wallet.connected]);

  const next = () => { if (stepError) return; if (step < 5) setStep((step + 1) as 1 | 2 | 3 | 4 | 5); };
  const back = () => step > 1 && setStep((step - 1) as 1 | 2 | 3 | 4 | 5);

  // ------- Step 5: deploy flow -------
  const deploy = async () => {
    if (!wallet.publicKey || !wallet.sendTransaction) {
      setDeployError("wallet not ready");
      setDeployPhase("error");
      return;
    }
    setDeployError(null);
    setDeployPhase("building-tx");
    try {
      const r = await fetch("/api/factory/deploy-tx", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          deployer:       wallet.publicKey.toBase58(),
          tokenMint:      data.tokenMint,
          name:           data.name,
          ticker:         data.ticker,
          maxSupply:      data.maxSupply,
          tokensPerWrap:  data.tokensPerWrap,
          artSource:      { kind: data.artSourceType, uri: data.artSourceUrl },
          collectionUri:  data.collectionUri,
        }),
      });
      const json = await r.json();
      if (!json.ok) throw new Error(json.error || "deploy-tx route returned an error");

      const txBytes = Buffer.from(json.txB64, "base64");
      const tx = Transaction.from(txBytes);

      setDeployPhase("awaiting-signature");
      const sig = await wallet.sendTransaction(tx, connection, {
        skipPreflight: false,
        maxRetries: 3,
      });
      setTxSig(sig);

      setDeployPhase("confirming");
      await connection.confirmTransaction(
        { signature: sig, blockhash: json.blockhash, lastValidBlockHeight: json.lastValidBlockHeight },
        "confirmed",
      );
      setDeployPhase("success");

      // Redirect to the new launch's dashboard once the chain has confirmed.
      router.push(`/launch/${data.tokenMint}`);
    } catch (e) {
      setDeployError((e as Error).message || "deploy failed");
      setDeployPhase("error");
    }
  };

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-8">
        <div style={{ color: "var(--bull-dim)", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
          factory / new
        </div>
        <h1 className="h1">LAUNCH A WRAP LAYER</h1>
        <p className="text-[var(--bull-dim)] mt-3 text-sm" style={{ maxWidth: 600 }}>
          five steps. each one validated before the next. nothing irreversible until step five.
        </p>
      </div>

      <Stepper step={step} />

      <div className="card" style={{ padding: 24, marginTop: 24 }}>
        {step === 1 && <Step1Token data={data} update={update} preflight={preflight} />}
        {step === 2 && <Step2Name  data={data} update={update} checkName={checkName} />}
        {step === 3 && <Step3Econ  data={data} update={update} />}
        {step === 4 && <Step4Art   data={data} update={update} />}
        {step === 5 && (
          <Step5Review
            data={data}
            update={update}
            deployPhase={deployPhase}
            deployError={deployError}
            txSig={txSig}
          />
        )}

        {stepError && deployPhase !== "success" && (
          <div style={{ marginTop: 16, padding: 12, border: "2px dashed #b35d00", color: "#b35d00", fontSize: 12, background: "#fff8e6" }}>
            <strong style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>blocker:</strong> {stepError}
          </div>
        )}

        <div style={{ display: "flex", gap: 12, marginTop: 24, justifyContent: "space-between" }}>
          {step > 1 ? (
            <button type="button" onClick={back} className="btn btn-secondary" disabled={deployPhase !== "idle" && step === 5}>
              [ ← BACK ]
            </button>
          ) : (
            <Link href="/launch" className="btn btn-secondary">[ ← CANCEL ]</Link>
          )}
          {step < 5 ? (
            <button type="button" onClick={next} disabled={!!stepError} className="btn btn-primary">
              [ CONTINUE → ]
            </button>
          ) : (
            <button
              type="button"
              onClick={deploy}
              disabled={!!stepError || deployPhase !== "idle"}
              className="btn btn-primary"
            >
              {deployPhase === "idle"               && `[ DEPLOY ${data.name.toUpperCase() || "WRAPPED…"} ]`}
              {deployPhase === "building-tx"        && "[ BUILDING TX… ]"}
              {deployPhase === "awaiting-signature" && "[ AWAITING WALLET SIGNATURE… ]"}
              {deployPhase === "confirming"         && "[ CONFIRMING ON CHAIN… ]"}
              {deployPhase === "success"            && "[ ✓ DEPLOYED — REDIRECTING ]"}
              {deployPhase === "error"              && "[ TRY AGAIN ]"}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

// =====================================================================
// Stepper
// =====================================================================
function Stepper({ step }: { step: number }) {
  const labels = ["TOKEN", "NAME", "ECONOMICS", "ART", "REVIEW"];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", border: "2px solid var(--bull-ink)" }}>
      {labels.map((label, i) => {
        const idx = i + 1;
        const isDone = step > idx;
        const isCurrent = step === idx;
        return (
          <div
            key={label}
            style={{
              padding: "12px 8px",
              borderRight: i < 4 ? "2px solid var(--bull-ink)" : undefined,
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              textAlign: "center",
              background: isDone ? "var(--bull-ink)" : isCurrent ? "#d4a017" : "var(--bull-paper)",
              color: isDone ? "var(--bull-paper)" : "var(--bull-ink)",
              fontWeight: isCurrent ? 800 : 500,
            }}
          >
            <span style={{ marginRight: 6, opacity: isCurrent ? 1 : 0.6 }}>0{idx}</span>
            {label}
          </div>
        );
      })}
    </div>
  );
}

// =====================================================================
// Step components
// =====================================================================
interface BaseStepProps {
  data: WizardData;
  update: <K extends keyof WizardData>(key: K, value: WizardData[K]) => void;
}

function Step1Token({
  data,
  update,
  preflight,
}: BaseStepProps & { preflight: PreflightResponse | "loading" | null }) {
  return (
    <div>
      <StepHeader num="01" title="PICK YOUR TOKEN" />
      <p style={{ color: "var(--bull-dim)", marginBottom: 16, fontSize: 13 }}>
        paste the mint address of any pump.fun token. the factory will sandbox
        a fresh wrap layer at <code>PDA([&quot;collection&quot;, token_mint])</code>.
      </p>
      <Field
        label="token mint"
        hint="44 character base58 solana pubkey"
        value={data.tokenMint}
        onChange={(v) => update("tokenMint", v.trim())}
        placeholder="9XdN…4cQk"
      />
      {preflight === "loading" && <Status tone="dim">checking on chain…</Status>}
      {preflight && preflight !== "loading" && preflight.ok && !preflight.collectionExists && (
        <Status tone="good">
          ✓ valid mint. decimals={preflight.decimals}, supply={preflight.supply}.{" "}
          {preflight.mintAuthority ? "⚠️ mint authority is set (can still inflate)" : "✓ mint authority null (supply locked)"}.
        </Status>
      )}
      {preflight && preflight !== "loading" && preflight.ok && preflight.collectionExists && (
        <Status tone="warn">
          this mint already has a wrap layer: <strong>{preflight.existingDeployment?.name}</strong> ($
          {preflight.existingDeployment?.ticker}). pick a different mint.
        </Status>
      )}
      {preflight && preflight !== "loading" && !preflight.ok && (
        <Status tone="bad">✗ {preflight.error}</Status>
      )}
    </div>
  );
}

function Step2Name({
  data,
  update,
  checkName,
}: BaseStepProps & { checkName: CheckNameResponse | "loading" | null }) {
  return (
    <div>
      <StepHeader num="02" title="NAME YOUR WRAP LAYER" />
      <p style={{ color: "var(--bull-dim)", marginBottom: 16, fontSize: 13 }}>
        becomes the on-chain collection name + symbol. shows on magic eden,
        tensor, phantom, and every wrappedbulls dashboard.
      </p>
      <Field
        label="name"
        hint={`uppercase + lowercase ascii, ≤ ${MAX_NAME_LEN} chars`}
        value={data.name}
        placeholder="WrappedDoge"
        onChange={(v) => update("name", v)}
        max={MAX_NAME_LEN}
      />
      <Field
        label="ticker"
        hint={`uppercase letters + digits only, ≤ ${MAX_TICKER_LEN} chars`}
        value={data.ticker}
        placeholder="WDOGE"
        onChange={(v) => update("ticker", v.toUpperCase())}
        max={MAX_TICKER_LEN}
      />
      {checkName === "loading" && <Status tone="dim">checking ticker availability…</Status>}
      {checkName && checkName !== "loading" && checkName.ok && checkName.available && (
        <Status tone="good">✓ ticker $${data.ticker} is available</Status>
      )}
      {checkName && checkName !== "loading" && checkName.ok && !checkName.available && (
        <Status tone="warn">
          ✗ ticker $${data.ticker} is taken by{" "}
          <strong>{checkName.conflict?.name}</strong>. pick another.
        </Status>
      )}
      {checkName && checkName !== "loading" && !checkName.ok && (
        <Status tone="bad">✗ {checkName.error}</Status>
      )}
    </div>
  );
}

function Step3Econ({ data, update }: BaseStepProps) {
  return (
    <div>
      <StepHeader num="03" title="CONFIGURE WRAP ECONOMICS" />
      <p style={{ color: "var(--bull-dim)", marginBottom: 16, fontSize: 13 }}>
        these fields are LOCKED at deploy time. they cannot be changed without
        a fresh deployment, so pick deliberately.
      </p>
      <div style={{ marginBottom: 20 }}>
        <Label hint={`min ${MIN_SUPPLY}, max ${MAX_SUPPLY.toLocaleString()} for v1`}>max supply</Label>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 6 }}>
          <input
            type="range"
            min={MIN_SUPPLY}
            max={MAX_SUPPLY}
            step={100}
            value={data.maxSupply}
            onChange={(e) => update("maxSupply", parseInt(e.target.value, 10))}
            style={{ flex: 1 }}
          />
          <div style={{ minWidth: 80, fontWeight: 800, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
            {data.maxSupply.toLocaleString()}
          </div>
        </div>
      </div>
      <Field
        label="tokens per wrap"
        hint="base units of the target token (apply mint decimals yourself)"
        value={data.tokensPerWrap}
        placeholder="5000000000000"
        onChange={(v) => update("tokensPerWrap", v.replace(/[^\d]/g, ""))}
      />
      <div style={{ marginTop: 16, padding: 12, background: "var(--bull-very-soft)", fontSize: 12, color: "var(--bull-dim)" }}>
        <strong style={{ color: "var(--bull-ink)" }}>at full wrap:</strong>{" "}
        {data.maxSupply.toLocaleString()} NFTs × {data.tokensPerWrap || "?"} tokens ={" "}
        {data.tokensPerWrap ? (BigInt(data.maxSupply) * BigInt(data.tokensPerWrap || "0")).toString() : "?"}{" "}
        base units of the target token locked forever (until unwraps).
      </div>
    </div>
  );
}

function Step4Art({ data, update }: BaseStepProps) {
  return (
    <div>
      <StepHeader num="04" title="ART SOURCE" />
      <p style={{ color: "var(--bull-dim)", marginBottom: 16, fontSize: 13 }}>
        choose how each wrapped NFT gets its image and metadata. your project
        hosts this — we just point Metaplex to your URL.
      </p>
      <div style={{ display: "flex", border: "2px solid var(--bull-ink)", marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => update("artSourceType", "baseUri")}
          style={{
            flex: 1, padding: 12,
            background: data.artSourceType === "baseUri" ? "var(--bull-ink)" : "transparent",
            color: data.artSourceType === "baseUri" ? "var(--bull-paper)" : "var(--bull-ink)",
            border: "none", fontFamily: "inherit", fontWeight: 800, letterSpacing: "0.08em",
            cursor: "pointer", fontSize: 11,
          }}
        >
          BASE URI
        </button>
        <button
          type="button"
          onClick={() => update("artSourceType", "rendererUrl")}
          style={{
            flex: 1, padding: 12,
            background: data.artSourceType === "rendererUrl" ? "var(--bull-ink)" : "transparent",
            color: data.artSourceType === "rendererUrl" ? "var(--bull-paper)" : "var(--bull-ink)",
            border: "none", fontFamily: "inherit", fontWeight: 800, letterSpacing: "0.08em",
            cursor: "pointer", fontSize: 11,
          }}
        >
          RENDERER URL
        </button>
      </div>
      <Field
        label={data.artSourceType === "baseUri" ? "URI prefix" : "renderer endpoint"}
        hint={
          data.artSourceType === "baseUri"
            ? `we append the tier index, e.g. ${data.artSourceUrl || "{prefix}"}1, ${data.artSourceUrl || "{prefix}"}2 …`
            : "we will GET this endpoint with ?tier=N appended per NFT"
        }
        value={data.artSourceUrl}
        placeholder={
          data.artSourceType === "baseUri"
            ? "https://wrappeddoge.com/api/metadata/"
            : "https://wrappeddoge.com/render?tier="
        }
        onChange={(v) => update("artSourceUrl", v.trim())}
      />
      <Field
        label="collection-level URI"
        hint="metaplex MCC parent NFT metadata. holds the collection icon + name + description."
        value={data.collectionUri}
        placeholder="https://wrappeddoge.com/api/collection"
        onChange={(v) => update("collectionUri", v.trim())}
      />
    </div>
  );
}

function Step5Review({
  data,
  update,
  deployPhase,
  deployError,
  txSig,
}: BaseStepProps & {
  deployPhase: string;
  deployError: string | null;
  txSig: string | null;
}) {
  const wallet = useWallet();
  return (
    <div>
      <StepHeader num="05" title="REVIEW + DEPLOY" />
      <p style={{ color: "var(--bull-dim)", marginBottom: 16, fontSize: 13 }}>
        last screen before the deploy tx. read everything. once you sign,
        the 1M $WBULL goes to the bull treasury and the wrap layer is live.
      </p>

      {!wallet.connected && (
        <div style={{ marginBottom: 16, padding: 12, border: "2px dashed var(--bull-ink)", textAlign: "center" }}>
          <p style={{ fontSize: 13, marginBottom: 8 }}>connect your wallet to deploy.</p>
          <p style={{ fontSize: 11, color: "var(--bull-dim)" }}>use the wallet button in the header.</p>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", rowGap: 8, fontSize: 13 }}>
        <KV label="token mint" value={truncate(data.tokenMint, 24)} mono />
        <KV label="name" value={data.name} />
        <KV label="ticker" value={`$${data.ticker}`} />
        <KV label="max supply" value={`${data.maxSupply.toLocaleString()} NFTs`} />
        <KV label="tokens per wrap" value={`${data.tokensPerWrap} base units`} />
        <KV label="art source" value={`${data.artSourceType === "baseUri" ? "BaseUri" : "RendererUrl"} ${truncate(data.artSourceUrl, 40)}`} />
        <KV label="collection URI" value={truncate(data.collectionUri, 40)} />
        <KV label="deployer" value={wallet.publicKey ? truncate(wallet.publicKey.toBase58(), 24) : "—"} mono />
      </div>

      <div style={{ marginTop: 24, padding: 20, background: "var(--bull-ink)", color: "var(--bull-paper)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#d4a017", marginBottom: 6 }}>
              deploy cost
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
              {DEPLOY_COST_WBULL.toLocaleString()} $WBULL
            </div>
            <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>
              into the bull treasury · 7 day lock per deposit
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16, padding: 12, border: "2px dashed #b35d00", background: "#fff4e6", fontSize: 12, color: "var(--bull-ink)" }}>
        <strong style={{ color: "#b35d00", textTransform: "uppercase", letterSpacing: "0.08em" }}>irreversible:</strong>{" "}
        once you sign, the 1M $WBULL is transferred to the bull treasury. economic fields
        (supply, tokens per wrap) cannot be changed without a fresh deployment.
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, fontSize: 13, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={data.acknowledged}
          onChange={(e) => update("acknowledged", e.target.checked)}
          style={{ width: 18, height: 18, accentColor: "var(--bull-ink)" }}
        />
        i understand. deposit 1M $WBULL into the bull treasury and deploy {data.name || "this wrap layer"}.
      </label>

      {/* Inline deploy progress + result */}
      {deployPhase === "success" && txSig && (
        <Status tone="good" extra>
          ✓ deployed. tx: <code>{truncate(txSig, 24)}</code>. redirecting…
        </Status>
      )}
      {deployPhase === "error" && deployError && (
        <Status tone="bad" extra>✗ {deployError}</Status>
      )}
    </div>
  );
}

// =====================================================================
// Form primitives
// =====================================================================
function StepHeader({ num, title }: { num: string; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14, paddingBottom: 12, borderBottom: "2px solid var(--bull-ink)" }}>
      <div style={{ fontWeight: 800, color: "var(--bull-dim)" }}>STEP {num}</div>
      <div className="h3">{title}</div>
    </div>
  );
}

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--bull-dim)" }}>
        {children}
      </div>
      {hint && <div style={{ fontSize: 11, color: "var(--bull-dim)", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function Field({
  label, hint, value, onChange, placeholder, max,
}: {
  label: string; hint?: string; value: string;
  onChange: (v: string) => void; placeholder?: string; max?: number;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <Label hint={hint}>{label}</Label>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        maxLength={max}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          padding: "10px 12px",
          marginTop: 6,
          border: "2px solid var(--bull-ink)",
          background: "var(--bull-paper)",
          fontFamily: "inherit",
          fontSize: 14,
        }}
      />
    </div>
  );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <div style={{ color: "var(--bull-dim)", fontSize: 12, paddingTop: 4 }}>{label}</div>
      <div style={{ fontWeight: 700, fontFamily: mono ? "inherit" : undefined, paddingTop: 4 }}>
        {value || <span style={{ color: "var(--bull-dim)", fontWeight: 400 }}>—</span>}
      </div>
    </>
  );
}

function Status({
  tone,
  children,
  extra,
}: {
  tone: "good" | "warn" | "bad" | "dim";
  children: React.ReactNode;
  extra?: boolean;
}) {
  const colors = {
    good: { bg: "#e6f4ea", fg: "#0a6b2c", border: "#0a6b2c" },
    warn: { bg: "#fff8e6", fg: "#b35d00", border: "#d4a017" },
    bad:  { bg: "#fbe6e6", fg: "#8a1212", border: "#8a1212" },
    dim:  { bg: "var(--bull-very-soft)", fg: "var(--bull-dim)", border: "var(--bull-soft)" },
  }[tone];
  return (
    <div
      style={{
        marginTop: extra ? 16 : 10,
        padding: 10,
        background: colors.bg,
        color: colors.fg,
        border: `1px solid ${colors.border}`,
        fontSize: 12,
      }}
    >
      {children}
    </div>
  );
}

function truncate(s: string, max: number) {
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, max / 2 - 1) + "…" + s.slice(-max / 2 + 2);
}
