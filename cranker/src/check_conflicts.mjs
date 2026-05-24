// Conflict checker: verifies that no two trait layers (one accessory +
// one eyewear + one mouth piece) paint to the same (row, col) cell.
//
// Render order in renderBullSvg:
//   1. Background (full canvas, never conflicts)
//   2. Body grid (LAYOUT — body cells)
//   3. Eyewear overlay
//   4. Mouth overlay
//   5. Accessory overlay
//   6. Holo shimmer (only on holo body)
//   7. Laser eyes (only on red_glow eye palette)
//
// The check below enumerates each cell-producing function for every variant
// and reports any overlapping (row, col) coordinates between SLOTS.
// Within a slot (e.g. two accessories), only one is selected at runtime, so
// internal overlap is fine.
//
// We also report any cells that fall outside the 24x24 grid as warnings.

import {
  renderBullSvg,
  selectTraits,
} from './renderer.mjs';

// Pull the cell-builder functions and constants by importing the module text.
// (These aren't exported as functions we can call directly with a name argument
// — buildEyewearOverlay and buildMouthOverlay are internal. We re-implement
// the enumeration here by reading the renderer source and using its exports
// where possible.)
//
// Simpler: render every variant with a fixed "no-other-trait" render and
// collect the set of (row, col) it would paint, then intersect.
//
// For each slot, we render a bull with ONLY that variant on, no others. We
// diff the resulting cell set against a baseline (bull with all-defaults)
// to find the cells contributed by each variant.

import crypto from 'node:crypto';

const ACC_NAMES = [
  'none', 'nose_ring', 'bell', 'war_paint', 'gold_chain',
  'cowboy_hat', 'dubai_hat', 'strawberry_hat', 'apple',
  'crown', 'halo', 'devil_aura', 'diamond_aura', 'fire_aura',
  'beanie', 'tinfoil', 'headband', 'mohawk', 'top_hat', 'sheriff_hat', 'tiara', 'halo_stars',
  'earring', 'mole', 'rosy_cheeks', 'scar', 'pump', 'phantom',
];

const EYEWEAR_NAMES = [
  'none', 'mog', 'sunglasses_classic', 'clout_shades',
  'thug_life', '3d_glasses', 'big_shades', 'swag', 'lasers',
];

const MOUTH_NAMES = ['none', 'cigarette', 'cigar', 'grill', 'smug', 'bubblegum', 'smile', 'frown', 'tongue_out', 'open_shout', 'pacifier'];

// Weight arrays (mirror renderer.mjs)
const W = {
  body:    [22, 18, 14, 12, 10,  8,  7,  6,  3],
  horn:    [50, 14, 16, 12,  8],
  eye:     [50,  8,  5,  5, 18, 14,  8,  6],
  bg:      [22, 18, 16, 14, 12, 10,  8],
  acc:     [36,  0,  6,  0,  6,  6,  2,  3,  3,  3,  2,  0,  2,  2,  3,  6,  3,  3,  3,  6,  3,  1,  3,  0,  0,  2,  3,  3],
  eyewear: [41, 15,  8,  8,  7,  6,  0,  0, 10],
  mouth:   [58, 12,  0,  4,  3,  7,  5,  4,  4,  3,  0],
};

// Find the seed byte that makes pickWeighted return a desired index.
function findByte(weights, desired) {
  for (let b = 0; b < 256; b++) {
    let acc = 0;
    const total = weights.reduce((a, b) => a + b, 0);
    const r = (b / 256) * total;
    let picked = -1;
    for (let i = 0; i < weights.length; i++) {
      acc += weights[i];
      if (r < acc) { picked = i; break; }
    }
    if (picked === desired) return b;
  }
  return 0;
}

function buildSeed({ body = 0, horn = 0, eye = 0, bg = 0, acc = 0, eyewear = 0, mouth = 0 }) {
  const seed = Buffer.alloc(32);
  seed[0] = findByte(W.body, body);
  seed[1] = findByte(W.horn, horn);
  seed[2] = findByte(W.eye, eye);
  seed[3] = findByte(W.bg, bg);
  seed[4] = findByte(W.acc, acc);
  seed[5] = findByte(W.eyewear, eyewear);
  seed[6] = findByte(W.mouth, mouth);
  return seed;
}

