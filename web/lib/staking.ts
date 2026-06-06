// Lightweight chain reader + ix builder for the wrappedstaking program.
// Mirrors the manual borsh pattern in factory.ts. No anchor client dep
// so the bundle stays small and we never need an anchor build to ship
// the website. Discriminators precomputed (sha256("global:<method>")[..8]
// for ixs, sha256("account:<Name>")[..8] for accounts).

import {
  PublicKey,
  Connection,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_STAKING_PROGRAM_ID ||
    "StAKeuh5kDJXpJRD72ELe3MGUc319uCZbMS82LNB7BW",
);

const RPC_URL =
  process.env.SOLANA_RPC_URL ||
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  "https://api.devnet.solana.com";

export const REWARD_PRECISION = BigInt("1000000000000");

// =====================================================================
// PDA derivation.
// =====================================================================

export function stakingPoolPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("staking_pool")], PROGRAM_ID);
}

export function rewardVaultPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("reward_vault")], PROGRAM_ID);
}

export function stakerPositionPda(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), owner.toBuffer()],
    PROGRAM_ID,
  );
}

export function getStakingProgramId(): PublicKey {
  return PROGRAM_ID;
}

export function getConnection(): Connection {
  return new Connection(RPC_URL, "confirmed");
}

// =====================================================================
// Anchor discriminators. Precomputed so we don't pay a sha256 at runtime.
// =====================================================================

const IX_INITIALIZE_POOL = Buffer.from([
  0x5f, 0xb4, 0x0a, 0xac, 0x54, 0xae, 0xe8, 0x28,
]);
const IX_DEPOSIT_REWARDS = Buffer.from([
  0x34, 0xf9, 0x70, 0x48, 0xce, 0xa1, 0xc4, 0x01,
]);
const IX_STAKE = Buffer.from([
  0xce, 0xb0, 0xca, 0x12, 0xc8, 0xd1, 0xb3, 0x6c,
]);
const IX_UNSTAKE = Buffer.from([
  0x5a, 0x5f, 0x6b, 0x2a, 0xcd, 0x7c, 0x32, 0xe1,
]);
const IX_CLAIM_REWARDS = Buffer.from([
  0x04, 0x90, 0x84, 0x47, 0x74, 0x17, 0x97, 0x50,
]);

const ACC_STAKING_POOL = Buffer.from([
  0xcb, 0x13, 0xd6, 0xdc, 0xdc, 0x9a, 0x18, 0x66,
]);
const ACC_STAKER_POSITION = Buffer.from([
  0xca, 0x9c, 0x31, 0x30, 0xe6, 0xd2, 0xf6, 0xc5,
]);

// =====================================================================
// Account types + readers.
// =====================================================================

export interface StakingPool {
  stakeMint: PublicKey;
  stakeVault: PublicKey;
  rewardVault: PublicKey;
  totalStaked: bigint;
  accRewardPerShare: bigint;
  lifetimeRewardsDeposited: bigint;
  lifetimeRewardsClaimed: bigint;
  bump: number;
}

export interface StakerPosition {
  owner: PublicKey;
  amount: bigint;
  rewardDebt: bigint;
  bump: number;
}

function readU128LE(d: Buffer, off: number): bigint {
  const lo = d.readBigUInt64LE(off);
  const hi = d.readBigUInt64LE(off + 8);
  return (hi << BigInt(64)) | lo;
}

function writeU64LE(amount: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(amount);
  return b;
}

export async function fetchStakingPool(
  conn: Connection,
): Promise<StakingPool | null> {
  const [pda] = stakingPoolPda();
  const info = await conn.getAccountInfo(pda, "confirmed");
  if (!info) return null;
  const d = info.data;
  if (!d.subarray(0, 8).equals(ACC_STAKING_POOL)) return null;
  let off = 8;
  const stakeMint = new PublicKey(d.slice(off, off + 32));
  off += 32;
  const stakeVault = new PublicKey(d.slice(off, off + 32));
  off += 32;
  const rewardVault = new PublicKey(d.slice(off, off + 32));
  off += 32;
  const totalStaked = d.readBigUInt64LE(off);
  off += 8;
  const accRewardPerShare = readU128LE(d, off);
  off += 16;
  const lifetimeRewardsDeposited = d.readBigUInt64LE(off);
  off += 8;
  const lifetimeRewardsClaimed = d.readBigUInt64LE(off);
  off += 8;
  const bump = d.readUInt8(off);
  return {
    stakeMint,
    stakeVault,
    rewardVault,
    totalStaked,
    accRewardPerShare,
    lifetimeRewardsDeposited,
    lifetimeRewardsClaimed,
    bump,
  };
}

export async function fetchStakerPosition(
  conn: Connection,
  owner: PublicKey,
): Promise<StakerPosition | null> {
  const [pda] = stakerPositionPda(owner);
  const info = await conn.getAccountInfo(pda, "confirmed");
  if (!info) return null;
  const d = info.data;
  if (!d.subarray(0, 8).equals(ACC_STAKER_POSITION)) return null;
  let off = 8;
  const ownerKey = new PublicKey(d.slice(off, off + 32));
  off += 32;
  const amount = d.readBigUInt64LE(off);
  off += 8;
  const rewardDebt = readU128LE(d, off);
  off += 16;
  const bump = d.readUInt8(off);
  return { owner: ownerKey, amount, rewardDebt, bump };
}

