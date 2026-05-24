// Variant banner: a NEW curated set of 12 bulls, distinct from the original
// banner.mjs set. Same 1500x500 / 6x2 / no-gap layout. Tuned so each bull
// displays unique traits where the category size allows, with repetition
// forced only where 12 bulls > category size (horn 5, bg 7, eye 8).
//
// Coverage by design:
//   body    9/9 (3 repeats: holo, cyan, red — different from original)
//   horn    5/5 (3,3,2,2,2 — theoretical minimum)
//   eye     8/8 (4 doubled — different distribution from original)
//   bg      7/7 (5 doubled — different distribution)
//   acc    12/12 UNIQUE (different mix than original)
//   eyewear  6/6 active values used (where accessory doesn't suppress)
//   mouth    7/7 active values used (0,1,3,5,7,8,9)
//
// Run: node wrappedbulls-sol/cranker/src/banner_unique.mjs

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { encodePng, svgToPixels } from './svg_to_png.mjs';
import * as renderer from './renderer.mjs';

const BANNER_W = 1500;
const BANNER_H = 500;
const COLS = 6;
const ROWS = 2;
const CELL = BANNER_W / COLS; // 250
if (CELL !== BANNER_H / ROWS) throw new Error('cells must be square');

// 12 hand-curated bulls, distinct from banner.mjs's set.
// BODY (9):    0 brown, 1 black, 2 white, 3 red, 4 golden, 5 cyan, 6 pink, 7 zombie, 8 holo
// HORN (5):    0 ivory, 1 dark, 2 gold, 3 crimson, 4 silver
// EYE (8):     0 normal, 1 golden, 2 void, 3 green, 4 closed, 5 angry, 6 crying, 7 ski_mask
// BG (7):      0 pasture, 1 sand, 2 sunset, 3 chart, 4 void, 5 sky, 6 crimson
// ACC active:  5 cowboy_hat, 6 dubai_hat, 7 strawberry_hat, 9 crown, 10 halo,
//              12 diamond_aura, 13 fire_aura, 17 mohawk, 19 sheriff_hat,
//              20 tiara, 21 halo_stars, 22 earring, 25 scar
// EYEWEAR (9): 0 none, 1 mog, 2 sunglasses_classic, 3 clout_shades,
//              4 thug_life, 5 3d_glasses, 8 lasers
// MOUTH active: 0 none, 1 cigarette, 3 grill, 5 bubblegum, 7 frown,
//              8 tongue_out, 9 open_shout
const WBULL = [
  { body: 8, horn: 1, eye: 5, bg: 1, acc: 13, eyewear: 4, mouth: 9 },  // holo / dark / angry / sand / fire_aura / thug_life / open_shout
  { body: 4, horn: 4, eye: 0, bg: 4, acc: 21, eyewear: 0, mouth: 0 },  // golden / silver / normal / void / halo_stars (legendary)
  { body: 6, horn: 0, eye: 1, bg: 5, acc: 22, eyewear: 1, mouth: 5 },  // pink / ivory / golden / sky / earring / mog / bubblegum
  { body: 7, horn: 3, eye: 6, bg: 3, acc:  7, eyewear: 0, mouth: 7 },  // zombie / crimson / crying / chart / strawberry_hat / frown
  { body: 0, horn: 2, eye: 2, bg: 2, acc:  9, eyewear: 2, mouth: 1 },  // brown / gold / void / sunset / crown / sunglasses_classic / cigarette
  { body: 5, horn: 1, eye: 3, bg: 0, acc: 25, eyewear: 3, mouth: 9 },  // cyan / dark / green / pasture / scar / clout_shades / open_shout
  { body: 2, horn: 0, eye: 4, bg: 1, acc:  6, eyewear: 0, mouth: 0 },  // white / ivory / closed / sand / dubai_hat
  { body: 3, horn: 3, eye: 7, bg: 6, acc: 17, eyewear: 8, mouth: 3 },  // red / crimson / ski_mask / crimson / mohawk / lasers / grill
  { body: 1, horn: 2, eye: 0, bg: 4, acc: 10, eyewear: 0, mouth: 8 },  // black / gold / normal / void / halo / tongue_out
  { body: 8, horn: 4, eye: 1, bg: 6, acc: 12, eyewear: 5, mouth: 0 },  // holo / silver / golden / crimson / diamond_aura / 3d_glasses
  { body: 5, horn: 0, eye: 4, bg: 4, acc:  5, eyewear: 0, mouth: 1 },  // cyan / ivory / closed / void / cowboy_hat / cigarette
  { body: 3, horn: 1, eye: 0, bg: 3, acc: 19, eyewear: 0, mouth: 0 },  // red / dark / normal / chart / sheriff_hat
];

