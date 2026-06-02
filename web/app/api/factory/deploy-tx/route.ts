// /api/factory/deploy-tx
//
// Wizard step 5 calls this to get an UNSIGNED, ready-to-sign Solana
// transaction containing the deploy_collection instruction. The client's
// wallet adapter signs + sends; we never touch the deployer's keys.
//
// We use BorshInstructionCoder directly (not an Anchor Program client)
// because instruction encoding is purely synthetic -- no provider, no
// wallet required. The client signs the serialized tx returned here.
//
// Response shape:
//   { ok: true,  txB64: "...", blockhash: "...", lastValidBlockHeight: ... }
//   { ok: false, error: "...", code: ... }

import { NextRequest, NextResponse } from "next/server";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { BorshInstructionCoder, BN, Idl } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import idl from "@/lib/idl-factory.json";
import {
  bullTreasuryStatePda,
  collectionAuthorityPda,
  collectionMintPda,
  collectionPda,
  factoryConfigPda,
  fetchFactoryConfig,
  getConnection,
  getFactoryProgramId,
  MAX_ART_URI_LEN,
  MAX_NAME_LEN,
  MAX_SUPPLY,
  MAX_TICKER_LEN,
  MIN_SUPPLY,
} from "@/lib/factory";

export const dynamic = "force-dynamic";

// Metaplex Token Metadata program -- canonical on every cluster.
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

interface DeployTxBody {
  // The deployer's wallet pubkey (base58). Will be set as fee payer +
  // primary signer on the returned tx.
  deployer: string;
  // The target pump.fun token mint to wrap.
  tokenMint: string;
  // Deployment params (mirror state.rs DeployCollectionArgs).
  name: string;
  ticker: string;
  maxSupply: number;
  tokensPerWrap: string;        // string -> BN to support bigint
  artSource:
    | { kind: "baseUri";     uri: string }
    | { kind: "rendererUrl"; uri: string };
  collectionUri: string;
}

