// Mainnet initialize_collection: one-time bootstrap of the Metaplex
// Certified Collection (MCC) parent NFT. After this, every wrap_bull
// verifies its NFT into the collection, so Magic Eden / Tensor / Phantom
// recognize the bulls as a single collection (no DYOR warnings,
// searchable, floor pricing).
//
// THIS COMMITS REAL SOL. Per LAUNCH_CHECKLIST.md Phase 2.
//
// Usage:
//   ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com \
//   ANCHOR_WALLET=/path/to/deployer-keypair.json \
//   npx ts-node scripts/mainnet_initialize_collection.ts
//
// Idempotent: if `bank.collection_mint` is already set, exits 0.

import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  ComputeBudgetProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
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

  console.log("=== MAINNET initialize_collection ===");
  console.log("rpc:            ", url);
  console.log("program:        ", program.programId.toBase58());
  console.log("bank:           ", bankPda.toBase58());
  console.log("authority:      ", (bank.authority as PublicKey).toBase58());
  console.log("payer:          ", payer.publicKey.toBase58());
  console.log("collection_mint:", (bank.collectionMint as PublicKey).toBase58());

  const alreadySet = (bank.collectionMint as PublicKey).toBase58() !==
    PublicKey.default.toBase58();
  if (alreadySet) {
    console.log("Collection already initialized. Nothing to do.");
    return;
  }

  if ((bank.authority as PublicKey).toBase58() !== payer.publicKey.toBase58()) {
    throw new Error(
      `Wallet ${payer.publicKey.toBase58()} is not the bank authority ` +
      `(${(bank.authority as PublicKey).toBase58()})`
    );
  }

  const collectionMint = Keypair.generate();
  console.log("\nNew collection_mint:", collectionMint.publicKey.toBase58());

  const [collectionAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("collection_authority")],
    program.programId
  );
  const [collectionMetadata] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      collectionMint.publicKey.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
  const [collectionMasterEdition] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      collectionMint.publicKey.toBuffer(),
      Buffer.from("edition"),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
  const authorityCollectionAta = getAssociatedTokenAddressSync(
    collectionMint.publicKey,
    payer.publicKey,
  );

  console.log("collection_authority PDA: ", collectionAuthority.toBase58());
  console.log("collection_metadata PDA:  ", collectionMetadata.toBase58());
  console.log("collection_master_edition:", collectionMasterEdition.toBase58());
  console.log("authority_collection_ata: ", authorityCollectionAta.toBase58());

  const cuBump = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });

  console.log("\nsubmitting initialize_collection tx...");
  const sig = await program.methods
    .initializeCollection()
    .accounts({
      bank: bankPda,
      authority: payer.publicKey,
      collectionMint: collectionMint.publicKey,
      collectionAuthority,
      authorityCollectionAta,
      collectionMetadata,
      collectionMasterEdition,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    } as any)
    .preInstructions([cuBump])
    .signers([collectionMint])
    .rpc();

  console.log("\ninitialize_collection tx:", sig);
  console.log("explorer:        https://explorer.solana.com/tx/" + sig);
  console.log("collection_mint: https://explorer.solana.com/address/" + collectionMint.publicKey.toBase58());

  const after = await (program.account as any).bullBank.fetch(bankPda);
  console.log(
    "\nbank.collection_mint after init:",
    (after.collectionMint as PublicKey).toBase58(),
  );
  if ((after.collectionMint as PublicKey).toBase58() !== collectionMint.publicKey.toBase58()) {
    throw new Error("bank.collection_mint did not match generated mint");
  }
  console.log("✓ Verified. Collection bootstrapped successfully.");
}

main().catch((e) => { console.error(e); process.exit(1); });
