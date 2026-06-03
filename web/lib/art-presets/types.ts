// Factory algorithmic art preset interface.
//
// A preset is a deterministic SVG generator: given a seed string (the
// NFT mint pubkey, or a synthetic preview seed), it returns the same
// SVG bytes every time. The bytes ARE the art for that specific NFT.
//
// Presets are plug in. Adding a new visual language means writing a
// new file in this directory and registering it in `./index.ts`. The
// renderer endpoint and the wizard pick them up automatically.

export interface ArtPreset {
  /** URL slug for the preset, e.g. "pixelated". */
  slug: string;
  /** Display name for the wizard art tier picker. */
  name: string;
  /** One sentence describing the visual language. */
  description: string;
  /** Suggested aspect ratio (width / height). Most presets use 1. */
  aspectRatio: number;
  /** Output canvas width in SVG units. Height = width / aspectRatio. */
  width: number;
  /** Generate the SVG bytes for a given seed string. Pure, deterministic. */
  render(seed: string): string;
}

// Pure, fast string hash. We mix the preset slug into the hash so the
// same seed yields different art across presets.
export function seedHash(presetSlug: string, seed: string): Uint8Array {
  // Browserless polyfill avoidance: use a tiny SHA256 done via Web
  // Crypto if available, else Node crypto. The route handler runs in
  // Node so we use crypto directly.
  const crypto = require("node:crypto") as typeof import("node:crypto");
  return new Uint8Array(
    crypto.createHash("sha256").update(`${presetSlug}:${seed}`).digest(),
  );
}

/** Read N bytes from `bytes` starting at `offset`, wrap around. */
export function readBytes(
  bytes: Uint8Array,
  offset: number,
  count: number,
): Uint8Array {
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = bytes[(offset + i) % bytes.length];
  }
  return out;
}

/** Map a byte (0-255) into [min, max] integer range, inclusive. */
export function mapByte(byte: number, min: number, max: number): number {
  return min + Math.floor((byte / 255) * (max - min + 1));
}
