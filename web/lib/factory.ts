// Lightweight chain reader for the WrappedFactory program.
// Mirrors the pattern in chain.ts (no anchor client dep -- manual borsh).
//
// Three account types the web side reads:
//   FactoryConfig       (singleton)  -- $WBULL mint + counters
//   BullTreasuryState   (singleton)  -- claimable, pending, lifetime totals
//   WrappedCollection   (per-token)  -- everything about one Factory deploy
//
// Plus the standard PDA derivation helpers so the wizard + dashboards
// can compute addresses client side.

import { PublicKey, Connection } from "@solana/web3.js";

// =====================================================================
// Program ID + RPC config. The placeholder ID will swap for the
// WrapF... vanity once the grind on the VPS lands. Override via
// NEXT_PUBLIC_FACTORY_PROGRAM_ID without a rebuild for any cluster.
// =====================================================================
const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_FACTORY_PROGRAM_ID ||
    "WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh"
);

const RPC_URL =
  process.env.SOLANA_RPC_URL ||
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  "https://api.devnet.solana.com";

// =====================================================================
// On-chain constants kept in lockstep with the Rust program.
// If state.rs ever bumps these (e.g. MAX_SUPPLY via a realloc upgrade),
// update here too -- both ends must agree.
// =====================================================================
export const MIN_SUPPLY = 100;
export const MAX_SUPPLY = 2_000;
export const MAX_NAME_LEN = 25;
export const MAX_TICKER_LEN = 10;
export const MAX_ART_URI_LEN = 195;
export const PENDING_CAP = 256;
export const PENDING_LOCK_SECONDS = 7 * 24 * 60 * 60; // 604_800
export const DEPLOY_COST_WBULL_UI = 1_000_000;

// =====================================================================
// Type interfaces
// =====================================================================

export interface FactoryConfig {
  wbullMint:           PublicKey;
  admin:               PublicKey;
  totalDeployments:    number;
  totalWbullDeposited: bigint;
  bump:                number;
  /** Global circuit breaker. When true, the on-chain program rejects
   *  new wraps, deploys, and treasury claims. Unwrap is never blocked.
   *  Flipped via set_factory_paused, gated to program upgrade authority. */
  paused:              boolean;
}

export interface DepositEntry {
  amount:      bigint;
  depositedAt: bigint; // unix seconds, signed i64
}

export interface BullTreasuryState {
  claimable:         bigint;
  pending:           DepositEntry[];
  lifetimeDeposited: bigint;
  lifetimeClaimed:   bigint;
  bump:              number;
}

export type ArtSource =
  | { kind: "baseUri";     uri: string }
  | { kind: "rendererUrl"; uri: string };

export interface WrappedCollection {
  tokenMint:       PublicKey;
  deployer:        PublicKey;
  name:            string;
  ticker:          string;
  artSource:       ArtSource;
  maxSupply:       number;
  tokensPerWrap:   bigint;
  collectionMint:  PublicKey;
  totalWrapped:    bigint;
  totalUnwrapped:  bigint;
  inCirculation:   number;
  nextTier:        number;
  freeTiers:       number[];
  createdAt:       bigint;
  bump:            number;
  /** Set by the protocol multisig via the Factory's set_verified ix.
   *  UX signal that this is the canonical wrap layer for its token,
   *  not a fan deploy / scam squat. */
  verified:        boolean;
}

// =====================================================================
// Conn + program id getters
// =====================================================================

export function getFactoryProgramId(): PublicKey {
  return PROGRAM_ID;
}

export function getConnection(): Connection {
  return new Connection(RPC_URL, "confirmed");
}

// =====================================================================
// PDA derivation. Seeds match programs/wrappedfactory/src/*.rs verbatim.
// Every helper returns the bump alongside the pubkey so callers can
// pass it to the program without re-deriving.
// =====================================================================

export function factoryConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("factory_config")], PROGRAM_ID);
}

export function bullTreasuryStatePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("bull_treasury")], PROGRAM_ID);
}

export function collectionPda(tokenMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("collection"), tokenMint.toBuffer()],
    PROGRAM_ID,
  );
}

export function collectionMintPda(tokenMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("collection_mint"), tokenMint.toBuffer()],
    PROGRAM_ID,
  );
}

export function collectionAuthorityPda(tokenMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("collection_authority"), tokenMint.toBuffer()],
    PROGRAM_ID,
  );
}

