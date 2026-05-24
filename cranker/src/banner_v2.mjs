// banner_v2: alternate 1500x500 banner with a DIFFERENT curated 12-bull set
// to the original banner.mjs. All 12 accessories are unique (including the
// new Rare-tier `pump` and `phantom`), and every body/horn/eye/background
// is used at least once. Mathematically minimal repetition for 12 cells
// against 9/5/8/7 axes.
//
// Run: node cranker/src/banner_v2.mjs
// Output: samples/banners/banner_v2_1500x500.png + banner_v2.html

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { encodePng, svgToPixels } from './svg_to_png.mjs';
import * as renderer from './renderer.mjs';

const BANNER_W = 1500;
const BANNER_H = 500;
const COLS = 6;
const ROWS = 2;
const CELL = BANNER_W / COLS;
if (CELL !== BANNER_H / ROWS) throw new Error('cells must be square');

// 12 bulls. All 12 accessories are unique. Body/horn/eye/bg cover their
// full set at minimum repetition (9, 5, 8, 7 against 12 cells). Eyewear
// and mouth vary across 7-8 distinct values each.
const WBULL = [
  // #1: holo + phantom (new Rare) — legendary opener
  { body: 8, horn: 2, eye: 2, bg: 4, acc: 27, eyewear: 0, mouth: 0 },
  // #2: golden + pump (new Rare) — second legendary slot
  { body: 4, horn: 4, eye: 0, bg: 2, acc: 26, eyewear: 2, mouth: 0 },
  // #3: brown + halo — classic angel
  { body: 0, horn: 0, eye: 0, bg: 0, acc: 10, eyewear: 0, mouth: 6 },
  // #4: black + top_hat — formal punk
  { body: 1, horn: 2, eye: 4, bg: 6, acc: 18, eyewear: 0, mouth: 4 },
  // #5: red + fire_aura — angry crimson
  { body: 3, horn: 3, eye: 5, bg: 6, acc: 13, eyewear: 4, mouth: 1 },
  // #6: white + gold_chain — clean drip
  { body: 2, horn: 1, eye: 2, bg: 5, acc:  4, eyewear: 3, mouth: 5 },
  // #7: cyan + headband — sport-core
  { body: 5, horn: 0, eye: 1, bg: 3, acc: 16, eyewear: 5, mouth: 8 },
  // #8: pink + tinfoil — quirky head wrap
  { body: 6, horn: 4, eye: 6, bg: 1, acc: 15, eyewear: 7, mouth: 6 },
  // #9: zombie + beanie — undead street
  { body: 7, horn: 1, eye: 3, bg: 0, acc: 14, eyewear: 0, mouth: 7 },
  // #10: golden + apple — Milady-coded
  { body: 4, horn: 2, eye: 0, bg: 2, acc:  8, eyewear: 6, mouth: 6 },
  // #11: brown + bell — pastoral
  { body: 0, horn: 0, eye: 7, bg: 5, acc:  2, eyewear: 0, mouth: 0 },
  // #12: holo + scar + lasers — battle bull holo finale
  { body: 8, horn: 4, eye: 0, bg: 4, acc: 25, eyewear: 8, mouth: 3 },
];

// Current weights (mirror renderer.mjs for forced-seed byte search)
const W = {
  body:    [30, 25, 12, 10,  6,  6,  6,  4,  1],
  horn:    [55, 18, 15,  7,  5],
  eye:     [55,  3,  3,  3, 14, 12,  8,  1],
  bg:      [28, 22, 14, 12,  4, 16,  4],
  acc:     [36,  0,  6,  0,  6,  6,  2,  3,  3,  3,  2,  0,  2,  2,  3,  6,  3,  3,  3,  6,  3,  1,  3,  0,  0,  2,  3,  3],
  eyewear: [50,  6, 12, 12,  6, 12,  0,  0,  2],
  mouth:   [68,  6,  0,  2,  0,  6,  0,  6,  6,  6,  0],
};

function findByte(weights, desired) {
  const total = weights.reduce((a, b) => a + b, 0);
  for (let b = 0; b < 256; b++) {
    let acc = 0;
    const r = (b / 256) * total;
    for (let i = 0; i < weights.length; i++) {
      acc += weights[i];
      if (r < acc) {
        if (i === desired) return b;
        break;
      }
    }
  }
  return 255;
}

