// Server-only seed derivation. Uses node:crypto which is unavailable
// in the browser. Render endpoint imports from here; wizard does not.

import crypto from "node:crypto";
import { PublicKey } from "@solana/web3.js";

/**
 * Derive a 64 bit seed from a collection mint pubkey and a tier index.
 *
 * sha256(collection_mint_bytes || tier_u32_le)[:8] interpreted as little
 * endian unsigned bigint. Deterministic and uniform; no two
 * (collection, tier) pairs map to the same seed in any meaningful sample.
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