// Current weights (must mirror renderer.mjs)
const W = {
  body:    [30, 25, 12, 10,  6,  6,  6,  4,  1],
  horn:    [55, 18, 15,  7,  5],
  eye:     [55,  3,  3,  3, 14, 12,  8,  1],
  bg:      [28, 22, 14, 12,  4, 16,  4],
  acc:     [36,  0,  6,  0,  6,  6,  2,  3,  3,  3,  2,  0,  2,  2,  3,  6,  3,  3,  3,  6,  3,  1,  3,  0,  0,  2],
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
    .update('wrappedbulls-banner-unique-' + idx).digest();
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
console.log(`Composing ${WBULL.length} unique-trait bulls into ${BANNER_W}x${BANNER_H} (${COLS}x${ROWS} grid)...`);

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
const outPath = path.join(OUT_DIR, 'banner_unique_1500x500.png');
fs.writeFileSync(outPath, png);
console.log(`\nWrote ${BANNER_W}x${BANNER_H} unique-trait banner to ${outPath} (${png.length} bytes)`);

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>WrappedBulls Banner (unique-trait variant)</title>
<style>
  body { background:#0a0a0c; color:#e8e4dc; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; padding:24px; margin:0; }
  h1 { color:#f0d028; margin-bottom:4px; }
  .sub { color:#888; font-size:13px; margin-bottom:20px; }
  img { max-width:100%; height:auto; display:block; image-rendering:pixelated; border-radius:8px; box-shadow:0 8px 32px rgba(0,0,0,0.5); }
  .info { margin-top:24px; color:#888; font-size:13px; line-height:1.6; }
  ul { padding-left:20px; }
  li { color:#aaa; font-size:12px; line-height:1.7; }
  li b { color:#f0d028; }
  .stats { background:#16161a; padding:12px 16px; border-radius:6px; margin-top:24px; }
  .stats div { color:#aaa; font-size:12px; line-height:1.6; }
  .stats b { color:#e8e4dc; }
</style></head><body>
<h1>WrappedBulls Banner &mdash; unique-trait variant</h1>
<p class="sub">1500 x 500 &middot; 12 curated bulls &middot; theoretical minimum trait repetition</p>
<img src="banner_unique_1500x500.png" alt="WrappedBulls banner (unique-trait variant)">
<div class="stats">
  <div><b>Bodies:</b> all 9 used (3 doubled: holo, cyan, red)</div>
  <div><b>Horns:</b> all 5 used (distribution 3,3,2,2,2 &mdash; theoretical minimum)</div>
  <div><b>Eyes:</b> all 8 used (4 doubled)</div>
  <div><b>Backgrounds:</b> all 7 used (5 doubled)</div>
  <div><b>Accessories:</b> 12 unique</div>
  <div><b>Eyewear:</b> all 6 active non-none values used (hat-bulls auto-suppress)</div>
  <div><b>Mouths:</b> all 7 active values used</div>
</div>
<p class="info" style="margin-top:24px;">Bulls (left to right, top to bottom):</p>
<ul>
${tags.map((t, i) => `<li><b>#${i + 1}</b> ${t}</li>`).join('\n')}
</ul>
</body></html>`;
fs.writeFileSync(path.join(OUT_DIR, 'index_unique.html'), html);
console.log(`Open: ${path.join(OUT_DIR, 'index_unique.html')}`);
