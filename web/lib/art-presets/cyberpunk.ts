// "Cyberpunk" preset. Placeholder generator.
//
// Stub: a dark background with neon lines and a glyph derived from the
// seed. Artist refines the glyph dictionary, line weights, and palette
// later. The endpoint and wizard are unaffected by those edits.

import { type ArtPreset, seedHash, readBytes, mapByte } from "./types";

const SIZE = 512;
const LINE_COUNT = 12;
const NEON_PALETTE = [
  "#ff00ff",
  "#00ffff",
  "#ff0080",
  "#80ff00",
  "#ffff00",
  "#0080ff",
];

const cyberpunk: ArtPreset = {
  slug: "cyberpunk",
  name: "Cyberpunk",
  description:
    "Dark canvas with neon lines and a unique glyph per mint. Bold, high contrast, futuristic.",
  aspectRatio: 1,
  width: SIZE,
  render(seed: string): string {
    const h = seedHash(this.slug, seed);
    const lines: string[] = [];
    for (let i = 0; i < LINE_COUNT; i += 1) {
      const off = (i * 5) % h.length;
      const bs = readBytes(h, off, 5);
      const x1 = mapByte(bs[0], 0, SIZE);
      const y1 = mapByte(bs[1], 0, SIZE);
      const x2 = mapByte(bs[2], 0, SIZE);
      const y2 = mapByte(bs[3], 0, SIZE);
      const color = NEON_PALETTE[bs[4] % NEON_PALETTE.length];
      const strokeWidth = 1 + (bs[0] % 4);
      lines.push(
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${strokeWidth}" opacity="0.8"/>`,
      );
    }
    // Central glyph: a circle stroked in a neon color, hollow.
    const glyphOff = 60 % h.length;
    const gb = readBytes(h, glyphOff, 4);
    const glyphR = mapByte(gb[0], 80, 180);
    const glyphColor = NEON_PALETTE[gb[1] % NEON_PALETTE.length];
    const glyph = `<circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${glyphR}" fill="none" stroke="${glyphColor}" stroke-width="4" opacity="0.9"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}"><rect width="${SIZE}" height="${SIZE}" fill="#0a0a14"/>${lines.join("")}${glyph}</svg>`;
  },
};

export default cyberpunk;
