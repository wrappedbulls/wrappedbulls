// "Geometric" preset. Placeholder generator.
//
// Stub: 6 layered shapes (circle / square / triangle) at positions and
// colors derived from the seed. The artist refines the shape library
// + layering rules + palette logic later without touching the
// endpoint or wizard.

import { type ArtPreset, seedHash, readBytes, mapByte } from "./types";

const SIZE = 512;
const SHAPE_COUNT = 6;

const geometric: ArtPreset = {
  slug: "geometric",
  name: "Geometric",
  description:
    "Layered geometric shapes derived from the NFT mint. Bold composition, clean palette, distinct per NFT.",
  aspectRatio: 1,
  width: SIZE,
  render(seed: string): string {
    const h = seedHash(this.slug, seed);
    // Background color from first triplet.
    const bgR = h[0];
    const bgG = h[1];
    const bgB = h[2];
    const shapes: string[] = [];
    for (let i = 0; i < SHAPE_COUNT; i += 1) {
      const off = (3 + i * 5) % h.length;
      const bs = readBytes(h, off, 5);
      const x = mapByte(bs[0], 50, SIZE - 50);
      const y = mapByte(bs[1], 50, SIZE - 50);
      const r = mapByte(bs[2], 40, 140);
      const fillR = bs[3];
      const fillG = bs[4];
      const fillB = readBytes(h, (off + 5) % h.length, 1)[0];
      const shapeType = bs[0] % 3;
      const fill = `rgb(${fillR},${fillG},${fillB})`;
      const opacity = 0.6 + (bs[2] / 255) * 0.3;
      if (shapeType === 0) {
        shapes.push(
          `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" opacity="${opacity.toFixed(2)}"/>`,
        );
      } else if (shapeType === 1) {
        shapes.push(
          `<rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" fill="${fill}" opacity="${opacity.toFixed(2)}"/>`,
        );
      } else {
        const p1 = `${x},${y - r}`;
        const p2 = `${x - r},${y + r}`;
        const p3 = `${x + r},${y + r}`;
        shapes.push(
          `<polygon points="${p1} ${p2} ${p3}" fill="${fill}" opacity="${opacity.toFixed(2)}"/>`,
        );
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}"><rect width="${SIZE}" height="${SIZE}" fill="rgb(${bgR},${bgG},${bgB})"/>${shapes.join("")}</svg>`;
  },
};

export default geometric;
