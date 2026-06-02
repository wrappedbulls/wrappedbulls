// /api/factory/set-verified-tx
//
// Builds an UNSIGNED `set_verified` transaction for a specific deployment.
// Same builder pattern as deploy-tx / wrap-tx / unwrap-tx: server encodes
// + returns base64; client signs + sends. Gated on chain to the program's
// upgrade authority — on mainnet that's the wrappedbulls Squads multisig,
// so the returned tx must be proposed + signed through the Squads UI.
//
// Body:
//   authority   pubkey signing the tx (must match the program's current upgrade authority on chain, else the on-chain constraint reverts)
//   tokenMint   the deployment whose verified flag is being flipped
//   verified    new boolean state for the flag (two-way; can also un-verify)
//
// Response:
//   { ok: true, txB64, blockhash, lastValidBlockHeight, collection, programData }

import { NextRequest, NextResponse } from "next/server";
import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { BorshInstructionCoder, Idl } from "@coral-xyz/anchor";

import idl from "@/lib/idl-factory.json";
import {
  collectionPda,
  getConnection,
  getFactoryProgramId,
} from "@/lib/factory";

export const dynamic = "force-dynamic";

const BPF_UPGRADEABLE_LOADER_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

interface SetVerifiedTxBody {
  authority: string;
  tokenMint: string;
  verified:  boolean;
}

export async function POST(req: NextRequest) {
  let body: SetVerifiedTxBody;
  try {
    body = await req.json();
  } catch {
    return err("body must be JSON", "invalid_body");
  }
  if (!body.authority || !body.tokenMint || typeof body.verified !== "boolean") {
    return err("authority + tokenMint + verified(bool) required", "missing_field");
  }

  let authority: PublicKey, tokenMintPk: PublicKey;
  try {
    authority = new PublicKey(body.authority);
    tokenMintPk = new PublicKey(body.tokenMint);
  } catch {
    return err("invalid pubkey", "invalid_pubkey");
  }

  const conn = getConnection();
  const programId = getFactoryProgramId();

  const [collection] = collectionPda(tokenMintPk);
  // ProgramData PDA derivation under the BPF Upgradeable Loader. Matches
  // the on-chain set_verified.rs constraint that reads
  // program.programdata_address() and compares to program_data.key().
  const [programData] = PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_UPGRADEABLE_LOADER_ID,
  );

  const coder = new BorshInstructionCoder(idl as unknown as Idl);
  let data: Buffer;
  try {
    data = coder.encode("set_verified", { verified: body.verified });
  } catch (e) {
    return err((e as Error).message || "failed to encode", "encode_error");
  }

  // Order matches set_verified.rs Accounts: collection, authority, program, program_data.
  const keys = [
    { pubkey: collection,  isSigner: false, isWritable: true  },
    { pubkey: authority,   isSigner: true,  isWritable: false },
    { pubkey: programId,   isSigner: false, isWritable: false },
    { pubkey: programData, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({ keys, programId, data });
  const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 });

  const tx = new Transaction();
  tx.add(cuIx, ix);
  tx.feePayer = authority;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;

  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return NextResponse.json(
    {
      ok: true,
      txB64: serialized.toString("base64"),
      blockhash,
      lastValidBlockHeight,
      collection:  collection.toBase58(),
      programData: programData.toBase58(),
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
