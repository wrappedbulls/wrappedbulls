// /api/factory/wrap-tx
//
// Builds an UNSIGNED `wrap` instruction targeting a specific deployment.
// Mirrors deploy-tx in pattern: server encodes via BorshInstructionCoder,
// returns base64 tx for the client wallet to sign + send.
//
// Tier selection is server-side: we read the WrappedCollection's current
// state, pop a tier index from free_tiers (LIFO) if any exist, otherwise
// use next_tier. This matches the on-chain handler's pop_tier logic so
// the tx the client signs will succeed atomically.
//
// What the client provides:
//   wrapper     wallet pubkey that holds the target token + signs the tx
//   tokenMint   which deployment's collection to wrap into
//
// What we return:
//   txB64       base64 of the unsigned Transaction
//   tierIndex   the tier the wrap will mint (server-chosen)
//   nftMint     deterministic PDA of the new NFT mint (same one the
//               program will init -- the client can show this immediately)

import { NextRequest, NextResponse } from "next/server";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { BorshInstructionCoder, Idl } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import idl from "@/lib/idl-factory.json";
import {
  bullAssetPda,
  collectionAuthorityPda,
  collectionMintPda,
  collectionPda,
  fetchWrappedCollection,
  getConnection,
  getFactoryProgramId,
  nftMintPda,
  vaultAuthorityPda,
} from "@/lib/factory";

export const dynamic = "force-dynamic";

const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

interface WrapTxBody {
  wrapper:   string;
  tokenMint: string;
}

export async function POST(req: NextRequest) {
  let body: WrapTxBody;
  try {
    body = await req.json();
  } catch {
    return err("body must be JSON", "invalid_body");
  }
  if (!body.wrapper || !body.tokenMint) {
    return err("wrapper and tokenMint are required", "missing_field");
  }

  let wrapper: PublicKey, tokenMintPk: PublicKey;
  try {
    wrapper = new PublicKey(body.wrapper);
    tokenMintPk = new PublicKey(body.tokenMint);
  } catch {
    return err("invalid pubkey", "invalid_pubkey");
  }

  const conn = getConnection();
  const programId = getFactoryProgramId();

  // Fetch the deployment so we can pick the tier + know tokens_per_wrap.
  const collection = await fetchWrappedCollection(conn, tokenMintPk);
  if (!collection) {
    return err("no wrap layer deployed for that token", "no_deployment");
  }

  // Pick the next tier. Mirrors WrappedCollection::pop_tier (LIFO free_tiers,
  // else next_tier). If the collection is already maxed, refuse.
  let tierIndex: number;
  if (collection.freeTiers.length > 0) {
    tierIndex = collection.freeTiers[collection.freeTiers.length - 1];
  } else if (collection.nextTier <= collection.maxSupply) {
    tierIndex = collection.nextTier;
  } else {
    return err(
      "this wrap layer is fully wrapped -- max supply reached",
      "max_supply_reached",
    );
  }

  // Detect the target token's owner program so ATAs derive correctly.
  // Most pump.fun tokens are on Token-2022 since the 2026 migration; some
  // legacy mints may still be classic SPL. Using the wrong program here
  // makes wrap fail at the first transfer_checked CPI.
  const targetMintInfo = await conn.getAccountInfo(tokenMintPk);
  if (!targetMintInfo) {
    return err("could not read target token mint account", "rpc_error");
  }
  const targetTokenProgram = targetMintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;

  // Derive every PDA the wrap ix needs.
  const [collectionAddr]      = collectionPda(tokenMintPk);
  const [collectionMintAddr]  = collectionMintPda(tokenMintPk);
  const [collectionAuth]      = collectionAuthorityPda(tokenMintPk);
  const [nftMint]             = nftMintPda(tokenMintPk, collection.totalWrapped);
  const [nftMintAuthority]    = vaultAuthorityPda(nftMint);
  const [bullAsset]           = bullAssetPda(tokenMintPk, tierIndex);

  const vault = getAssociatedTokenAddressSync(tokenMintPk, nftMintAuthority, true, targetTokenProgram);
  const wrapperTokenAccount = getAssociatedTokenAddressSync(tokenMintPk, wrapper, false, targetTokenProgram);
  const wrapperNftAccount   = getAssociatedTokenAddressSync(nftMint, wrapper);

  // Metaplex PDAs for the new NFT.
  const [metadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), nftMint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID,
  );
  const [masterEdition] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      nftMint.toBuffer(),
      Buffer.from("edition"),
    ],
    TOKEN_METADATA_PROGRAM_ID,
  );

  // Metaplex PDAs for the parent MCC.
  const [collectionMetadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), collectionMintAddr.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID,
  );
  const [collectionMasterEdition] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      collectionMintAddr.toBuffer(),
      Buffer.from("edition"),
    ],
    TOKEN_METADATA_PROGRAM_ID,
  );

  // Encode the wrap instruction. The IDL exposes it as `wrap(tier_index: u16)`.
  const coder = new BorshInstructionCoder(idl as Idl);
  let data: Buffer;
  try {
    data = coder.encode("wrap", { tierIndex });
  } catch (e) {
    return err((e as Error).message || "failed to encode", "encode_error");
  }

  // Account metas in the exact order #[derive(Accounts)] in wrap.rs.
  const keys = [
    { pubkey: collectionAddr,            isSigner: false, isWritable: true  },
    { pubkey: wrapper,                   isSigner: true,  isWritable: true  },
    { pubkey: tokenMintPk,               isSigner: false, isWritable: false },
    { pubkey: wrapperTokenAccount,       isSigner: false, isWritable: true  },
    { pubkey: nftMint,                   isSigner: false, isWritable: true  },
    { pubkey: nftMintAuthority,          isSigner: false, isWritable: false },
    { pubkey: vault,                     isSigner: false, isWritable: true  },
    { pubkey: wrapperNftAccount,         isSigner: false, isWritable: true  },
    { pubkey: bullAsset,                 isSigner: false, isWritable: true  },
    { pubkey: metadata,                  isSigner: false, isWritable: true  },
    { pubkey: masterEdition,             isSigner: false, isWritable: true  },
    { pubkey: collectionMintAddr,        isSigner: false, isWritable: false },
    { pubkey: collectionMetadata,        isSigner: false, isWritable: true  },
    { pubkey: collectionMasterEdition,   isSigner: false, isWritable: false },
    { pubkey: collectionAuth,            isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID,          isSigner: false, isWritable: false },
    { pubkey: targetTokenProgram,        isSigner: false, isWritable: false }, // detected from target mint owner above
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId,   isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY,        isSigner: false, isWritable: false },
  ];

  const wrapIx = new TransactionInstruction({ keys, programId, data });
  const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });

  const tx = new Transaction();
  tx.add(cuIx, wrapIx);
  tx.feePayer = wrapper;

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;

  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return NextResponse.json(
    {
      ok: true,
      txB64: serialized.toString("base64"),
      blockhash,
      lastValidBlockHeight,
      tierIndex,
      nftMint: nftMint.toBase58(),
      // tokensPerWrap echo so the UI can show the exact amount being locked
      // without re-fetching the collection.
      tokensPerWrap: collection.tokensPerWrap.toString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

function err(message: string, code: string) {
  return NextResponse.json(
    { ok: false, error: message, code },
    { status: 400, headers: { "cache-control": "no-store" } },
  );
}