export function nftMintPda(tokenMint: PublicKey, totalWrappedBefore: bigint): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(totalWrappedBefore);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("nft_mint"), tokenMint.toBuffer(), buf],
    PROGRAM_ID,
  );
}

export function vaultAuthorityPda(nftMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), nftMint.toBuffer()],
    PROGRAM_ID,
  );
}

export function bullAssetPda(tokenMint: PublicKey, tierIndex: number): [PublicKey, number] {
  const tierBuf = Buffer.alloc(2);
  tierBuf.writeUInt16LE(tierIndex, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bull"), tokenMint.toBuffer(), tierBuf],
    PROGRAM_ID,
  );
}

// =====================================================================
// Account deserializers. Each skips the 8-byte Anchor discriminator,
// then reads fields in the exact order defined in state.rs.
// =====================================================================

function readString(d: Buffer, off: number): { value: string; nextOff: number } {
  const len = d.readUInt32LE(off);
  off += 4;
  const value = d.slice(off, off + len).toString("utf8");
  return { value, nextOff: off + len };
}

export async function fetchFactoryConfig(
  conn: Connection,
): Promise<FactoryConfig | null> {
  const [pda] = factoryConfigPda();
  const info = await conn.getAccountInfo(pda, "confirmed");
  if (!info) return null;
  const d = info.data;
  let off = 8; // skip anchor discriminator
  const wbullMint = new PublicKey(d.slice(off, off + 32));
  off += 32;
  const admin = new PublicKey(d.slice(off, off + 32));
  off += 32;
  const totalDeployments = d.readUInt32LE(off);
  off += 4;
  const totalWbullDeposited = d.readBigUInt64LE(off);
  off += 8;
  const bump = d.readUInt8(off);
  off += 1;
  // `paused` follows the bump. On pre-pause-upgrade data, the byte at
  // this offset is the first reserved byte (zeroed at initialize), which
  // deserializes to false -- safe default for unpatched chain state.
  const paused = d.readUInt8(off) !== 0;
  return { wbullMint, admin, totalDeployments, totalWbullDeposited, bump, paused };
}

export async function fetchBullTreasuryState(
  conn: Connection,
): Promise<BullTreasuryState | null> {
  const [pda] = bullTreasuryStatePda();
  const info = await conn.getAccountInfo(pda, "confirmed");
  if (!info) return null;
  const d = info.data;
  let off = 8;
  const claimable = d.readBigUInt64LE(off);
  off += 8;
  // pending: Vec<DepositEntry> = 4-byte len prefix + N * 16 bytes
  const pendingLen = d.readUInt32LE(off);
  off += 4;
  const pending: DepositEntry[] = [];
  for (let i = 0; i < pendingLen; i++) {
    const amount = d.readBigUInt64LE(off);
    off += 8;
    const depositedAt = d.readBigInt64LE(off);
    off += 8;
    pending.push({ amount, depositedAt });
  }
  const lifetimeDeposited = d.readBigUInt64LE(off);
  off += 8;
  const lifetimeClaimed = d.readBigUInt64LE(off);
  off += 8;
  const bump = d.readUInt8(off);
  return { claimable, pending, lifetimeDeposited, lifetimeClaimed, bump };
}

export async function fetchWrappedCollection(
  conn: Connection,
  tokenMint: PublicKey,
): Promise<WrappedCollection | null> {
  const [pda] = collectionPda(tokenMint);
  const info = await conn.getAccountInfo(pda, "confirmed");
  if (!info) return null;
  return deserializeWrappedCollection(info.data);
}

