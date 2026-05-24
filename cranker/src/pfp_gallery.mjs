// Generate 30 random WrappedBulls PFPs as individual high-res PNGs + a
// contact sheet, for sending to the video maker as source material.
//
// Usage: node cranker/src/pfp_gallery.mjs
// Output:
//   pfps/bull_01.png ... bull_30.png      (each 768x768, scale=32)
//   pfps/contact_sheet.png                (5x6 grid, all 30 visible)
//   pfps/index.html                       (browser preview of the lot)

import { renderBullSvg, deriveSeed } from "./renderer.mjs";
import { encodePng, svgToPixels, contactSheet } from "./svg_to_png.mjs";
import fs from "node:fs";
import path from "node:path";

const COUNT = 30;
const SCALE = 32; // 24 * 32 = 768 — sharp enough for video / Twitter
const OUT_DIR = path.resolve(import.meta.dirname, "..", "..", "pfps");
fs.mkdirSync(OUT_DIR, { recursive: true });

// Generate distinct fake mint pubkeys. Each pubkey reseeds the renderer
// (deterministically) so each output PNG is its own bull.
function fakeMint(i) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ123456789";
  let s = "";
  let n = i * 9_999_991 + 314_159 + Date.now() % 1_000_003;
  for (let k = 0; k < 44; k++) {
    n = (n * 16807) % 2147483647;
    s += chars[n % chars.length];
  }
  return s;
}

const svgs = [];
for (let i = 0; i < COUNT; i++) {
  const mint = fakeMint(i);
  const seed = deriveSeed(mint);
  const { svg } = renderBullSvg(seed);
  svgs.push(svg);

  const { width, height, rgb } = svgToPixels(svg, SCALE);
  const png = encodePng(width, height, rgb);
  const num = String(i + 1).padStart(2, "0");
  const file = path.join(OUT_DIR, `bull_${num}.png`);
  fs.writeFileSync(file, png);
  console.log(`  bull_${num}.png  (${width}x${height})  mint=${mint.slice(0, 8)}...`);
}

// Contact sheet — 5 cols x 6 rows
const sheet = contactSheet(svgs, { cellScale: 12, cols: 5, margin: 12 });
const sheetPng = encodePng(sheet.width, sheet.height, sheet.rgb);
fs.writeFileSync(path.join(OUT_DIR, "contact_sheet.png"), sheetPng);
console.log(`\n  contact_sheet.png  (${sheet.width}x${sheet.height})`);

// Tiny index.html for visual review
const items = Array.from({ length: COUNT }, (_, i) => {
  const num = String(i + 1).padStart(2, "0");
  return `<figure><img src="bull_${num}.png" /><figcaption>#${num}</figcaption></figure>`;
}).join("\n");
const html = `<!doctype html>
<meta charset="utf-8" />
<title>WrappedBulls PFP gallery (30)</title>
<style>
  body { background:#0a0a0c; color:#e8e8ec; font:14px/1.4 system-ui; margin:0; padding:24px; }
  h1 { margin:0 0 16px; }
  .grid { display:grid; grid-template-columns:repeat(5,1fr); gap:16px; }
  figure { margin:0; background:#14141a; border:1px solid #1f1f28; border-radius:8px; padding:8px; }
  img { width:100%; image-rendering:pixelated; display:block; border-radius:4px; }
  figcaption { text-align:center; padding-top:6px; color:#9a9aa6; }
</style>
<h1>WrappedBulls PFP gallery (30)</h1>
<div class="grid">${items}</div>
`;
fs.writeFileSync(path.join(OUT_DIR, "index.html"), html);
console.log(`  index.html (open this in a browser to preview the lot)`);
console.log(`\nAll output: ${OUT_DIR}`);
