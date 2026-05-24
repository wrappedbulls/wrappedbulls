// Force-render one bull per accessory variant so we can see every trait.
// Useful for visual QA — confirms diamond/fire/dubai/etc. all render correctly.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { encodePng, svgToPixels, contactSheet } from './svg_to_png.mjs';

// Hand-build the renderer's internals so we can override traits directly.
// Easier than re-seeding: just patch selectTraits temporarily.
import * as renderer from './renderer.mjs';

// Forced trait combos — one per accessory variant we want to showcase.
// ACC indices: 0 none / 1 nose_ring / 2 bell / 3 war_paint / 4 gold_chain
//              5 cowboy_hat / 6 dubai_hat / 7 strawberry_hat / 8 apple
//              9 crown / 10 halo / 11 devil_aura / 12 diamond_aura / 13 fire_aura
//              14 beanie
// EYEWEAR: 0 none / 1 mog / 2 sunglasses_classic / 3 clout_shades
//          4 thug_life / 5 3d_glasses / 6 big_shades / 7 swag / 8 lasers
// MOUTH: 0 none / 1 cigarette / 2 cigar / 3 grill / 4 smug / 5 bubblegum / 6 smile
// BODY: 0 brown / 1 black / 2 white / 3 red / 4 golden / 5 cyan / 6 pink / 7 zombie / 8 holo
// EYE: 0 normal / 1 golden / 2 void / 3 green / 4 closed / 5 angry  (lasers moved to EYEWEAR)
const FORCED = [
  { acc: 0,  eyewear: 0, mouth: 0, body: 0, label: 'plain brown' },
  // Eyewear row (5 variants now — single canonical mog visor)
  { acc: 0,  eyewear: 1, mouth: 0, body: 4, label: 'mog' },
  { acc: 0,  eyewear: 2, mouth: 0, body: 3, label: 'classic sunglasses' },
  { acc: 0,  eyewear: 3, mouth: 0, body: 0, label: 'clout_shades' },
  { acc: 0,  eyewear: 4, mouth: 0, body: 1, label: 'thug_life' },
  { acc: 0,  eyewear: 5, mouth: 0, body: 6, label: '3d_glasses' },
  // Mouth pieces row
  { acc: 0,  eyewear: 0, mouth: 1, body: 1, label: 'cigarette' },
  { acc: 0,  eyewear: 0, mouth: 3, body: 1, label: 'gold grill' },
  { acc: 0,  eyewear: 0, mouth: 5, body: 6, label: 'bubblegum' },
  { acc: 0,  eyewear: 0, mouth: 7, body: 0, label: 'frown' },
  { acc: 0,  eyewear: 0, mouth: 8, body: 0, label: 'tongue_out' },
  { acc: 0,  eyewear: 0, mouth: 9, body: 3, label: 'open_shout' },
  // Accessories row
  { acc: 2,  eyewear: 0, mouth: 0, body: 2, label: 'bell' },
  { acc: 4,  eyewear: 0, mouth: 0, body: 1, label: 'gold_chain' },
  { acc: 5,  eyewear: 0, mouth: 0, body: 0, label: 'cowboy_hat' },
  { acc: 6,  eyewear: 0, mouth: 0, body: 0, label: 'dubai_hat' },
  { acc: 7,  eyewear: 0, mouth: 0, body: 0, label: 'strawberry_hat (Milady)' },
  { acc: 8,  eyewear: 0, mouth: 0, body: 0, label: 'apple' },
  { acc: 9,  eyewear: 0, mouth: 0, body: 8, label: 'crown (holo)' },
  { acc: 10, eyewear: 0, mouth: 0, body: 2, label: 'halo' },
  { acc: 12, eyewear: 0, mouth: 0, body: 5, label: 'diamond_aura (Moonbirds)' },
  { acc: 13, eyewear: 0, mouth: 0, body: 0, label: 'fire_aura (Moonbirds)' },
  { acc: 14, eyewear: 0, mouth: 0, body: 0, label: 'beanie (Punks)' },
  { acc: 15, eyewear: 0, mouth: 0, body: 0, label: 'tinfoil' },
  { acc: 16, eyewear: 0, mouth: 0, body: 0, label: 'headband (Punks)' },
  { acc: 17, eyewear: 0, mouth: 0, body: 2, label: 'mohawk (Punks)' },
  { acc: 18, eyewear: 0, mouth: 0, body: 2, label: 'top_hat (Punks)' },
  { acc: 19, eyewear: 0, mouth: 0, body: 0, label: 'sheriff_hat (black cowboy)' },
  { acc: 20, eyewear: 0, mouth: 0, body: 6, label: 'tiara (Punks)' },
  { acc: 21, eyewear: 0, mouth: 0, body: 8, label: 'halo_of_stars' },
  { acc: 22, eyewear: 0, mouth: 0, body: 0, label: 'earring (Punks)' },
  { acc: 25, eyewear: 0, mouth: 0, body: 1, label: 'scar' },
  // Eye variants (no eyewear so the eyes are visible)
  { acc: 0,  eyewear: 8, mouth: 0, body: 0,         label: 'lasers' },
  { acc: 0,  eyewear: 0, mouth: 0, body: 4, eye: 1, label: 'golden eyes' },
  { acc: 0,  eyewear: 0, mouth: 0, body: 1, eye: 2, label: 'void eyes' },
  { acc: 0,  eyewear: 0, mouth: 0, body: 7, eye: 3, label: 'green alien eyes' },
  { acc: 0,  eyewear: 0, mouth: 0, body: 2, eye: 4, label: 'closed (sleepy)' },
  { acc: 0,  eyewear: 0, mouth: 0, body: 0, eye: 5, label: 'angry' },
  { acc: 0,  eyewear: 0, mouth: 0, body: 0, eye: 6, label: 'crying' },
  { acc: 0,  eyewear: 0, mouth: 0, body: 0, eye: 7, label: 'ski_mask' },
  // Stacked legendary combos
  { acc: 0,  eyewear: 1, mouth: 1, body: 8, label: 'holo body + mog + cigarette' },
  { acc: 13, eyewear: 1, mouth: 1, body: 3, label: 'fire aura + mog + cigarette' },
  { acc: 12, eyewear: 3, mouth: 0, body: 7, label: 'diamond + clout + zombie' },
  { acc: 7,  eyewear: 3, mouth: 5, body: 6, label: 'strawberry + clout + bubblegum' },
  { acc: 8,  eyewear: 5, mouth: 0, body: 0, label: 'apple + 3d glasses' },
];

