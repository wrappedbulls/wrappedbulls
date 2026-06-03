// Devnet wrap_bull SIMULATION ONLY — diagnostic, sends nothing.
// Mirrors web/lib/program.ts buildSignSimulateSend EXACTLY:
//   legacy .transaction() + .preInstructions([CU_BUMP]) + "confirmed"
//   blockhash + feePayer/recentBlockhash + connection.simulateTransaction(tx)
//   with NO config arg. Prints the same simulationErr/logs the website logs.
// Usage (env like devnet_wrap_bull.ts):
//   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
//   ANCHOR_WALLET=/root/deployer-keypair.json npx ts-node scripts/devnet_simulate_wrap.ts

import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  ComputeBudgetProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
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
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Wrappedbulls as anchor.Program<Wrappedbulls>;
  const connection = provider.connection;
  // Allow SIM_PAYER env override so we can simulate a wrap as any pubkey
  // (e.g. a known token holder). Simulation doesn't require valid signatures,
  // so the simulator runs as if that wallet had signed. Useful when the
  // provider wallet is empty of $WBULL — pick a holder, prove the program
  // would accept their wrap end-to-end.
  const simPayerStr = process.env.SIM_PAYER;
  const payer = simPayerStr
    ? { publicKey: new PublicKey(simPayerStr) }
    : provider.wallet;
  console.log("sim payer:", payer.publicKey.toBase58());

  const [bankPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bank")],
    program.programId
  );
  const bank = await (program.account as any).bullBank.fetch(bankPda);
  const tokenMint = bank.tokenMint as PublicKey;
  const collectionMint = bank.collectionMint as PublicKey;
  const tier = (bank.freeTiers.length > 0
    ? bank.freeTiers[bank.freeTiers.length - 1]
    : bank.nextTier) as number;

  const totalWrappedBuf = Buffer.alloc(8);
  totalWrappedBuf.writeBigUInt64LE(BigInt(bank.totalWrapped.toString()));
  const [nftMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("nft_mint"), totalWrappedBuf],
    program.programId
  );
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
  // $WBULL is Token-2022 on mainnet (verified). Derive its ATAs against
  // the Token-2022 program; NFT ATA stays classic SPL (we mint the NFT).
  // allowOwnerOffCurve=true so we can simulate as PDAs (e.g. bonding curves).
  const vault = getAssociatedTokenAddressSync(tokenMint, vaultAuthority, true, TOKEN_2022_PROGRAM_ID);
  const payerTokenAccount = getAssociatedTokenAddressSync(tokenMint, payer.publicKey, true, TOKEN_2022_PROGRAM_ID);
  const payerNftAccount = getAssociatedTokenAddressSync(nftMint, payer.publicKey, true);
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

  console.log("program:    ", program.programId.toBase58());
  console.log("token mint: ", tokenMint.toBase58());
  console.log("tier:       ", tier, "nft mint:", nftMint.toBase58());

  const CU_BUMP = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });

  // Identical builder to web/lib/program.ts wrapBull()
  const builder = program.methods
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
      bullsTokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    } as any)
    .preInstructions([CU_BUMP]);

  // === EXACT buildSignSimulateSend mirror ===
  const tx: Transaction = await builder.transaction();
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = blockhash;
  const sim = await connection.simulateTransaction(tx);

  const msg = tx.compileMessage();
  console.log("\n[wrappedbulls-tx:wrapBull-SIM]", JSON.stringify({
    size: tx.serializeMessage().length,
    accountKeys: msg.accountKeys.length,
    simulationErr: sim.value.err,
    unitsConsumed: sim.value.unitsConsumed,
    txKind: "legacy",
  }, null, 2));
  console.log("\n--- simulation logs ---");
  for (const l of (sim.value.logs ?? [])) console.log(l);
  console.log("\nRESULT:", sim.value.err === null
    ? "CLEAN — simulationErr is null (tx mechanics OK; any Phantom banner = domain reputation, not a code/tx error)"
    : "FAILED — see simulationErr above");
}

main().catch((e) => { console.error("SCRIPT ERROR:", e); process.exit(1); });
