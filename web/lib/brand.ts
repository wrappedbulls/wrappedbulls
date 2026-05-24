// brand.ts — single getBrand() helper merging shared launch config
// (config/launch.toml -> launch-config.generated.ts) with web-only
// brand surface (web/config/brand.json).
//
// USAGE in Server Components:
//   import { getBrand } from "@/lib/brand";
//   const brand = getBrand();
//   <h1>{brand.name}</h1>
//
// USAGE in Client Components: pass the relevant fields as props from
// the closest Server Component. Do not call getBrand() from
// "use client" modules — JSON imports work in client bundles, but
// importing this helper accidentally pulls launch-config.generated
// (which is fine) and brand.json (fine too) — but the convention is
// "Server reads, props flow down". Keeps the brand surface in one
// auditable place.

import brandJson from "../config/brand.json";
import { LAUNCH_CONFIG } from "./launch-config.generated";

export interface Brand {
  /** Display name (e.g. "WrappedBulls"). Also the collection name. */
  name: string;
  /** Singular noun (e.g. "Bull"). Used in copy and error messages. */
  unitSingular: string;
  /** Ticker (e.g. "WBULL"). Also the on-chain NFT symbol. */
  ticker: string;
  /** Web domain (e.g. "wrappedbulls.com"). No protocol, no path. */
  domain: string;

  /** Max NFTs that can be wrapped concurrently. */
  maxSupply: number;
  /** Whole tokens locked per NFT. */
  tokensPerNft: number;
  /** Token mint decimals. */
  tokenDecimals: number;
  /** Base-unit tokens-per-NFT as a bigint (safe for RPC math). */
  tokensPerNftBase: bigint;

  /** Royalty in basis points (500 = 5%). */
  royaltyBps: number;
  /** Royalty treasury pubkey (base58). */
  treasuryPubkey: string;

  /** Collection-level metadata URI. */
  collectionUri: string;
  /** Per-NFT metadata URI template (contains literal "{tier}"). */
  nftUriTemplate: string;

  /** Anchor program ID (base58). */
  programId: string;

  /** Social handles + URLs. Any value may be null. */
  social: typeof brandJson.social;
  /** Brand art paths under /public. */
  art: typeof brandJson.art;
  /** Marketing copy. */
  copy: typeof brandJson.copy;
  /** Color tokens (hex). Mirrored in app/globals.css under --bull-*. */
  colors: typeof brandJson.colors;
  /** Optional analytics IDs. May all be null. */
  analytics: typeof brandJson.analytics;
}

let _cached: Brand | null = null;

export function getBrand(): Brand {
  if (_cached) return _cached;
  _cached = {
    name:          LAUNCH_CONFIG.project.name,
    unitSingular:  LAUNCH_CONFIG.project.unitSingular,
    ticker:        LAUNCH_CONFIG.project.ticker,
    domain:        LAUNCH_CONFIG.project.domain,

    maxSupply:        LAUNCH_CONFIG.supply.maxSupply,
    tokensPerNft:     LAUNCH_CONFIG.supply.tokensPerNft,
    tokenDecimals:    LAUNCH_CONFIG.supply.tokenDecimals,
    tokensPerNftBase: LAUNCH_CONFIG.supply.tokensPerNftBase,

    royaltyBps:     LAUNCH_CONFIG.royalty.bps,
    treasuryPubkey: LAUNCH_CONFIG.royalty.treasuryPubkey,

    collectionUri:  LAUNCH_CONFIG.metadata.collectionUri,
    nftUriTemplate: LAUNCH_CONFIG.metadata.nftUriTemplate,

    programId:      LAUNCH_CONFIG.program.id,

    social:    brandJson.social,
    art:       brandJson.art,
    copy:      brandJson.copy,
    colors:    brandJson.colors,
    analytics: brandJson.analytics,
  };
  return _cached;
}

/**
 * Build a per-NFT metadata URI from a tier index.
 *   `nftMetadataUri(42)` -> `"https://<domain>/api/metadata/42"`
 * Centralized so the template format is enforced from one place.
 */
export function nftMetadataUri(tier: number): string {
  return getBrand().nftUriTemplate.replace("{tier}", String(tier));
}
