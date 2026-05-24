// Mainnet initialize: creates the BullBank PDA and locks the live $WBULL mint.
//
// THIS COMMITS REAL SOL. Per LAUNCH_CHECKLIST.md Phase 2.
//
// Usage:
//   ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com \
//   ANCHOR_WALLET=/path/to/deployer-keypair.json \
//   npx ts-node scripts/mainnet_initialize.ts <WBULL_MINT>
//
// The wallet at ANCHOR_WALLET MUST be the program upgrade authority
// (the deployer wallet that ran `solana program deploy`).

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Wrappedbulls } from "../target/types/wrappedbulls";

async function main() {
  // Cluster guard. Refuse to run against devnet by accident.
  const url = process.env.ANCHOR_PROVIDER_URL ?? "";
  if (!/mainnet/.test(url)) {
    console.error(
      `Refusing to run: ANCHOR_PROVIDER_URL ("${url}") is not a mainnet endpoint.\n` +
      `Set ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com (or your Helius mainnet URL).`
    );
    process.exit(2);
  }

  const tokenMintArg = process.argv[2];
  if (!tokenMintArg) {
    console.error("usage: ts-node mainnet_initialize.ts <WBULL_MINT>");
    process.exit(1);
  }

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Wrappedbulls as anchor.Program<Wrappedbulls>;

  const tokenMint = new PublicKey(tokenMintArg);
  const [bankPda, bankBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("bank")],
    program.programId
  );

  const BPF_LOADER_UPGRADEABLE = new PublicKey(
    "BPFLoaderUpgradeab1e11111111111111111111111"
  );
  const [programDataPda] = PublicKey.findProgramAddressSync(
    [program.programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE
  );

  console.log("=== MAINNET initialize ===");
  console.log("rpc:          ", url);
  console.log("program id:   ", program.programId.toBase58());
  console.log("token mint:   ", tokenMint.toBase58());
  console.log("bank pda:     ", bankPda.toBase58(), "(bump", bankBump + ")");
  console.log("program data: ", programDataPda.toBase58());
  console.log("authority:    ", provider.wallet.publicKey.toBase58(),
    "(must be the program upgrade authority)");

  const sig = await program.methods
    .initialize(tokenMint)
    .accounts({
      bank: bankPda,
      authority: provider.wallet.publicKey,
      program: program.programId,
      programData: programDataPda,
      systemProgram: anchor.web3.SystemProgram.programId,
    } as any)
    .rpc();

  console.log("\ninitialized. tx:", sig);
  console.log("explorer: https://explorer.solana.com/tx/" + sig);

  const bank = await (program.account as any).bullBank.fetch(bankPda);
  console.log("\nbank state:");
  console.log("  token_mint:    ", bank.tokenMint.toBase58());
  console.log("  next_tier:     ", bank.nextTier);
  console.log("  total_wrapped: ", bank.totalWrapped.toString());
  console.log("  in_circulation:", bank.inCirculation);
}

main().catch((e) => { console.error(e); process.exit(1); });
