// Provenance for a bull, derived from facts that already exist onchain.
// Nothing here changes the art, the mint, or any chain state. It only reads.
//
//   serial: the Nth bull ever wrapped across the protocol's lifetime. The NFT
//           mint is PDA(["nft_mint", total_wrapped]) at wrap time, so the mint
//           permanently encodes a unique, ever increasing index. We recover it
//           by matching the mint against that derivation. 1-indexed for humans
//           (the first bull ever is Serial 1). Immutable, so cached long.
//   era:    serials grouped in hundreds (1 to 100 = era 1, etc).
//   isOG:   serial <= 100, the Founding Herd. Surviving low serials are rare
//           because most early bulls were unwrapped and burned.

import { Connection, PublicKey } from "@solana/web3.js";
import { getProgramId, fetchBullBank } from "@/lib/chain";
import { cacheGet, cacheSet } from "@/lib/cache";

export const ERA_SIZE = 100;
export const OG_MAX_SERIAL = 100;

export interface Provenance {
  serial: number | null;
  era: number | null;
  isOG: boolean;
  wrappedAt: number; // unix seconds, 0 if unknown
}

function nftMintPda(n: number, programId: PublicKey): PublicKey {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return PublicKey.findProgramAddressSync([Buffer.from("nft_mint"), b], programId)[0];
}

export function eraOf(serial: number): number {
  return Math.ceil(serial / ERA_SIZE);
}

export function isOgSerial(serial: number): boolean {
  return serial >= 1 && serial <= OG_MAX_SERIAL;
}

// Resolve a mint's serial by matching it against PDA(["nft_mint", n]) for n in
// [0, total_wrapped]. The result is immutable for a given mint, so cache it.
export async function deriveSerial(
  conn: Connection,
  nftMintB58: string,
): Promise<number | null> {
  const cached = cacheGet<number>("serial", nftMintB58);
  if (cached !== undefined) return cached;

  const programId = getProgramId();
  let upper = 5000;
  try {
    const bank = await fetchBullBank(conn);
    if (bank) upper = Number(bank.totalWrapped);
  } catch {
    // fall back to a generous bound
  }

  for (let n = 0; n <= upper; n++) {
    if (nftMintPda(n, programId).toBase58() === nftMintB58) {
      const serial = n + 1; // 1-indexed for display
      cacheSet("serial", nftMintB58, serial, 24 * 3_600_000);
      return serial;
    }
  }
  return null;
}

export async function getProvenance(
  conn: Connection,
  nftMintB58: string,
  wrappedAt: number,
): Promise<Provenance> {
  const serial = await deriveSerial(conn, nftMintB58);
  return {
    serial,
    era: serial ? eraOf(serial) : null,
    isOG: serial ? isOgSerial(serial) : false,
    wrappedAt: wrappedAt || 0,
  };
}
