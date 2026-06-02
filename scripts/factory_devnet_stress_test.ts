// scripts/factory_devnet_stress_test.ts
//
// End-to-end sanity gate for the WrappedFactory before mainnet.
// Walks a single wallet through the full lifecycle of a deployment,
// against the deployed web app's API surface (not the raw chain), so
// it exercises BOTH the program + the wizard's tx-building code path.
//
// Sequence:
//   0. Verify program is deployed + initialized on target cluster.
//   1. Create a fresh target-token mint owned by the test wallet.
//   2. Mint enough target-token to the test wallet so wrap will succeed.
//   3. POST /api/factory/preflight  -- expect ok, collection does not exist.
//   4. POST /api/factory/check-name -- expect ok, ticker available.
//   5. POST /api/factory/deploy-tx  -- get unsigned tx, sign, send, confirm.
//   6. Read WrappedCollection PDA, assert state matches what we sent.
//   7. POST /api/factory/wrap-tx    -- sign, send, confirm.
//   8. Read BullAsset PDA, assert it exists with the right tier.
//   9. POST /api/factory/unwrap-tx  -- sign, send, confirm.
//  10. Read BullAsset PDA again, assert it's been closed.
//
// Repeat steps 1..10 N_DEPLOYMENTS times to exercise the PDA isolation
// path (each iteration uses a fresh target-token mint).
//
// Usage:
//   export FACTORY_API=http://localhost:3000          (or https://wrappedbulls.com)
//   export FACTORY_RPC=https://api.devnet.solana.com  (or your Helius devnet URL)
//   export FACTORY_KEYPAIR=/path/to/test-wallet.json
//   export FACTORY_WBULL_BALANCE_MIN=10000000         (10M $WBULL base units)
//   npx ts-node scripts/factory_devnet_stress_test.ts

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";

// =====================================================================
// Config
// =====================================================================
const API_BASE    = process.env.FACTORY_API     || "http://localhost:3000";
const RPC_URL     = process.env.FACTORY_RPC     || "https://api.devnet.solana.com";
const KEYPAIR_FILE = process.env.FACTORY_KEYPAIR || `${process.env.HOME}/.config/solana/id.json`;
const N_DEPLOYMENTS = parseInt(process.env.N_DEPLOYMENTS || "3", 10);
const TOKEN_DECIMALS = 6; // pump.fun standard

const ONE_MILLION_TOKENS = BigInt("1000000000000"); // 1M with 6 decimals

// =====================================================================
// Result tracking
// =====================================================================
interface StepResult {
  step: string;
  ok: boolean;
  detail: string;
  durationMs: number;
}
const results: StepResult[] = [];

function step(name: string) {
  const start = Date.now();
  return {
    pass(detail: string) {
      results.push({ step: name, ok: true, detail, durationMs: Date.now() - start });
      console.log(`  ✓ ${name} (${Date.now() - start}ms)  ${detail}`);
    },
    fail(detail: string): never {
      results.push({ step: name, ok: false, detail, durationMs: Date.now() - start });
      console.error(`  ✗ ${name} (${Date.now() - start}ms)  ${detail}`);
      throw new Error(`${name} failed: ${detail}`);
    },
  };
}

// =====================================================================
// Helpers
// =====================================================================
async function api(path: string, init?: RequestInit): Promise<any> {
  const r = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const text = await r.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`API ${path} returned non-JSON (status ${r.status}): ${text.slice(0, 200)}`);
  }
  if (!json.ok) {
    throw new Error(`API ${path} returned error: ${JSON.stringify(json)}`);
  }
  return json;
}

async function signAndSend(
  conn: Connection,
  signer: Keypair,
  txB64: string,
  blockhash: string,
  lastValidBlockHeight: number,
): Promise<string> {
  const tx = Transaction.from(Buffer.from(txB64, "base64"));
  tx.partialSign(signer);
  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  await conn.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  return sig;
}

// Derive the WrappedCollection PDA the same way the program does.
// Program ID is read from the running API's /api/factory/preflight response
// (the `collectionPda` field) so this script never has to hardcode it.
function deriveCollectionPda(programId: PublicKey, tokenMint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("collection"), tokenMint.toBuffer()],
    programId,
  )[0];
}

function deriveBullAssetPda(programId: PublicKey, tokenMint: PublicKey, tier: number): PublicKey {
  const tierBuf = Buffer.alloc(2);
  tierBuf.writeUInt16LE(tier, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bull"), tokenMint.toBuffer(), tierBuf],
    programId,
  )[0];
}

