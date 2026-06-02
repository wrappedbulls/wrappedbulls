// Account deserializers. Skip the 8-byte Anchor discriminator, then read
// fields in the exact order defined in programs/*/src/state.rs.
//
// Mirrors web/lib/factory.ts + web/lib/chain.ts but as a stand-alone module
// with no @/* path dependencies, so the SDK can ship as a single npm package.

import { PublicKey } from "@solana/web3.js";
import {
  ArtSource,
  BullAsset,
  BullBank,
  BullTreasuryState,
  DepositEntry,
  FactoryConfig,
  WrappedCollection,
} from "./types";

function readString(d: Buffer, off: number): { value: string; nextOff: number } {
  const len = d.readUInt32LE(off);
  off += 4;
  const value = d.slice(off, off + len).toString("utf8");
  return { value, nextOff: off + len };
}

// ---- Factory accounts ----

export function deserializeFactoryConfig(data: Buffer): FactoryConfig {
  let off = 8;
  const wbullMint = new PublicKey(data.slice(off, off + 32));
  off += 32;
  const admin = new PublicKey(data.slice(off, off + 32));
  off += 32;
  const totalDeployments = data.readUInt32LE(off);
  off += 4;
  const totalWbullDeposited = data.readBigUInt64LE(off);
  off += 8;
  const bump = data.readUInt8(off);
  return { wbullMint, admin, totalDeployments, totalWbullDeposited, bump };
}

export function deserializeBullTreasuryState(data: Buffer): BullTreasuryState {
  let off = 8;
  const claimable = data.readBigUInt64LE(off);
  off += 8;
  const pendingLen = data.readUInt32LE(off);
  off += 4;
  const pending: DepositEntry[] = [];
  for (let i = 0; i < pendingLen; i++) {
    const amount = data.readBigUInt64LE(off);
    off += 8;
    const depositedAt = data.readBigInt64LE(off);
    off += 8;
    pending.push({ amount, depositedAt });
  }
  const lifetimeDeposited = data.readBigUInt64LE(off);
  off += 8;
  const lifetimeClaimed = data.readBigUInt64LE(off);
  off += 8;
  const bump = data.readUInt8(off);
  return { claimable, pending, lifetimeDeposited, lifetimeClaimed, bump };
}

export function deserializeWrappedCollection(data: Buffer): WrappedCollection {
  let off = 8;
  const tokenMint = new PublicKey(data.slice(off, off + 32));
  off += 32;
  const deployer = new PublicKey(data.slice(off, off + 32));
  off += 32;
  const nameRes = readString(data, off);
  off = nameRes.nextOff;
  const tickerRes = readString(data, off);
  off = tickerRes.nextOff;
  const variant = data.readUInt8(off);
  off += 1;
  const uriRes = readString(data, off);
  off = uriRes.nextOff;
  const artSource: ArtSource =
    variant === 0
      ? { kind: "baseUri", uri: uriRes.value }
      : { kind: "rendererUrl", uri: uriRes.value };
  const maxSupply = data.readUInt16LE(off);
  off += 2;
  const tokensPerWrap = data.readBigUInt64LE(off);
  off += 8;
  const collectionMint = new PublicKey(data.slice(off, off + 32));
  off += 32;
  const totalWrapped = data.readBigUInt64LE(off);
  off += 8;
  const totalUnwrapped = data.readBigUInt64LE(off);
  off += 8;
  const inCirculation = data.readUInt16LE(off);
  off += 2;
  const nextTier = data.readUInt16LE(off);
  off += 2;
  const freeLen = data.readUInt32LE(off);
  off += 4;
  const freeTiers: number[] = [];
  for (let i = 0; i < freeLen; i++) {
    freeTiers.push(data.readUInt16LE(off));
    off += 2;
  }
  const createdAt = data.readBigInt64LE(off);
  off += 8;
  const bump = data.readUInt8(off);
  off += 1;
  // `verified` field; carved from the 64-byte reserved slack at the
  // 2026-06 program upgrade. Borsh bool = 1 byte (0x00 / 0x01).
  const verified = data.readUInt8(off) !== 0;
  return {
    tokenMint, deployer,
    name: nameRes.value, ticker: tickerRes.value,
    artSource, maxSupply, tokensPerWrap, collectionMint,
    totalWrapped, totalUnwrapped, inCirculation, nextTier, freeTiers,
    createdAt, bump, verified,
  };
}

export function deserializeBullAsset(data: Buffer): BullAsset {
  let off = 8;
  const nftMint = new PublicKey(data.slice(off, off + 32));
  off += 32;
  const tierIndex = data.readUInt16LE(off);
  off += 2;
  const wrappedAt = data.readBigInt64LE(off);
  off += 8;
  const bump = data.readUInt8(off);
  return { nftMint, tierIndex, wrappedAt, bump };
}

// ---- Wrappedbulls accounts ----

export function deserializeBullBank(data: Buffer): BullBank {
  let off = 8;
  const tokenMint = new PublicKey(data.slice(off, off + 32));
  off += 32;
  const totalWrapped = data.readBigUInt64LE(off);
  off += 8;
  const totalUnwrapped = data.readBigUInt64LE(off);
  off += 8;
  const inCirculation = data.readUInt16LE(off);
  off += 2;
  const nextTier = data.readUInt16LE(off);
  off += 2;
  const freeLen = data.readUInt32LE(off);
  off += 4;
  const freeTiers: number[] = [];
  for (let i = 0; i < freeLen; i++) {
    freeTiers.push(data.readUInt16LE(off));
    off += 2;
  }
  const authority = new PublicKey(data.slice(off, off + 32));
  off += 32;
  const bump = data.readUInt8(off);
  off += 1;
  const collectionMint = new PublicKey(data.slice(off, off + 32));
  return {
    tokenMint, totalWrapped, totalUnwrapped, inCirculation,
    nextTier, freeTiers, authority, bump, collectionMint,
  };
}
