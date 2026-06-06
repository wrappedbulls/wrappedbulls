// wrappedstaking bankrun integration tests.
//
// Covers the staking lifecycle end to end:
//   1. initialize_pool authority gate: random caller is rejected
//      with NotPoolAdmin (proves upgrade authority gating works)
//   2. initialize_pool happy path: pool singleton + stake_vault ATA +
//      reward_vault PDA are created and pool fields are zeroed
//   3. deposit_rewards with total_staked == 0 short circuits: tokens
//      land in reward_vault but acc_reward_per_share stays at 0
//   4. stake creates the position PDA, transfers $WBULL to stake_vault,
//      and sets reward_debt against the current accumulator (which is
//      non zero after step 3, proving the pre-staker no advance branch)
//   5. deposit_rewards with total_staked > 0 advances
//      acc_reward_per_share by exactly (amount * REWARD_PRECISION)
//      / total_staked
//   6. claim_rewards pays the position's pending share into the
//      staker's token account and refreshes reward_debt to current
//   7. unstake settles pending, returns the stake, and closes the
//      position PDA (rent refunded to staker)
//   8. unstake rejects amount > position.amount
//   9. multi staker fairness: two stakers split a deposit pro rata
//
// Bankrun is used so each scenario runs in a fresh in process
// validator and so we can synthesize the BPFLoaderUpgradeable
// program data accounts (initialize_pool gates on
// program.programdata_address(), same pattern as wrappedfactory's
// initialize). Mirror of wrappedfactory_pause.ts +
// wrappedfactory_claim_success.ts setup.

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { startAnchor, BankrunProvider } from "anchor-bankrun";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

const BPF_LOADER_UPGRADEABLE_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

const TOKEN_DECIMALS = 6;
const MINT_RENT_LAMPORTS = 1_500_000;
const ONE_TOKEN = BigInt("1000000");
const ONE_M = ONE_TOKEN * BigInt(1_000_000);
const REWARD_PRECISION = BigInt("1000000000000");

function buildUpgradeableLoaderAccounts(
  context: any,
  programId: PublicKey,
  upgradeAuthority: PublicKey,
  bytecode: Buffer,
) {
  const [programDataAddress] = PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE_ID,
  );

  const header = Buffer.alloc(4 + 8 + 1 + 32);
  header.writeUInt32LE(3, 0);
  header.writeBigUInt64LE(0n, 4);
  header.writeUInt8(1, 12);
  upgradeAuthority.toBuffer().copy(header, 13);
  const programDataBytes = Buffer.concat([header, bytecode]);

  context.setAccount(programDataAddress, {
    lamports: 10_000_000_000,
    data: programDataBytes,
    owner: BPF_LOADER_UPGRADEABLE_ID,
    executable: false,
    rentEpoch: 0,
  });

  const programAccount = Buffer.alloc(4 + 32);
  programAccount.writeUInt32LE(2, 0);
  programDataAddress.toBuffer().copy(programAccount, 4);

  context.setAccount(programId, {
    lamports: 1_000_000_000,
    data: programAccount,
    owner: BPF_LOADER_UPGRADEABLE_ID,
    executable: true,
    rentEpoch: 0,
  });

  return programDataAddress;
}

function derivePool(programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("staking_pool")],
    programId,
  )[0];
}

function deriveRewardVault(programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("reward_vault")],
    programId,
  )[0];
}

function derivePosition(programId: PublicKey, owner: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), owner.toBuffer()],
    programId,
  )[0];
}