// Pure compute. Mirrors the on chain pending formula.
export function computePending(
  pool: Pick<StakingPool, "accRewardPerShare">,
  pos: Pick<StakerPosition, "amount" | "rewardDebt">,
): bigint {
  const earned = (pos.amount * pool.accRewardPerShare) / REWARD_PRECISION;
  return earned > pos.rewardDebt ? earned - pos.rewardDebt : BigInt(0);
}

// =====================================================================
// Instruction builders. Same account ordering as the Rust Accounts
// struct. Browser side does NOT include the anchor system_program /
// associated_token_program autodetect, so the caller must pass them
// explicitly. We re export the canonical Pubkeys for convenience.
// =====================================================================

export const TOKEN_PROGRAMS = {
  classic: TOKEN_PROGRAM_ID,
  token2022: TOKEN_2022_PROGRAM_ID,
};

export interface StakeAccounts {
  pool: PublicKey;
  position: PublicKey;
  stakeMint: PublicKey;
  stakeVault: PublicKey;
  rewardVault: PublicKey;
  stakerTokenAccount: PublicKey;
  staker: PublicKey;
  stakeTokenProgram: PublicKey;
}

export function stakeIx(amount: bigint, a: StakeAccounts): TransactionInstruction {
  const data = Buffer.concat([IX_STAKE, writeU64LE(amount)]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data,
    keys: [
      { pubkey: a.pool, isSigner: false, isWritable: true },
      { pubkey: a.position, isSigner: false, isWritable: true },
      { pubkey: a.stakeMint, isSigner: false, isWritable: false },
      { pubkey: a.stakeVault, isSigner: false, isWritable: true },
      { pubkey: a.rewardVault, isSigner: false, isWritable: true },
      { pubkey: a.stakerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: a.staker, isSigner: true, isWritable: true },
      { pubkey: a.stakeTokenProgram, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

export interface UnstakeAccounts {
  pool: PublicKey;
  position: PublicKey;
  stakerCloseTarget: PublicKey;
  stakeMint: PublicKey;
  stakeVault: PublicKey;
  rewardVault: PublicKey;
  stakerTokenAccount: PublicKey;
  staker: PublicKey;
  stakeTokenProgram: PublicKey;
}

export function unstakeIx(
  amount: bigint,
  a: UnstakeAccounts,
): TransactionInstruction {
  const data = Buffer.concat([IX_UNSTAKE, writeU64LE(amount)]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data,
    keys: [
      { pubkey: a.pool, isSigner: false, isWritable: true },
      { pubkey: a.position, isSigner: false, isWritable: true },
      { pubkey: a.stakerCloseTarget, isSigner: false, isWritable: true },
      { pubkey: a.stakeMint, isSigner: false, isWritable: false },
      { pubkey: a.stakeVault, isSigner: false, isWritable: true },
      { pubkey: a.rewardVault, isSigner: false, isWritable: true },
      { pubkey: a.stakerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: a.staker, isSigner: true, isWritable: true },
      { pubkey: a.stakeTokenProgram, isSigner: false, isWritable: false },
    ],
  });
}

export interface ClaimRewardsAccounts {
  pool: PublicKey;
  position: PublicKey;
  stakeMint: PublicKey;
  rewardVault: PublicKey;
  stakerTokenAccount: PublicKey;
  staker: PublicKey;
  stakeTokenProgram: PublicKey;
}

export function claimRewardsIx(a: ClaimRewardsAccounts): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data: Buffer.from(IX_CLAIM_REWARDS),
    keys: [
      { pubkey: a.pool, isSigner: false, isWritable: true },
      { pubkey: a.position, isSigner: false, isWritable: true },
      { pubkey: a.stakeMint, isSigner: false, isWritable: false },
      { pubkey: a.rewardVault, isSigner: false, isWritable: true },
      { pubkey: a.stakerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: a.staker, isSigner: true, isWritable: true },
      { pubkey: a.stakeTokenProgram, isSigner: false, isWritable: false },
    ],
  });
}

// =====================================================================
// Convenience: detect whether the stake mint is classic SPL or
// Token-2022 by inspecting the mint account's owner. $WBULL on mainnet
// is Token-2022; devnet test mints are usually classic SPL.
// =====================================================================
export async function detectStakeTokenProgram(
  conn: Connection,
  stakeMint: PublicKey,
): Promise<PublicKey> {
  const info = await conn.getAccountInfo(stakeMint);
  if (!info) throw new Error(`stake mint ${stakeMint.toBase58()} not found`);
  return info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
}

export function stakerTokenAccountAddress(
  stakeMint: PublicKey,
  owner: PublicKey,
  tokenProgram: PublicKey,
): PublicKey {
  return getAssociatedTokenAddressSync(stakeMint, owner, false, tokenProgram);
}

// Stub: ATA program is exported in case the page needs to pre create
// the user's staker_token_account.
export { ASSOCIATED_TOKEN_PROGRAM_ID };
