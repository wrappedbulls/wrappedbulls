#!/usr/bin/env node
// preview_banner.mjs — produce two artifacts:
//   1. wrapped-bull-favorite.png  — bull #11 standalone, 768x768
//   2. wrapped-bulls-banner.png   — 5x2 banner, exactly 1500x500
//
// Run:  node scripts/preview_banner.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderBullSvg, deriveSeed } from "../web/lib/renderer.mjs";
import { svgToPixels, encodePng } from "../web/lib/svg_to_png.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// --- 1. Favorite bull standalone --------------------------------------
// The "11th" from the 20-bull preview (zero-indexed cat 10):
// white body / normal eyes / no accessory / lasers / no mouth.
const FAVORITE_SEED = "WrappedBullLbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const fav = renderBullSvg(deriveSeed(FAVORITE_SEED), 24);
const favPx = svgToPixels(fav.svg, 32); // 24*32 = 768x768 (same as /api/render)
fs.writeFileSync(
  path.join(ROOT, "wrapped-bull-favorite.png"),
  encodePng(favPx.width, favPx.height, favPx.rgb),
);
console.log(
  `Favorite: ${fav.names.body}/${fav.names.eye}/${fav.names.acc}/${fav.names.eyewear}/${fav.names.mouth}  -> wrapped-bull-favorite.png (${favPx.width}x${favPx.height})`,
);

// --- 2. 5x2 banner — exactly 1500x500 ---------------------------------
// Bulls picked from the 20-bull preview for max trait variety + the
// favorite included as the centerpiece.
// Fresh batch — 12 NEW seeds. deriveSeed sha256s these, so any string
// change rolls a completely different trait combination. Mixed
// prefixes + suffixes for maximum hash diversity.
const BANNER_SEEDS = [
  "BullFresh01alphabetaomegaaaaaaaaaaaaaaaaaa",
  "BullFresh02deltatethaspsiloniotaaaaaaaaaaa",
  "BullFresh03zetaetathetakappaoooooooooooooo",
  "BullFresh04lambdamunuxiomicronpiiiiiiiiiii",
  "BullFresh05rhosigmataumphichipsiomegaaaaaa",
  "BullFresh06aurummercuriferreumargentummmmm",
  "BullFresh07carbonsiliconnitrogenoxygensssss",
  "BullFresh08quasarpulsarnovablackholeeeeeee",
  "BullFresh09aphroditeapolloathenaaresssssss",
  "BullFresh10gaiauranushestiademetersssssss",
  "BullFresh11odinthorlokifreyaaaaaaaaaaaaaaa",
  "BullFresh12anubisrahorussethisissetnephtys",
];

const COLS = 6, ROWS = 2;
const W = 1500, H = 500;
// Each tile is exactly 250x250 px (1500/6 = 250, 500/2 = 250),
// flush with no gaps. We render at integer scale 10 (240x240) for
// crisp pixels, then nearest-neighbor upscale each tile 240->250
// at composite time. 250/24 isn't an integer, so a few source rows
// get duplicated — at this resolution it is imperceptible.
const SRC = 240;   // scale 10 -> 24*10 = 240
const TILE = 250;  // 1500/6 = 250, 500/2 = 250

const tilesPx = BANNER_SEEDS.map((seed, i) => {
  const out = renderBullSvg(deriveSeed(seed), 24);
  const px = svgToPixels(out.svg, 10);
  console.log(
    `  tile ${i}: ${out.names.body}/${out.names.eye}/${out.names.acc}/${out.names.eyewear}/${out.names.mouth}`,
  );
  return px;
});

const ch = tilesPx[0].rgb.length / (tilesPx[0].width * tilesPx[0].height);
const banner = Buffer.alloc(W * H * ch);

// Composite tiles flush — no canvas bg fill needed because every
// banner pixel is covered by a tile (12 tiles * 250*250 = 750,000 px
// = 1500*500). Each tile is nearest-neighbor upscaled 240 -> 250.
tilesPx.forEach((px, idx) => {
  const col = idx % COLS, row = (idx / COLS) | 0;
  const ox = col * TILE;
  const oy = row * TILE;
  const srcW = px.width;   // 240
  const srcH = px.height;  // 240
  for (let y = 0; y < TILE; y++) {
    const sy = Math.floor(y * srcH / TILE); // 240/250 nearest-neighbor
    for (let x = 0; x < TILE; x++) {
      const sx = Math.floor(x * srcW / TILE);
      const srcIdx = (sy * srcW + sx) * ch;
      const dstIdx = ((oy + y) * W + (ox + x)) * ch;
      for (let c = 0; c < ch; c++) banner[dstIdx + c] = px.rgb[srcIdx + c];
    }
  }
});

fs.writeFileSync(
  path.join(ROOT, "wrapped-bulls-banner.png"),
  encodePng(W, H, banner),
);
console.log(`Banner: ${W}x${H}  -> wrapped-bulls-banner.png`);