describe("wrappedstaking (bankrun)", () => {
  let context: Awaited<ReturnType<typeof startAnchor>>;
  let provider: BankrunProvider;
  let program: Program<any>;
  let authority: anchor.Wallet;
  let programDataAddress: PublicKey;

  const wbullMintKp = Keypair.generate();
  const wbullMint = wbullMintKp.publicKey;
  const stakerA = Keypair.generate();
  const stakerB = Keypair.generate();
  const random = Keypair.generate();
  const operator = Keypair.generate();

  let stakerAAta: PublicKey;
  let stakerBAta: PublicKey;
  let operatorAta: PublicKey;
  let pool: PublicKey;
  let stakeVault: PublicKey;
  let rewardVault: PublicKey;

  async function createMintTx(mintKp: Keypair, mintAuthority: PublicKey) {
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: authority.publicKey,
        newAccountPubkey: mintKp.publicKey,
        space: MINT_SIZE,
        lamports: MINT_RENT_LAMPORTS,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        mintKp.publicKey,
        TOKEN_DECIMALS,
        mintAuthority,
        null,
      ),
    );
    await provider.sendAndConfirm!(tx, [mintKp]);
  }

  async function createAtaAndMintTx(
    mint: PublicKey,
    owner: PublicKey,
    amount: bigint,
  ): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(mint, owner);
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey,
        ata,
        owner,
        mint,
      ),
      createMintToInstruction(mint, ata, authority.publicKey, amount),
    );
    await provider.sendAndConfirm!(tx);
    return ata;
  }

  async function fundSol(target: PublicKey, lamports: number) {
    await provider.sendAndConfirm!(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: target,
          lamports,
        }),
      ),
    );
  }

  async function getTokenAmount(account: PublicKey): Promise<bigint> {
    const acc = await context.banksClient.getAccount(account);
    if (!acc) return BigInt(0);
    return Buffer.from(acc.data).readBigUInt64LE(64);
  }

  before(async () => {
    context = await startAnchor("", [], []);
    provider = new BankrunProvider(context);
    const walletPayer = (provider.wallet as anchor.Wallet).payer;
    (provider.wallet as any).signTransaction = (tx: any) => {
      tx.partialSign(walletPayer);
      return tx;
    };
    anchor.setProvider(provider);
    const idl = require("../target/idl/wrappedstaking.json");
    program = new Program(idl, provider) as Program<any>;
    authority = provider.wallet as anchor.Wallet;

    const bytecode = fs.readFileSync(
      path.join(__dirname, "..", "target", "deploy", "wrappedstaking.so"),
    );
    programDataAddress = buildUpgradeableLoaderAccounts(
      context,
      program.programId,
      authority.publicKey,
      bytecode,
    );

    pool = derivePool(program.programId);
    stakeVault = getAssociatedTokenAddressSync(wbullMint, pool, true);
    rewardVault = deriveRewardVault(program.programId);

    await fundSol(stakerA.publicKey, 2 * LAMPORTS_PER_SOL);
    await fundSol(stakerB.publicKey, 2 * LAMPORTS_PER_SOL);
    await fundSol(random.publicKey, 1 * LAMPORTS_PER_SOL);
    await fundSol(operator.publicKey, 1 * LAMPORTS_PER_SOL);

    await createMintTx(wbullMintKp, authority.publicKey);
    stakerAAta = await createAtaAndMintTx(
      wbullMint,
      stakerA.publicKey,
      BigInt(10) * ONE_M,
    );
    stakerBAta = await createAtaAndMintTx(
      wbullMint,
      stakerB.publicKey,
      BigInt(10) * ONE_M,
    );
    operatorAta = await createAtaAndMintTx(
      wbullMint,
      operator.publicKey,
      BigInt(100) * ONE_M,
    );
  });

  it("rejects initialize_pool from a non upgrade authority caller", async () => {
    try {
      await program.methods
        .initializePool()
        .accounts({
          pool,
          stakeMint: wbullMint,
          stakeVault,
          rewardVault,
          authority: random.publicKey,
          program: program.programId,
          programData: programDataAddress,
          stakeTokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([random])
        .rpc();
      expect.fail("initialize_pool should have rejected random caller");
    } catch (err: any) {
      expect(String(err)).to.match(/NotPoolAdmin/);
    }
  });

  it("initialize_pool happy path zeros every field", async () => {
    await program.methods
      .initializePool()
      .accounts({
        pool,
        stakeMint: wbullMint,
        stakeVault,
        rewardVault,
        authority: authority.publicKey,
        program: program.programId,
        programData: programDataAddress,
        stakeTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    const acc: any = await program.account.stakingPool.fetch(pool);
    expect(acc.stakeMint.toBase58()).to.eq(wbullMint.toBase58());
    expect(acc.stakeVault.toBase58()).to.eq(stakeVault.toBase58());
    expect(acc.rewardVault.toBase58()).to.eq(rewardVault.toBase58());
    expect(acc.totalStaked.toString()).to.eq("0");
    expect(acc.accRewardPerShare.toString()).to.eq("0");
    expect(acc.lifetimeRewardsDeposited.toString()).to.eq("0");
    expect(acc.lifetimeRewardsClaimed.toString()).to.eq("0");
  });

  it("deposit_rewards with total_staked == 0 lands in vault and does not advance accumulator", async () => {
    const amount = BigInt(5) * ONE_M;
    await program.methods
      .depositRewards(new BN(amount.toString()))
      .accounts({
        pool,
        stakeMint: wbullMint,
        rewardVault,
        depositorTokenAccount: operatorAta,
        depositor: operator.publicKey,
        stakeTokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([operator])
      .rpc();

    const acc: any = await program.account.stakingPool.fetch(pool);
    expect(acc.accRewardPerShare.toString()).to.eq("0");
    expect(acc.lifetimeRewardsDeposited.toString()).to.eq(amount.toString());
    expect(await getTokenAmount(rewardVault)).to.eq(amount);
  });

  it("stake creates the position and transfers $WBULL into stake_vault", async () => {
    const stakeAmount = BigInt(1) * ONE_M;
    const positionA = derivePosition(program.programId, stakerA.publicKey);

    await program.methods
      .stake(new BN(stakeAmount.toString()))
      .accounts({
        pool,
        position: positionA,
        stakeMint: wbullMint,
        stakeVault,
        rewardVault,
        stakerTokenAccount: stakerAAta,
        staker: stakerA.publicKey,
        stakeTokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([stakerA])
      .rpc();

    const pos: any = await program.account.stakerPosition.fetch(positionA);
    expect(pos.owner.toBase58()).to.eq(stakerA.publicKey.toBase58());
    expect(pos.amount.toString()).to.eq(stakeAmount.toString());
    // accRewardPerShare was still 0 at stake time so reward_debt is 0.
    expect(pos.rewardDebt.toString()).to.eq("0");

    expect(await getTokenAmount(stakeVault)).to.eq(stakeAmount);

    const pool_: any = await program.account.stakingPool.fetch(pool);
    expect(pool_.totalStaked.toString()).to.eq(stakeAmount.toString());
  });

  it("deposit_rewards with stake advances accumulator by (amount * PRECISION) / total_staked", async () => {
    const before: any = await program.account.stakingPool.fetch(pool);
    const totalStaked = BigInt(before.totalStaked.toString());
    const amount = BigInt(2) * ONE_M;

    await program.methods
      .depositRewards(new BN(amount.toString()))
      .accounts({
        pool,
        stakeMint: wbullMint,
        rewardVault,
        depositorTokenAccount: operatorAta,
        depositor: operator.publicKey,
        stakeTokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([operator])
      .rpc();

    const after: any = await program.account.stakingPool.fetch(pool);
    const expectedDelta = (amount * REWARD_PRECISION) / totalStaked;
    const actualDelta =
      BigInt(after.accRewardPerShare.toString()) -
      BigInt(before.accRewardPerShare.toString());
    expect(actualDelta.toString()).to.eq(expectedDelta.toString());
  });

  it("claim_rewards pays pending and refreshes reward_debt", async () => {
    const positionA = derivePosition(program.programId, stakerA.publicKey);
    const beforePool: any = await program.account.stakingPool.fetch(pool);
    const beforePos: any =
      await program.account.stakerPosition.fetch(positionA);
    const beforeBal = await getTokenAmount(stakerAAta);

    await program.methods
      .claimRewards()
      .accounts({
        pool,
        position: positionA,
        stakeMint: wbullMint,
        rewardVault,
        stakerTokenAccount: stakerAAta,
        staker: stakerA.publicKey,
        stakeTokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([stakerA])
      .rpc();

    const afterPos: any =
      await program.account.stakerPosition.fetch(positionA);
    const afterBal = await getTokenAmount(stakerAAta);

    const amount = BigInt(beforePos.amount.toString());
    const acc = BigInt(beforePool.accRewardPerShare.toString());
    const debt = BigInt(beforePos.rewardDebt.toString());
    const expectedPending = (amount * acc) / REWARD_PRECISION - debt;

    expect((afterBal - beforeBal).toString()).to.eq(expectedPending.toString());
    expect(afterPos.rewardDebt.toString()).to.eq(
      ((amount * acc) / REWARD_PRECISION).toString(),
    );
  });

  it("rejects unstake amount greater than position", async () => {
    const positionA = derivePosition(program.programId, stakerA.publicKey);
    const pos: any = await program.account.stakerPosition.fetch(positionA);
    const tooMuch = BigInt(pos.amount.toString()) + BigInt(1);

    try {
      await program.methods
        .unstake(new BN(tooMuch.toString()))
        .accounts({
          pool,
          position: positionA,
          stakerCloseTarget: stakerA.publicKey,
          stakeMint: wbullMint,
          stakeVault,
          rewardVault,
          stakerTokenAccount: stakerAAta,
          staker: stakerA.publicKey,
          stakeTokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .signers([stakerA])
        .rpc();
      expect.fail("unstake should reject amount > position");
    } catch (err: any) {
      expect(String(err)).to.match(/UnstakeExceedsPosition/);
    }
  });

  it("unstake settles pending, returns the stake, and closes the position PDA", async () => {
    const positionA = derivePosition(program.programId, stakerA.publicKey);
    const pos: any = await program.account.stakerPosition.fetch(positionA);
    const beforeBal = await getTokenAmount(stakerAAta);
    const beforeVault = await getTokenAmount(stakeVault);
    const amount = BigInt(pos.amount.toString());

    await program.methods
      .unstake(new BN(amount.toString()))
      .accounts({
        pool,
        position: positionA,
        stakerCloseTarget: stakerA.publicKey,
        stakeMint: wbullMint,
        stakeVault,
        rewardVault,
        stakerTokenAccount: stakerAAta,
        staker: stakerA.publicKey,
        stakeTokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([stakerA])
      .rpc();

    const afterBal = await getTokenAmount(stakerAAta);
    const afterVault = await getTokenAmount(stakeVault);
    expect((afterBal - beforeBal) >= amount).to.eq(true);
    expect((beforeVault - afterVault).toString()).to.eq(amount.toString());

    // Position PDA should be closed (zero lamports, owned by system).
    const closed = await context.banksClient.getAccount(positionA);
    expect(closed === null || closed.lamports === 0n).to.eq(true);

    const pool_: any = await program.account.stakingPool.fetch(pool);
    expect(pool_.totalStaked.toString()).to.eq("0");
  });

  it("multi staker fairness: two stakers split a deposit pro rata", async () => {
    const positionA = derivePosition(program.programId, stakerA.publicKey);
    const positionB = derivePosition(program.programId, stakerB.publicKey);

    // A re-stakes 1M (fresh PDA via init_if_needed since previous full
    // unstake closed it), B stakes 3M -> shares should be 1:3.
    await program.methods
      .stake(new BN((BigInt(1) * ONE_M).toString()))
      .accounts({
        pool,
        position: positionA,
        stakeMint: wbullMint,
        stakeVault,
        rewardVault,
        stakerTokenAccount: stakerAAta,
        staker: stakerA.publicKey,
        stakeTokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([stakerA])
      .rpc();

    await program.methods
      .stake(new BN((BigInt(3) * ONE_M).toString()))
      .accounts({
        pool,
        position: positionB,
        stakeMint: wbullMint,
        stakeVault,
        rewardVault,
        stakerTokenAccount: stakerBAta,
        staker: stakerB.publicKey,
        stakeTokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([stakerB])
      .rpc();

    // Operator deposits 4M rewards: A should earn 1M, B should earn 3M.
    const deposit = BigInt(4) * ONE_M;
    await program.methods
      .depositRewards(new BN(deposit.toString()))
      .accounts({
        pool,
        stakeMint: wbullMint,
        rewardVault,
        depositorTokenAccount: operatorAta,
        depositor: operator.publicKey,
        stakeTokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([operator])
      .rpc();

    const balABefore = await getTokenAmount(stakerAAta);
    const balBBefore = await getTokenAmount(stakerBAta);

    await program.methods
      .claimRewards()
      .accounts({
        pool,
        position: positionA,
        stakeMint: wbullMint,
        rewardVault,
        stakerTokenAccount: stakerAAta,
        staker: stakerA.publicKey,
        stakeTokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([stakerA])
      .rpc();

    await program.methods
      .claimRewards()
      .accounts({
        pool,
        position: positionB,
        stakeMint: wbullMint,
        rewardVault,
        stakerTokenAccount: stakerBAta,
        staker: stakerB.publicKey,
        stakeTokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([stakerB])
      .rpc();

    const balAAfter = await getTokenAmount(stakerAAta);
    const balBAfter = await getTokenAmount(stakerBAta);
    const aShare = balAAfter - balABefore;
    const bShare = balBAfter - balBBefore;

    // Allow up to 1 base unit of rounding slop from integer division.
    const expectedA = BigInt(1) * ONE_M;
    const expectedB = BigInt(3) * ONE_M;
    const aDiff = aShare > expectedA ? aShare - expectedA : expectedA - aShare;
    const bDiff = bShare > expectedB ? bShare - expectedB : expectedB - bShare;
    expect(aDiff <= BigInt(1)).to.eq(true);
    expect(bDiff <= BigInt(1)).to.eq(true);
  });
});
