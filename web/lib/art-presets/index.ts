// Preset registry. New presets get added here once and the renderer
// endpoint + wizard art tier picker pick them up automatically.

import pixelated from "./pixelated";
import geometric from "./geometric";
import cyberpunk from "./cyberpunk";
import type { ArtPreset } from "./types";

const presets: Record<string, ArtPreset> = {
  [pixelated.slug]: pixelated,
  [geometric.slug]: geometric,
  [cyberpunk.slug]: cyberpunk,
};

export function getPreset(slug: string): ArtPreset | null {
  return presets[slug] ?? null;
}

export function listPresets(): ArtPreset[] {
  return Object.values(presets);
}

export type { ArtPreset };
