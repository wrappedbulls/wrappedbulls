// Client-safe types for the algorithmic art system. No Node-only
// imports here so this module can be pulled into client components
// (the /launch/new wizard imports it for the theme picker UI).

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
