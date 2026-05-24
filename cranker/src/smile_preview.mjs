// Side-by-side preview of the new smile + smug shapes (vs default).
// Renders 3 large bulls with the same body/head, varying mouth only.
//
// Run: node wrappedbulls-sol/cranker/src/smile_preview.mjs

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { encodePng, svgToPixels } from './svg_to_png.mjs';
import * as renderer from './renderer.mjs';

// Same body/head/horn/eye/bg for all 3 — only mouth differs.
// Brown body + ivory horns + normal eyes + sky bg = clean baseline.
const VARIANTS = [
  { id: 'a_default', label: 'Default (mouth = none)',  mouth: 0 },
  { id: 'b_smile',   label: 'Smile (new wings)',        mouth: 6 },
  { id: 'c_smug',    label: 'Smug (asymmetric wing)',   mouth: 4 },
];

const W = {
  body:    [30, 25, 12, 10,  6,  6,  6,  4,  1],
  horn:    [55, 18, 15,  7,  5],
  eye:     [55,  3,  3,  3, 14, 12,  8,  1],
  bg:      [28, 22, 14, 12,  4, 16,  4],
  acc:     [36,  0,  6,  0,  6,  6,  2,  3,  3,  3,  2,  0,  2,  2,  3,  6,  3,  3,  3,  6,  3,  1,  3,  0,  0,  2],
  eyewear: [50,  6, 12, 12,  6, 12,  0,  0,  2],
  mouth:   [56,  6,  0,  2,  6,  6,  6,  6,  6,  6,  0],
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

function buildSeed(mouth) {
  // Body=brown(0), horn=ivory(0), eye=normal(0), bg=sky(5), acc=none(0), eyewear=none(0), mouth=variant
  const seed = crypto.createHash('sha256').update('smile-preview-' + mouth).digest();
  const p = Buffer.from(seed);
  p[0] = findByte(W.body, 0);
  p[1] = findByte(W.horn, 0);
  p[2] = findByte(W.eye, 0);
  p[3] = findByte(W.bg, 5);
  p[4] = findByte(W.acc, 0);
  p[5] = findByte(W.eyewear, 0);
  p[6] = findByte(W.mouth, mouth);
  return p;
}

const OUT = path.resolve(import.meta.dirname, '..', '..', 'samples', 'smile-preview');
fs.mkdirSync(OUT, { recursive: true });

const cards = [];
for (const v of VARIANTS) {
  const seed = buildSeed(v.mouth);
  const { svg, names } = renderer.renderBullSvg(seed, 24);
  // PNG at scale 32 = 768x768 (large, sharp)
  const { width, height, rgb } = svgToPixels(svg, 32);
  const png = encodePng(width, height, rgb);
  fs.writeFileSync(path.join(OUT, `${v.id}.png`), png);

  // Also crop to mouth area for a zoomed-in close-up.
  // Mouth area is rows 14-18, cols 7-16 (5x10 cells in 24x24)
  // After scaling by 32: rows 14*32 to 18*32 = y 448-576, cols 7*32 to 16*32 = x 224-512
  const cropY = 14 * 32;
  const cropH = 5 * 32; // 5 rows
  const cropX = 7 * 32;
  const cropW = 10 * 32; // 10 cols
  const cropped = Buffer.alloc(cropW * cropH * 3);
  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      const si = ((cropY + y) * width + (cropX + x)) * 3;
      const di = (y * cropW + x) * 3;
      cropped[di + 0] = rgb[si + 0];
      cropped[di + 1] = rgb[si + 1];
      cropped[di + 2] = rgb[si + 2];
    }
  }
  const croppedPng = encodePng(cropW, cropH, cropped);
  fs.writeFileSync(path.join(OUT, `${v.id}_zoom.png`), croppedPng);

  cards.push({ ...v, mouthName: names.mouth });
}

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<title>WrappedBulls - Smile/Smug Preview</title>
<style>
  * { box-sizing: border-box; }
  body { background:#0a0a0c; color:#e8e4dc; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; padding:32px; margin:0; }
  h1 { color:#f0d028; margin:0 0 6px; }
  .sub { color:#888; margin:0 0 32px; }
  .grid { display:grid; grid-template-columns: repeat(3, 1fr); gap:24px; max-width:1400px; margin:0 auto; }
  .card { background:#15151a; border-radius:12px; padding:16px; border:1px solid #2a2a32; }
  .card img { width:100%; image-rendering:pixelated; border-radius:8px; display:block; background:#0a0a0c; }
  .label { color:#f0d028; font-weight:bold; font-size:14px; margin:12px 0 4px; }
  .info { color:#888; font-size:12px; }
  .zoom-row { margin-top:48px; }
  .zoom-grid { display:grid; grid-template-columns: repeat(3, 1fr); gap:24px; max-width:1400px; margin:0 auto; }
  .zoom-card { background:#15151a; border-radius:12px; padding:16px; border:1px solid #2a2a32; }
  .zoom-card img { width:100%; image-rendering:pixelated; border-radius:8px; display:block; background:#0a0a0c; }
  .zoom-card .label { color:#f0d028; font-weight:bold; font-size:13px; margin:8px 0 0; }
  hr { border:0; border-top:1px solid #2a2a32; margin:48px 0; }
</style></head><body>
<h1>Smile / Smug Preview</h1>
<p class="sub">Same brown bull, ivory horns, sky bg. Only the mouth varies. Top row: full bull. Bottom row: zoomed mouth area.</p>

<div class="grid">
${cards.map((c) => `<div class="card">
  <img src="${c.id}.png" alt="${c.label}" />
  <div class="label">${c.label}</div>
  <div class="info">mouth=${c.mouthName}</div>
</div>`).join('\n')}
</div>

<hr>
<p class="sub" style="text-align:center">Mouth area zoom (rows 14-18, cols 7-16)</p>
<div class="zoom-grid">
${cards.map((c) => `<div class="zoom-card">
  <img src="${c.id}_zoom.png" alt="${c.label} mouth detail" />
  <div class="label">${c.label}</div>
</div>`).join('\n')}
</div>

</body></html>`;

fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log('Wrote preview to ' + OUT);
console.log('Open: ' + path.join(OUT, 'index.html'));
