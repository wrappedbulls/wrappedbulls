// /api/factory/preflight
//
// Wizard step 1 calls this with the deployer's typed token mint. We:
//   1. Validate the input is a parseable solana pubkey
//   2. Fetch the mint account from chain (proves it exists)
//   3. Check whether a WrappedCollection already exists for this mint
//      (if yes, the deployer cannot re-deploy on this token -- one wrap
//       layer per token, enforced on chain by the `init` constraint on
//       the collection PDA seed)
//   4. Return a structured response the UI can render confidence flags from
//
// Future enrichment (Week 2.5+): pull Helius DAS metadata for name/symbol,
// pump.fun bonding curve liquidity, holder count. For v1 we expose just
// the chain-truth essentials so the wizard never lies about validation state.

import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  collectionPda,
  fetchWrappedCollection,
  getConnection,
} from "@/lib/factory";

export const dynamic = "force-dynamic";

interface PreflightOK {
  ok: true;
  mint: string;
  decimals: number;
  supply: string;             // string because bigint doesn't JSON
  mintAuthority: string | null;
  freezeAuthority: string | null;
  // Returns the WrappedCollection PDA address regardless of whether it
  // exists yet -- the UI can show it as the future "your wrap layer's
  // address" preview.
  collectionPda: string;
  collectionExists: boolean;
  // If a wrap layer for this token is already live, surface its identity
  // so the UI can deep-link to /launch/<ticker> instead of letting the
  // user try a doomed second deploy.
  existingDeployment?: {
    name: string;
    ticker: string;
    deployer: string;
    totalWrapped: string;
  };
}

interface PreflightErr {
  ok: false;
  error: string;
  // Specific code for the UI to map to a clear inline message.
  code:
    | "missing_mint"
    | "invalid_pubkey"
    | "mint_not_found"
    | "rpc_error";
}

export async function GET(req: NextRequest) {
  const mintParam = req.nextUrl.searchParams.get("mint");
  if (!mintParam) {
    return err("paste a pump.fun token mint address", "missing_mint");
  }

  // Parse + validate the pubkey.
  let mintPk: PublicKey;
  try {
    mintPk = new PublicKey(mintParam);
  } catch {
    return err("not a valid solana pubkey", "invalid_pubkey");
  }

  const conn = getConnection();

  // Fetch the mint account to confirm it exists + read decimals/authorities.
  let mintAccount;
  try {
    mintAccount = await conn.getParsedAccountInfo(mintPk, "confirmed");
  } catch (e) {
    return err((e as Error).message || "rpc failure", "rpc_error");
  }
  if (!mintAccount.value) {
    return err("no mint account found at that address", "mint_not_found");
  }

  // Parse mint data. solana-web3 returns either a parsed JSON shape or
  // raw bytes; we expect parsed because both classic SPL and Token-2022
  // mints have parsers registered.
  const parsed = (mintAccount.value.data as any)?.parsed?.info;
  const decimals: number = typeof parsed?.decimals === "number" ? parsed.decimals : 0;
  const supply: string = parsed?.supply ?? "0";
  const mintAuthority: string | null = parsed?.mintAuthority ?? null;
  const freezeAuthority: string | null = parsed?.freezeAuthority ?? null;

  // Check whether the wrap layer already exists for this token.
  const [collPda] = collectionPda(mintPk);
  const existing = await fetchWrappedCollection(conn, mintPk);

  const out: PreflightOK = {
    ok: true,
    mint: mintPk.toBase58(),
    decimals,
    supply,
    mintAuthority,
    freezeAuthority,
    collectionPda: collPda.toBase58(),
    collectionExists: existing !== null,
  };
  if (existing) {
    out.existingDeployment = {
      name:          existing.name,
      ticker:        existing.ticker,
      deployer:      existing.deployer.toBase58(),
      totalWrapped:  existing.totalWrapped.toString(),
    };
  }
  return NextResponse.json(out, {
    headers: { "cache-control": "no-store" },
  });
}

function err(message: string, code: PreflightErr["code"]) {
  const body: PreflightErr = { ok: false, error: message, code };
  return NextResponse.json(body, {
    status: 400,
    headers: { "cache-control": "no-store" },
  });
}