function forcedSeed(forced, idx) {
  const seed = crypto.createHash('sha256')
    .update('wrappedbulls-banner-v2-' + idx).digest();
  const patched = Buffer.from(seed);
  patched[0] = findByte(W.body,    forced.body);
  patched[1] = findByte(W.horn,    forced.horn);
  patched[2] = findByte(W.eye,     forced.eye);
  patched[3] = findByte(W.bg,      forced.bg);
  patched[4] = findByte(W.acc,     forced.acc);
  patched[5] = findByte(W.eyewear, forced.eyewear);
  patched[6] = findByte(W.mouth,   forced.mouth);
  return patched;
}

function scaleNN(src24, dstW, dstH) {
  const out = Buffer.alloc(dstW * dstH * 3);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.floor((y * 24) / dstH);
    for (let x = 0; x < dstW; x++) {
      const sx = Math.floor((x * 24) / dstW);
      const si = (sy * 24 + sx) * 3;
      const di = (y * dstW + x) * 3;
      out[di + 0] = src24[si + 0];
      out[di + 1] = src24[si + 1];
      out[di + 2] = src24[si + 2];
    }
  }
  return out;
}

const OUT_DIR = path.resolve(import.meta.dirname, '..', '..', 'samples', 'banners');
fs.mkdirSync(OUT_DIR, { recursive: true });

const out = Buffer.alloc(BANNER_W * BANNER_H * 3);
console.log(`v2: composing ${WBULL.length} bulls into ${BANNER_W}x${BANNER_H} (${COLS}x${ROWS}, ${CELL}x${CELL} cells)...`);

const tags = [];
for (let i = 0; i < WBULL.length; i++) {
  const seed = forcedSeed(WBULL[i], i);
  const { svg, names } = renderer.renderBullSvg(seed, 24);
  const { rgb: rgb24 } = svgToPixels(svg, 1);
  const rgbCell = scaleNN(rgb24, CELL, CELL);

  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const ox = col * CELL;
  const oy = row * CELL;

  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const si = (y * CELL + x) * 3;
      const di = ((oy + y) * BANNER_W + (ox + x)) * 3;
      out[di + 0] = rgbCell[si + 0];
      out[di + 1] = rgbCell[si + 1];
      out[di + 2] = rgbCell[si + 2];
    }
  }
  const tag = `body=${names.body} horn=${names.horn} eye=${names.eye} bg=${names.bg} acc=${names.acc} eyewear=${names.eyewear} mouth=${names.mouth}`;
  tags.push(tag);
  console.log(`  #${i + 1}: ${tag}`);
}

const png = encodePng(BANNER_W, BANNER_H, out);
const outPath = path.join(OUT_DIR, 'banner_v2_1500x500.png');
fs.writeFileSync(outPath, png);
console.log(`\nWrote ${BANNER_W}x${BANNER_H} v2 banner to ${outPath} (${png.length} bytes)`);

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>WrappedBulls Banner v2 Preview</title>
<style>
  body { background:#0a0a0c; color:#e8e4dc; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; padding:24px; margin:0; }
  h1 { color:#f0d028; }
  img { max-width:100%; height:auto; display:block; image-rendering:pixelated; border-radius:8px; box-shadow:0 8px 32px rgba(0,0,0,0.5); }
  .info { margin-top:16px; color:#888; font-size:13px; line-height:1.6; }
  .info span { color:#e8e4dc; }
  ul { padding-left:20px; }
  li { color:#888; font-size:12px; line-height:1.6; }
</style></head><body>
<h1>WrappedBulls Banner v2 (alternate)</h1>
<p class="info"><span>1500 x 500</span> &middot; 12 fresh bulls &middot; all 12 accessories unique &middot; includes Rare <span>pump</span> + <span>phantom</span></p>
<img src="banner_v2_1500x500.png" alt="WrappedBulls banner v2">
<p class="info" style="margin-top:24px;">Bulls (left to right, top to bottom):</p>
<ul>
${tags.map((t, i) => `<li><span style="color:#f0d028">#${i + 1}</span> ${t}</li>`).join('\n')}
</ul>
</body></html>`;
fs.writeFileSync(path.join(OUT_DIR, 'banner_v2.html'), html);
console.log(`Open: ${path.join(OUT_DIR, 'banner_v2.html')}`);
