#!/usr/bin/env node
// preview_mascot_png.mjs — render a PNG contact sheet of sample mascots
// via the SAME svg->png pipeline /api/render uses. Throwaway dev tool.
//
//   node scripts/preview_mascot_png.mjs
//
// Writes mascot-preview.png at the repo root.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderBullSvg, deriveSeed } from "../web/lib/renderer.mjs";
import { svgToPixels, encodePng } from "../web/lib/svg_to_png.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COLS = 5, ROWS = 4, SCALE = 10; // 5x4 = 20 tiles, each 24*10 = 240px

// Varied seed strings to maximize trait variety in the contact sheet.
// (deriveSeed sha256s these, so any string change gives a totally
// different trait roll — but mixing prefixes nudges the distribution.)
const seeds = [
  "WrappedBullA1111111111111111111111111111111",
  "WrappedBullB2222222222222222222222222222222",
  "WrappedBullC3333333333333333333333333333333",
  "WrappedBullD4444444444444444444444444444444",
  "WrappedBullE5555555555555555555555555555555",
  "WrappedBullF6666666666666666666666666666666",
  "WrappedBullG7777777777777777777777777777777",
  "WrappedBullH8888888888888888888888888888888",
  "WrappedBullJ9999999999999999999999999999999",
  "WrappedBullKaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "WrappedBullLbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "WrappedBullMcccccccccccccccccccccccccccccc",
  "WrappedBullNdddddddddddddddddddddddddddddd",
  "WrappedBullPeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "WrappedBullQfffffffffffffffffffffffffffffff",
  "WrappedBullRgggggggggggggggggggggggggggggg",
  "WrappedBullShhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh",
  "WrappedBullTjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjj",
  "WrappedBullUkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk",
  "WrappedBullVmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm",
];

// Render each cat to a pixel buffer.
const tilesPx = seeds.map((mint, i) => {
  const { svg, names } = renderBullSvg(deriveSeed(mint), 24);
  const px = svgToPixels(svg, SCALE);
  console.log(`  cat ${i}: ${names.body}/${names.eye}/${names.acc}/${names.eyewear}/${names.mouth}`);
  return px;
});

const tw = tilesPx[0].width, th = tilesPx[0].height;
const ch = tilesPx[0].rgb.length / (tw * th); // channels (3 or 4)
const CW = COLS * tw, CH = ROWS * th;
const composite = Buffer.alloc(CW * CH * ch);

tilesPx.forEach((px, i) => {
  const ox = (i % COLS) * tw, oy = ((i / COLS) | 0) * th;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const src = (y * tw + x) * ch;
      const dst = ((oy + y) * CW + (ox + x)) * ch;
      for (let c = 0; c < ch; c++) composite[dst + c] = px.rgb[src + c];
    }
  }
});

const png = encodePng(CW, CH, composite);
const outPath = path.join(ROOT, "mascot-preview.png");
fs.writeFileSync(outPath, png);
console.log(`\nWrote ${path.relative(ROOT, outPath)} (${CW}x${CH}, ${ch}ch)`);
