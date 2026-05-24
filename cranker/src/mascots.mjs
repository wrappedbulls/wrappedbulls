// Generate 10 curated WrappedBulls mascot candidates for PFP / X account.
// Renders both 768x768 PNG (Twitter PFP source) and inline SVG (sharp preview).
//
// Run: node wrappedbulls-sol/cranker/src/mascots.mjs

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { encodePng, svgToPixels } from './svg_to_png.mjs';
import * as renderer from './renderer.mjs';

// Curated trait combos. "Clean" = strong body color + minimal accessory clutter.
// Each entry forces specific trait indices via brute-force seed byte search.
//
// Indices reference the NAMES arrays in renderer.mjs:
//   BODY  : 0 brown, 1 black, 2 white, 3 red, 4 golden, 5 cyan, 6 pink, 7 zombie, 8 holo
//   HORN  : 0 ivory, 1 dark, 2 gold, 3 crimson, 4 silver
//   EYE   : 0 normal, 1 golden, 2 void, 3 green, 4 closed, 5 angry, 6 crying, 7 ski_mask
//   BG    : 0 pasture, 1 sand, 2 sunset, 3 chart, 4 void, 5 sky, 6 crimson
//   ACC   : 0 none, 9 crown, 10 halo, 12 diamond_aura, 13 fire_aura, 21 halo_stars
//   EYEWR : 0 none, 1 mog, 2 sunglasses_classic, 8 lasers
//   MOUTH : 0 none
const MASCOTS = [
  // 1. The flagship — classic brown bull, ivory horns, calm pasture bg.
  //    The default. The platonic CryptoBull.
  { id: '01_classic_brown',     label: 'Classic — brown bull, ivory horns, pasture',
    body: 0, horn: 0, eye: 0, bg: 0, acc: 0, eyewear: 0, mouth: 0 },

  // 2. Black bull on sky bg — sleek silhouette, alternate colorway.
  { id: '02_sleek_black',       label: 'Sleek — black bull, ivory horns, sky',
    body: 1, horn: 0, eye: 0, bg: 5, acc: 0, eyewear: 0, mouth: 0 },

  // 3. Holo bull — legendary body color (1% drop). Premium, eye-catching.
  { id: '03_holo_legendary',    label: 'Holo — legendary purple/holo body, gold horns, void bg',
    body: 8, horn: 2, eye: 0, bg: 4, acc: 0, eyewear: 0, mouth: 0 },

  // 4. Golden bull — premium, no clutter. The "wealth" mascot.
  { id: '04_golden_premium',    label: 'Golden — golden body, ivory horns, sand',
    body: 4, horn: 0, eye: 0, bg: 1, acc: 0, eyewear: 0, mouth: 0 },

  // 5. Brown bull with the signature mog visor — our brand accessory in yellow.
  { id: '05_mog_signature',     label: 'Mog — brown bull, ivory horns, yellow visor (signature)',
    body: 0, horn: 0, eye: 0, bg: 0, acc: 0, eyewear: 1, mouth: 0 },

  // 6. White bull, crimson horns — high contrast, brandable.
  { id: '06_white_crimson',     label: 'White — white bull, crimson horns, sky',
    body: 2, horn: 3, eye: 0, bg: 5, acc: 0, eyewear: 0, mouth: 0 },

  // 7. Black bull with crown — regal, simple gold accent.
  { id: '07_crowned_black',     label: 'Crowned — black bull, gold horns, crown, sunset',
    body: 1, horn: 2, eye: 0, bg: 2, acc: 9, eyewear: 0, mouth: 0 },

  // 8. Holo + halo_stars (legendary x legendary) — stacked rarity flex.
  { id: '08_holo_halostars',    label: 'Holo + Halo Stars — two legendaries stacked',
    body: 8, horn: 4, eye: 0, bg: 4, acc: 21, eyewear: 0, mouth: 0 },

  // 9. Red bull, angry eyes — pure bull-market energy.
  { id: '09_angry_red',         label: 'Bull market — red body, gold horns, angry eyes, crimson bg',
    body: 3, horn: 2, eye: 5, bg: 6, acc: 0, eyewear: 0, mouth: 0 },

  // 10. Golden bull with classic sunglasses — premium with attitude.
  { id: '10_golden_shades',     label: 'Premium cool — golden body, classic sunglasses, sand',
    body: 4, horn: 0, eye: 0, bg: 1, acc: 0, eyewear: 2, mouth: 0 },

  // 11. Classic brown on sand bg — same as #1 but warmer/desert palette.
  { id: '11_classic_sand',      label: 'Classic Sand — brown bull, ivory horns, sand',
    body: 0, horn: 0, eye: 0, bg: 1, acc: 0, eyewear: 0, mouth: 0 },
];

