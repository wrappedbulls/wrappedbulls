// Algorithmic art core: seed derivation, theme registry, PRNG.
//
// A theme is a self contained module that takes a 64 bit seed plus a
// tier index and returns SVG markup. The render endpoint composes the
// theme call and the metadata endpoint composes the JSON. This file
// is the glue that lives between both endpoints, the wizard previews,
// and any theme module.
//
// SVG rather than PNG / canvas because:
//   - no native binary dep (works in next standalone build cleanly)
//   - same code path renders client side for wizard previews
//   - infinite resolution scaling for marketplaces
//   - byte deterministic without OS dependent font rendering quirks

import crypto from "node:crypto";
import { PublicKey } from "@solana/web3.js";

export interface Theme {
  /** URL slug. e.g. "orb". */
  slug: string;
  /** Display name shown in the wizard. */
  name: string;
  /** One sentence pitch shown under the name. */
  description: string;
  /** Sample tier indices to render in the wizard preview grid. */
  preview: number[];
  /** Deterministic SVG renderer. Same (seed, tier, size) -> identical bytes. */
  render(seed: bigint, tier: number, size: number): string;
  /** Metaplex Token Metadata v3 attributes derived from the same seed. */
  attributes(seed: bigint, tier: number): Array<{ trait_type: string; value: string }>;
}

/** All registered themes. Add new themes by importing here. */
import { orb } from "./themes/orb";

export const THEMES: Record<string, Theme> = {
  [orb.slug]: orb,
};

export function getTheme(slug: string): Theme | null {
  return THEMES[slug] ?? null;
}

/**
 * Derive a 64 bit seed from a collection mint pubkey and a tier index.
 *
 * sha256(collection_mint_bytes || tier_u32_le)[:8] interpreted as little
 * endian unsigned bigint. Deterministic and uniform across all valid
 * inputs; no two (collection, tier) pairs map to the same seed in any
 * meaningful sample.
 *
 * SHA256 instead of keccak256 to avoid an extra hash dependency. Both
 * produce 32 byte uniformly distributed outputs; we take 8 bytes.
 */
export function deriveSeed(collectionMint: string, tier: number): bigint {
  if (!Number.isInteger(tier) || tier < 0 || tier > 0xFFFFFFFF) {
    throw new Error(`tier out of u32 range: ${tier}`);
  }
  let mintBytes: Buffer;
  try {
    mintBytes = Buffer.from(new PublicKey(collectionMint).toBuffer());
  } catch {
    throw new Error(`invalid collection mint pubkey: ${collectionMint}`);
  }
  const tierBytes = Buffer.alloc(4);
  tierBytes.writeUInt32LE(tier, 0);
  const hash = crypto.createHash("sha256").update(mintBytes).update(tierBytes).digest();
  return hash.readBigUInt64LE(0);
}

/**
 * Tiny deterministic PRNG. xorshift64*. Returns the same sequence for
 * the same starting seed across Node and the browser, so wizard
 * preview output matches server render output byte for byte.
 */
export class PRNG {
  private state: bigint;
  constructor(seed: bigint) {
    // xorshift64 collapses at state=0. Salt with a non zero constant so
    // a seed of 0 still produces a usable sequence.
    this.state = seed === 0n ? 0x123456789ABCDEF0n : seed;
  }
  /** Advance state, return the new 64 bit raw word. */
  nextU64(): bigint {
    let x = this.state;
    x = x ^ (x << 13n);
    x = x & 0xFFFFFFFFFFFFFFFFn;
    x = x ^ (x >> 7n);
    x = x ^ (x << 17n);
    x = x & 0xFFFFFFFFFFFFFFFFn;
    this.state = x;
    return x;
  }
  /** Uniform integer in [0, max). max must be > 0. */
  nextInt(max: number): number {
    if (max <= 0) throw new Error("PRNG.nextInt: max must be > 0");
    return Number(this.nextU64() % BigInt(max));
  }
  /** Uniform float in [0, 1). */
  nextFloat(): number {
    // top 53 bits over 2^53 = uniform [0, 1).
    return Number(this.nextU64() >> 11n) / 2 ** 53;
  }
  /** Pick one element from a non empty array. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("PRNG.pick: empty array");
    return arr[this.nextInt(arr.length)];
  }
}

/**
 * Placeholder pubkey for wizard sample previews. The Solana System
 * Program ID (all zero bytes, 32 ones in base58). Universally
 * recognized as a "non account" pubkey; using it as the seed input
 * for wizard sample previews guarantees the previews are
 * distinguishable from any real collection mint.
 */
export const WIZARD_PREVIEW_MINT = "11111111111111111111111111111111";
