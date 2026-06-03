// Operator drill against the live devnet wrappedfactory program.
//
// Goal: prove the single keypair upgrade authority posture (the mainnet
// plan) actually works end to end on a real cluster:
//   1. The deployer keypair can call `initialize`, the admin gated ix
//      that writes FactoryConfig + BullTreasuryState + bull_treasury_vault.
//   2. The same keypair can call `claim_treasury` (which here will fail
//      with NothingClaimable because there are no expired deposits,
//      proving the authority gate accepts and the body rejects for the
//      right reason).
//
// Run via:
//   cd /root/wrappedbulls
//   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
//   ANCHOR_WALLET=/root/devnet-deployer.json \
//   npx ts-node scripts/factory_devnet_operator_drill.ts
//
// Skips deploy_collection / wrap / unwrap; those need a Metaplex
// metadata server and are exercised in the bankrun + anchor test suites.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  getAccount,
} from "@solana/spl-token";

const PROGRAM_ID = new PublicKey(
  "WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh",
);
const BPF_UPGRADEABLE = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
const TOKEN_DECIMALS = 6;

function deriveFactoryConfig() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("factory_config")],
    PROGRAM_ID,
  )[0];
}
function deriveBullTreasuryState() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bull_treasury")],
    PROGRAM_ID,
  )[0];
}
function deriveProgramData() {
  return PublicKey.findProgramAddressSync(
    [PROGRAM_ID.toBuffer()],
    BPF_UPGRADEABLE,
  )[0];
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const idl = require("../target/idl/wrappedfactory.json");
  const program = new Program(idl, provider);
  const authority = provider.wallet as anchor.Wallet;

  console.log("=== Factory devnet operator drill ===");
  console.log("program  :", PROGRAM_ID.toBase58());
  console.log("authority:", authority.publicKey.toBase58());

  // === 1. Confirm program is healthy on devnet ===
  const programInfo = await provider.connection.getAccountInfo(PROGRAM_ID);
  if (!programInfo) throw new Error("Program account not found on devnet");
  if (!programInfo.executable) throw new Error("Program is not executable");
  if (!programInfo.owner.equals(BPF_UPGRADEABLE)) {
    throw new Error(
      `Program owner is ${programInfo.owner.toBase58()}, expected ${BPF_UPGRADEABLE.toBase58()}`,
    );
  }
  console.log("[ok] program exists, executable, BPF upgradeable owned");

  // === 2. Read the on chain upgrade authority and check it matches our wallet ===
  const programDataAddress = deriveProgramData();
  const programDataInfo =
    await provider.connection.getAccountInfo(programDataAddress);
  if (!programDataInfo) throw new Error("ProgramData not found");
  // Layout: 4 tag | 8 slot | 1 option | 32 authority | bytecode
  const authorityOnChain = new PublicKey(
    programDataInfo.data.slice(13, 13 + 32),
  );
  console.log("[info] on chain upgrade authority:", authorityOnChain.toBase58());
  if (!authorityOnChain.equals(authority.publicKey)) {
    throw new Error(
      `Wallet ${authority.publicKey.toBase58()} is NOT the upgrade authority. ` +
        `Drill cannot exercise admin gated ixs without the right key.`,
    );
  }
  console.log("[ok] wallet IS the program upgrade authority");

  // === 3. Check if initialize already ran (idempotent precondition) ===
  const factoryConfigPda = deriveFactoryConfig();
  const treasuryStatePda = deriveBullTreasuryState();
  const existingConfig =
    await provider.connection.getAccountInfo(factoryConfigPda);

  let mockWbullMint: PublicKey;

  if (existingConfig) {
    console.log(
      "[info] FactoryConfig already exists; reading its wbull_mint to skip initialize",
    );
    const cfg: any = await (program.account as any).factoryConfig.fetch(
      factoryConfigPda,
    );
    mockWbullMint = cfg.wbullMint;
    console.log("[info] existing wbull_mint:", mockWbullMint.toBase58());
  } else {
    console.log("[step] creating a mock $WBULL mint on devnet...");
    mockWbullMint = await createMint(
      provider.connection,
      authority.payer,
      authority.publicKey,
      null,
      TOKEN_DECIMALS,
    );
    console.log("[ok] mock wbull_mint:", mockWbullMint.toBase58());

    const treasuryVault = getAssociatedTokenAddressSync(
      mockWbullMint,
      treasuryStatePda,
      true,
    );

    console.log("[step] calling initialize(wbull_mint)...");
    await program.methods
      .initialize(mockWbullMint)
      .accounts({
        factoryConfig: factoryConfigPda,
        bullTreasuryState: treasuryStatePda,
        wbullMint: mockWbullMint,
        bullTreasuryVault: treasuryVault,
        authority: authority.publicKey,
        program: PROGRAM_ID,
        programData: programDataAddress,
        wbullTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("[ok] initialize succeeded");
  }

  // === 4. Read state ===
  const cfg: any = await (program.account as any).factoryConfig.fetch(
    factoryConfigPda,
  );
  console.log("[ok] FactoryConfig:");
  console.log("    wbull_mint        :", cfg.wbullMint.toBase58());
  console.log("    admin             :", cfg.admin.toBase58());
  console.log("    total_deployments :", cfg.totalDeployments);
  console.log(
    "    total_wbull_deposited:",
    cfg.totalWbullDeposited.toString(),
  );

  const treasury: any = await (program.account as any).bullTreasuryState.fetch(
    treasuryStatePda,
  );
  console.log("[ok] BullTreasuryState:");
  console.log("    claimable          :", treasury.claimable.toString());
  console.log("    pending.length     :", treasury.pending.length);
  console.log(
    "    lifetime_deposited:",
    treasury.lifetimeDeposited.toString(),
  );
  console.log("    lifetime_claimed  :", treasury.lifetimeClaimed.toString());

  // === 5. Exercise claim_treasury. Should fail with NothingClaimable
  //         since the treasury has no expired deposits to drain. ===
  const treasuryVault = getAssociatedTokenAddressSync(
    mockWbullMint,
    treasuryStatePda,
    true,
  );
  const destination = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    authority.payer,
    mockWbullMint,
    authority.publicKey,
  );

  console.log("[step] calling claim_treasury (expect NothingClaimable)...");
  let claimErr = "";
  try {
    await program.methods
      .claimTreasury()
      .accounts({
        factoryConfig: factoryConfigPda,
        bullTreasuryState: treasuryStatePda,
        wbullMint: mockWbullMint,
        bullTreasuryVault: treasuryVault,
        destinationWbullAccount: destination.address,
        authority: authority.publicKey,
        program: PROGRAM_ID,
        programData: programDataAddress,
        wbullTokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    throw new Error("claim_treasury unexpectedly succeeded with empty treasury");
  } catch (e: any) {
    claimErr = String(e.message ?? e);
  }

  if (claimErr.includes("NothingClaimable")) {
    console.log("[ok] claim_treasury correctly rejected: NothingClaimable");
  } else {
    throw new Error(
      `claim_treasury rejected for the WRONG reason. Got: ${claimErr}`,
    );
  }

  // === 6. Drill summary ===
  console.log("=== drill summary ===");
  console.log("✓ program is deployed + executable + BPF upgradeable owned");
  console.log("✓ wallet matches the on chain upgrade authority");
  console.log("✓ initialize ran or already had run; FactoryConfig is populated");
  console.log(
    "✓ claim_treasury is callable by the authority and rejects with the correct error",
  );
  console.log("");
  console.log(
    "The single keypair posture works end to end on devnet. The same keypair on mainnet will hold the same powers.",
  );
}

main().catch((e) => {
  console.error("DRILL FAILED:", e.message ?? e);
  process.exit(1);
});