function deserializeWrappedCollection(d: Buffer): WrappedCollection {
  let off = 8; // anchor discriminator
  const tokenMint = new PublicKey(d.slice(off, off + 32));
  off += 32;
  const deployer = new PublicKey(d.slice(off, off + 32));
  off += 32;
  const nameRes = readString(d, off);
  off = nameRes.nextOff;
  const tickerRes = readString(d, off);
  off = tickerRes.nextOff;
  // ArtSource enum: 1 byte variant tag + string payload
  const variant = d.readUInt8(off);
  off += 1;
  const uriRes = readString(d, off);
  off = uriRes.nextOff;
  const artSource: ArtSource =
    variant === 0
      ? { kind: "baseUri", uri: uriRes.value }
      : { kind: "rendererUrl", uri: uriRes.value };
  const maxSupply = d.readUInt16LE(off);
  off += 2;
  const tokensPerWrap = d.readBigUInt64LE(off);
  off += 8;
  const collectionMint = new PublicKey(d.slice(off, off + 32));
  off += 32;
  const totalWrapped = d.readBigUInt64LE(off);
  off += 8;
  const totalUnwrapped = d.readBigUInt64LE(off);
  off += 8;
  const inCirculation = d.readUInt16LE(off);
  off += 2;
  const nextTier = d.readUInt16LE(off);
  off += 2;
  const freeLen = d.readUInt32LE(off);
  off += 4;
  const freeTiers: number[] = [];
  for (let i = 0; i < freeLen; i++) {
    freeTiers.push(d.readUInt16LE(off));
    off += 2;
  }
  const createdAt = d.readBigInt64LE(off);
  off += 8;
  const bump = d.readUInt8(off);
  off += 1;
  // verified flag (1 byte borsh bool) carved from the original 64-byte
  // reserved slack at the 2026-06 program upgrade.
  const verified = d.readUInt8(off) !== 0;
  return {
    tokenMint,
    deployer,
    name: nameRes.value,
    ticker: tickerRes.value,
    artSource,
    maxSupply,
    tokensPerWrap,
    collectionMint,
    totalWrapped,
    totalUnwrapped,
    inCirculation,
    nextTier,
    freeTiers,
    createdAt,
    bump,
    verified,
  };
}

// =====================================================================
// Bulk reader: every WrappedCollection PDA the program owns.
// Used by /launches and the /launch landing's "featured" strip.
//
// getProgramAccounts is heavy on public RPCs; the API route that calls
// this should wrap in cacheWrapSWR (see lib/cache.ts) with a sensible
// TTL so a popular /launches page doesn't hammer Helius.
// =====================================================================
export async function fetchAllWrappedCollections(
  conn: Connection,
): Promise<WrappedCollection[]> {
  // WrappedCollection has size = 4454 bytes (post size-fix). Filter by
  // dataSize so we only pull the right account type, not FactoryConfig or
  // BullTreasuryState which also live under this program.
  const accounts = await conn.getProgramAccounts(PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ dataSize: WRAPPED_COLLECTION_SIZE }],
  });
  return accounts.map((acc) => deserializeWrappedCollection(acc.account.data));
}

// Mirror of state.rs WrappedCollection::SIZE -- update both in lockstep.
// Used as a dataSize filter so getProgramAccounts only returns deployments,
// not the singleton FactoryConfig / BullTreasuryState PDAs.
const WRAPPED_COLLECTION_SIZE =
  8                                          // discriminator
  + 32                                        // token_mint
  + 32                                        // deployer
  + 4 + MAX_NAME_LEN                          // name
  + 4 + MAX_TICKER_LEN                        // ticker
  + 1 + 4 + MAX_ART_URI_LEN                   // art_source
  + 2                                          // max_supply
  + 8                                          // tokens_per_wrap
  + 32                                         // collection_mint
  + 8                                          // total_wrapped
  + 8                                          // total_unwrapped
  + 2                                          // in_circulation
  + 2                                          // next_tier
  + 4 + (MAX_SUPPLY * 2)                       // free_tiers (Vec<u16>)
  + 8                                          // created_at
  + 1                                          // bump
  + 64;                                        // reserved

// =====================================================================
// Treasury accounting helpers (mirror state.rs::BullTreasuryState methods)
//
// These match the on-chain sweep_expired / drain_claimable semantics so
// the /launch and /launch/treasury pages can preview what a claim WOULD
// drain right now without simulating a tx. Both functions take a "now"
// param so callers can drive what-if scenarios (e.g. countdown timers).
// =====================================================================

/**
 * Returns the amount that's already eligible to be claimed at `now`,
 * combining the on-chain `claimable` field with any pending entries that
 * have aged past PENDING_LOCK_SECONDS.
 */
export function previewClaimableAt(
  treasury: BullTreasuryState,
  now: number, // unix seconds
): bigint {
  const cutoff = BigInt(now - PENDING_LOCK_SECONDS);
  let sum = treasury.claimable;
  for (const entry of treasury.pending) {
    if (entry.depositedAt <= cutoff) {
      sum += entry.amount;
    }
  }
  return sum;
}

/**
 * Returns the amount still locked (would not be claimable at `now`).
 */
export function previewLockedAt(
  treasury: BullTreasuryState,
  now: number,
): bigint {
  const cutoff = BigInt(now - PENDING_LOCK_SECONDS);
  let sum = 0n;
  for (const entry of treasury.pending) {
    if (entry.depositedAt > cutoff) {
      sum += entry.amount;
    }
  }
  return sum;
}