// Monkey-patch renderer.selectTraits via wrapper around renderBullSvg
function forcedRender(forcedTraits) {
  // Build the seed bytes deterministically just for variation in horn/eye/bg
  const seed = crypto.createHash('sha256').update('showcase-' + JSON.stringify(forcedTraits)).digest();
  // We need to bypass the seed-based picker for body/acc/eyewear/mouth.
  // Easiest: temporarily override the exported selectTraits. But ESM exports
  // are read-only. Instead: regenerate seed bytes that produce desired indices.
  //
  // Simpler approach: directly call renderer internals via re-implementation.
  // For showcase purposes we just want to set t.body etc. — we can do this
  // by replacing the relevant seed bytes with values that pickWeighted will
  // map to the forced index.
  //
  // Since pickWeighted uses (byte / 256) * total to index, we need the byte
  // s.t. the cumulative weights at the desired index contain that fraction.
  // For simplicity let's just brute-force: find a byte that picks the index.
  function findByte(weights, desired) {
    for (let b = 0; b < 256; b++) {
      let acc = 0, picked = -1;
      const total = weights.reduce((a,b) => a+b, 0);
      const r = (b / 256) * total;
      for (let i = 0; i < weights.length; i++) {
        acc += weights[i];
        if (r < acc) { picked = i; break; }
      }
      if (picked === desired) return b;
    }
    return 0;
  }
  // Mirror weights (must stay in sync with renderer.mjs:78-92)
  const W = {
    body:    [30, 25, 12, 10,  6,  6,  6,  4,  1],
    horn:    [55, 18, 15,  7,  5],
    eye:     [55,  3,  3,  3, 14, 12,  8,  1],
    bg:      [28, 22, 14, 12,  4, 16,  4],
    acc:     [36,  0,  6,  0,  6,  6,  2,  3,  3,  3,  2,  0,  2,  2,  3,  6,  3,  3,  3,  6,  3,  1,  3,  0,  0,  2],
    eyewear: [50,  6, 12, 12,  6, 12,  0,  0,  2],
    mouth:   [68,  6,  0,  2,  0,  6,  0,  6,  6,  6,  0],
  };

  const patched = Buffer.from(seed);
  patched[0] = findByte(W.body,    forcedTraits.body);
  patched[1] = findByte(W.horn,    forcedTraits.horn ?? 0);
  patched[2] = findByte(W.eye,     forcedTraits.eye ?? 0);
  patched[3] = findByte(W.bg,      forcedTraits.bg ?? 0);
  patched[4] = findByte(W.acc,     forcedTraits.acc);
  patched[5] = findByte(W.eyewear, forcedTraits.eyewear);
  patched[6] = findByte(W.mouth,   forcedTraits.mouth);

  return renderer.renderBullSvg(patched, 12);
}

const SHOWCASE = path.resolve(import.meta.dirname, '..', '..', 'samples', 'showcase');
fs.mkdirSync(SHOWCASE, { recursive: true });

const svgs = [];
const labels = [];
for (let i = 0; i < FORCED.length; i++) {
  const f = FORCED[i];
  const { svg, names } = forcedRender(f);
  const fname = `showcase_${String(i).padStart(2, '0')}_${f.label.replace(/[^a-z0-9]+/gi, '_')}.svg`;
  fs.writeFileSync(path.join(SHOWCASE, fname), svg);
  svgs.push(svg);
  labels.push(f.label);

  // Per-bull PNG
  const { width, height, rgb } = svgToPixels(svg, 12);
  fs.writeFileSync(path.join(SHOWCASE, fname.replace('.svg', '.png')), encodePng(width, height, rgb));
}

// Contact sheet
const sheet = contactSheet(svgs, { cellScale: 8, cols: 6, margin: 8 });
fs.writeFileSync(path.join(SHOWCASE, 'showcase_sheet.png'),
                 encodePng(sheet.width, sheet.height, sheet.rgb));

// HTML index
const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Wrappedbulls trait showcase</title>
<style>
  body { background:#0e0e12; color:#e8e8ec; font-family:system-ui; padding:24px; }
  .grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(220px,1fr)); gap:16px; }
  .card { background:#1a1a22; border-radius:8px; padding:12px; }
  img { width:100%; image-rendering:pixelated; border-radius:4px; }
  .label { margin-top:8px; font-size:13px; color:#aab; text-align:center; }
</style></head>
<body><h1>Trait showcase (forced combos)</h1>
<div class="grid">
${svgs.map((_, i) => `<div class="card">
  <img src="showcase_${String(i).padStart(2,'0')}_${labels[i].replace(/[^a-z0-9]+/gi,'_')}.png">
  <div class="label">${labels[i]}</div>
</div>`).join('\n')}
</div></body></html>`;
fs.writeFileSync(path.join(SHOWCASE, 'index.html'), html);

console.log(`Wrote ${svgs.length} showcase bulls to ${SHOWCASE}`);