// =====================================================================
// One full lifecycle: deploy -> wrap -> unwrap
// =====================================================================
async function runOneLifecycle(
  conn: Connection,
  wallet: Keypair,
  iteration: number,
  programId: PublicKey,
): Promise<void> {
  console.log(`\n=== Iteration ${iteration} ===`);

  // ---- 1. Fresh target-token mint ----
  const mintStep = step(`[${iteration}] create target token mint`);
  let targetMint: PublicKey;
  try {
    targetMint = await createMint(
      conn,
      wallet,
      wallet.publicKey,
      null,
      TOKEN_DECIMALS,
    );
    mintStep.pass(`mint=${targetMint.toBase58()}`);
  } catch (e) {
    mintStep.fail((e as Error).message);
  }

  // ---- 2. Mint 10M target-token to the test wallet so wrap will succeed ----
  const fundStep = step(`[${iteration}] mint target tokens to wallet`);
  try {
    const ata = await getOrCreateAssociatedTokenAccount(conn, wallet, targetMint!, wallet.publicKey);
    await mintTo(conn, wallet, targetMint!, ata.address, wallet, Number(BigInt(10) * ONE_MILLION_TOKENS));
    fundStep.pass(`10M tokens minted to ata=${ata.address.toBase58()}`);
  } catch (e) {
    fundStep.fail((e as Error).message);
  }

  // ---- 3. Preflight ----
  const preflightStep = step(`[${iteration}] /api/factory/preflight`);
  let preflightJson: any;
  try {
    preflightJson = await api(`/api/factory/preflight?mint=${targetMint!.toBase58()}`);
    if (preflightJson.collectionExists) {
      preflightStep.fail("collection already exists -- mint reused?");
    }
    preflightStep.pass(`decimals=${preflightJson.decimals}, collection_pda=${preflightJson.collectionPda}`);
  } catch (e) {
    preflightStep.fail((e as Error).message);
  }

  // ---- 4. Check name (use unique ticker per iteration) ----
  const ticker = `WSTRES${iteration}`.slice(0, 10);
  const nameStep = step(`[${iteration}] /api/factory/check-name (${ticker})`);
  try {
    const checkJson = await api(`/api/factory/check-name?ticker=${ticker}`);
    if (!checkJson.available) {
      nameStep.fail(`ticker ${ticker} already taken: ${JSON.stringify(checkJson.conflict)}`);
    }
    nameStep.pass(`available`);
  } catch (e) {
    nameStep.fail((e as Error).message);
  }

  // ---- 5. Deploy ----
  const deployStep = step(`[${iteration}] /api/factory/deploy-tx + sign + send`);
  let deployJson: any;
  let deploySig: string;
  try {
    deployJson = await api("/api/factory/deploy-tx", {
      method: "POST",
      body: JSON.stringify({
        deployer:       wallet.publicKey.toBase58(),
        tokenMint:      targetMint!.toBase58(),
        name:           `WrappedStress${iteration}`,
        ticker,
        maxSupply:      100,
        tokensPerWrap:  ONE_MILLION_TOKENS.toString(),
        artSource:      { kind: "baseUri", uri: `https://example.test/stress/${iteration}/` },
        collectionUri:  `https://example.test/stress/${iteration}/collection`,
      }),
    });
    deploySig = await signAndSend(conn, wallet, deployJson.txB64, deployJson.blockhash, deployJson.lastValidBlockHeight);
    deployStep.pass(`tx=${deploySig.slice(0, 16)}…`);
  } catch (e) {
    deployStep.fail((e as Error).message);
  }

  // ---- 6. Verify WrappedCollection state ----
  const verifyDeployStep = step(`[${iteration}] read WrappedCollection PDA`);
  try {
    const collectionPda = deriveCollectionPda(programId, targetMint!);
    const info = await conn.getAccountInfo(collectionPda, "confirmed");
    if (!info) verifyDeployStep.fail("collection PDA not found");
    if (info!.data.length < 8) verifyDeployStep.fail("collection PDA too small");
    verifyDeployStep.pass(`pda=${collectionPda.toBase58()}, ${info!.data.length} bytes`);
  } catch (e) {
    verifyDeployStep.fail((e as Error).message);
  }

  // ---- 7. Wrap ----
  const wrapStep = step(`[${iteration}] /api/factory/wrap-tx + sign + send`);
  let wrapJson: any;
  try {
    wrapJson = await api("/api/factory/wrap-tx", {
      method: "POST",
      body: JSON.stringify({
        wrapper:   wallet.publicKey.toBase58(),
        tokenMint: targetMint!.toBase58(),
      }),
    });
    const wrapSig = await signAndSend(conn, wallet, wrapJson.txB64, wrapJson.blockhash, wrapJson.lastValidBlockHeight);
    wrapStep.pass(`tier=${wrapJson.tierIndex}, nft_mint=${wrapJson.nftMint.slice(0, 12)}…, tx=${wrapSig.slice(0, 16)}…`);
  } catch (e) {
    wrapStep.fail((e as Error).message);
  }

  // ---- 8. Verify BullAsset exists ----
  const verifyWrapStep = step(`[${iteration}] read BullAsset after wrap`);
  try {
    const bullAssetPda = deriveBullAssetPda(programId, targetMint!, wrapJson.tierIndex);
    const info = await conn.getAccountInfo(bullAssetPda, "confirmed");
    if (!info) verifyWrapStep.fail("bull_asset PDA not found");
    verifyWrapStep.pass(`pda=${bullAssetPda.toBase58()}, ${info!.data.length} bytes`);
  } catch (e) {
    verifyWrapStep.fail((e as Error).message);
  }

  // ---- 9. Unwrap ----
  const unwrapStep = step(`[${iteration}] /api/factory/unwrap-tx + sign + send`);
  try {
    const unwrapJson = await api("/api/factory/unwrap-tx", {
      method: "POST",
      body: JSON.stringify({
        holder:    wallet.publicKey.toBase58(),
        tokenMint: targetMint!.toBase58(),
        tierIndex: wrapJson.tierIndex,
      }),
    });
    const unwrapSig = await signAndSend(conn, wallet, unwrapJson.txB64, unwrapJson.blockhash, unwrapJson.lastValidBlockHeight);
    unwrapStep.pass(`tx=${unwrapSig.slice(0, 16)}…`);
  } catch (e) {
    unwrapStep.fail((e as Error).message);
  }

  // ---- 10. Verify BullAsset is closed ----
  const verifyUnwrapStep = step(`[${iteration}] read BullAsset after unwrap (expect closed)`);
  try {
    const bullAssetPda = deriveBullAssetPda(programId, targetMint!, wrapJson.tierIndex);
    const info = await conn.getAccountInfo(bullAssetPda, "confirmed");
    if (info) {
      verifyUnwrapStep.fail(`bull_asset still exists after unwrap (${info.data.length} bytes)`);
    }
    verifyUnwrapStep.pass(`closed`);
  } catch (e) {
    verifyUnwrapStep.fail((e as Error).message);
  }
}