// Parse the SVG output and extract all <rect> cells. Returns Map of "x,y" -> color.
function extractCells(svg) {
  const cells = new Map();
  // Skip the bg rect (which has width=24 height=24, no x/y attrs)
  const re = /<rect x="(\d+)" y="(\d+)" width="1" height="1" fill="([^"]+)"\/>/g;
  for (const m of svg.matchAll(re)) {
    cells.set(`${m[1]},${m[2]}`, m[3]);
  }
  return cells;
}

// Diff: given the cells of a "trait on" render and a baseline, return cells
// uniquely contributed by the trait.
function diffCells(traitCells, baselineCells) {
  const diff = new Set();
  for (const [k, v] of traitCells) {
    if (baselineCells.get(k) !== v) diff.add(k);
  }
  return diff;
}

// Baseline: plain brown bull, no overlays.
const baselineSvg = renderBullSvg(buildSeed({}), 1).svg;
const baselineCells = extractCells(baselineSvg);

// Capture cell sets contributed by each variant in each slot.
function captureVariants(slotName, names, makeSeedOpts) {
  const map = new Map();
  for (let i = 0; i < names.length; i++) {
    const seed = buildSeed(makeSeedOpts(i));
    const svg  = renderBullSvg(seed, 1).svg;
    const cells = extractCells(svg);
    const diff = diffCells(cells, baselineCells);
    map.set(names[i], diff);
  }
  return map;
}

const accVariants    = captureVariants('acc',     ACC_NAMES,     i => ({ acc: i }));
const eyewearVariants = captureVariants('eyewear', EYEWEAR_NAMES, i => ({ eyewear: i }));
const mouthVariants  = captureVariants('mouth',   MOUTH_NAMES,   i => ({ mouth: i }));

// Pairwise overlap check: for each (slotA variant, slotB variant) pair,
// report any shared cells.
function reportOverlaps(slotA, varsA, slotB, varsB) {
  const conflicts = [];
  for (const [na, ca] of varsA) {
    if (na === 'none' || ca.size === 0) continue;
    for (const [nb, cb] of varsB) {
      if (nb === 'none' || cb.size === 0) continue;
      const shared = [...ca].filter(c => cb.has(c));
      if (shared.length > 0) {
        conflicts.push({ slotA, na, slotB, nb, count: shared.length, cells: shared });
      }
    }
  }
  return conflicts;
}

const conflicts = [
  ...reportOverlaps('acc',     accVariants,     'eyewear', eyewearVariants),
  ...reportOverlaps('acc',     accVariants,     'mouth',   mouthVariants),
  ...reportOverlaps('eyewear', eyewearVariants, 'mouth',   mouthVariants),
];

console.log('=== Wrappedbulls trait conflict check ===\n');
console.log(`Variants: ${ACC_NAMES.length} accessories x ${EYEWEAR_NAMES.length} eyewear x ${MOUTH_NAMES.length} mouth pieces`);
console.log(`Total combinations: ${ACC_NAMES.length * EYEWEAR_NAMES.length * MOUTH_NAMES.length}\n`);

if (conflicts.length === 0) {
  console.log('✓ NO CELL CONFLICTS between any (accessory, eyewear, mouth) combination.');
  console.log('  Every trait pair paints to disjoint (row, col) cells.');
} else {
  console.log(`Found ${conflicts.length} cross-slot cell overlaps:\n`);
  for (const c of conflicts) {
    console.log(`  [${c.slotA}=${c.na}] x [${c.slotB}=${c.nb}]: ${c.count} cells overlap`);
    if (c.count <= 5) {
      console.log(`    cells: ${c.cells.join(', ')}`);
    }
  }
  console.log('\nNote: overlaps may be intentional (e.g., war paint covering Mog visor temple).');
  console.log('      Render order: eyewear -> mouth -> accessory, so later slots win.');
}

// Show stats per slot
console.log('\n=== Cells contributed per variant ===');
for (const [slot, vars] of [['acc', accVariants], ['eyewear', eyewearVariants], ['mouth', mouthVariants]]) {
  console.log(`\n${slot}:`);
  for (const [n, cells] of vars) {
    console.log(`  ${n.padEnd(22)} : ${cells.size} cells`);
  }
}