export async function POST(req: NextRequest) {
  let body: DeployTxBody;
  try {
    body = await req.json();
  } catch {
    return err("body must be JSON", "invalid_body");
  }

  // ------- Input validation (mirrors program-side guards) -------
  const v = validate(body);
  if (v) return err(v.message, v.code);

  let deployer: PublicKey;
  let tokenMintPk: PublicKey;
  let tokensPerWrap: BN;
  try {
    deployer = new PublicKey(body.deployer);
    tokenMintPk = new PublicKey(body.tokenMint);
    tokensPerWrap = new BN(body.tokensPerWrap);
  } catch {
    return err("could not parse deployer/tokenMint/tokensPerWrap", "invalid_pubkey");
  }

  // ------- Resolve all PDAs + ATAs -------
  const conn = getConnection();
  const programId = getFactoryProgramId();

  // FactoryConfig must already exist (someone has run initialize).
  const factoryConfig = await fetchFactoryConfig(conn);
  if (!factoryConfig) {
    return err(
      "Factory is not initialized on this cluster yet. The wbull_mint and bull_treasury setup must run first.",
      "factory_uninitialized",
    );
  }

  const wbullMint = factoryConfig.wbullMint;
  const [factoryConfigAddr] = factoryConfigPda();
  const [treasuryStateAddr] = bullTreasuryStatePda();
  const treasuryVault = getAssociatedTokenAddressSync(
    wbullMint,
    treasuryStateAddr,
    true, // allow owner off-curve (PDA)
  );
  const deployerWbullAccount = getAssociatedTokenAddressSync(
    wbullMint,
    deployer,
  );

  const [collection]          = collectionPda(tokenMintPk);
  const [collectionMint]      = collectionMintPda(tokenMintPk);
  const [collectionAuthority] = collectionAuthorityPda(tokenMintPk);
  const deployerCollectionAta = getAssociatedTokenAddressSync(
    collectionMint,
    deployer,
  );

  // Metaplex metadata + master_edition for the collection NFT mint.
  const [collectionMetadata] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      collectionMint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID,
  );
  const [collectionMasterEdition] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      collectionMint.toBuffer(),
      Buffer.from("edition"),
    ],
    TOKEN_METADATA_PROGRAM_ID,
  );

  // ------- Encode the deploy_collection instruction data -------
  const coder = new BorshInstructionCoder(idl as Idl);
  // Arg names mirror the Rust struct exactly. The art_source enum uses
  // Anchor's tuple variant encoding: { baseUri: [string] } or
  // { rendererUrl: [string] }.
  const args = {
    args: {
      name:           body.name,
      ticker:         body.ticker,
      maxSupply:      body.maxSupply,
      tokensPerWrap:  tokensPerWrap,
      artSource:
        body.artSource.kind === "baseUri"
          ? { baseUri: [body.artSource.uri] }
          : { rendererUrl: [body.artSource.uri] },
      collectionUri:  body.collectionUri,
    },
  };
  let data: Buffer;
  try {
    data = coder.encode("deploy_collection", args);
  } catch (e) {
    return err((e as Error).message || "failed to encode ix", "encode_error");
  }

  // ------- Build the TransactionInstruction with account metas -------
  // Order MUST match #[derive(Accounts)] in deploy_collection.rs.
  const keys = [
    { pubkey: factoryConfigAddr,         isSigner: false, isWritable: true  },
    { pubkey: treasuryStateAddr,         isSigner: false, isWritable: true  },
    { pubkey: treasuryVault,             isSigner: false, isWritable: true  },
    { pubkey: deployer,                  isSigner: true,  isWritable: true  },
    { pubkey: tokenMintPk,               isSigner: false, isWritable: false },
    { pubkey: wbullMint,                 isSigner: false, isWritable: false },
    { pubkey: deployerWbullAccount,      isSigner: false, isWritable: true  },
    { pubkey: collection,                isSigner: false, isWritable: true  },
    { pubkey: collectionMint,            isSigner: false, isWritable: true  },
    { pubkey: collectionAuthority,       isSigner: false, isWritable: false },
    { pubkey: deployerCollectionAta,     isSigner: false, isWritable: true  },
    { pubkey: collectionMetadata,        isSigner: false, isWritable: true  },
    { pubkey: collectionMasterEdition,   isSigner: false, isWritable: true  },
    { pubkey: TOKEN_PROGRAM_ID,          isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID,          isSigner: false, isWritable: false }, // wbullTokenProgram (classic SPL for now; Token-2022 if pump.fun has migrated)
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId,   isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY,        isSigner: false, isWritable: false },
  ];

  const deployIx = new TransactionInstruction({ keys, programId, data });

  // Bump compute budget. deploy_collection runs ~6 Metaplex CPIs + token
  // transfer + multiple ATA inits; the 200k default trips it.
  const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });

  // ------- Build the Transaction -------
  const tx = new Transaction();
  tx.add(cuIx, deployIx);
  tx.feePayer = deployer;

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;

  // Serialize WITHOUT requiring signatures. The client wallet will sign +
  // send -- both happen in the same wallet UI prompt.
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });

  return NextResponse.json(
    {
      ok: true,
      txB64: serialized.toString("base64"),
      blockhash,
      lastValidBlockHeight,
      // Echo the deployment's resolved addresses so the welcome screen
      // can deep-link to /launch/<ticker> + Magic Eden / Tensor immediately
      // after sign + confirm.
      addresses: {
        collection:               collection.toBase58(),
        collectionMint:           collectionMint.toBase58(),
        collectionAuthority:      collectionAuthority.toBase58(),
        deployerCollectionAta:    deployerCollectionAta.toBase58(),
        treasuryVault:            treasuryVault.toBase58(),
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}

// =====================================================================
// Validation helpers
// =====================================================================

interface ValidationError {
  message: string;
  code:
    | "invalid_body"
    | "missing_field"
    | "invalid_name"
    | "invalid_ticker"
    | "invalid_supply"
    | "invalid_tokens_per_wrap"
    | "invalid_art_uri"
    | "invalid_collection_uri";
}

function validate(b: DeployTxBody): ValidationError | null {
  if (!b.deployer)  return { message: "deployer is required",  code: "missing_field" };
  if (!b.tokenMint) return { message: "tokenMint is required", code: "missing_field" };

  if (!b.name || b.name.length > MAX_NAME_LEN || !isAscii(b.name))
    return { message: `name must be 1..=${MAX_NAME_LEN} ascii chars`, code: "invalid_name" };

  if (!b.ticker || b.ticker.length > MAX_TICKER_LEN || !/^[A-Z0-9]+$/.test(b.ticker))
    return { message: `ticker must be 1..=${MAX_TICKER_LEN} uppercase ascii alnum`, code: "invalid_ticker" };

  if (typeof b.maxSupply !== "number" || b.maxSupply < MIN_SUPPLY || b.maxSupply > MAX_SUPPLY)
    return { message: `maxSupply must be ${MIN_SUPPLY}..=${MAX_SUPPLY}`, code: "invalid_supply" };

  if (!b.tokensPerWrap || !/^\d+$/.test(b.tokensPerWrap) || BigInt(b.tokensPerWrap) <= 0n)
    return { message: "tokensPerWrap must be a positive integer string", code: "invalid_tokens_per_wrap" };

  if (!b.artSource || (b.artSource.kind !== "baseUri" && b.artSource.kind !== "rendererUrl"))
    return { message: "artSource.kind must be 'baseUri' or 'rendererUrl'", code: "invalid_art_uri" };
  const uri = b.artSource.uri;
  if (!uri || uri.length > MAX_ART_URI_LEN || !isAscii(uri) || /\s$/.test(uri))
    return { message: `artSource.uri must be 1..=${MAX_ART_URI_LEN} ascii chars, no trailing whitespace`, code: "invalid_art_uri" };

  if (!b.collectionUri || b.collectionUri.length > MAX_ART_URI_LEN || !isAscii(b.collectionUri) || /\s$/.test(b.collectionUri))
    return { message: `collectionUri must be 1..=${MAX_ART_URI_LEN} ascii chars, no trailing whitespace`, code: "invalid_collection_uri" };

  return null;
}

function isAscii(s: string): boolean {
  return /^[\x00-\x7f]*$/.test(s);
}

function err(message: string, code: string) {
  return NextResponse.json(
    { ok: false, error: message, code },
    { status: 400, headers: { "cache-control": "no-store" } },
  );
}
