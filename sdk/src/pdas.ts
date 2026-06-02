// PDA derivation helpers. Seeds match programs/wrappedfactory/src/*.rs
// and programs/wrappedbulls/src/*.rs verbatim. Every function returns
// [pda, bump] so callers can pass the bump back to the program if needed.

import { PublicKey } from "@solana/web3.js";

// =====================================================================
// Factory PDAs
// =====================================================================

export function factoryConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("factory_config")], programId);
}

export function bullTreasuryStatePda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("bull_treasury")], programId);
}

export function collectionPda(programId: PublicKey, tokenMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("collection"), tokenMint.toBuffer()],
    programId,
  );
}

export function collectionMintPda(programId: PublicKey, tokenMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("collection_mint"), tokenMint.toBuffer()],
    programId,
  );
}

export function collectionAuthorityPda(programId: PublicKey, tokenMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("collection_authority"), tokenMint.toBuffer()],
    programId,
  );
}

export function nftMintPdaFactory(
  programId: PublicKey,
  tokenMint: PublicKey,
  totalWrappedBefore: bigint,
): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(totalWrappedBefore);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("nft_mint"), tokenMint.toBuffer(), buf],
    programId,
  );
}

export function bullAssetPdaFactory(
  programId: PublicKey,
  tokenMint: PublicKey,
  tierIndex: number,
): [PublicKey, number] {
  const tierBuf = Buffer.alloc(2);
  tierBuf.writeUInt16LE(tierIndex, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bull"), tokenMint.toBuffer(), tierBuf],
    programId,
  );
}

// =====================================================================
// Vault PDA (shared between wrappedbulls + Factory) -- derived from nft_mint
// =====================================================================

export function vaultAuthorityPda(programId: PublicKey, nftMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), nftMint.toBuffer()],
    programId,
  );
}

// =====================================================================
// Wrappedbulls PDAs (the original program)
// =====================================================================

export function bullBankPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("bank")], programId);
}

export function bullAssetPdaBulls(programId: PublicKey, tier: number): [PublicKey, number] {
  const tierBuf = Buffer.alloc(2);
  tierBuf.writeUInt16LE(tier, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bull"), tierBuf],
    programId,
  );
}

export function nftMintPdaBulls(
  programId: PublicKey,
  totalWrappedBefore: bigint,
): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(totalWrappedBefore);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("nft_mint"), buf],
    programId,
  );
}

// =====================================================================
// Metaplex Token Metadata PDAs (constant across programs)
// =====================================================================

export const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

export function metadataPda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID,
  );
}

export function masterEditionPda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
      Buffer.from("edition"),
    ],
    TOKEN_METADATA_PROGRAM_ID,
  );
}
