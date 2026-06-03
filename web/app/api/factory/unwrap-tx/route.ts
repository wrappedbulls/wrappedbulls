// /api/factory/unwrap-tx
//
// Builds an UNSIGNED `unwrap` instruction targeting a specific NFT in a
// specific deployment. Mirrors wrap-tx but in reverse: caller specifies
// which tier they hold + want to unwrap; server derives every PDA + ATA
// and returns the unsigned tx.
//
// Client provides:
//   holder     wallet pubkey that holds the NFT being unwrapped
//   tokenMint  which deployment the NFT belongs to
//   tierIndex  which tier (the "WrappedDoge #N" number) to unwrap
//
// We refuse to build if:
//   - no WrappedCollection exists for that mint
//   - the tier_index has no BullAsset (no live NFT at that tier)

import { NextRequest, NextResponse } from "next/server";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { BorshInstructionCoder, Idl } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import idl from "@/lib/idl-factory.json";
import {
  bullAssetPda,
  collectionPda,
  fetchWrappedCollection,
  getConnection,
  getFactoryProgramId,
  vaultAuthorityPda,
} from "@/lib/factory";

export const dynamic = "force-dynamic";

const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

interface UnwrapTxBody {
  holder:    string;
  tokenMint: string;
  tierIndex: number;
}

export async function POST(req: NextRequest) {
  let body: UnwrapTxBody;
  try {
    body = await req.json();
  } catch {
    return err("body must be JSON", "invalid_body");
  }
  if (!body.holder || !body.tokenMint || typeof body.tierIndex !== "number") {
    return err("holder + tokenMint + tierIndex required", "missing_field");
  }

  let holder: PublicKey, tokenMintPk: PublicKey;
  try {
    holder = new PublicKey(body.holder);
    tokenMintPk = new PublicKey(body.tokenMint);
  } catch {
    return err("invalid pubkey", "invalid_pubkey");
  }

  const conn = getConnection();
  const programId = getFactoryProgramId();

  // Fetch the collection to discover (a) it exists, (b) the BullAsset PDA's
  // recorded nft_mint, which the unwrap ix requires for the burn CPI.
  const collection = await fetchWrappedCollection(conn, tokenMintPk);
  if (!collection) {
    return err("no wrap layer deployed for that token", "no_deployment");
  }
  if (body.tierIndex < 1 || body.tierIndex > collection.maxSupply) {
    return err("tier_index out of bounds", "tier_oob");
  }

  // Fetch the BullAsset to extract nft_mint. The unwrap ix's account
  // constraint requires nft_mint == bull_asset.nft_mint, so passing a
  // wrong one would fail at the on-chain check; we resolve it server-side
  // to make the tx build deterministic.
  const [bullAsset] = bullAssetPda(tokenMintPk, body.tierIndex);
  const bullAssetInfo = await conn.getAccountInfo(bullAsset, "confirmed");
  if (!bullAssetInfo) {
    return err(
      "no live NFT at that tier (already unwrapped or never wrapped)",
      "no_bull_asset",
    );
  }
  // BullAsset layout: 8 discriminator + 32 nft_mint + 2 tier + 8 wrapped_at + 1 bump
  if (bullAssetInfo.data.length < 8 + 32) {
    return err("bull_asset account malformed", "bad_state");
  }
  const nftMint = new PublicKey(bullAssetInfo.data.slice(8, 8 + 32));

  // Detect target token's owner program so ATAs derive correctly across
  // classic SPL and Token-2022 mints. Same fix as wrap-tx + deploy-tx.
  const targetMintInfo = await conn.getAccountInfo(tokenMintPk);
  if (!targetMintInfo) {
    return err("could not read target token mint account", "rpc_error");
  }
  const targetTokenProgram = targetMintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;

  // Derive remaining PDAs/ATAs.
  const [collectionAddr] = collectionPda(tokenMintPk);
  const [nftMintAuthority] = vaultAuthorityPda(nftMint);
  const vault = getAssociatedTokenAddressSync(tokenMintPk, nftMintAuthority, true, targetTokenProgram);
  const holderTokenAccount = getAssociatedTokenAddressSync(tokenMintPk, holder, false, targetTokenProgram);
  const holderNftAccount = getAssociatedTokenAddressSync(nftMint, holder);

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
  const [collectionMetadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), collection.collectionMint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID,
  );

  // Encode the unwrap instruction.
  const coder = new BorshInstructionCoder(idl as Idl);
  let data: Buffer;
  try {
    data = coder.encode("unwrap", { tierIndex: body.tierIndex });
  } catch (e) {
    return err((e as Error).message || "failed to encode", "encode_error");
  }

  // Account metas in the order #[derive(Accounts)] in unwrap.rs.
  const keys = [
    { pubkey: collectionAddr,            isSigner: false, isWritable: true  },
    { pubkey: holder,                    isSigner: true,  isWritable: true  },
    { pubkey: holderTokenAccount,        isSigner: false, isWritable: true  },
    { pubkey: tokenMintPk,               isSigner: false, isWritable: false },
    { pubkey: nftMint,                   isSigner: false, isWritable: true  },
    { pubkey: nftMintAuthority,          isSigner: false, isWritable: false },
    { pubkey: vault,                     isSigner: false, isWritable: true  },
    { pubkey: holderNftAccount,          isSigner: false, isWritable: true  },
    { pubkey: bullAsset,                 isSigner: false, isWritable: true  },
    { pubkey: metadata,                  isSigner: false, isWritable: true  },
    { pubkey: masterEdition,             isSigner: false, isWritable: true  },
    { pubkey: collection.collectionMint, isSigner: false, isWritable: false },
    { pubkey: collectionMetadata,        isSigner: false, isWritable: true  },
    { pubkey: TOKEN_PROGRAM_ID,          isSigner: false, isWritable: false },
    { pubkey: targetTokenProgram,        isSigner: false, isWritable: false }, // detected from target mint owner above
    { pubkey: TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId,   isSigner: false, isWritable: false },
  ];

  const unwrapIx = new TransactionInstruction({ keys, programId, data });
  const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });

  const tx = new Transaction();
  tx.add(cuIx, unwrapIx);
  tx.feePayer = holder;

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;

  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return NextResponse.json(
    {
      ok: true,
      txB64: serialized.toString("base64"),
      blockhash,
      lastValidBlockHeight,
      tierIndex: body.tierIndex,
      nftMint: nftMint.toBase58(),
      // expected drain (== tokens_per_wrap; may be larger if grief tokens
      // were donated to the vault, in which case the holder also receives
      // the donation atomically).
      expectedDrain: collection.tokensPerWrap.toString(),
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
