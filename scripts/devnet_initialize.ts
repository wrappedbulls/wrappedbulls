// Devnet initialize: creates the BullBank PDA and locks the test token mint.
// Usage: npx ts-node scripts/devnet_initialize.ts <TOKEN_MINT>
// Env: ANCHOR_PROVIDER_URL=https://api.devnet.solana.com ANCHOR_WALLET=~/.config/solana/id.json

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Wrappedbulls } from "../target/types/wrappedbulls";

async function main() {
  const tokenMintArg = process.argv[2];
  if (!tokenMintArg) {
    console.error("usage: ts-node devnet_initialize.ts <TOKEN_MINT>");
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

  // initialize is gated on the program's on-chain upgrade authority.
  // The provider wallet here MUST be the deployer/upgrade authority.
  const BPF_LOADER_UPGRADEABLE = new PublicKey(
    "BPFLoaderUpgradeab1e11111111111111111111111"
  );
  const [programDataPda] = PublicKey.findProgramAddressSync(
    [program.programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE
  );

  console.log("program id:", program.programId.toBase58());
  console.log("token mint:", tokenMint.toBase58());
  console.log("bank pda:  ", bankPda.toBase58(), "(bump", bankBump + ")");
  console.log("program data:", programDataPda.toBase58());
  console.log("authority: ", provider.wallet.publicKey.toBase58(),
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
  console.log("explorer: https://explorer.solana.com/tx/" + sig + "?cluster=devnet");

  const bank = await (program.account as any).bullBank.fetch(bankPda);
  console.log("\nbank state:");
  console.log("  token_mint:    ", bank.tokenMint.toBase58());
  console.log("  next_tier:     ", bank.nextTier);
  console.log("  total_wrapped: ", bank.totalWrapped.toString());
  console.log("  in_circulation:", bank.inCirculation);
}

main().catch((e) => { console.error(e); process.exit(1); });
