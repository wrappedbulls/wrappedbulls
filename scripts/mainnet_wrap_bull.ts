// Mainnet wrap_bull: lock 1,000,000 $WBULL into a fresh WrappedBulls NFT.
//
// THIS COMMITS REAL TOKENS. Per LAUNCH_CHECKLIST.md Phase 3.
//
// Use this for the launch day "first wrap" tx (the one the Phantom team
// asked for evidence on). Run from a test wallet pre-funded with
// 1,000,000 $WBULL bought from pump.fun + ~0.05 SOL for fees.
//
// Usage:
//   ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com \
//   ANCHOR_WALLET=/path/to/test-wallet.json \
//   npx ts-node scripts/mainnet_wrap_bull.ts

import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  ComputeBudgetProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Wrappedbulls } from "../target/types/wrappedbulls";

const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

async function main() {
  const url = process.env.ANCHOR_PROVIDER_URL ?? "";
  if (!/mainnet/.test(url)) {
    console.error(
      `Refusing to run: ANCHOR_PROVIDER_URL ("${url}") is not a mainnet endpoint.`
    );
    process.exit(2);
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

  // Detect whether $WBULL is classic SPL or Token2022 by inspecting the
  // mint account's owner. Pump.fun migrated to Token2022 in 2026 but
  // older or alternate launches use classic. The program accepts both
  // via Anchor InterfaceAccount.
  const mintInfo = await provider.connection.getAccountInfo(tokenMint);
  if (!mintInfo) throw new Error(`token mint ${tokenMint.toBase58()} not found`);
  const bullsTokenProgram = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
  console.log(
    "bulls_token_program:",
    bullsTokenProgram.toBase58(),
    bullsTokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? "(Token2022)" : "(classic SPL)",
  );
  const tier = (bank.freeTiers.length > 0
    ? bank.freeTiers[bank.freeTiers.length - 1]
    : bank.nextTier) as number;

  if (collectionMint.toBase58() === PublicKey.default.toBase58()) {
    throw new Error(
      "Collection NFT not initialized. Run scripts/mainnet_initialize_collection.ts first."
    );
  }

  console.log("=== MAINNET wrap_bull ===");
  console.log("rpc:            ", url);
  console.log("program:        ", program.programId.toBase58());
  console.log("bank:           ", bankPda.toBase58());
  console.log("token mint:     ", tokenMint.toBase58());
  console.log("collection_mint:", collectionMint.toBase58());
  console.log("next tier:      ", tier);
  console.log("payer:          ", payer.publicKey.toBase58());

  const totalWrappedBuf = Buffer.alloc(8);
  totalWrappedBuf.writeBigUInt64LE(BigInt(bank.totalWrapped.toString()));
  const [nftMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("nft_mint"), totalWrappedBuf],
    program.programId
  );
  console.log("nft mint (PDA):", nftMint.toBase58());

  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), nftMint.toBuffer()],
    program.programId
  );
  const tierBytes = Buffer.alloc(2);
  tierBytes.writeUInt16LE(tier, 0);
  const [bullAsset] = PublicKey.findProgramAddressSync(
    [Buffer.from("bull"), tierBytes],
    program.programId
  );

  // ATAs that hold the underlying $TOKEN must be derived with the
  // correct token program (classic vs Token2022). The NFT ATA is
  // always classic SPL because the NFT mint is classic.
  const vault = getAssociatedTokenAddressSync(tokenMint, vaultAuthority, true, bullsTokenProgram);
  const payerTokenAccount = getAssociatedTokenAddressSync(tokenMint, payer.publicKey, false, bullsTokenProgram);
  const payerNftAccount = getAssociatedTokenAddressSync(nftMint, payer.publicKey);

  const [metadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), nftMint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID
  );
  const [masterEdition] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), nftMint.toBuffer(), Buffer.from("edition")],
    TOKEN_METADATA_PROGRAM_ID
  );

  const [collectionAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("collection_authority")],
    program.programId,
  );
  const [collectionMetadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), collectionMint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID,
  );
  const [collectionMasterEdition] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), collectionMint.toBuffer(), Buffer.from("edition")],
    TOKEN_METADATA_PROGRAM_ID,
  );

  console.log("vault:        ", vault.toBase58());
  console.log("vault auth:   ", vaultAuthority.toBase58());
  console.log("metadata:     ", metadata.toBase58());
  console.log("master edition:", masterEdition.toBase58());
  console.log("bull asset:   ", bullAsset.toBase58());
  console.log("collection_metadata:      ", collectionMetadata.toBase58());
  console.log("collection_master_edition:", collectionMasterEdition.toBase58());
  console.log("collection_authority PDA: ", collectionAuthority.toBase58());

  const cuBump = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });

  console.log("\nsubmitting wrap_bull tx...");
  const sig = await program.methods
    .wrapBull(tier)
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
      collectionMasterEdition,
      collectionAuthority,
      tokenProgram: TOKEN_PROGRAM_ID,
      bullsTokenProgram,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    } as any)
    .preInstructions([cuBump])
    .rpc();

  console.log("\nwrap_bull tx:", sig);
  console.log("explorer:    https://explorer.solana.com/tx/" + sig);
  console.log("solscan:     https://solscan.io/tx/" + sig);
  console.log("nft mint:    https://explorer.solana.com/address/" + nftMint.toBase58());
  console.log("bull asset:  https://explorer.solana.com/address/" + bullAsset.toBase58());
  console.log("\n→ Send the solscan URL above to Phantom in the existing review thread.");
  console.log("→ Check Phantom for the new WrappedBulls #" + tier + " NFT.");
}

main().catch((e) => { console.error(e); process.exit(1); });
