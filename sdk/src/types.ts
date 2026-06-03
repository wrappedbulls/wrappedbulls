// Public types for @wrappedbulls/sdk consumers.
//
// All on-chain integers come back as `bigint` so callers don't have to
// reach for BN.js. All pubkeys are `PublicKey` instances from
// @solana/web3.js. Strings (name, ticker, art URIs) are plain UTF-8.

import { PublicKey } from "@solana/web3.js";

/** Singleton Factory state. */
export interface FactoryConfig {
  wbullMint:           PublicKey;
  admin:               PublicKey;
  totalDeployments:    number;
  totalWbullDeposited: bigint;
  bump:                number;
  /** Global circuit breaker. When true the program rejects new wraps,
   *  deploys, and treasury claims; unwrap is never blocked. Flipped via
   *  set_factory_paused, gated to program upgrade authority. */
  paused:              boolean;
}

/** One pending deposit in the treasury's 7-day lock window. */
export interface DepositEntry {
  amount:      bigint;
  /** Unix seconds, signed i64. */
  depositedAt: bigint;
}

/** Bull treasury accounting + 7-day-lock state. */
export interface BullTreasuryState {
  claimable:         bigint;
  pending:           DepositEntry[];
  lifetimeDeposited: bigint;
  lifetimeClaimed:   bigint;
  bump:              number;
}

/** Per-NFT art source -- either a static URI prefix or a dynamic renderer URL. */
export type ArtSource =
  | { kind: "baseUri";     uri: string }
  | { kind: "rendererUrl"; uri: string };

/** A single Factory deployment's full state. */
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
  /** True when the WrappedBulls Squads multisig has marked this
   *  deployment as the canonical wrap layer for its target token.
   *  UX signal, not a security boundary -- wrap/unwrap remain
   *  permissionless on any deployment regardless of this flag. */
  verified:        boolean;
}

/** Per-NFT record kept by both wrappedbulls + Factory. */
export interface BullAsset {
  nftMint:    PublicKey;
  tierIndex:  number;
  wrappedAt:  bigint;
  bump:       number;
}

/** Wrappedbulls singleton state (the original program, not the Factory). */
export interface BullBank {
  tokenMint:        PublicKey;
  totalWrapped:     bigint;
  totalUnwrapped:   bigint;
  inCirculation:    number;
  nextTier:         number;
  freeTiers:        number[];
  authority:        PublicKey;
  bump:             number;
  collectionMint:   PublicKey;
}

/** Args bundled for the Factory's `deploy_collection` instruction. */
export interface DeployCollectionArgs {
  name:           string;
  ticker:         string;
  maxSupply:      number;
  tokensPerWrap:  bigint;
  artSource:      ArtSource;
  collectionUri:  string;
}

/** Per-protocol PDA hard-caps mirrored from state.rs. */
export const PROTOCOL_CONSTANTS = {
  MIN_SUPPLY: 100,
  MAX_SUPPLY: 2_000,
  MAX_NAME_LEN: 25,
  MAX_TICKER_LEN: 10,
  MAX_ART_URI_LEN: 195,
  PENDING_CAP: 256,
  PENDING_LOCK_SECONDS: 7 * 24 * 60 * 60,
  DEPLOY_COST_WBULL_UI: 1_000_000,
} as const;
