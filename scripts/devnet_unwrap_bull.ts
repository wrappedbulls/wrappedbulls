// Devnet unwrap_bull: burn a bull NFT and redeem the locked 1M $TOKEN.
// Usage:
//   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
//   ANCHOR_WALLET=$DEPLOYER_KEYPAIR \
//   npx ts-node scripts/devnet_unwrap_bull.ts <tier_index>
//
// The caller must own the bull's NFT (held in their ATA). Reads the BullAsset
// PDA to find the nft_mint, then issues unwrap_bull with the right accounts.

import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Wrappedbulls } from "../target/types/wrappedbulls";

const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

async function main() {
  const tierStr = process.argv[2];
  if (!tierStr) {
    throw new Error("Usage: devnet_unwrap_bull.ts <tier_index>");
  }
  const tier = parseInt(tierStr, 10);
  if (!Number.isInteger(tier) || tier < 1 || tier > 1000) {
    throw new Error(`invalid tier: ${tierStr}`);
  }

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Wrappedbulls as anchor.Program<Wrappedbulls>;
  const payer = provider.wallet;

  const [bankPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bank")],
    program.programId
  );
  const bank = await (program.account as any).bullBank.fetch(bankPda);
  const tokenMint = bank.tokenMint as PublicKey;
  const collectionMint = bank.collectionMint as PublicKey;

  const tierBytes = Buffer.alloc(2);
  tierBytes.writeUInt16LE(tier, 0);
  const [bullAsset] = PublicKey.findProgramAddressSync(
    [Buffer.from("bull"), tierBytes],
    program.programId,
  );
  const bullAssetData = await (program.account as any).bullAsset.fetch(bullAsset);
  const nftMint = bullAssetData.nftMint as PublicKey;

  // Detect $WBULL token program (classic vs Token2022) by inspecting
  // the mint account's owner.
  const mintInfo = await provider.connection.getAccountInfo(tokenMint);
  if (!mintInfo) throw new Error(`token mint ${tokenMint.toBase58()} not found`);
  const bullsTokenProgram = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;

  console.log("program:        ", program.programId.toBase58());
  console.log("bank:           ", bankPda.toBase58());
  console.log("tier:           ", tier);
  console.log("nft mint:       ", nftMint.toBase58());
  console.log("collection_mint:", collectionMint.toBase58());

  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), nftMint.toBuffer()],
    program.programId,
  );
  const vault = getAssociatedTokenAddressSync(tokenMint, vaultAuthority, true, bullsTokenProgram);
  const payerTokenAccount = getAssociatedTokenAddressSync(tokenMint, payer.publicKey, false, bullsTokenProgram);
  const payerNftAccount = getAssociatedTokenAddressSync(nftMint, payer.publicKey);

  const [metadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), nftMint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID,
  );
  const [masterEdition] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), nftMint.toBuffer(), Buffer.from("edition")],
    TOKEN_METADATA_PROGRAM_ID,
  );
  const [collectionMetadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), collectionMint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID,
  );

  const cuBump = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });

  console.log("\nsubmitting unwrap_bull tx...");
  const sig = await program.methods
    .unwrapBull(tier)
    .accounts({
      bank: bankPda,
      payer: payer.publicKey,
      payerTokenAccount,
      tokenMint,
      nftMint,
      nftMintAuthority: vaultAuthority,
      vault,
      payerNftAccount,
      bullAsset,
      metadata,
      masterEdition,
      collectionMint,
      collectionMetadata,
      tokenProgram: TOKEN_PROGRAM_ID,
      bullsTokenProgram,
      tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
    } as any)
    .preInstructions([cuBump])
    .rpc();

  console.log("\nunwrap_bull tx:", sig);
  console.log("explorer:      https://explorer.solana.com/tx/" + sig + "?cluster=devnet");
}

main().catch((e) => { console.error(e); process.exit(1); });
