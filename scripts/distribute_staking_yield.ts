// distribute_staking_yield: operator script that routes 50% of a fresh
// claim_treasury sweep into the wrappedstaking reward vault and leaves
// the other 50% in the operator wallet.
//
// Per docs/STAKING_DESIGN.md the revenue split is enforced operationally,
// not on chain. This script is the operational enforcement. It is
// idempotent: it reads the operator wallet's $WBULL balance delta since
// the last run from a tiny side car file (data/staking_yield_state.json)
// so re running with no new claim is a no op.
//
// Usage:
//   # Dry run: print the planned distribution without sending the tx
//   ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com \
//   ANCHOR_WALLET=/root/operator-keypair.json \
//   STAKING_SPLIT_PCT=50 \
//   DRY_RUN=1 \
//   npx ts-node scripts/distribute_staking_yield.ts
//
//   # Live:
//   ... same env, DRY_RUN=0 ...
//
// Inputs:
//   STAKING_SPLIT_PCT  percent of the new $WBULL balance to route into
//                      wrappedstaking (default 50)
//   DRY_RUN            "1" to print only, "0" to send
//   MIN_DEPOSIT_WBULL  minimum $WBULL to bother depositing (default
//                      100_000 base units = 0.1 $WBULL). Avoids paying
//                      tx fee on dust.
//
// Side car state file is data/staking_yield_state.json:
//   { "last_known_operator_balance": "12345678" }
// On each run we read the operator's current balance, subtract this
// value, and treat the delta as "new revenue since last sweep".

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  ComputeBudgetProgram,
  Connection,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

const STATE_PATH = path.join(__dirname, "..", "data", "staking_yield_state.json");
const DEFAULT_MIN_DEPOSIT = BigInt(100_000);

function readState(): { last_known_operator_balance: string } {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { last_known_operator_balance: "0" };
  }
}

function writeState(state: { last_known_operator_balance: string }) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

function deriveStakingPool(stakingProgramId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("staking_pool")],
    stakingProgramId,
  )[0];
}

function deriveRewardVault(stakingProgramId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("reward_vault")],
    stakingProgramId,
  )[0];
}

async function detectTokenProgram(
  connection: Connection,
  mint: PublicKey,
): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error(`mint ${mint.toBase58()} not found`);
  return info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const stakingIdl = require("../target/idl/wrappedstaking.json");
  const stakingProgram = new Program(stakingIdl, provider) as Program<any>;

  const splitPct = Number(process.env.STAKING_SPLIT_PCT ?? "50");
  if (!Number.isFinite(splitPct) || splitPct < 0 || splitPct > 100) {
    throw new Error(`STAKING_SPLIT_PCT must be 0..100, got ${splitPct}`);
  }
  const dryRun = process.env.DRY_RUN !== "0";
  const minDeposit = process.env.MIN_DEPOSIT_WBULL
    ? BigInt(process.env.MIN_DEPOSIT_WBULL)
    : DEFAULT_MIN_DEPOSIT;

  const pool = deriveStakingPool(stakingProgram.programId);
  const rewardVault = deriveRewardVault(stakingProgram.programId);

  const poolAcc: any = await stakingProgram.account.stakingPool.fetch(pool);
  const stakeMint: PublicKey = poolAcc.stakeMint;

  const tokenProgram = await detectTokenProgram(provider.connection, stakeMint);
  const operatorAta = getAssociatedTokenAddressSync(
    stakeMint,
    provider.wallet.publicKey,
    false,
    tokenProgram,
  );
  const operatorAccount = await getAccount(
    provider.connection,
    operatorAta,
    "confirmed",
    tokenProgram,
  );
  const currentBalance = operatorAccount.amount;

  const state = readState();
  const lastKnown = BigInt(state.last_known_operator_balance);
  const delta = currentBalance > lastKnown ? currentBalance - lastKnown : BigInt(0);

  console.log("==== distribute_staking_yield ====");
  console.log("stake_mint            :", stakeMint.toBase58());
  console.log("operator              :", provider.wallet.publicKey.toBase58());
  console.log("operator_ata          :", operatorAta.toBase58());
  console.log("reward_vault          :", rewardVault.toBase58());
  console.log("current_balance       :", currentBalance.toString());
  console.log("last_known_balance    :", lastKnown.toString());
  console.log("revenue_delta         :", delta.toString());
  console.log("split_pct             :", splitPct);
  console.log("dry_run               :", dryRun);

  if (delta === BigInt(0)) {
    console.log("No new revenue since last sweep. Exiting clean.");
    return;
  }

  const depositAmount = (delta * BigInt(splitPct)) / BigInt(100);
  console.log("planned_deposit       :", depositAmount.toString());

  if (depositAmount < minDeposit) {
    console.log(
      `Planned deposit ${depositAmount} below MIN_DEPOSIT_WBULL ${minDeposit}; skipping. ` +
        `Revenue stays in operator wallet for next sweep.`,
    );
    return;
  }

  if (dryRun) {
    console.log("DRY_RUN=1; would deposit", depositAmount.toString(), "to reward_vault.");
    return;
  }

  const sig = await stakingProgram.methods
    .depositRewards(new anchor.BN(depositAmount.toString()))
    .accounts({
      pool,
      stakeMint,
      rewardVault,
      depositorTokenAccount: operatorAta,
      depositor: provider.wallet.publicKey,
      stakeTokenProgram: tokenProgram,
    } as any)
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 })])
    .rpc();

  console.log("deposit_rewards sig   :", sig);

  // Persist the post deposit operator balance so the next run's delta
  // excludes the amount we just transferred out.
  const postBalance = currentBalance - depositAmount;
  writeState({ last_known_operator_balance: postBalance.toString() });
  console.log("new_last_known_balance:", postBalance.toString());
  console.log("done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
