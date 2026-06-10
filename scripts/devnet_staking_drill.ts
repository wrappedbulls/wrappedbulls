// devnet_staking_drill: end to end smoke test for the deployed
// wrappedstaking program. Uses the configured ANCHOR provider wallet
// as deployer / staker / operator in one (single keypair flow keeps
// the drill tight).
//
// Flow:
//   1. Create a fresh test mint owned by deployer (devnet substitute
//      for $WBULL). Mint 100M base units to deployer's ATA.
//   2. initialize_pool against the test mint. Verify pool fields.
//   3. stake 1M base units. Verify position + stake_vault.
//   4. deposit_rewards 1M base units. Verify acc_reward_per_share
//      advanced.
//   5. claim_rewards. Verify pending paid out + reward_debt refreshed.
//   6. unstake 1M base units. Verify stake_vault drained + position
//      account closed.
//
// Usage:
//   export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
//   export ANCHOR_WALLET=/root/deployer-keypair.json
//   npx ts-node scripts/devnet_staking_drill.ts

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";

const BPF_LOADER_UPGRADEABLE_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
const TOKEN_DECIMALS = 6;
const ONE = BigInt(1_000_000); // 1 token in base units

function poolPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("staking_pool")],
    programId,
  )[0];
}
function rewardVaultPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("reward_vault")],
    programId,
  )[0];
}
function positionPda(programId: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), owner.toBuffer()],
    programId,
  )[0];
}
function programDataAddress(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE_ID,
  )[0];
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const idl = require("../target/idl/wrappedstaking.json");
  const program: any = new Program(idl, provider);
  const wallet = provider.wallet as anchor.Wallet;
  const me = wallet.publicKey;

  console.log("== devnet_staking_drill ==");
  console.log("program_id      :", program.programId.toBase58());
  console.log("deployer/staker :", me.toBase58());

  // 1. Test mint.
  const mintKp = Keypair.generate();
  console.log("\n[1] creating test mint", mintKp.publicKey.toBase58());
  const rent = await provider.connection.getMinimumBalanceForRentExemption(
    MINT_SIZE,
  );
  const tx1 = new Transaction()
    .add(
      SystemProgram.createAccount({
        fromPubkey: me,
        newAccountPubkey: mintKp.publicKey,
        space: MINT_SIZE,
        lamports: rent,
        programId: TOKEN_PROGRAM_ID,
      }),
    )
    .add(createInitializeMint2Instruction(mintKp.publicKey, TOKEN_DECIMALS, me, null));

  const myAta = getAssociatedTokenAddressSync(mintKp.publicKey, me);
  tx1.add(createAssociatedTokenAccountInstruction(me, myAta, me, mintKp.publicKey));
  const initial = ONE * BigInt(100_000_000);
  tx1.add(createMintToInstruction(mintKp.publicKey, myAta, me, initial));
  const sig1 = await provider.sendAndConfirm!(tx1, [mintKp]);
  console.log("  mint+ata+supply sig:", sig1);

  // 2. initialize_pool.
  const pool = poolPda(program.programId);
  const rewardVault = rewardVaultPda(program.programId);
  const stakeVault = getAssociatedTokenAddressSync(
    mintKp.publicKey,
    pool,
    true,
  );
  console.log("\n[2] initialize_pool");
  const sig2 = await program.methods
    .initializePool()
    .accounts({
      pool,
      stakeMint: mintKp.publicKey,
      stakeVault,
      rewardVault,
      authority: me,
      program: program.programId,
      programData: programDataAddress(program.programId),
      stakeTokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as any)
    .rpc();
  console.log("  init sig:", sig2);
  const poolAcc: any = await program.account.stakingPool.fetch(pool);
  console.log("  pool.total_staked        :", poolAcc.totalStaked.toString());
  console.log("  pool.acc_reward_per_share:", poolAcc.accRewardPerShare.toString());

  // 3. stake 1M.
  const stakeAmount = ONE * BigInt(1_000_000);
  const position = positionPda(program.programId, me);
  console.log("\n[3] stake", stakeAmount.toString());
  const sig3 = await program.methods
    .stake(new BN(stakeAmount.toString()))
    .accounts({
      pool,
      position,
      stakeMint: mintKp.publicKey,
      stakeVault,
      rewardVault,
      stakerTokenAccount: myAta,
      staker: me,
      stakeTokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as any)
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
    .rpc();
  console.log("  stake sig:", sig3);
  const posAcc: any = await program.account.stakerPosition.fetch(position);
  console.log("  position.amount     :", posAcc.amount.toString());
  console.log("  position.reward_debt:", posAcc.rewardDebt.toString());
  const vaultBal = await getAccount(provider.connection, stakeVault);
  console.log("  stake_vault.amount  :", vaultBal.amount.toString());

  // 4. deposit_rewards 1M.
  const depositAmount = ONE * BigInt(1_000_000);
  console.log("\n[4] deposit_rewards", depositAmount.toString());
  const sig4 = await program.methods
    .depositRewards(new BN(depositAmount.toString()))
    .accounts({
      pool,
      stakeMint: mintKp.publicKey,
      rewardVault,
      depositorTokenAccount: myAta,
      depositor: me,
      stakeTokenProgram: TOKEN_PROGRAM_ID,
    } as any)
    .rpc();
  console.log("  deposit sig:", sig4);
  const poolAcc2: any = await program.account.stakingPool.fetch(pool);
  console.log("  acc_reward_per_share:", poolAcc2.accRewardPerShare.toString());
  console.log("  lifetime_deposited  :", poolAcc2.lifetimeRewardsDeposited.toString());

  // 5. claim_rewards.
  const balBeforeClaim = (await getAccount(provider.connection, myAta)).amount;
  console.log("\n[5] claim_rewards");
  const sig5 = await program.methods
    .claimRewards()
    .accounts({
      pool,
      position,
      stakeMint: mintKp.publicKey,
      rewardVault,
      stakerTokenAccount: myAta,
      staker: me,
      stakeTokenProgram: TOKEN_PROGRAM_ID,
    } as any)
    .rpc();
  console.log("  claim sig:", sig5);
  const balAfterClaim = (await getAccount(provider.connection, myAta)).amount;
  console.log("  paid                :", (balAfterClaim - balBeforeClaim).toString());
  const posAcc2: any = await program.account.stakerPosition.fetch(position);
  console.log("  position.reward_debt:", posAcc2.rewardDebt.toString());

  // 6. unstake. Full.
  console.log("\n[6] unstake (full)");
  const sig6 = await program.methods
    .unstake(new BN(stakeAmount.toString()))
    .accounts({
      pool,
      position,
      stakerCloseTarget: me,
      stakeMint: mintKp.publicKey,
      stakeVault,
      rewardVault,
      stakerTokenAccount: myAta,
      staker: me,
      stakeTokenProgram: TOKEN_PROGRAM_ID,
    } as any)
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
    .rpc();
  console.log("  unstake sig:", sig6);
  const vaultAfter = await getAccount(provider.connection, stakeVault);
  console.log("  stake_vault.amount  :", vaultAfter.amount.toString());
  const closed = await provider.connection.getAccountInfo(position);
  console.log("  position closed?    :", closed === null || closed.lamports === 0);
  const poolAcc3: any = await program.account.stakingPool.fetch(pool);
  console.log("  pool.total_staked   :", poolAcc3.totalStaked.toString());

  console.log("\n== DRILL COMPLETE ==");
  console.log("test_mint:", mintKp.publicKey.toBase58());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
