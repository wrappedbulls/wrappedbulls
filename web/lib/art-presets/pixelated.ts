// "Pixelated" preset. Placeholder generator.
//
// Generalization of the WrappedBulls aesthetic: a small grid where each
// cell color is deterministic from the seed. The visual language is
// stub level here. The artist refines the palette + cell layout later
// without touching the renderer endpoint or the wizard.

import { type ArtPreset, seedHash, readBytes, mapByte } from "./types";

const GRID = 16;
const CELL = 32;

const pixelated: ArtPreset = {
  slug: "pixelated",
  name: "Pixelated",
  description:
    "Pixel grid art derived from the NFT mint. Each cell color computed from the seed; every NFT in the collection is visually unique.",
  aspectRatio: 1,
  width: GRID * CELL,
  render(seed: string): string {
    const h = seedHash(this.slug, seed);
    const cells: string[] = [];
    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        const i = y * GRID + x;
        const triplet = readBytes(h, (i * 3) % h.length, 3);
        const r = triplet[0];
        const g = triplet[1];
        const b = triplet[2];
        cells.push(
          `<rect x="${x * CELL}" y="${y * CELL}" width="${CELL}" height="${CELL}" fill="rgb(${r},${g},${b})"/>`,
        );
      }
    }
    const w = GRID * CELL;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${w}" width="${w}" height="${w}" shape-rendering="crispEdges">${cells.join("")}</svg>`;
  },
};

export default pixelated;
// suppress unused warnings on mapByte until presets use it
void mapByte;
