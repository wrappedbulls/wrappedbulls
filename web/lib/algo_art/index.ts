// Client-safe entry point for the algorithmic art system. Re-exports
// the Theme interface, the PRNG, and the THEMES registry. The wizard
// imports from here for the theme picker UI.
//
// Server-only seed derivation lives in ./seed.ts (uses node:crypto)
// and is imported only by the render and metadata route handlers.

export type { Theme } from "./types";
export { PRNG } from "./prng";

import type { Theme } from "./types";
import { orb } from "./themes/orb";

export const THEMES: Record<string, Theme> = {
  [orb.slug]: orb,
};

export const THEME_LIST: Theme[] = Object.values(THEMES);

export function getTheme(slug: string): Theme | null {
  return THEMES[slug] ?? null;
}

/**
 * Placeholder pubkey for wizard sample previews. The Solana System
 * Program ID (all zero bytes, 32 ones in base58). Universally
 * recognized as a "non account" pubkey; using it as the seed input
 * for wizard sample previews guarantees the previews are
 * distinguishable from any real collection mint.
 */
export const WIZARD_PREVIEW_MINT = "11111111111111111111111111111111";