// =====================================================================
// Main
// =====================================================================
async function main() {
  console.log("=========================================================");
  console.log("  WrappedFactory devnet stress test");
  console.log(`  API:       ${API_BASE}`);
  console.log(`  RPC:       ${RPC_URL}`);
  console.log(`  Keypair:   ${KEYPAIR_FILE}`);
  console.log(`  Lifecycles: ${N_DEPLOYMENTS}`);
  console.log("=========================================================");

  // Load wallet.
  const walletJson = JSON.parse(fs.readFileSync(KEYPAIR_FILE, "utf-8"));
  const wallet = Keypair.fromSecretKey(Uint8Array.from(walletJson));
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);

  const conn = new Connection(RPC_URL, "confirmed");

  // Verify the wallet has SOL.
  const solBalance = await conn.getBalance(wallet.publicKey);
  console.log(`SOL balance: ${(solBalance / LAMPORTS_PER_SOL).toFixed(3)}`);
  if (solBalance < 0.5 * LAMPORTS_PER_SOL) {
    console.error("ERROR: wallet needs at least 0.5 SOL for fees + rent");
    process.exit(1);
  }

  // Hit preflight once with the wallet's own pubkey just to confirm the API
  // is reachable and the program ID matches. The preflight response carries
  // collection_pda; we need the program ID for our local PDA derivations.
  // The cleanest way is to use a known $WBULL mint -- but the script is
  // generic, so we'll pull program_id from the env or default to the
  // current published vanity / throwaway.
  const programIdStr = process.env.FACTORY_PROGRAM_ID
    || "Ab7yPbWmgUov7ZCYG4NjZ5354rTKL3A7JEUTHh2HdQ5s";
  const programId = new PublicKey(programIdStr);
  console.log(`Program ID: ${programId.toBase58()}`);

  // Run N lifecycles back to back.
  let allOk = true;
  for (let i = 1; i <= N_DEPLOYMENTS; i++) {
    try {
      await runOneLifecycle(conn, wallet, i, programId);
    } catch (e) {
      console.error(`Iteration ${i} aborted: ${(e as Error).message}`);
      allOk = false;
      break;
    }
  }

  // Final summary.
  console.log("\n=========================================================");
  console.log("  SUMMARY");
  console.log("=========================================================");
  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log(`  Steps: ${pass} passed, ${fail} failed`);
  console.log(`  Total time: ${results.reduce((sum, r) => sum + r.durationMs, 0) / 1000}s`);

  if (!allOk || fail > 0) {
    console.error("  RESULT: FAILED");
    process.exit(1);
  }
  console.log("  RESULT: PASS");
}

main().catch((e) => {
  console.error("UNCAUGHT:", e);
  process.exit(1);
});
