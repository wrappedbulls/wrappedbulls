// Lightweight chain reader for the wrappedbulls program.
// Avoids pulling @coral-xyz/anchor (which has CJS/ESM resolution quirks
// inside Next.js server runtime). We only need to deserialize two account
// types - both are tiny and fixed-size enough that manual borsh works fine.

import { PublicKey, Connection } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ||
    "A2tUttiL2v2fYxPyeUSZ75CqnjDp5sewCqcnXubgoxm"
);

const RPC_URL =
  process.env.SOLANA_RPC_URL ||
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  "https://api.devnet.solana.com";

const CLUSTER =
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "devnet"; // for explorer links

export interface BullAsset {
  nftMint: PublicKey;
  tierIndex: number;
  wrappedAt: number; // unix seconds
  bump: number;
}

export interface BullBank {
  tokenMint: PublicKey;
  totalWrapped: bigint;
  totalUnwrapped: bigint;
  inCirculation: number;
  nextTier: number;
  freeTiers: number[];
  authority: PublicKey;
  bump: number;
  // MCC: Pubkey::default() until initialize_collection runs.
  collectionMint: PublicKey;
}

export function getProgramId(): PublicKey {
  return PROGRAM_ID;
}

export function getCluster(): string {
  return CLUSTER;
}

export function getConnection(): Connection {
  return new Connection(RPC_URL, "confirmed");
}

export function bankPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("bank")], PROGRAM_ID);
}

export function bullAssetPda(tier: number): [PublicKey, number] {
  const tierBuf = Buffer.alloc(2);
  tierBuf.writeUInt16LE(tier, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bull"), tierBuf],
    PROGRAM_ID
  );
}

// ---- Account deserializers (Anchor-style: 8-byte discriminator prefix) ----

export async function fetchBullAsset(
  conn: Connection,
  tier: number
): Promise<BullAsset | null> {
  const [pda] = bullAssetPda(tier);
  const info = await conn.getAccountInfo(pda, "confirmed");
  if (!info) return null;
  // skip 8-byte anchor discriminator
  const d = info.data;
  if (d.length < 8 + 32 + 2 + 8 + 1) return null;
  let off = 8;
  const nftMint = new PublicKey(d.slice(off, off + 32));
  off += 32;
  const tierIndex = d.readUInt16LE(off);
  off += 2;
  const wrappedAt = Number(d.readBigInt64LE(off));
  off += 8;
  const bump = d.readUInt8(off);
  return { nftMint, tierIndex, wrappedAt, bump };
}

export async function fetchBullBank(
  conn: Connection
): Promise<BullBank | null> {
  const [pda] = bankPda();
  const info = await conn.getAccountInfo(pda, "confirmed");
  if (!info) return null;
  const d = info.data;
  let off = 8; // anchor discriminator
  const tokenMint = new PublicKey(d.slice(off, off + 32));
  off += 32;
  const totalWrapped = d.readBigUInt64LE(off);
  off += 8;
  const totalUnwrapped = d.readBigUInt64LE(off);
  off += 8;
  const inCirculation = d.readUInt16LE(off);
  off += 2;
  const nextTier = d.readUInt16LE(off);
  off += 2;
  // free_tiers: Vec<u16> = 4-byte LE length + 2*N bytes
  const freeLen = d.readUInt32LE(off);
  off += 4;
  const freeTiers: number[] = [];
  for (let i = 0; i < freeLen; i++) {
    freeTiers.push(d.readUInt16LE(off));
    off += 2;
  }
  const authority = new PublicKey(d.slice(off, off + 32));
  off += 32;
  const bump = d.readUInt8(off);
  off += 1;
  // MCC: 32 bytes of collection_mint, carved from the original 64-byte
  // reserved block. Pre-MCC banks have all zeros (Pubkey::default()).
  const collectionMint = new PublicKey(d.slice(off, off + 32));
  return {
    tokenMint,
    totalWrapped,
    totalUnwrapped,
    inCirculation,
    nextTier,
    freeTiers,
    authority,
    bump,
    collectionMint,
  };
}