// CURRENT weights (must mirror renderer.mjs:78-89 exactly, post-tiering)
const W = {
  body:    [30, 25, 12, 10,  6,  6,  6,  4,  1],
  horn:    [55, 18, 15,  7,  5],
  eye:     [55,  3,  3,  3, 14, 12,  8,  1],
  bg:      [28, 22, 14, 12,  4, 16,  4],
  acc:     [36,  0,  6,  0,  6,  6,  2,  3,  3,  3,  2,  0,  2,  2,  3,  6,  3,  3,  3,  6,  3,  1,  3,  0,  0,  2],
  eyewear: [50,  6, 12, 12,  6, 12,  0,  0,  2],
  mouth:   [56,  6,  0,  2,  6,  6,  6,  6,  6,  6,  0],
};

// Find a seed byte 0..255 that pickWeighted will map to the desired index.
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
  // Fallback: 255 lands on last index for any non-zero last weight.
  return 255;
}

function forcedSeed(forced) {
  // Start from a deterministic seed for the unspecified bytes (not used by
  // pickWeighted but feed into laser/aura cell variations etc.)
  const seed = crypto.createHash('sha256')
    .update('wrappedbulls-mascot-' + forced.id).digest();
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

const OUT = path.resolve(import.meta.dirname, '..', '..', 'samples', 'mascots');
fs.mkdirSync(OUT, { recursive: true });

const SVG_SCALE = 24;     // 576x576 for inline preview
const PNG_PIXEL_SCALE = 32; // svgToPixels nearest-neighbor scale → 24*32 = 768

console.log(`Rendering ${MASCOTS.length} mascot candidates → ${OUT}`);

const svgs = [];
for (const m of MASCOTS) {
  const seed = forcedSeed(m);
  const { svg, names } = renderer.renderBullSvg(seed, SVG_SCALE);
  fs.writeFileSync(path.join(OUT, `mascot_${m.id}.svg`), svg);

  // PNG: 768×768 via nearest-neighbor pixel-doubling. Crisp, no blur.
  const { width, height, rgb } = svgToPixels(svg, PNG_PIXEL_SCALE);
  fs.writeFileSync(path.join(OUT, `mascot_${m.id}.png`),
                   encodePng(width, height, rgb));

  svgs.push({ ...m, names, file: `mascot_${m.id}` });
  console.log(`  ✓ ${m.id} — body=${names.body} horn=${names.horn} eye=${names.eye} bg=${names.bg} acc=${names.acc} eyewear=${names.eyewear} mouth=${names.mouth}`);
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>WrappedBulls — Mascot / PFP Candidates</title>
<style>
  * { box-sizing: border-box; }
  body { background: #0a0a0c; color: #e8e4dc; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; padding: 32px; max-width: 1400px; margin: 0 auto; }
  h1 { color: #f0d028; font-size: 28px; margin: 0 0 8px; }
  p.sub { color: #888; margin: 0 0 32px; font-size: 14px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }
  .card { background: #15151a; border-radius: 12px; padding: 16px; border: 1px solid transparent; transition: border-color 0.15s; }
  .card:hover { border-color: #f0d028; }
  .pfp-wrap { background: #0a0a0c; border-radius: 8px; aspect-ratio: 1/1; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .pfp-wrap svg { width: 100%; height: 100%; image-rendering: pixelated; }
  .num { color: #f0d028; font-weight: bold; font-size: 14px; margin-bottom: 6px; }
  .label { color: #e8e4dc; font-size: 13px; line-height: 1.4; margin-top: 12px; }
  .traits { color: #888; font-size: 11px; margin-top: 8px; line-height: 1.5; }
  .download { display: inline-block; margin-top: 10px; color: #f0d028; text-decoration: none; font-size: 12px; }
  .download:hover { text-decoration: underline; }
</style></head>
<body>
<h1>WrappedBulls — Mascot Candidates</h1>
<p class="sub">10 curated picks for the project mascot / X profile picture. Click PNG link to download Twitter-ready 768×768.</p>
<div class="grid">
${svgs.map((m, i) => {
  // Rewrite gradient id to be unique per-card. Chrome treats inline-SVG
  // <defs> ids as document-global, which would otherwise paint every
  // bull with bull #1's background.
  const raw = fs.readFileSync(path.join(OUT, m.file + '.svg'), 'utf8');
  const uid = `bg-${i + 1}`;
  const svgFixed = raw.replace(/id="bg"/g, `id="${uid}"`).replace(/url\(#bg\)/g, `url(#${uid})`);
  return `<div class="card">
  <div class="num">#${i + 1}</div>
  <div class="pfp-wrap">${svgFixed}</div>
  <div class="label">${m.label}</div>
  <div class="traits">body: ${m.names.body} · horn: ${m.names.horn} · eye: ${m.names.eye}<br>bg: ${m.names.bg} · acc: ${m.names.acc} · eyewear: ${m.names.eyewear}</div>
  <a class="download" href="${m.file}.png" download>↓ Download PNG (768×768)</a>
</div>`;
}).join('\n')}
</div>
</body></html>`;

fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log(`\nWrote ${MASCOTS.length} SVGs + PNGs + index.html`);
console.log(`Open: ${path.join(OUT, 'index.html')}`);
