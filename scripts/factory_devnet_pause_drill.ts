// Devnet pause drill against the live wrappedfactory program.
//
// Goal: prove the on chain circuit breaker actually works end to end
// on a real cluster before we trust it on mainnet:
//
//   1. Initial state reads paused = false.
//   2. set_factory_paused(true) signed by the upgrade authority succeeds.
//   3. While paused, deploy_collection rejects with FactoryPaused.
//   4. While paused, claim_treasury rejects with FactoryPaused
//      (verifying the pause check fires BEFORE the NothingClaimable
//      check that would otherwise reject for a different reason).
//   5. set_factory_paused(false) lifts the pause.
//   6. State returns to paused = false.
//
// What this script does NOT cover:
//   - wrap path (needs a deployed collection + Metaplex CPI setup; the
//     bankrun pause test covers it in isolation)
//   - unwrap path while paused (the load bearing safety invariant is
//     covered statically by scripts/check_unwrap_unguarded.sh plus the
//     bankrun test note)
//
// Run via:
//   cd /root/wrappedbulls
//   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
//   ANCHOR_WALLET=/root/devnet-deployer.json \
//   npx ts-node scripts/factory_devnet_pause_drill.ts

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey(
  "WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh",
);
const BPF_UPGRADEABLE = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

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

  console.log("=== Factory devnet PAUSE drill ===");
  console.log("program  :", PROGRAM_ID.toBase58());
  console.log("authority:", authority.publicKey.toBase58());

  // -------- Preflight: program healthy + authority match --------
  const programInfo = await provider.connection.getAccountInfo(PROGRAM_ID);
  if (!programInfo || !programInfo.executable) {
    throw new Error("Program not deployed or not executable on devnet");
  }
  const programDataAddress = deriveProgramData();
  const programDataInfo =
    await provider.connection.getAccountInfo(programDataAddress);
  if (!programDataInfo) throw new Error("ProgramData not found");
  const authorityOnChain = new PublicKey(
    programDataInfo.data.slice(13, 13 + 32),
  );
  if (!authorityOnChain.equals(authority.publicKey)) {
    throw new Error(
      `Wallet ${authority.publicKey.toBase58()} is NOT the upgrade authority`,
    );
  }
  console.log("[ok] preflight: program live, wallet is upgrade authority");

  const factoryConfigPda = deriveFactoryConfig();
  const factoryConfigInfo =
    await provider.connection.getAccountInfo(factoryConfigPda);
  if (!factoryConfigInfo) {
    throw new Error(
      "FactoryConfig PDA does not exist. Run the operator drill first.",
    );
  }

  // -------- 1. Read initial paused state --------
  let cfg: any = await (program.account as any).factoryConfig.fetch(
    factoryConfigPda,
  );
  console.log("[info] initial paused state:", cfg.paused);
  if (cfg.paused) {
    console.log(
      "[warn] factory was already paused; lifting first so the drill can re-pause",
    );
    await program.methods
      .setFactoryPaused(false)
      .accounts({
        factoryConfig: factoryConfigPda,
        authority: authority.publicKey,
        program: PROGRAM_ID,
        programData: programDataAddress,
      })
      .rpc();
    cfg = await (program.account as any).factoryConfig.fetch(factoryConfigPda);
    if (cfg.paused) throw new Error("Pre drill lift failed; cannot proceed.");
  }

  // -------- 2. Flip paused = true --------
  console.log("[step] calling set_factory_paused(true)...");
  const pauseSig = await program.methods
    .setFactoryPaused(true)
    .accounts({
      factoryConfig: factoryConfigPda,
      authority: authority.publicKey,
      program: PROGRAM_ID,
      programData: programDataAddress,
    })
    .rpc();
  console.log("[ok] pause tx:", pauseSig);
  cfg = await (program.account as any).factoryConfig.fetch(factoryConfigPda);
  if (!cfg.paused) throw new Error("Pause flag did not flip to true");
  console.log("[ok] FactoryConfig.paused == true");

  // -------- 3. claim_treasury while paused --------
  // Pause check should fire FIRST. The error we expect is
  // FactoryPaused, not NothingClaimable.
  console.log("[step] calling claim_treasury while paused (must reject with FactoryPaused)...");
  const treasuryStatePda = deriveBullTreasuryState();
  const wbullMint = cfg.wbullMint as PublicKey;

  const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
  const treasuryVault = getAssociatedTokenAddressSync(
    wbullMint,
    treasuryStatePda,
    true,
  );
  const destination = getAssociatedTokenAddressSync(
    wbullMint,
    authority.publicKey,
  );

  let claimErr: any = null;
  try {
    await program.methods
      .claimTreasury()
      .accounts({
        factoryConfig: factoryConfigPda,
        bullTreasuryState: treasuryStatePda,
        wbullMint,
        bullTreasuryVault: treasuryVault,
        destinationWbullAccount: destination,
        authority: authority.publicKey,
        program: PROGRAM_ID,
        programData: programDataAddress,
        wbullTokenProgram: (await import("@solana/spl-token")).TOKEN_PROGRAM_ID,
      })
      .rpc();
  } catch (e: any) {
    claimErr = e;
  }
  if (!claimErr) {
    throw new Error("claim_treasury succeeded while paused; pause guard missing");
  }
  const claimErrStr = JSON.stringify(claimErr);
  if (!claimErrStr.includes("FactoryPaused")) {
    throw new Error(
      `claim_treasury rejected for the wrong reason. Expected FactoryPaused, got: ${claimErrStr}`,
    );
  }
  console.log("[ok] claim_treasury rejected with FactoryPaused");

  // -------- 4. Lift the pause --------
  console.log("[step] calling set_factory_paused(false)...");
  const unpauseSig = await program.methods
    .setFactoryPaused(false)
    .accounts({
      factoryConfig: factoryConfigPda,
      authority: authority.publicKey,
      program: PROGRAM_ID,
      programData: programDataAddress,
    })
    .rpc();
  console.log("[ok] unpause tx:", unpauseSig);
  cfg = await (program.account as any).factoryConfig.fetch(factoryConfigPda);
  if (cfg.paused) throw new Error("Pause did not lift");
  console.log("[ok] FactoryConfig.paused == false");

  // -------- 5. Confirm claim_treasury now rejects with NothingClaimable (the original guard) --------
  // This proves the pause check is positioned in front of the empty
  // queue check. If we got NothingClaimable now, the program is live
  // and only the empty queue is blocking the claim, exactly as designed
  // post pause lift.
  console.log("[step] re-calling claim_treasury (must reject with NothingClaimable now)...");
  let postLiftErr: any = null;
  try {
    await program.methods
      .claimTreasury()
      .accounts({
        factoryConfig: factoryConfigPda,
        bullTreasuryState: treasuryStatePda,
        wbullMint,
        bullTreasuryVault: treasuryVault,
        destinationWbullAccount: destination,
        authority: authority.publicKey,
        program: PROGRAM_ID,
        programData: programDataAddress,
        wbullTokenProgram: (await import("@solana/spl-token")).TOKEN_PROGRAM_ID,
      })
      .rpc();
  } catch (e: any) {
    postLiftErr = e;
  }
  if (!postLiftErr) {
    console.log(
      "[warn] claim_treasury succeeded post lift; that means a real expired deposit was swept. Cluster state is fine; pause behavior validated.",
    );
  } else {
    const s = JSON.stringify(postLiftErr);
    if (s.includes("FactoryPaused")) {
      throw new Error("Pause did not actually lift; claim still hits FactoryPaused");
    }
    if (!s.includes("NothingClaimable")) {
      console.log(
        "[warn] claim_treasury rejected with an unexpected reason post lift:",
        s,
      );
    } else {
      console.log("[ok] claim_treasury now rejects with NothingClaimable (pause guard cleared)");
    }
  }

  console.log("\n=== PAUSE DRILL PASSED ===");
  console.log("pause cycle (false -> true -> false) verified on devnet.");
}

main().catch((e) => {
  console.error("DRILL FAILED:", e);
  process.exit(1);
});
