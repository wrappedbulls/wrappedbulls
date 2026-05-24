// Deterministic 24x24 pixel-bull SVG renderer.
//
// seed = sha256(nft_mint_pubkey_base58)
//
// The seed source changed in the ERC404 redesign: visuals are now locked
// to the NFT's mint address (not the wrapping wallet), so the bull's art
// stays with the NFT through marketplace transfers. When a tier is reused
// after unwrap, the new wrap creates a fresh NFT mint -> different seed
// -> different visual ("re-roll" behavior).
//
// Output: SVG string of <rect> elements (~1.2-1.5KB per bull).
// Layout: chibi bull bust (head + shoulders), horns above head, eyes/nose
// in middle, neck/shoulders at bottom. Accessories overlay the base layout.

import crypto from 'node:crypto';

// ============================================================
// Palettes
// ============================================================

// Body palettes: [base, shade, light, accent]
const BODY_PALETTES = [
  { name: 'brown',      base: '#7a4a2a', shade: '#5a3520', light: '#9a6240', nose: '#d8a888' },
  { name: 'black',      base: '#2a2530', shade: '#15121a', light: '#3f3a48', nose: '#a87878' },
  { name: 'white',      base: '#e8e4dc', shade: '#b8b2a8', light: '#ffffff', nose: '#f0c8c0' },
  { name: 'red',        base: '#a02828', shade: '#681818', light: '#c44848', nose: '#e88080' },
  { name: 'golden',     base: '#d4a428', shade: '#a07410', light: '#f0c850', nose: '#e8c080' },
  { name: 'cyan',       base: '#28b0c4', shade: '#187088', light: '#58d4e8', nose: '#a8e8f0' },
  { name: 'pink',       base: '#e8689c', shade: '#a83870', light: '#ffa0c0', nose: '#ffd8e8' },
  { name: 'zombie',     base: '#5c8050', shade: '#385030', light: '#88b070', nose: '#7a3050' }, // rare undead
  { name: 'holo',       base: '#9c5cff', shade: '#5828c4', light: '#d8b4ff', nose: '#f0d8ff' }, // legendary
];

const HORN_PALETTES = [
  { name: 'ivory',      base: '#e8dcc0', tip: '#c0a878' },
  { name: 'dark',       base: '#3a2818', tip: '#1a1008' },
  { name: 'gold',       base: '#f0c850', tip: '#ffe888' },
  { name: 'crimson',    base: '#882020', tip: '#c04040' },
  { name: 'silver',     base: '#c0c4c8', tip: '#e8ecf0' },
];

// Eye palettes. Each palette has either:
//   type: 'default'  → render the standard 2x2 sclera/pupil cells using the
//                       palette's `sclera` and `pupil` colors
//   type: 'closed'   → eyes are closed; render an eyelid line, no sclera
//   type: 'angry'    → narrowed V-shape; partial sclera + sharp downward pupils
//
// Variations are kept tight (CryptoPunks/BAYC approach: most identity comes
// from eyewear, with eyes themselves having a few iconic structural variants).
//
// Laser ("red") eye is now CONTAINED — no beam cells extending across the
// canvas, just red sclera + dark pupil within the 2x2 eye area.
const EYE_PALETTES = [
  // Lasers were removed from EYE palettes and moved to the EYEWEAR slot —
  // that way lasers are mutually exclusive with glasses (no more "beams
  // shooting out from behind goggles" weirdness).
  { name: 'normal',   type: 'default', sclera: '#ffffff', pupil: '#181818' },
  { name: 'golden',   type: 'default', sclera: '#fff5b8', pupil: '#6a4810' },
  { name: 'void',     type: 'default', sclera: '#181818', pupil: '#ff20ff' },
  { name: 'green',    type: 'default', sclera: '#80ff80', pupil: '#208020' },
  { name: 'closed',   type: 'closed' },  // sleepy bull (no sclera)
  { name: 'angry',    type: 'angry'  },  // narrowed downturn
  { name: 'crying',   type: 'crying', sclera: '#ffffff', pupil: '#181818', tear: '#28a8e8', tear_light: '#a8e0ff' }, // tears trickling down outer corners
  { name: 'ski_mask', type: 'ski_mask', sclera: '#ffffff', pupil: '#b8b8b8', mask: '#181818' }, // black ski mask; white sclera + light-gray pupils stay clearly visible against the dark mask cutouts
];

const BG_PALETTES = [
  { name: 'pasture',    top: '#a8d878', bot: '#789848' },
  { name: 'sand',       top: '#f0d890', bot: '#c8a868' },
  { name: 'sunset',     top: '#ff8848', bot: '#683078' },
  { name: 'chart',      top: '#0a3818', bot: '#082810' },          // green candles
  { name: 'void',       top: '#181828', bot: '#080810' },
  { name: 'sky',        top: '#88c8f0', bot: '#c8e8ff' },
  { name: 'crimson',    top: '#481010', bot: '#280808' },
];

// Trait rarity weights. Order MUST match the corresponding NAMES array.
// Tier targets per slot: Common ~50-60% / Uncommon ~25-30% / Rare ~10-12%
//                        Epic ~3-5% / Legendary ~0.5-1%
const BODY_WEIGHTS    = [30, 25, 12, 10,  6,  6,  6,  4,  1]; // brown..zombie..holo (holo legendary)
const HORN_WEIGHTS    = [55, 18, 15,  7,  5]; // ivory / dark / gold / crimson / silver
//                       normal gold void grn closed angry crying ski_mask
const EYE_WEIGHTS     = [ 55,    3,   3,  3,  14,    12,   8,    1]; // ski_mask legendary
const BG_WEIGHTS      = [28, 22, 14, 12,  4, 16,  4]; // pasture/sand/sky common, void epic
//                       none ring bell paint chain cowboy dubai strw apple crown halo devil diamond fire beanie tinfoil headband mohawk top_hat sheriff tiara halostars earring mole rosy scar pump phantom
//  (nose_ring=0, war_paint=0, devil_aura=0, mole=0, rosy_cheeks=0 — REMOVED; indices kept for backward-compat)
//  halo_stars legendary; dubai/fire_aura/halo/diamond_aura/scar epic; tiara/top_hat/mohawk/pump/phantom/etc rare; tinfoil/sheriff/cowboy/bell/gold_chain uncommon
const ACC_WEIGHTS     = [ 36,   0,   6,    0,    6,     6,    2,    3,    3,    3,   2,    0,      2,    2,     3,      6,       3,      3,    3,      6,    3,    1,         3,    0,    0,   2,    3,    3];
//                       none mog classic clout thug 3d_glasses big_shades(=0) swag(=0) lasers
const EYEWEAR_WEIGHTS = [ 50,          6,     12,   12,   6,        12,             0,        0,     2];
//                       none cig cigar(=0) grill smug(=0) bubble smile(=0) frown tongue shout pacifier(=0)
//  smug and smile removed - never picked. Their weight redistributed to 'none'.
const MOUTH_WEIGHTS   = [ 68,   6,        0,    2,        0,      6,         0,     6,      6,    6,         0];

// ============================================================
// Base layout (chibi bull bust, 24x24)
// ============================================================
//
// Cell role codes:
//   .   transparent (background shows through)
//   B   body base color
//   b   body shade color (1-px outline / shadows)
//   L   body light color (highlight)
//   H   horn base color
//   h   horn tip color
//   W   eye sclera (white normally)
//   E   eye pupil
//   N   nose / muzzle (lighter body color)
//   R   nostril (dark)
//   M   mouth (dark line)

// Bull silhouette: horns rise from top-center, sweep outward and upward
// (Spanish fighting bull / Texas longhorn style). Wide brow, tapering snout
// with two distinct nostrils, broad shoulders. Reads as a bull at first glance.
//
// Cell roles:
//   .  transparent    B  body base    b  body shade
//   L  body light     H  horn base    h  horn tip
//   W  eye sclera     E  eye pupil
//   N  nose/muzzle    R  nostril dark M  mouth dark
const LAYOUT = [
//  0         1         2
//  0123456789012345678901234
   '........................', // 0  (empty — horns shifted down 1 to feel rooted)
   '......H..........H......', // 1  horn tips
   '.....HH..........HH.....', // 2
   '.....HH..........HH.....', // 3
   '....HhH..BBBBBB..HhH....', // 4  horns curving inward, top of head appears
   '....HHH.BBBBBBBB.HHH....', // 5
   '....HH.BBBBBBBBBB.HH....', // 6  horn bases merge with skull
   '.....HBBBLBBBBLBBBH.....', // 7  horn base + brow ridge highlight
   '.....BBbBbbBBbbBbBB.....', // 8
   '....BBbbbWWbbWWbbbBB....', // 9  eyes (sclera)
   '....BbbbbEWbbWEbbbBB....', // 10 pupils (forward-looking, not cross-eyed)
   '....BbbbbbbbbbbbbbbB....', // 11 cheekbones
   '.....BbbbbNNNNNNbbB.....', // 12 muzzle starts (lighter color)
   '.....BBbNNNNNNNNNbB.....', // 13 muzzle widens
   '.....BbNNNRNNRNNNbB.....', // 14 two distinct nostrils
   '.....BBbNNNNNNNNNbB.....', // 15 muzzle continues
   '.......BbNMMMMNbB.......', // 16 mouth line
   '........BbNNNNbB........', // 17 chin
   '........BBBBBBBB........', // 18 jaw closes
   '.......BBBBBBBBBB.......', // 19 neck
   '......BBBBBBBBBBBB......', // 20 shoulders broaden
   '.....BBBBBBBBBBBBBB.....', // 21
   '....BBBBBBBBBBBBBBBB....', // 22
   '........................', // 23
];

// ============================================================
// Horn variants (override horn cells in rows 2-7)
// ============================================================

// Horn shape is FIXED across the collection — every bull has the same
// Spanish-bull horn silhouette baked into LAYOUT. Variation comes only
// from horn COLOR via HORN_PALETTES (ivory / dark / gold / crimson / silver).
//
// Keeping the silhouette consistent reads as a cohesive collection (CryptoPunks
// approach) rather than feeling like a glitchy generator with random mutations.

const HORN_NAMES = ['ivory', 'dark', 'gold', 'crimson', 'silver']; // matches HORN_PALETTES indices

// ============================================================
// Eye variants (override eye cells)
// ============================================================
//
// All variants keep the same cell positions, just swap palette via EYE_PALETTES.
// "laser" adds glow ray cells on rows 11-12 extending outward.

const EYE_VARIANTS = {
  normal: null,
  red_glow: { addLaser: true },
  golden: null,
  void: null,
  green: null,
};

// ============================================================
// Accessory variants (overlay extra cells)
// ============================================================
// Each accessory is a list of {row, col, role} additions.

// Accessory cells overlay the base layout (drawn after body, before lasers).
// All accessories use a consistent palette of "metals" and dark outlines so
// they read as a coherent collection regardless of body color.
//
// Shared palette:
//   gold_dark   #a07410   gold_mid   #d4a428   gold_light  #f0c850   gold_bright #ffe888
//   silver_dark #6a7080   silver_mid #b0b8c0   silver_light #e0e8f0
//   outline     #181818   outline_lt #3a2a18
//
// Positions assume the bull layout (snout at rows 12-17, neck at 19-22,
// horns at rows 0-6 leaving the area between horns clear at top center).
const ACCESSORIES = {
  none: [],
  nose_ring: [
    // Small 3-cell V-shape septum ring hanging between the nostrils.
    // Two top cells form the ring's body anchored to the septum, and one
    // bottom cell hangs as the V apex below — reads as a tiny gold ring
    // dangling from the bull's nose.
    //
    // Position is tight — confined to rows 14-15 cols 11-12, between
    // the nostrils (row 14 cols 10, 13) and above the mouth (row 16).
    //
    // Palette: gold_dark #a07410 / gold_bright #ffe888
    { row: 14, col: 11, color: '#ffe888' }, // top-left of V (between nostrils)
    { row: 14, col: 12, color: '#d4a428' }, // top-right of V
    { row: 15, col: 12, color: '#a07410' }, // V apex hanging down
  ],
  bell: [
    // Cowbell: thin black leather strap on row 18, gold trapezoidal bell
    // hanging from a small attach loop, widening from row 20 to row 22 with
    // a dark slot opening at the bottom and the clapper hanging out below.
    // Bell silhouette dominates — strap is just a thin band.
    //
    // Palette: strap #181818 / gold_dark #a07410 / gold_mid #d4a428
    //          gold_light #f0c850 / gold_bright #ffe888 / opening #0a0a0a
    //
    // === Row 18: thin black leather strap (cols 8-15, matches jaw width) ===
    { row: 18, col: 8,  color: '#181818' },
    { row: 18, col: 9,  color: '#181818' },
    { row: 18, col: 10, color: '#181818' },
    { row: 18, col: 11, color: '#181818' },
    { row: 18, col: 12, color: '#181818' },
    { row: 18, col: 13, color: '#181818' },
    { row: 18, col: 14, color: '#181818' },
    { row: 18, col: 15, color: '#181818' },

    // === Row 19: small gold attach loop (where strap meets bell) ===
    { row: 19, col: 11, color: '#a07410' },
    { row: 19, col: 12, color: '#a07410' },

    // === Row 20: bell top (narrow, 4 cells) ===
    { row: 20, col: 10, color: '#a07410' }, // outline
    { row: 20, col: 11, color: '#f0c850' },
    { row: 20, col: 12, color: '#ffe888' }, // shine
    { row: 20, col: 13, color: '#a07410' }, // outline

    // === Row 21: bell middle (wider, 6 cells) ===
    { row: 21, col: 9,  color: '#a07410' }, // outline
    { row: 21, col: 10, color: '#d4a428' },
    { row: 21, col: 11, color: '#f0c850' },
    { row: 21, col: 12, color: '#d4a428' },
    { row: 21, col: 13, color: '#d4a428' },
    { row: 21, col: 14, color: '#a07410' }, // outline

    // === Row 22: bell bottom widest (8 cells with dark slot opening) ===
    { row: 22, col: 8,  color: '#a07410' }, // outline left
    { row: 22, col: 9,  color: '#d4a428' },
    { row: 22, col: 10, color: '#d4a428' },
    { row: 22, col: 11, color: '#0a0a0a' }, // dark slot opening
    { row: 22, col: 12, color: '#0a0a0a' }, // dark slot opening
    { row: 22, col: 13, color: '#d4a428' },
    { row: 22, col: 14, color: '#d4a428' },
    { row: 22, col: 15, color: '#a07410' }, // outline right

    // === Row 23: clapper hanging out of the slot ===
    { row: 23, col: 11, color: '#0a0a0a' },
    { row: 23, col: 12, color: '#0a0a0a' },
  ],
  war_paint: [
    // 3 diagonal red slash marks across the left cheek + smudge on snout.
    // Uses a single saturated red so it pops on any body color.
    { row: 10, col: 6,  color: '#d82020' },
    { row: 11, col: 5,  color: '#a01818' }, // shadow
    { row: 11, col: 6,  color: '#d82020' },
    { row: 11, col: 7,  color: '#ff4040' }, // bright tip
    { row: 12, col: 5,  color: '#d82020' },
    { row: 13, col: 4,  color: '#a01818' },
    { row: 13, col: 5,  color: '#d82020' },
    { row: 14, col: 5,  color: '#ff4040' },
  ],
  crown: [
    // Larger 5-point gold crown sitting on the brow, between the horns.
    // Spikes (top of crown)
    { row: 1, col: 9,  color: '#a07410' },
    { row: 1, col: 11, color: '#a07410' },
    { row: 1, col: 13, color: '#a07410' },
    { row: 2, col: 8,  color: '#a07410' }, // outline left
    { row: 2, col: 9,  color: '#f0c850' },
    { row: 2, col: 10, color: '#a07410' }, // valley
    { row: 2, col: 11, color: '#ffe888' }, // bright spike center
    { row: 2, col: 12, color: '#a07410' },
    { row: 2, col: 13, color: '#f0c850' },
    { row: 2, col: 14, color: '#a07410' }, // outline right
    // Crown band
    { row: 3, col: 8,  color: '#a07410' },
    { row: 3, col: 9,  color: '#f0c850' },
    { row: 3, col: 10, color: '#d4a428' },
    { row: 3, col: 11, color: '#ff60a0' }, // ruby gem
    { row: 3, col: 12, color: '#d4a428' },
    { row: 3, col: 13, color: '#f0c850' },
    { row: 3, col: 14, color: '#a07410' },
    { row: 4, col: 8,  color: '#181818' }, // band shadow
    { row: 4, col: 9,  color: '#a07410' },
    { row: 4, col: 10, color: '#a07410' },
    { row: 4, col: 11, color: '#a07410' },
    { row: 4, col: 12, color: '#a07410' },
    { row: 4, col: 13, color: '#a07410' },
    { row: 4, col: 14, color: '#181818' },
  ],
  halo: [
    // Bright golden halo ring with a soft outer glow above the horns.
    { row: 1, col: 8,  color: '#fff080' },
    { row: 1, col: 9,  color: '#ffe888' },
    { row: 1, col: 10, color: '#fff8c8' },
    { row: 1, col: 11, color: '#ffffff' },
    { row: 1, col: 12, color: '#ffffff' },
    { row: 1, col: 13, color: '#fff8c8' },
    { row: 1, col: 14, color: '#ffe888' },
    { row: 1, col: 15, color: '#fff080' },
    { row: 2, col: 9,  color: '#fff080' }, // soft falloff
    { row: 2, col: 14, color: '#fff080' },
  ],
  gold_chain: [
    // Skinny gold necklace — single-cell-wide chain that drapes from the
    // upper neck down the chest in a clean V curve. NOT a thick choker.
    //
    // The chain anchors at row 19 (upper neck edges) and steps diagonally
    // inward as it drops, meeting at the chest center on row 22 with a
    // small pendant-style highlight cell.
    //
    // Palette: gold_dark #a07410 / gold_mid #d4a428 / gold_bright #ffe888
    //
    // === ANCHOR POINTS — upper neck edges (row 19) ===
    { row: 19, col: 7,  color: '#a07410' }, // left anchor
    { row: 19, col: 16, color: '#a07410' }, // right anchor
    // === DIAGONAL STEPS DOWN — single-cell chain ===
    { row: 20, col: 8,  color: '#d4a428' },
    { row: 20, col: 15, color: '#d4a428' },
    { row: 21, col: 9,  color: '#d4a428' },
    { row: 21, col: 14, color: '#d4a428' },
    // === V-CURVE BOTTOM — chain meets at chest center (row 22) ===
    { row: 22, col: 10, color: '#a07410' },
    { row: 22, col: 11, color: '#d4a428' },
    { row: 22, col: 12, color: '#ffe888' }, // bright pendant highlight
    { row: 22, col: 13, color: '#a07410' },
  ],
  cowboy_hat: [
    // Brown sheriff cowboy hat — solid brown body matching the reference
    // photo. Replaces the old black hatband with a thin GOLD ROPE BAND
    // and a bright GOLD STAR badge centered at the front. Brim has
    // dramatic upturned WING TIPS on the sides + wide flat plane +
    // front-center underside drop.
    //
    // Palette: brown_dark #2a1810 / brown_main #6a3a20
    //          gold_dark #a07410 / gold_mid #d4a428 / gold_bright #ffe888
    //          brim_shadow #4a2810

    // ============================================================
    // CROWN — cattleman crease (two peaks + V valley), rows 0-3
    // ============================================================
    // Row 0 — two peak tips
    { row: 0, col: 11, color: '#6a3a20' },
    { row: 0, col: 13, color: '#6a3a20' },
    // Row 1 — peaks widen + V valley + outer dark edges
    { row: 1, col: 10, color: '#2a1810' },
    { row: 1, col: 11, color: '#6a3a20' },
    { row: 1, col: 12, color: '#2a1810' }, // V crease valley
    { row: 1, col: 13, color: '#6a3a20' },
    { row: 1, col: 14, color: '#2a1810' },
    // Row 2 — crown body widens (cols 9-15)
    { row: 2, col: 9,  color: '#2a1810' },
    { row: 2, col: 10, color: '#6a3a20' },
    { row: 2, col: 11, color: '#6a3a20' },
    { row: 2, col: 12, color: '#6a3a20' },
    { row: 2, col: 13, color: '#6a3a20' },
    { row: 2, col: 14, color: '#6a3a20' },
    { row: 2, col: 15, color: '#2a1810' },
    // Row 3 — crown body bottom (just above the band)
    { row: 3, col: 9,  color: '#2a1810' },
    { row: 3, col: 10, color: '#6a3a20' },
    { row: 3, col: 11, color: '#6a3a20' },
    { row: 3, col: 12, color: '#6a3a20' },
    { row: 3, col: 13, color: '#6a3a20' },
    { row: 3, col: 14, color: '#6a3a20' },
    { row: 3, col: 15, color: '#2a1810' },

    // ============================================================
    // GOLD ROPE BAND + STAR BADGE (row 4) — replaces black hatband
    // Thin gold rope runs across the crown base, brightest at the
    // center where the sheriff star sits.
    // ============================================================
    { row: 4, col: 9,  color: '#a07410' }, // dark gold rope (left end)
    { row: 4, col: 10, color: '#d4a428' }, // gold rope
    { row: 4, col: 11, color: '#ffe888' }, // ★ STAR (bright gold)
    { row: 4, col: 12, color: '#ffe888' }, // ★ STAR (bright gold)
    { row: 4, col: 13, color: '#d4a428' },
    { row: 4, col: 14, color: '#d4a428' },
    { row: 4, col: 15, color: '#a07410' }, // dark gold rope (right end)

    // ============================================================
    // BRIM with DRAMATIC UPTURNED WING TIPS (rows 4-7)
    // The wings curl up at the outer sides at row 4 (one cell each),
    // widen at row 5, and merge into the wide flat plane at row 6.
    // ============================================================
    // Row 4 — wing tips at the far outer sides (cols 5-6 left, 17-18 right)
    { row: 4, col: 5,  color: '#2a1810' }, // outer dark edge
    { row: 4, col: 6,  color: '#6a3a20' },
    { row: 4, col: 17, color: '#6a3a20' },
    { row: 4, col: 18, color: '#2a1810' }, // outer dark edge
    // Row 5 — wings widen as they descend toward the brim plane
    { row: 5, col: 4,  color: '#2a1810' },
    { row: 5, col: 5,  color: '#6a3a20' },
    { row: 5, col: 6,  color: '#6a3a20' },
    { row: 5, col: 17, color: '#6a3a20' },
    { row: 5, col: 18, color: '#6a3a20' },
    { row: 5, col: 19, color: '#2a1810' },
    // Row 6 — full brim plane (wide, cols 3-20)
    { row: 6, col: 3,  color: '#2a1810' },
    { row: 6, col: 4,  color: '#6a3a20' },
    { row: 6, col: 5,  color: '#6a3a20' },
    { row: 6, col: 6,  color: '#6a3a20' },
    { row: 6, col: 7,  color: '#6a3a20' },
    { row: 6, col: 8,  color: '#6a3a20' },
    { row: 6, col: 9,  color: '#6a3a20' },
    { row: 6, col: 10, color: '#6a3a20' },
    { row: 6, col: 11, color: '#6a3a20' },
    { row: 6, col: 12, color: '#6a3a20' },
    { row: 6, col: 13, color: '#6a3a20' },
    { row: 6, col: 14, color: '#6a3a20' },
    { row: 6, col: 15, color: '#6a3a20' },
    { row: 6, col: 16, color: '#6a3a20' },
    { row: 6, col: 17, color: '#6a3a20' },
    { row: 6, col: 18, color: '#6a3a20' },
    { row: 6, col: 19, color: '#6a3a20' },
    { row: 6, col: 20, color: '#2a1810' },
    // Row 7 — front-center underside drop (medium-dark shadow)
    { row: 7, col: 7,  color: '#2a1810' }, // outline cap
    { row: 7, col: 8,  color: '#4a2810' },
    { row: 7, col: 9,  color: '#4a2810' },
    { row: 7, col: 10, color: '#4a2810' },
    { row: 7, col: 11, color: '#4a2810' },
    { row: 7, col: 12, color: '#4a2810' },
    { row: 7, col: 13, color: '#4a2810' },
    { row: 7, col: 14, color: '#4a2810' },
    { row: 7, col: 15, color: '#4a2810' },
    { row: 7, col: 16, color: '#2a1810' }, // outline cap
  ],
  devil_aura: [
    // Red glowing horns + behind-the-head crimson glow.
    // Layered red tones (dark → bright) form a halo of fire around horns.
    { row: 1, col: 5,  color: '#c02020' },
    { row: 1, col: 18, color: '#c02020' },
    { row: 2, col: 4,  color: '#a01010' },
    { row: 2, col: 5,  color: '#ff4040' },
    { row: 2, col: 18, color: '#ff4040' },
    { row: 2, col: 19, color: '#a01010' },
    { row: 3, col: 4,  color: '#c02020' },
    { row: 3, col: 19, color: '#c02020' },
    { row: 4, col: 3,  color: '#a01010' },
    { row: 4, col: 20, color: '#a01010' },
    // Deep red glow at top of head (between horns)
    { row: 7, col: 9,  color: '#c02020' },
    { row: 7, col: 14, color: '#c02020' },
    { row: 8, col: 11, color: '#ff4040' },
    { row: 8, col: 12, color: '#ff4040' },
  ],
  dubai_hat: [
    // Keffiyeh (ghutra) — sits ON the bull's head between the horns, with
    // the horns sticking up above/around it (horns remain visible, drawn
    // BEFORE this overlay so the hat doesn't paint over them on rows 0-3).
    //
    // Hat structure:
    //   Row 4: top of cloth (peaked between the horns at cols 4-6 / 17-19)
    //   Row 5: agal cord (iconic black twisted rope)
    //   Row 6: cloth band below cord
    //   Row 7-8: cloth wraps around top of head
    //   Row 9-13: side drapes outside the head silhouette
    //
    // Palette: cloth_dark #b8b2a8 / cloth #e8e4dc / cloth_light #ffffff
    //          agal #181818 / agal_light #3a3a3a (twisted-rope highlight)
    //
    // Row 4: cloth peak between horns (cols 7-16, leaving horn cells at 4-6/17-19 visible)
    { row: 4, col: 7,  color: '#b8b2a8' },
    { row: 4, col: 8,  color: '#e8e4dc' },
    { row: 4, col: 9,  color: '#ffffff' },
    { row: 4, col: 10, color: '#ffffff' },
    { row: 4, col: 11, color: '#ffffff' },
    { row: 4, col: 12, color: '#ffffff' },
    { row: 4, col: 13, color: '#ffffff' },
    { row: 4, col: 14, color: '#ffffff' },
    { row: 4, col: 15, color: '#e8e4dc' },
    { row: 4, col: 16, color: '#b8b2a8' },
    // Row 5: agal cord (cols 7-16 between the row-5 horns at cols 4-5 and 18-19)
    { row: 5, col: 7,  color: '#181818' },
    { row: 5, col: 8,  color: '#3a3a3a' },
    { row: 5, col: 9,  color: '#181818' },
    { row: 5, col: 10, color: '#3a3a3a' },
    { row: 5, col: 11, color: '#181818' },
    { row: 5, col: 12, color: '#3a3a3a' },
    { row: 5, col: 13, color: '#181818' },
    { row: 5, col: 14, color: '#3a3a3a' },
    { row: 5, col: 15, color: '#181818' },
    { row: 5, col: 16, color: '#3a3a3a' },
    // Row 6: cloth band — wider, wraps around horn at col 5 and col 18 (paints over them)
    { row: 6, col: 6,  color: '#b8b2a8' },
    { row: 6, col: 7,  color: '#ffffff' },
    { row: 6, col: 8,  color: '#e8e4dc' },
    { row: 6, col: 9,  color: '#ffffff' },
    { row: 6, col: 10, color: '#ffffff' },
    { row: 6, col: 11, color: '#e8e4dc' },
    { row: 6, col: 12, color: '#e8e4dc' },
    { row: 6, col: 13, color: '#ffffff' },
    { row: 6, col: 14, color: '#ffffff' },
    { row: 6, col: 15, color: '#e8e4dc' },
    { row: 6, col: 16, color: '#ffffff' },
    { row: 6, col: 17, color: '#b8b2a8' },
    // Row 7: cloth covers brow ridge / top of head (replaces the L highlight cells)
    { row: 7, col: 5,  color: '#b8b2a8' },
    { row: 7, col: 6,  color: '#ffffff' },
    { row: 7, col: 7,  color: '#e8e4dc' },
    { row: 7, col: 8,  color: '#ffffff' },
    { row: 7, col: 9,  color: '#e8e4dc' },
    { row: 7, col: 10, color: '#ffffff' },
    { row: 7, col: 11, color: '#ffffff' },
    { row: 7, col: 12, color: '#ffffff' },
    { row: 7, col: 13, color: '#ffffff' },
    { row: 7, col: 14, color: '#e8e4dc' },
    { row: 7, col: 15, color: '#ffffff' },
    { row: 7, col: 16, color: '#e8e4dc' },
    { row: 7, col: 17, color: '#ffffff' },
    { row: 7, col: 18, color: '#b8b2a8' },
    // Row 8: cloth tapering — only side fringe (forehead detail visible at center)
    { row: 8, col: 4,  color: '#b8b2a8' },
    { row: 8, col: 5,  color: '#e8e4dc' },
    { row: 8, col: 18, color: '#e8e4dc' },
    { row: 8, col: 19, color: '#b8b2a8' },
    // Side drapes (cols outside the head, framing the face)
    { row: 9,  col: 3,  color: '#b8b2a8' },
    { row: 9,  col: 4,  color: '#e8e4dc' },
    { row: 9,  col: 19, color: '#e8e4dc' },
    { row: 9,  col: 20, color: '#b8b2a8' },
    { row: 10, col: 2,  color: '#b8b2a8' },
    { row: 10, col: 3,  color: '#e8e4dc' },
    { row: 10, col: 20, color: '#e8e4dc' },
    { row: 10, col: 21, color: '#b8b2a8' },
    { row: 11, col: 2,  color: '#b8b2a8' },
    { row: 11, col: 3,  color: '#e8e4dc' },
    { row: 11, col: 20, color: '#e8e4dc' },
    { row: 11, col: 21, color: '#b8b2a8' },
    { row: 12, col: 2,  color: '#b8b2a8' },
    { row: 12, col: 3,  color: '#e8e4dc' },
    { row: 12, col: 20, color: '#e8e4dc' },
    { row: 12, col: 21, color: '#b8b2a8' },
    { row: 13, col: 3,  color: '#b8b2a8' },
    { row: 13, col: 20, color: '#b8b2a8' },
  ],
  diamond_aura: [
    // Small round-brilliant cut diamond perfectly centered between the
    // horns. Max width 6 cells (cols 9-14), 5 rows tall. Closest cells
    // are at col 9 / col 14 — horns are at cols 4-6 / 17-19, leaving a
    // 3-cell gap on each side so the diamond never touches any horn.
    //
    // Shape (symmetric around col 11.5):
    //   row 1:    . . . T T T T . . .   table (4 cells, flat top)
    //   row 2:    . . T T T T T T . .   crown (6 cells)
    //   row 3:    . . T T T T T T . .   girdle widest (6 cells)
    //   row 4:    . . . T T T T . . .   pavilion narrows (4 cells)
    //   row 5:    . . . . T T . . . .   culet point (2 cells)
    //
    // Palette:
    //   outline #205070 / facet_dark #4080a0 / facet_mid #80d8ff
    //   facet_light #a8e8ff / shine #ffffff

    // === TABLE — flat top (row 1, cols 10-13) ===
    { row: 1, col: 10, color: '#205070' }, // outline corner
    { row: 1, col: 11, color: '#ffffff' }, // bright shine
    { row: 1, col: 12, color: '#a8e8ff' },
    { row: 1, col: 13, color: '#205070' }, // outline corner

    // === CROWN — sloping sides angle outward (row 2, cols 9-14) ===
    { row: 2, col: 9,  color: '#205070' },
    { row: 2, col: 10, color: '#a8e8ff' },
    { row: 2, col: 11, color: '#ffffff' },
    { row: 2, col: 12, color: '#80d8ff' },
    { row: 2, col: 13, color: '#4080a0' },
    { row: 2, col: 14, color: '#205070' },

    // === GIRDLE — widest part (row 3, cols 9-14) ===
    { row: 3, col: 9,  color: '#205070' },
    { row: 3, col: 10, color: '#80d8ff' },
    { row: 3, col: 11, color: '#80d8ff' },
    { row: 3, col: 12, color: '#4080a0' },
    { row: 3, col: 13, color: '#4080a0' },
    { row: 3, col: 14, color: '#205070' },

    // === PAVILION — tapers down (row 4, cols 10-13) ===
    { row: 4, col: 10, color: '#205070' },
    { row: 4, col: 11, color: '#4080a0' },
    { row: 4, col: 12, color: '#4080a0' },
    { row: 4, col: 13, color: '#205070' },

    // === CULET — bottom point (row 5, cols 11-12) ===
    { row: 5, col: 11, color: '#205070' },
    { row: 5, col: 12, color: '#205070' },

    // === SPARKLES — small bright dots above the table (row 0) ===
    { row: 0, col: 11, color: '#ffffff' },
    { row: 0, col: 12, color: '#ffffff' },
  ],
  strawberry_hat: [
    // Milady-style strawberry hat. Centered on the head's midpoint (col 11.5).
    // Symmetric around cols 11-12, widest row spans cols 7-16 (10 cells).
    //
    // Green leaves on top (row 1)
    { row: 1, col: 10, color: '#186024' },
    { row: 1, col: 11, color: '#28a83c' },
    { row: 1, col: 12, color: '#28a83c' },
    { row: 1, col: 13, color: '#186024' },
    // Sepal connection (green peeking through)
    { row: 2, col: 11, color: '#28a83c' },
    { row: 2, col: 12, color: '#186024' },
    // Red dome top (row 2)
    { row: 2, col: 9,  color: '#a01010' },
    { row: 2, col: 10, color: '#d82020' },
    { row: 2, col: 13, color: '#d82020' },
    { row: 2, col: 14, color: '#a01010' },
    // Row 3 — upper red body
    { row: 3, col: 8,  color: '#a01010' },
    { row: 3, col: 9,  color: '#d82020' },
    { row: 3, col: 10, color: '#181818' }, // seed
    { row: 3, col: 11, color: '#ff4040' }, // highlight
    { row: 3, col: 12, color: '#d82020' },
    { row: 3, col: 13, color: '#181818' }, // seed
    { row: 3, col: 14, color: '#d82020' },
    { row: 3, col: 15, color: '#a01010' },
    // Row 4 — widest red body (cols 8-15, no extra side bumps)
    { row: 4, col: 8,  color: '#a01010' },
    { row: 4, col: 9,  color: '#181818' }, // seed
    { row: 4, col: 10, color: '#d82020' },
    { row: 4, col: 11, color: '#ff4040' },
    { row: 4, col: 12, color: '#d82020' },
    { row: 4, col: 13, color: '#181818' }, // seed
    { row: 4, col: 14, color: '#d82020' },
    { row: 4, col: 15, color: '#a01010' },
    // Row 5 — second wide row
    { row: 5, col: 8,  color: '#a01010' },
    { row: 5, col: 9,  color: '#d82020' },
    { row: 5, col: 10, color: '#d82020' },
    { row: 5, col: 11, color: '#181818' }, // seed
    { row: 5, col: 12, color: '#d82020' },
    { row: 5, col: 13, color: '#d82020' },
    { row: 5, col: 14, color: '#181818' }, // seed
    { row: 5, col: 15, color: '#a01010' },
    // Row 6 — taper
    { row: 6, col: 9,  color: '#a01010' },
    { row: 6, col: 10, color: '#d82020' },
    { row: 6, col: 11, color: '#d82020' },
    { row: 6, col: 12, color: '#d82020' },
    { row: 6, col: 13, color: '#d82020' },
    { row: 6, col: 14, color: '#a01010' },
    // Row 7 — pointed strawberry tip
    { row: 7, col: 11, color: '#a01010' },
    { row: 7, col: 12, color: '#a01010' },
  ],
  apple: [
    // Classic round apple sitting on top of the bull's head.
    // Silhouette is wider in the upper-middle and tapers to a small base —
    // the iconic apple shape, not just a circle.
    //
    // Layout features:
    //  - Brown stem (row 0) with a visible dimple in the apple top (row 1)
    //  - Green leaf curling right of the stem
    //  - Rounded "shoulders" on row 1 around the stem
    //  - Widest at rows 3-4 (8 cells)
    //  - Narrows on row 5 then small base on row 6
    //
    // Brown stem at the very top
    { row: 0, col: 11, color: '#5a3520' },
    // Green leaf curling right of stem
    { row: 0, col: 12, color: '#28a83c' },
    { row: 0, col: 13, color: '#186024' },
    // Row 1: rounded shoulders + stem dimple at center + leaf bottom
    { row: 1, col: 10, color: '#a01010' },        // left shoulder
    { row: 1, col: 11, color: '#5a3520' },        // stem dimple
    { row: 1, col: 12, color: '#a01010' },        // right shoulder
    { row: 1, col: 13, color: '#28a83c' },        // leaf bottom
    // Row 2 — apple top widens (cols 9-14, 6 cells)
    { row: 2, col: 9,  color: '#a01010' },
    { row: 2, col: 10, color: '#d82020' },
    { row: 2, col: 11, color: '#d82020' },
    { row: 2, col: 12, color: '#d82020' },
    { row: 2, col: 13, color: '#d82020' },
    { row: 2, col: 14, color: '#a01010' },
    // Row 3 — widest (cols 8-15, 8 cells) with shine glint
    { row: 3, col: 8,  color: '#a01010' },
    { row: 3, col: 9,  color: '#ff5050' }, // highlight glint
    { row: 3, col: 10, color: '#d82020' },
    { row: 3, col: 11, color: '#d82020' },
    { row: 3, col: 12, color: '#d82020' },
    { row: 3, col: 13, color: '#d82020' },
    { row: 3, col: 14, color: '#d82020' },
    { row: 3, col: 15, color: '#a01010' },
    // Row 4 — widest continues (sits on head's top curve)
    { row: 4, col: 8,  color: '#a01010' },
    { row: 4, col: 9,  color: '#d82020' },
    { row: 4, col: 10, color: '#d82020' },
    { row: 4, col: 11, color: '#d82020' },
    { row: 4, col: 12, color: '#d82020' },
    { row: 4, col: 13, color: '#d82020' },
    { row: 4, col: 14, color: '#d82020' },
    { row: 4, col: 15, color: '#a01010' },
    // Row 5 — narrows back in (cols 9-14, 6 cells)
    { row: 5, col: 9,  color: '#a01010' },
    { row: 5, col: 10, color: '#d82020' },
    { row: 5, col: 11, color: '#d82020' },
    { row: 5, col: 12, color: '#d82020' },
    { row: 5, col: 13, color: '#d82020' },
    { row: 5, col: 14, color: '#a01010' },
    // Row 6 — small base (cols 11-12) — apple's bottom dimple
    { row: 6, col: 11, color: '#a01010' },
    { row: 6, col: 12, color: '#a01010' },
  ],
  scar: [
    // Battle scar — diagonal slash across the right side of the face with
    // small stitched crossing lines. Goes from forehead down to mid-cheek.
    // Distinct from war_paint (which is multi-stroke red on the LEFT cheek).
    //
    // Palette: scar_main #c8a098 / scar_dark #6a4a44 / stitch #181818
    //
    // Diagonal slash line (stepping down-right)
    { row: 8,  col: 16, color: '#6a4a44' }, // top of scar (above brow)
    { row: 9,  col: 16, color: '#c8a098' },
    { row: 10, col: 17, color: '#c8a098' },
    { row: 11, col: 17, color: '#6a4a44' },
    { row: 12, col: 18, color: '#c8a098' },
    // Stitches crossing the scar (3 short marks)
    { row: 9,  col: 17, color: '#181818' },
    { row: 10, col: 16, color: '#181818' },
    { row: 11, col: 18, color: '#181818' },
  ],
  rosy_cheeks: [
    // Soft pink blush dots on both cheeks. Cute / wholesome bull mark.
    // Position: rows 11-12, cols 5-6 (left) and cols 17-18 (right).
    //
    // Palette: blush_main #ff90b0 / blush_shade #c86090
    //
    // Left cheek
    { row: 11, col: 5, color: '#ff90b0' },
    { row: 11, col: 6, color: '#ff90b0' },
    { row: 12, col: 5, color: '#c86090' },
    { row: 12, col: 6, color: '#c86090' },
    // Right cheek
    { row: 11, col: 17, color: '#ff90b0' },
    { row: 11, col: 18, color: '#ff90b0' },
    { row: 12, col: 17, color: '#c86090' },
    { row: 12, col: 18, color: '#c86090' },
  ],
  mole: [
    // Tiny mole on the left cheek — Punks-style face mark.
    // Single dark dot with a 1-pixel shadow below for definition.
    //
    // Palette: mole_dark #3a1810 / mole_shadow #1a0808
    //
    { row: 12, col: 7, color: '#3a1810' }, // mole dot (left cheek)
    { row: 13, col: 7, color: '#1a0808' }, // tiny shadow under it
  ],
  earring: [
    // Tiny gold hoop earring on the right side of the head (where the ear
    // would be on a real bull — bulls have ears at the side near the horn
    // base). 3-cell hoop + bright glint pixel.
    //
    // Palette: gold #f0c850 / gold_shade #a07410 / gold_bright #ffe888
    //
    // Right-side earring (cols 17-18, rows 10-11) — sits just below
    // the right horn base, on the side of the head.
    { row: 10, col: 18, color: '#a07410' }, // top of hoop
    { row: 11, col: 17, color: '#f0c850' }, // hoop left
    { row: 11, col: 19, color: '#f0c850' }, // hoop right
    { row: 11, col: 18, color: '#ffe888' }, // bright center (the hole / shine)
    { row: 12, col: 18, color: '#a07410' }, // bottom of hoop
  ],
  halo_stars: [
    // Arc of 4-point stars above the head. Each star is a plus-shape (5
    // cells: center bright + 4 surrounding dim arms) — reads clearly as
    // a star at this resolution. 3 stars total in a curved arc.
    //
    // Palette: star_bright #ffe858 / star_arm #ffc020 / star_dim #a07410
    //
    // === LEFT STAR (cols 6-8 rows 1-3) ===
    { row: 1, col: 7,  color: '#ffc020' }, // top arm
    { row: 2, col: 6,  color: '#ffc020' }, // left arm
    { row: 2, col: 7,  color: '#ffe858' }, // bright center
    { row: 2, col: 8,  color: '#ffc020' }, // right arm
    { row: 3, col: 7,  color: '#ffc020' }, // bottom arm

    // === CENTER STAR (cols 10-12 rows 0-2) — biggest, peak of arc ===
    { row: 0, col: 11, color: '#ffc020' }, // top arm
    { row: 0, col: 12, color: '#ffc020' }, // top arm (extra cell for big center star)
    { row: 1, col: 10, color: '#ffc020' }, // left arm
    { row: 1, col: 11, color: '#ffffff' }, // hot center
    { row: 1, col: 12, color: '#ffe858' }, // bright center
    { row: 1, col: 13, color: '#ffc020' }, // right arm
    { row: 2, col: 11, color: '#ffc020' }, // bottom arm
    { row: 2, col: 12, color: '#ffc020' },

    // === RIGHT STAR (cols 15-17 rows 1-3) ===
    { row: 1, col: 16, color: '#ffc020' }, // top arm
    { row: 2, col: 15, color: '#ffc020' }, // left arm
    { row: 2, col: 16, color: '#ffe858' }, // bright center
    { row: 2, col: 17, color: '#ffc020' }, // right arm
    { row: 3, col: 16, color: '#ffc020' }, // bottom arm
  ],
  tiara: [
    // CryptoPunks-style fitted tiara — gold center diamond/jewel at the
    // top, two thin gold chains running diagonally down and outward,
    // ending in small blue jewel drops on either side of the head.
    // Compact and fitted to the bull's head silhouette (no peaks/spires).
    //
    // Palette: gold_main #f0c850 / gold_bright #ffe888
    //          drop_blue #2860ff / drop_blue_dark #1838c8

    // === CENTER DIAMOND (rows 2-4, cols 11-13) — 5-cell ◇ shape ===
    { row: 2, col: 12, color: '#ffe888' }, // top point (brightest)
    { row: 3, col: 11, color: '#f0c850' }, // left point
    { row: 3, col: 12, color: '#ffe888' }, // center shine
    { row: 3, col: 13, color: '#f0c850' }, // right point
    { row: 4, col: 12, color: '#f0c850' }, // bottom point

    // === DIAGONAL CHAINS — gold lines going outward from diamond ===
    // Left chain (down-left from diamond's left point at row 3 col 11)
    { row: 4, col: 10, color: '#f0c850' },
    { row: 5, col: 9,  color: '#f0c850' },
    // Right chain (down-right from diamond's right point at row 3 col 13)
    { row: 4, col: 14, color: '#f0c850' },
    { row: 5, col: 15, color: '#f0c850' },

    // === BLUE JEWEL DROPS — 2-cell dangles hanging from chain ends ===
    // Left drop (rows 6-7 col 9)
    { row: 6, col: 9,  color: '#2860ff' },
    { row: 7, col: 9,  color: '#1838c8' }, // darker shade at drop bottom
    // Right drop (rows 6-7 col 15)
    { row: 6, col: 15, color: '#2860ff' },
    { row: 7, col: 15, color: '#1838c8' },
  ],
  sheriff_hat: [
    // Iconic black cowboy hat — TRUE cattleman silhouette with all the
    // recognizable features:
    //   - "Cattleman crease" crown: two peaks with a V-valley between them
    //   - Brown leather hatband with a silver sheriff star at center
    //   - Wide curved brim: outer edges curl UP (row 5), main plane spans
    //     full head width (row 6), front center dips DOWN (row 7) — this
    //     creates the classic "U" smile silhouette of a real cowboy hat
    //
    // Palette: crown_main #181818 / crown_shade #0a0a0a / crown_light #383838
    //          band_brown #2a1810 / star_silver #c8c8d0 / brim_edge #050505

    // ============================================================
    // CROWN — cattleman crease (two peaks + V valley)
    // ============================================================
    // Row 0 — two narrow peak tips
    { row: 0, col: 11, color: '#181818' }, // left peak tip
    { row: 0, col: 13, color: '#181818' }, // right peak tip
    // Row 1 — peaks widen, V valley at col 12 (darker)
    { row: 1, col: 10, color: '#0a0a0a' },
    { row: 1, col: 11, color: '#181818' },
    { row: 1, col: 12, color: '#0a0a0a' }, // V crease valley
    { row: 1, col: 13, color: '#181818' },
    { row: 1, col: 14, color: '#0a0a0a' },

    // ============================================================
    // CROWN BODY (rows 2-3) — with 5-POINT SHERIFF STAR centered
    // on col 12. The star is a 3-row × 3-col silhouette spanning
    // rows 2-4: top point on row 2, middle 3 cells on row 3, bottom
    // 2 legs on row 4 (poking through the hatband).
    // ============================================================
    // Row 2 — crown body + STAR TOP POINT at col 12
    { row: 2, col: 9,  color: '#0a0a0a' },
    { row: 2, col: 10, color: '#181818' },
    { row: 2, col: 11, color: '#181818' },
    { row: 2, col: 12, color: '#c8c8d0' }, // ★ STAR top point
    { row: 2, col: 13, color: '#181818' },
    { row: 2, col: 14, color: '#181818' },
    { row: 2, col: 15, color: '#0a0a0a' },
    // Row 3 — crown body + STAR MIDDLE ROW (cols 11-13)
    { row: 3, col: 9,  color: '#0a0a0a' },
    { row: 3, col: 10, color: '#181818' },
    { row: 3, col: 11, color: '#c8c8d0' }, // ★ STAR left point
    { row: 3, col: 12, color: '#ffffff' }, // ★ STAR center (brightest)
    { row: 3, col: 13, color: '#c8c8d0' }, // ★ STAR right point
    { row: 3, col: 14, color: '#181818' },
    { row: 3, col: 15, color: '#0a0a0a' },

    // ============================================================
    // HATBAND (row 4) — brown leather strap with the STAR's bottom
    // 2 legs at cols 11 and 13. The leather band fills the rest
    // (cols 9, 10, 12, 14, 15) including the gap between the legs.
    // ============================================================
    { row: 4, col: 9,  color: '#2a1810' },
    { row: 4, col: 10, color: '#2a1810' },
    { row: 4, col: 11, color: '#c8c8d0' }, // ★ STAR bottom-left leg
    { row: 4, col: 12, color: '#2a1810' }, // band gap between legs
    { row: 4, col: 13, color: '#c8c8d0' }, // ★ STAR bottom-right leg
    { row: 4, col: 14, color: '#2a1810' },
    { row: 4, col: 15, color: '#2a1810' },

    // ============================================================
    // BRIM ROW 5 — UPTURNED OUTER EDGES (curl-up sides)
    // Only the outer tips of the brim show at this row; the main plane
    // is below at row 6. This creates the iconic "smile" curve.
    // ============================================================
    { row: 5, col: 4,  color: '#0a0a0a' },
    { row: 5, col: 5,  color: '#181818' },
    { row: 5, col: 6,  color: '#181818' },
    // (cols 7-16 stay empty — brim center dips below)
    { row: 5, col: 17, color: '#181818' },
    { row: 5, col: 18, color: '#181818' },
    { row: 5, col: 19, color: '#0a0a0a' },

    // ============================================================
    // BRIM ROW 6 — main plane spanning full head width (cols 3-20)
    // ============================================================
    { row: 6, col: 3,  color: '#050505' }, // brim outer edge left
    { row: 6, col: 4,  color: '#181818' },
    { row: 6, col: 5,  color: '#181818' },
    { row: 6, col: 6,  color: '#181818' },
    { row: 6, col: 7,  color: '#181818' },
    { row: 6, col: 8,  color: '#181818' },
    { row: 6, col: 9,  color: '#181818' },
    { row: 6, col: 10, color: '#181818' },
    { row: 6, col: 11, color: '#383838' }, // brim sheen highlight
    { row: 6, col: 12, color: '#181818' },
    { row: 6, col: 13, color: '#181818' },
    { row: 6, col: 14, color: '#181818' },
    { row: 6, col: 15, color: '#181818' },
    { row: 6, col: 16, color: '#181818' },
    { row: 6, col: 17, color: '#181818' },
    { row: 6, col: 18, color: '#181818' },
    { row: 6, col: 19, color: '#181818' },
    { row: 6, col: 20, color: '#050505' }, // brim outer edge right

    // ============================================================
    // BRIM ROW 7 — front-center dip (brim drapes lowest at front)
    // The center of the brim hangs lower than the upturned sides,
    // completing the "U" curve. Horns at cols 5 and 17 still show
    // through because the horn-on-top pass repaints them last.
    // ============================================================
    { row: 7, col: 7,  color: '#0a0a0a' },
    { row: 7, col: 8,  color: '#0a0a0a' },
    { row: 7, col: 9,  color: '#0a0a0a' },
    { row: 7, col: 10, color: '#0a0a0a' },
    { row: 7, col: 11, color: '#0a0a0a' },
    { row: 7, col: 12, color: '#0a0a0a' },
    { row: 7, col: 13, color: '#0a0a0a' },
    { row: 7, col: 14, color: '#0a0a0a' },
    { row: 7, col: 15, color: '#0a0a0a' },
    { row: 7, col: 16, color: '#0a0a0a' },
  ],
  top_hat: [
    // Tall black formal top hat — crown rises from rows 0-3, hatband at
    // row 4, and a STRAIGHT FITTED BRIM at row 5 extending evenly across
    // the top of the bull's head.
    //
    // Palette: black #181818 / shade #0a0a0a / band_gray #5a5a5a / band_dark #2a2a2a
    //
    // === CROWN (rows 0-3, cols 9-14, 6 cells wide) ===
    { row: 0, col: 9,  color: '#0a0a0a' },
    { row: 0, col: 10, color: '#181818' },
    { row: 0, col: 11, color: '#181818' },
    { row: 0, col: 12, color: '#181818' },
    { row: 0, col: 13, color: '#181818' },
    { row: 0, col: 14, color: '#0a0a0a' },
    { row: 1, col: 9,  color: '#0a0a0a' },
    { row: 1, col: 10, color: '#181818' },
    { row: 1, col: 11, color: '#181818' },
    { row: 1, col: 12, color: '#181818' },
    { row: 1, col: 13, color: '#181818' },
    { row: 1, col: 14, color: '#0a0a0a' },
    { row: 2, col: 9,  color: '#0a0a0a' },
    { row: 2, col: 10, color: '#181818' },
    { row: 2, col: 11, color: '#181818' },
    { row: 2, col: 12, color: '#181818' },
    { row: 2, col: 13, color: '#181818' },
    { row: 2, col: 14, color: '#0a0a0a' },
    { row: 3, col: 9,  color: '#0a0a0a' },
    { row: 3, col: 10, color: '#181818' },
    { row: 3, col: 11, color: '#181818' },
    { row: 3, col: 12, color: '#181818' },
    { row: 3, col: 13, color: '#181818' },
    { row: 3, col: 14, color: '#0a0a0a' },
    // === HATBAND (row 4) — gray stripe matching crown width ===
    { row: 4, col: 9,  color: '#2a2a2a' },
    { row: 4, col: 10, color: '#5a5a5a' },
    { row: 4, col: 11, color: '#5a5a5a' },
    { row: 4, col: 12, color: '#5a5a5a' },
    { row: 4, col: 13, color: '#5a5a5a' },
    { row: 4, col: 14, color: '#2a2a2a' },
    // === STRAIGHT BRIM (row 5) — single horizontal line, fitted to head ===
    // Extends 2 cells beyond crown on each side (cols 7-16, 10 cells)
    // Sits flat across the top of the head — no sagging corners or tiers.
    { row: 5, col: 7,  color: '#0a0a0a' },
    { row: 5, col: 8,  color: '#181818' },
    { row: 5, col: 9,  color: '#181818' },
    { row: 5, col: 10, color: '#181818' },
    { row: 5, col: 11, color: '#181818' },
    { row: 5, col: 12, color: '#181818' },
    { row: 5, col: 13, color: '#181818' },
    { row: 5, col: 14, color: '#181818' },
    { row: 5, col: 15, color: '#181818' },
    { row: 5, col: 16, color: '#0a0a0a' },
  ],
  mohawk: [
    // CryptoPunks-style fitted black mohawk — tall narrow fin running
    // straight up from the top of the bull's head. Sharp 1-cell tip,
    // 3-cell body, and a 5-cell base where it attaches to the head top.
    // Solid black color, symmetric around col 12.
    //
    // Shape:
    //         X       row 0 — tip (1 cell)
    //       X X X     rows 1-3 — fin body (3 cells)
    //       X X X
    //       X X X
    //     X X X X X   rows 4-5 — base (5 cells, attaches to head)
    //     X X X X X
    //
    // Palette: black #181818

    // === TIP (row 0, col 12) — sharp 1-cell point ===
    { row: 0, col: 12, color: '#181818' },

    // === BODY (rows 1-3, cols 11-13) — 3 cells wide ===
    { row: 1, col: 11, color: '#181818' },
    { row: 1, col: 12, color: '#181818' },
    { row: 1, col: 13, color: '#181818' },
    { row: 2, col: 11, color: '#181818' },
    { row: 2, col: 12, color: '#181818' },
    { row: 2, col: 13, color: '#181818' },
    { row: 3, col: 11, color: '#181818' },
    { row: 3, col: 12, color: '#181818' },
    { row: 3, col: 13, color: '#181818' },

    // === BASE (rows 4-5, cols 10-14) — 5 cells wide, attaches to head top ===
    { row: 4, col: 10, color: '#181818' },
    { row: 4, col: 11, color: '#181818' },
    { row: 4, col: 12, color: '#181818' },
    { row: 4, col: 13, color: '#181818' },
    { row: 4, col: 14, color: '#181818' },
    { row: 5, col: 10, color: '#181818' },
    { row: 5, col: 11, color: '#181818' },
    { row: 5, col: 12, color: '#181818' },
    { row: 5, col: 13, color: '#181818' },
    { row: 5, col: 14, color: '#181818' },
  ],
  headband: [
    // Sport-style headband: thin band across the brow with two color stripes.
    // 2 rows tall, cols 6-17 (between the horns). Horns visible on sides.
    //
    // Palette: white #ffffff / red_stripe #c81818 / blue_stripe #2870d0
    //
    // Top stripe row (row 6) — white with stripes
    { row: 6, col: 6,  color: '#c81818' },  // red edge
    { row: 6, col: 7,  color: '#ffffff' },
    { row: 6, col: 8,  color: '#ffffff' },
    { row: 6, col: 9,  color: '#c81818' },  // red stripe
    { row: 6, col: 10, color: '#ffffff' },
    { row: 6, col: 11, color: '#2870d0' },  // blue stripe
    { row: 6, col: 12, color: '#2870d0' },  // blue stripe
    { row: 6, col: 13, color: '#ffffff' },
    { row: 6, col: 14, color: '#c81818' },  // red stripe
    { row: 6, col: 15, color: '#ffffff' },
    { row: 6, col: 16, color: '#ffffff' },
    { row: 6, col: 17, color: '#c81818' },  // red edge
    // Bottom stripe row (row 7) — same pattern with shading
    { row: 7, col: 6,  color: '#8a1010' },  // shaded edge
    { row: 7, col: 7,  color: '#d8d8d8' },
    { row: 7, col: 8,  color: '#d8d8d8' },
    { row: 7, col: 9,  color: '#8a1010' },
    { row: 7, col: 10, color: '#d8d8d8' },
    { row: 7, col: 11, color: '#1a4890' },
    { row: 7, col: 12, color: '#1a4890' },
    { row: 7, col: 13, color: '#d8d8d8' },
    { row: 7, col: 14, color: '#8a1010' },
    { row: 7, col: 15, color: '#d8d8d8' },
    { row: 7, col: 16, color: '#d8d8d8' },
    { row: 7, col: 17, color: '#8a1010' },
  ],
  tinfoil: [
    // Metallic silver tinfoil head wrap — paranoid bull aesthetic.
    // Snug fit on the head with a single crinkled peak at the top
    // (offset right, suggesting the foil is bunched/folded). No hanging
    // tail — tinfoil holds its shape rigidly.
    //
    // Palette mimics polished foil:
    //   foil_dark   #6a6e74  (shadow / wrinkle creases)
    //   foil_main   #b8bcc4  (mid-tone metal)
    //   foil_light  #e8eaf0  (highlight)
    //   foil_glint  #ffffff  (specular reflection)

    // ============================================================
    // CRINKLED PEAK (rows 2-3) — single bunched bump, offset right
    // ============================================================
    { row: 2, col: 13, color: '#6a6e74' }, // shadow edge
    { row: 2, col: 14, color: '#e8eaf0' }, // bright crinkle highlight
    { row: 3, col: 12, color: '#b8bcc4' },
    { row: 3, col: 13, color: '#e8eaf0' },
    { row: 3, col: 14, color: '#b8bcc4' },
    { row: 3, col: 15, color: '#6a6e74' }, // shadow edge

    // ============================================================
    // BODY (rows 4-7) — snug fit to head silhouette
    // Specular highlights scattered for that crumpled-foil shimmer
    // ============================================================
    // Row 4 — cols 9-14 (matches head's narrowest top, 6 cells)
    { row: 4, col: 9,  color: '#6a6e74' },
    { row: 4, col: 10, color: '#b8bcc4' },
    { row: 4, col: 11, color: '#e8eaf0' }, // foil highlight
    { row: 4, col: 12, color: '#b8bcc4' },
    { row: 4, col: 13, color: '#b8bcc4' },
    { row: 4, col: 14, color: '#6a6e74' },
    // Row 5 — cols 8-15 (matches head, 8 cells)
    { row: 5, col: 8,  color: '#6a6e74' },
    { row: 5, col: 9,  color: '#b8bcc4' },
    { row: 5, col: 10, color: '#e8eaf0' },
    { row: 5, col: 11, color: '#ffffff' }, // bright specular glint
    { row: 5, col: 12, color: '#b8bcc4' },
    { row: 5, col: 13, color: '#b8bcc4' },
    { row: 5, col: 14, color: '#e8eaf0' },
    { row: 5, col: 15, color: '#6a6e74' },
    // Row 6 — cols 7-16 (matches head, 10 cells)
    { row: 6, col: 7,  color: '#6a6e74' },
    { row: 6, col: 8,  color: '#b8bcc4' },
    { row: 6, col: 9,  color: '#b8bcc4' },
    { row: 6, col: 10, color: '#e8eaf0' },
    { row: 6, col: 11, color: '#b8bcc4' },
    { row: 6, col: 12, color: '#b8bcc4' },
    { row: 6, col: 13, color: '#e8eaf0' },
    { row: 6, col: 14, color: '#b8bcc4' },
    { row: 6, col: 15, color: '#b8bcc4' },
    { row: 6, col: 16, color: '#6a6e74' },
    // Row 7 — cols 7-16 (bottom edge, snug fit above eyes)
    { row: 7, col: 7,  color: '#6a6e74' },
    { row: 7, col: 8,  color: '#b8bcc4' },
    { row: 7, col: 9,  color: '#b8bcc4' },
    { row: 7, col: 10, color: '#b8bcc4' },
    { row: 7, col: 11, color: '#b8bcc4' },
    { row: 7, col: 12, color: '#b8bcc4' },
    { row: 7, col: 13, color: '#b8bcc4' },
    { row: 7, col: 14, color: '#b8bcc4' },
    { row: 7, col: 15, color: '#b8bcc4' },
    { row: 7, col: 16, color: '#6a6e74' },
  ],
  beanie: [
    // Compact fitted orange knit beanie — 5 rows total. Outline uses
    // deep burnt-orange (#8a3808) so the border blends with the beanie
    // color scheme instead of clashing as a black ring.
    //
    // Layout:
    //   Row 1 — top outline (cap dome edge)
    //   Rows 2-3 — cap body (narrower upper tier)
    //   Row 4 — knit band with horizontal dashes (wider lower tier)
    //   Row 5 — bottom outline (defines the brim line)
    //
    // Palette: knit_main #ff8020 / knit_shade #c05010 / outline #8a3808
    //
    // === TOP OUTLINE (row 1) ===
    { row: 1, col: 9,  color: '#8a3808' },
    { row: 1, col: 10, color: '#8a3808' },
    { row: 1, col: 11, color: '#8a3808' },
    { row: 1, col: 12, color: '#8a3808' },
    { row: 1, col: 13, color: '#8a3808' },
    { row: 1, col: 14, color: '#8a3808' },
    // === CAP BODY (rows 2-3) — solid orange with side outlines ===
    { row: 2, col: 8,  color: '#8a3808' },
    { row: 2, col: 9,  color: '#ff8020' },
    { row: 2, col: 10, color: '#ff8020' },
    { row: 2, col: 11, color: '#ff8020' },
    { row: 2, col: 12, color: '#ff8020' },
    { row: 2, col: 13, color: '#ff8020' },
    { row: 2, col: 14, color: '#ff8020' },
    { row: 2, col: 15, color: '#8a3808' },
    { row: 3, col: 8,  color: '#8a3808' },
    { row: 3, col: 9,  color: '#ff8020' },
    { row: 3, col: 10, color: '#ff8020' },
    { row: 3, col: 11, color: '#ff8020' },
    { row: 3, col: 12, color: '#ff8020' },
    { row: 3, col: 13, color: '#ff8020' },
    { row: 3, col: 14, color: '#ff8020' },
    { row: 3, col: 15, color: '#8a3808' },
    // === KNIT BAND (row 4) — wider, with horizontal knit dashes ===
    { row: 4, col: 7,  color: '#8a3808' }, // outline left
    { row: 4, col: 8,  color: '#c05010' }, // dash
    { row: 4, col: 9,  color: '#ff8020' },
    { row: 4, col: 10, color: '#c05010' }, // dash
    { row: 4, col: 11, color: '#ff8020' },
    { row: 4, col: 12, color: '#c05010' }, // dash
    { row: 4, col: 13, color: '#ff8020' },
    { row: 4, col: 14, color: '#c05010' }, // dash
    { row: 4, col: 15, color: '#ff8020' },
    { row: 4, col: 16, color: '#8a3808' }, // outline right
    // === BOTTOM OUTLINE (row 5) — defines the brim line ===
    { row: 5, col: 7,  color: '#8a3808' },
    { row: 5, col: 8,  color: '#8a3808' },
    { row: 5, col: 9,  color: '#8a3808' },
    { row: 5, col: 10, color: '#8a3808' },
    { row: 5, col: 11, color: '#8a3808' },
    { row: 5, col: 12, color: '#8a3808' },
    { row: 5, col: 13, color: '#8a3808' },
    { row: 5, col: 14, color: '#8a3808' },
    { row: 5, col: 15, color: '#8a3808' },
    { row: 5, col: 16, color: '#8a3808' },
  ],
  fire_aura: [
    // Distinctly flame-shaped fire crown:
    //   - 3 separate flame tongues at the top with NEGATIVE SPACE between them
    //   - Tongues taper to single-cell tips at the very top
    //   - Tongues merge into a wider yellow base
    //   - Narrowed to cols 8-15 (NO overlap with horns at cols 4-6 / 17-19)
    //   - Floating spark on the right side
    //
    // Palette:
    //   deep_red #c02020 / red #ff5028 / orange #ff8020 / amber #ffc020
    //   yellow #ffe858 / white_hot #ffffff
    //
    // === ROW 0: three single-cell tongue tips, well separated ===
    { row: 0, col: 9,  color: '#ff5028' },  // left tongue tip
    { row: 0, col: 12, color: '#ffe858' },  // tallest center tongue tip
    { row: 0, col: 14, color: '#ff5028' },  // right tongue tip

    // === ROW 1: tongues continue, gaps preserved + 1 ember spark ===
    { row: 1, col: 9,  color: '#ff8020' },  // left tongue
    // (col 10 GAP — negative space between left and center tongue)
    { row: 1, col: 11, color: '#ff8020' },  // center tongue left edge
    { row: 1, col: 12, color: '#ffffff' },  // white-hot core
    { row: 1, col: 13, color: '#ff8020' },  // center tongue right edge
    // (cols 14 GAP — negative space)
    { row: 1, col: 14, color: '#c02020' },
    { row: 1, col: 16, color: '#ff5028' },  // floating spark on right

    // === ROW 2: tongues spread, valleys between them visible ===
    { row: 2, col: 8,  color: '#c02020' },
    { row: 2, col: 9,  color: '#ff5028' },
    { row: 2, col: 10, color: '#ff8020' },
    // (col 10.5 valley — but using col 10 dim orange)
    { row: 2, col: 11, color: '#ffc020' },
    { row: 2, col: 12, color: '#ffe858' },
    { row: 2, col: 13, color: '#ffc020' },
    { row: 2, col: 14, color: '#ff8020' },
    { row: 2, col: 15, color: '#ff5028' },

    // === ROW 3: tongues merging, yellow heart visible ===
    { row: 3, col: 8,  color: '#c02020' },
    { row: 3, col: 9,  color: '#ff8020' },
    { row: 3, col: 10, color: '#ffc020' },
    { row: 3, col: 11, color: '#ffe858' },
    { row: 3, col: 12, color: '#ffe858' },
    { row: 3, col: 13, color: '#ffe858' },
    { row: 3, col: 14, color: '#ffc020' },
    { row: 3, col: 15, color: '#c02020' },

    // === ROW 4: WIDEST base, yellow dominant inside, tight red outline ===
    { row: 4, col: 8,  color: '#ff5028' },
    { row: 4, col: 9,  color: '#ffc020' },
    { row: 4, col: 10, color: '#ffe858' },
    { row: 4, col: 11, color: '#ffffff' },  // hot core
    { row: 4, col: 12, color: '#ffe858' },
    { row: 4, col: 13, color: '#ffe858' },
    { row: 4, col: 14, color: '#ffc020' },
    { row: 4, col: 15, color: '#ff5028' },

    // === ROW 5: base narrows toward the head ===
    { row: 5, col: 9,  color: '#ff5028' },
    { row: 5, col: 10, color: '#ff8020' },
    { row: 5, col: 11, color: '#ffe858' },
    { row: 5, col: 12, color: '#ffc020' },
    { row: 5, col: 13, color: '#ff5028' },
  ],
  pump: [
    // "Pump" — horizontal capsule pill floating above the head, centered
    // between the horn tips. Named for the pump.fun origin. 6 cells wide x
    // 4 rows tall (rows 0-3, cols 9-14). Cols 9 and 14 in rows 0/3 stay
    // empty so the caps read as rounded.
    //
    // Left half green, right half white with a vertical seam at the col
    // 11/12 boundary. Subtle top-light / bottom-shadow gives a 3D feel.
    //
    // Palette: outline #1a3a2a / green_light #5ddb95 / green #4cd97a /
    //          green_dark #2ab85a / white_bright #ffffff / white #f0f0f0 /
    //          white_shade #d0d0d0

    // === ROW 0: top arc (outline only — caps at 9/14 empty for rounding) ===
    { row: 0, col: 10, color: '#1a3a2a' },
    { row: 0, col: 11, color: '#1a3a2a' },
    { row: 0, col: 12, color: '#1a3a2a' },
    { row: 0, col: 13, color: '#1a3a2a' },

    // === ROW 1: upper body (left cap + green half | white half + right cap) ===
    { row: 1, col: 9,  color: '#1a3a2a' }, // left cap
    { row: 1, col: 10, color: '#5ddb95' }, // green top-light highlight
    { row: 1, col: 11, color: '#4cd97a' }, // green main
    { row: 1, col: 12, color: '#ffffff' }, // white bright (top-right shine)
    { row: 1, col: 13, color: '#f0f0f0' }, // white main
    { row: 1, col: 14, color: '#1a3a2a' }, // right cap

    // === ROW 2: lower body (slightly darker for cylindrical 3D feel) ===
    { row: 2, col: 9,  color: '#1a3a2a' }, // left cap
    { row: 2, col: 10, color: '#4cd97a' }, // green main
    { row: 2, col: 11, color: '#2ab85a' }, // green bottom-shadow
    { row: 2, col: 12, color: '#f0f0f0' }, // white main
    { row: 2, col: 13, color: '#d0d0d0' }, // white bottom-shadow
    { row: 2, col: 14, color: '#1a3a2a' }, // right cap

    // === ROW 3: bottom arc (outline only — caps at 9/14 empty for rounding) ===
    { row: 3, col: 10, color: '#1a3a2a' },
    { row: 3, col: 11, color: '#1a3a2a' },
    { row: 3, col: 12, color: '#1a3a2a' },
    { row: 3, col: 13, color: '#1a3a2a' },
  ],
  phantom: [
    // "Phantom" — sheet ghost shaped to match the Phantom wallet logo. 8
    // wide x 5 tall at LAYOUT rows 1-5, cols 8-15. Allowed to overlap the
    // bull's forehead (rows 4-5 head cells at cols 8-15) — the ghost
    // visually "sits on" the head, which matches the reference's tilted
    // floating-over feel. Stays well clear of the bull's eyes (rows 9-10),
    // mouth (rows 12-17), and horns (cols 5-6 / 17-18). No inter-trait
    // interference.
    //
    // Shape (mirrors the Phantom logo):
    //   . W W W W W . .       row 1: top dome (cols 9-13)
    //   W W W W W W W .       row 2: widens (cols 8-14) — covers ABOVE both eyes
    //   W W W W E W E W       row 3: eyes at cols 12 & 14 (upper-right)
    //   W W W W W W W W       row 4: widest body (cols 8-15)
    //   W . W W . W W .       row 5: scalloped tail, 3 humps + right curl
    //
    // Row 1-2 must extend to col 14 so the right eye at col 14 row 3 has
    // body cells directly above it — otherwise the eye looks cut off at
    // the top of the ghost.
    //
    // Palette: ghost_body #ffffff / ghost_eye #181818

    // === ROW 1: top dome (5 cells, cols 9-13) ===
    { row: 1, col: 9,  color: '#ffffff' },
    { row: 1, col: 10, color: '#ffffff' },
    { row: 1, col: 11, color: '#ffffff' },
    { row: 1, col: 12, color: '#ffffff' },
    { row: 1, col: 13, color: '#ffffff' },

    // === ROW 2: widening (cols 8-14) — covers above both eyes ===
    { row: 2, col: 8,  color: '#ffffff' },
    { row: 2, col: 9,  color: '#ffffff' },
    { row: 2, col: 10, color: '#ffffff' },
    { row: 2, col: 11, color: '#ffffff' },
    { row: 2, col: 12, color: '#ffffff' },
    { row: 2, col: 13, color: '#ffffff' },
    { row: 2, col: 14, color: '#ffffff' },

    // === ROW 3: eye row — eyes at cols 12 & 14, body wraps around them ===
    { row: 3, col: 8,  color: '#ffffff' },
    { row: 3, col: 9,  color: '#ffffff' },
    { row: 3, col: 10, color: '#ffffff' },
    { row: 3, col: 11, color: '#ffffff' },
    { row: 3, col: 12, color: '#181818' }, // left eye (centered on the right-ish side)
    { row: 3, col: 13, color: '#ffffff' },
    { row: 3, col: 14, color: '#181818' }, // right eye
    { row: 3, col: 15, color: '#ffffff' }, // body cell to right of right eye

    // === ROW 4: widest body (cols 8-15) — full 8 cells ===
    { row: 4, col: 8,  color: '#ffffff' },
    { row: 4, col: 9,  color: '#ffffff' },
    { row: 4, col: 10, color: '#ffffff' },
    { row: 4, col: 11, color: '#ffffff' },
    { row: 4, col: 12, color: '#ffffff' },
    { row: 4, col: 13, color: '#ffffff' },
    { row: 4, col: 14, color: '#ffffff' },
    { row: 4, col: 15, color: '#ffffff' },

    // === ROW 5: scalloped tail — 3 humps with gaps (cols 8, 10-11, 13-14) ===
    { row: 5, col: 8,  color: '#ffffff' }, // left foot
    { row: 5, col: 10, color: '#ffffff' }, // center hump left
    { row: 5, col: 11, color: '#ffffff' }, // center hump right
    { row: 5, col: 13, color: '#ffffff' }, // right hump left
    { row: 5, col: 14, color: '#ffffff' }, // right hump right (the curl tip)
  ],
};

// Eyewear overlays.
// - Mog: wraparound visor with clear top/bottom frame, lens highlights,
//   and side temples that wrap to the head edge for that "1990s ski goggle" vibe.
// - Sunglasses classic: same wraparound shape, all-black lens.
// - Clout shades: small thin matte-black lenses sitting tight on the eyes,
//   no wrap. Remilio-style.
function buildEyewearOverlay(eyewearName) {
  if (eyewearName === 'none') return [];

  if (eyewearName === 'lasers') {
    // Laser eyes — bright red horizontal beams shooting outward from
    // white-hot eye cores. Lives in the EYEWEAR slot (not eye palette) so
    // it's mutually exclusive with glasses. Beams cover the eye area +
    // extend across the canvas.
    return [
      // === EYE CORES (sclera + white-hot pupils) — paint over default eyes ===
      { row: 9, col: 9,  color: '#ff4040' },
      { row: 9, col: 10, color: '#ff2020' },
      { row: 9, col: 13, color: '#ff2020' },
      { row: 9, col: 14, color: '#ff4040' },
      { row: 10, col: 9,  color: '#ffffff' }, // hot core
      { row: 10, col: 10, color: '#ff2020' },
      { row: 10, col: 13, color: '#ff2020' },
      { row: 10, col: 14, color: '#ffffff' }, // hot core

      // === LEFT BEAM ===
      { row: 10, col: 0,  color: '#ff6060' },
      { row: 10, col: 1,  color: '#ff4040' },
      { row: 10, col: 2,  color: '#ff2020' },
      { row: 10, col: 3,  color: '#ff0000' },
      { row: 10, col: 4,  color: '#ff0000' },
      { row: 10, col: 5,  color: '#ff0000' },
      { row: 10, col: 6,  color: '#ff0000' },
      { row: 10, col: 7,  color: '#ff0000' },
      { row: 10, col: 8,  color: '#ff2020' },

      // === RIGHT BEAM ===
      { row: 10, col: 15, color: '#ff2020' },
      { row: 10, col: 16, color: '#ff0000' },
      { row: 10, col: 17, color: '#ff0000' },
      { row: 10, col: 18, color: '#ff0000' },
      { row: 10, col: 19, color: '#ff0000' },
      { row: 10, col: 20, color: '#ff0000' },
      { row: 10, col: 21, color: '#ff2020' },
      { row: 10, col: 22, color: '#ff4040' },
      { row: 10, col: 23, color: '#ff6060' },

      // === GLOW HALO above + below beams (faint pink) ===
      { row: 9,  col: 4,  color: '#ffc0c0' },
      { row: 9,  col: 5,  color: '#ffa0a0' },
      { row: 9,  col: 6,  color: '#ff8080' },
      { row: 9,  col: 17, color: '#ff8080' },
      { row: 9,  col: 18, color: '#ffa0a0' },
      { row: 9,  col: 19, color: '#ffc0c0' },
      { row: 11, col: 4,  color: '#ffc0c0' },
      { row: 11, col: 5,  color: '#ffa0a0' },
      { row: 11, col: 6,  color: '#ff8080' },
      { row: 11, col: 17, color: '#ff8080' },
      { row: 11, col: 18, color: '#ffa0a0' },
      { row: 11, col: 19, color: '#ffc0c0' },
    ];
  }

  if (eyewearName === 'mog') {
    // Mog (Pit-Viper-style wraparound visor): single continuous wraparound
    // with a small bridge NOTCH at the bottom-center (where the nose goes),
    // not a full vertical bridge column. Yellow lens with a slight
    // curved/swept silhouette.
    //
    // Shape:
    //   Row 8: top frame (flat, full width cols 4-19)
    //   Row 9: continuous rainbow lens (cols 4-19, NO bridge break)
    //   Row 10: rainbow lens with bridge notch cutout at cols 11-12
    //   Row 11: bottom frame split by bridge cutout (cols 4-10, 13-19)
    //   Side temples: thick black stubs cols 3 and 20 at rows 9-10
    const f = '#181818'; // black frame
    const cells = [];

    // === TOP FRAME (row 8) — clean flat top, full width ===
    for (let c = 4; c <= 19; c++) cells.push({ row: 8, col: c, color: f });

    // === RAINBOW LENS GRADIENT (row 9) — single continuous surface ===
    const stripes = {
      4:  '#c81818',
      5:  '#ff2828',
      6:  '#ff5028',
      7:  '#ff8020',
      8:  '#ffb020',
      9:  '#ffe028',
      10: '#a8d028',
      11: '#5cc028',
      12: '#28b8a0',
      13: '#28a8c8',
      14: '#2880d8',
      15: '#4068d0',
      16: '#6050c8',
      17: '#8040c0',
      18: '#a830b0',
      19: '#c8288c',
    };
    for (let c = 4; c <= 19; c++) {
      cells.push({ row: 9, col: c, color: stripes[c] });
    }

    // === ROW 10: lens continues but with bridge NOTCH cutout at cols 11-12 ===
    for (let c = 4; c <= 10; c++) cells.push({ row: 10, col: c, color: stripes[c] });
    for (let c = 13; c <= 19; c++) cells.push({ row: 10, col: c, color: stripes[c] });
    // Bridge notch (cols 11-12) at row 10 — black, this is where the nose goes
    cells.push({ row: 10, col: 11, color: f });
    cells.push({ row: 10, col: 12, color: f });

    // === ROW 11: bottom frame split by the bridge notch ===
    for (let c = 4; c <= 10; c++) cells.push({ row: 11, col: c, color: f });
    for (let c = 13; c <= 19; c++) cells.push({ row: 11, col: c, color: f });

    // === SIDE TEMPLES (thick wraps at the head edges) ===
    cells.push({ row: 8, col: 3,  color: f });
    cells.push({ row: 8, col: 20, color: f });
    cells.push({ row: 9, col: 3,  color: f });
    cells.push({ row: 9, col: 20, color: f });
    cells.push({ row: 10, col: 3,  color: f });
    cells.push({ row: 10, col: 20, color: f });

    return cells;
  }

  if (eyewearName === 'big_shades') {
    // Oversized round-square sunglasses (CryptoPunks "Big Shades" style).
    // Two large lenses with REFLECTIVE/MIRRORED gray fill (not flat black),
    // thick black frames, and a clear skin-gap bridge between them.
    //
    // Palette: frame #181818 / lens_dark #383838 / lens_mid #585858
    //          lens_shine #a0a0a0 / lens_glint #ffffff
    const f = '#181818'; // outer frame (matte black)
    return [
      // === LEFT LENS (cols 7-10, rows 8-11) — 4x4 with rounded corners ===
      // Top frame (rounded — middle 2 cells)
      { row: 8, col: 8, color: f },
      { row: 8, col: 9, color: f },
      // Upper lens row
      { row: 9, col: 7,  color: f },
      { row: 9, col: 8,  color: '#ffffff' }, // bright shine glint
      { row: 9, col: 9,  color: '#a0a0a0' }, // shine
      { row: 9, col: 10, color: f },
      // Lower lens row
      { row: 10, col: 7,  color: f },
      { row: 10, col: 8,  color: '#585858' },
      { row: 10, col: 9,  color: '#383838' },
      { row: 10, col: 10, color: f },
      // Bottom frame
      { row: 11, col: 8, color: f },
      { row: 11, col: 9, color: f },

      // === BRIDGE — thin 1-cell connector at row 9 (skin shows above/below) ===
      { row: 9, col: 11, color: f },
      { row: 9, col: 12, color: f },

      // === RIGHT LENS (cols 13-16, rows 8-11) — 4x4 mirror of left ===
      { row: 8, col: 14, color: f },
      { row: 8, col: 15, color: f },
      { row: 9, col: 13, color: f },
      { row: 9, col: 14, color: '#ffffff' }, // shine glint
      { row: 9, col: 15, color: '#a0a0a0' },
      { row: 9, col: 16, color: f },
      { row: 10, col: 13, color: f },
      { row: 10, col: 14, color: '#585858' },
      { row: 10, col: 15, color: '#383838' },
      { row: 10, col: 16, color: f },
      { row: 11, col: 14, color: f },
      { row: 11, col: 15, color: f },

      // Side temple stubs (extending out one cell)
      { row: 9,  col: 6,  color: f },
      { row: 9,  col: 17, color: f },
    ];
  }

  if (eyewearName === 'thug_life') {
    // Clean "deal with it" pixel-art glasses — single bar with bridge gap.
    // No outer wings, no stair-step extensions. Just two rectangular lenses
    // joined by a top frame, with white reflection dots.
    const f = '#0a0a0a'; // pure black
    const w = '#ffffff'; // white reflection
    const cells = [];

    // === Row 8: TOP EDGE (flat across both lenses) ===
    for (let c = 4; c <= 19; c++) cells.push({ row: 8, col: c, color: f });

    // === Row 9: LENS UPPER (bridge gap at cols 11-12) ===
    for (let c = 4; c <= 10; c++) cells.push({ row: 9, col: c, color: f });
    for (let c = 13; c <= 19; c++) cells.push({ row: 9, col: c, color: f });
    // White reflection glints (top-left of each lens)
    cells.push({ row: 9, col: 5,  color: w });
    cells.push({ row: 9, col: 14, color: w });

    // === Row 10: LENS LOWER (same width, no outer extensions) ===
    for (let c = 4; c <= 10; c++) cells.push({ row: 10, col: c, color: f });
    for (let c = 13; c <= 19; c++) cells.push({ row: 10, col: c, color: f });
    // Continued reflection (offset for shimmer)
    cells.push({ row: 10, col: 6,  color: w });
    cells.push({ row: 10, col: 15, color: w });

    return cells;
  }

  if (eyewearName === '3d_glasses') {
    // CryptoPunks-style 3D glasses (zombie reference) — square BLUE
    // LEFT lens, RED RIGHT lens, surrounded by a thick WHITE FRAME with
    // a FULL-HEIGHT WHITE BRIDGE between the two lenses. The bridge
    // covers rows 9-10 cols 11-12 (no nose gap — the bridge is solid
    // white in the middle, exactly per reference).
    //
    // Palette: frame #ffffff / blue #2860ff / red #e82020
    const fr = '#ffffff';
    const bl = '#2860ff';
    const rl = '#e82020';
    return [
      // === TOP FRAME (row 8) — white bar across both lenses ===
      { row: 8, col: 8,  color: fr },
      { row: 8, col: 9,  color: fr },
      { row: 8, col: 10, color: fr },
      { row: 8, col: 11, color: fr },
      { row: 8, col: 12, color: fr },
      { row: 8, col: 13, color: fr },
      { row: 8, col: 14, color: fr },
      { row: 8, col: 15, color: fr },
      // === LENS ROW 1 (row 9) — outer frame + blue lens + WHITE BRIDGE + red lens + outer frame ===
      { row: 9, col: 8,  color: fr },  // outer frame left
      { row: 9, col: 9,  color: bl },  // blue lens
      { row: 9, col: 10, color: bl },
      { row: 9, col: 11, color: fr },  // white bridge (solid)
      { row: 9, col: 12, color: fr },  // white bridge (solid)
      { row: 9, col: 13, color: rl },  // red lens
      { row: 9, col: 14, color: rl },
      { row: 9, col: 15, color: fr },  // outer frame right
      // === LENS ROW 2 (row 10) — same pattern as row 9 ===
      { row: 10, col: 8,  color: fr },
      { row: 10, col: 9,  color: bl },
      { row: 10, col: 10, color: bl },
      { row: 10, col: 11, color: fr },  // white bridge continues
      { row: 10, col: 12, color: fr },  // white bridge continues
      { row: 10, col: 13, color: rl },
      { row: 10, col: 14, color: rl },
      { row: 10, col: 15, color: fr },
      // === BOTTOM FRAME (row 11) — white bar across both lenses ===
      { row: 11, col: 8,  color: fr },
      { row: 11, col: 9,  color: fr },
      { row: 11, col: 10, color: fr },
      { row: 11, col: 11, color: fr },
      { row: 11, col: 12, color: fr },
      { row: 11, col: 13, color: fr },
      { row: 11, col: 14, color: fr },
      { row: 11, col: 15, color: fr },
      // === ARMS — temples extending out to head edges (cols 4, 19) ===
      { row: 9, col: 7,  color: fr },
      { row: 9, col: 6,  color: fr },
      { row: 9, col: 5,  color: fr },
      { row: 9, col: 4,  color: fr },
      { row: 9, col: 16, color: fr },
      { row: 9, col: 17, color: fr },
      { row: 9, col: 18, color: fr },
      { row: 9, col: 19, color: fr },
    ];
  }

  if (eyewearName === 'swag') {
    // Pudgy-Penguins-style swag glasses with WINGTIP shape:
    //   - Outer corners RISE UP (wingtip peaks at row 7)
    //   - Top frame extends full width at row 8
    //   - Two diagonal white reflection slashes per lens
    //   - Bottom narrower than top (curves toward face)
    //   - Continuous bar (no bridge break)
    //
    // Palette: frame #0a0a0a / lens #181818 / reflect #ffffff
    const f = '#0a0a0a';   // outer frame (deepest black)
    const l = '#181818';   // lens fill (slightly lighter than frame)
    const w = '#ffffff';   // white reflection slash
    return [
      // === ROW 7: WINGTIP PEAKS (outer corners only) ===
      { row: 7, col: 4,  color: f }, // left wingtip outer
      { row: 7, col: 5,  color: f },
      { row: 7, col: 18, color: f }, // right wingtip outer
      { row: 7, col: 19, color: f },

      // === ROW 8: TOP FRAME (full width) ===
      { row: 8, col: 4,  color: f },
      { row: 8, col: 5,  color: f },
      { row: 8, col: 6,  color: f },
      { row: 8, col: 7,  color: f },
      { row: 8, col: 8,  color: f },
      { row: 8, col: 9,  color: f },
      { row: 8, col: 10, color: f },
      { row: 8, col: 11, color: f },
      { row: 8, col: 12, color: f },
      { row: 8, col: 13, color: f },
      { row: 8, col: 14, color: f },
      { row: 8, col: 15, color: f },
      { row: 8, col: 16, color: f },
      { row: 8, col: 17, color: f },
      { row: 8, col: 18, color: f },
      { row: 8, col: 19, color: f },

      // === ROW 9: LENS UPPER with white reflections ===
      { row: 9, col: 4,  color: f },
      { row: 9, col: 5,  color: l },
      { row: 9, col: 6,  color: w }, // left lens reflection slash 1 (top)
      { row: 9, col: 7,  color: w },
      { row: 9, col: 8,  color: l },
      { row: 9, col: 9,  color: w }, // left lens reflection slash 2 (top, smaller)
      { row: 9, col: 10, color: l },
      { row: 9, col: 11, color: l }, // bridge area (continuous lens, slight notch)
      { row: 9, col: 12, color: l },
      { row: 9, col: 13, color: w }, // right lens reflection slash 2 (top, smaller)
      { row: 9, col: 14, color: l },
      { row: 9, col: 15, color: w }, // right lens reflection slash 1 (top)
      { row: 9, col: 16, color: w },
      { row: 9, col: 17, color: l },
      { row: 9, col: 18, color: f },
      { row: 9, col: 19, color: f },

      // === ROW 10: LENS LOWER with reflections shifted 1 col (diagonal) ===
      { row: 10, col: 4,  color: f },
      { row: 10, col: 5,  color: l },
      { row: 10, col: 6,  color: l },
      { row: 10, col: 7,  color: w }, // slash 1 continues (diagonal)
      { row: 10, col: 8,  color: w },
      { row: 10, col: 9,  color: l },
      { row: 10, col: 10, color: w }, // slash 2 continues
      { row: 10, col: 11, color: l },
      { row: 10, col: 12, color: l }, // bridge dip
      { row: 10, col: 13, color: l },
      { row: 10, col: 14, color: w }, // slash 2 continues (right)
      { row: 10, col: 15, color: l },
      { row: 10, col: 16, color: w }, // slash 1 continues (right)
      { row: 10, col: 17, color: w },
      { row: 10, col: 18, color: l },
      { row: 10, col: 19, color: f },

      // === ROW 11: BOTTOM FRAME (narrower than top, curves toward face) ===
      { row: 11, col: 6,  color: f },
      { row: 11, col: 7,  color: f },
      { row: 11, col: 8,  color: f },
      { row: 11, col: 9,  color: f },
      { row: 11, col: 10, color: f },
      { row: 11, col: 13, color: f },
      { row: 11, col: 14, color: f },
      { row: 11, col: 15, color: f },
      { row: 11, col: 16, color: f },
      { row: 11, col: 17, color: f },
    ];
  }

  if (eyewearName === 'clout_shades') {
    // Round clout shades — two oval lenses with a SMALL rounded bridge
    // (only 2 cells at the top center, leaving room for the nose below)
    // and SHORT arms that stop at the bull's head edge instead of floating
    // outside the silhouette.
    //
    // Each lens is 5 cells wide × 4 cells tall with rounded top/bottom
    // corners (the outer corner cells are transparent, leaving a clean
    // oval silhouette). Bridge sits high so the bull's snout shows through.
    //
    // Palette: frame #ffffff (pure white) / lens #050505 (pitch black)
    const w = '#ffffff';
    const l = '#050505';
    return [
      // ============================================================
      // LEFT LENS (rows 8-11, cols 7-11) — oval shape, 5 wide × 4 tall
      // Lens FILL (cols 8-10 rows 9-10) covers the bull's left eye
      // entirely (eye at cols 9-10 rows 9-10).
      // ============================================================
      // Top edge (rounded — only middle 3 cells)
      { row: 8, col: 8,  color: w },
      { row: 8, col: 9,  color: w },
      { row: 8, col: 10, color: w },
      // Lens row 1 — outer frame + 3 lens fill cells + inner frame
      { row: 9, col: 7,  color: w },     // outer frame
      { row: 9, col: 8,  color: l },
      { row: 9, col: 9,  color: l },
      { row: 9, col: 10, color: l },
      { row: 9, col: 11, color: w },     // inner frame (touches right lens)
      // Lens row 2
      { row: 10, col: 7,  color: w },
      { row: 10, col: 8,  color: l },
      { row: 10, col: 9,  color: l },
      { row: 10, col: 10, color: l },
      { row: 10, col: 11, color: w },
      // Bottom edge (rounded)
      { row: 11, col: 8,  color: w },
      { row: 11, col: 9,  color: w },
      { row: 11, col: 10, color: w },

      // ============================================================
      // RIGHT LENS (rows 8-11, cols 12-16) — mirror of left
      // Lens FILL (cols 13-15 rows 9-10) covers the bull's right eye
      // entirely (eye at cols 13-14 rows 9-10).
      // The inner frames of the two lenses meet naturally at cols
      // 11-12 rows 9-10 — no extra bridge bar needed.
      // ============================================================
      // Top edge (rounded)
      { row: 8, col: 13, color: w },
      { row: 8, col: 14, color: w },
      { row: 8, col: 15, color: w },
      // Lens row 1
      { row: 9, col: 12, color: w },     // inner frame (touches left lens)
      { row: 9, col: 13, color: l },
      { row: 9, col: 14, color: l },
      { row: 9, col: 15, color: l },
      { row: 9, col: 16, color: w },     // outer frame
      // Lens row 2
      { row: 10, col: 12, color: w },
      { row: 10, col: 13, color: l },
      { row: 10, col: 14, color: l },
      { row: 10, col: 15, color: l },
      { row: 10, col: 16, color: w },
      // Bottom edge (rounded)
      { row: 11, col: 13, color: w },
      { row: 11, col: 14, color: w },
      { row: 11, col: 15, color: w },

      // ============================================================
      // ARMS — temples extending out from outer frames to head edges
      // (head row 9 extends from col 4 to col 19)
      // ============================================================
      { row: 9, col: 6,  color: w }, // connect to left lens at col 7
      { row: 9, col: 5,  color: w },
      { row: 9, col: 4,  color: w }, // stops AT head edge
      { row: 9, col: 17, color: w }, // connect to right lens at col 16
      { row: 9, col: 18, color: w },
      { row: 9, col: 19, color: w }, // stops AT head edge
    ];
  }

  // Classic black sunglasses: solid black wraparound visor.
  const colors = MOG_LENS[eyewearName];
  if (!colors) return [];
  const cells = [];

  // Top frame
  for (let c = 7; c <= 16; c++) cells.push({ row: 8, col: c, color: colors.frame });
  // Lens fill (rows 9-10)
  for (let c = 7; c <= 16; c++) cells.push({ row: 9,  col: c, color: colors.lens });
  for (let c = 7; c <= 16; c++) cells.push({ row: 10, col: c, color: colors.lens });
  // Bridge
  cells.push({ row: 9,  col: 11, color: colors.frame });
  cells.push({ row: 9,  col: 12, color: colors.frame });
  cells.push({ row: 10, col: 11, color: colors.frame });
  cells.push({ row: 10, col: 12, color: colors.frame });
  // Highlight glint on each lens
  cells.push({ row: 9, col: 8,  color: colors.highlight });
  cells.push({ row: 9, col: 13, color: colors.highlight });
  // Bottom frame
  for (let c = 7; c <= 16; c++) cells.push({ row: 11, col: c, color: colors.frame });
  // Arms — temples extending OUT past the lens edges across the head sides
  // (left cols 4-6, right cols 17-19) — reads as proper glasses arms,
  // stops at the head edge (cols 4 and 19 at row 9).
  cells.push({ row: 9,  col: 6,  color: colors.frame });
  cells.push({ row: 9,  col: 5,  color: colors.frame });
  cells.push({ row: 9,  col: 4,  color: colors.frame });
  cells.push({ row: 9,  col: 17, color: colors.frame });
  cells.push({ row: 9,  col: 18, color: colors.frame });
  cells.push({ row: 9,  col: 19, color: colors.frame });
  cells.push({ row: 10, col: 6,  color: colors.frame });
  cells.push({ row: 10, col: 17, color: colors.frame });

  return cells;
}

// Mouth-piece overlays positioned around the snout/mouth area (rows 14-17).
// All use a consistent palette with high-contrast outlines so they read at
// thumbnail size.
function buildMouthOverlay(mouthName, body) {
  switch (mouthName) {
    case 'cigarette':
      // Classic cigarette: longer body so the ember and smoke are further
      // from the bull's face. Yellow filter at mouth side, white paper body
      // (3 cells), red ember at the tip, smoke trail rising up far right.
      //
      // Palette: filter_main #e8c060 / filter_dark #a07410
      //          paper #ffffff / paper_shade #f0f0f0
      //          ember #ff5020 / ember_dark #a02010 / smoke trail
      return [
        // Yellow filter (mouth side, 2 cells)
        { row: 16, col: 14, color: '#a07410' }, // filter wrap shadow
        { row: 16, col: 15, color: '#e8c060' }, // filter body
        // White paper body (3 cells, longer)
        { row: 16, col: 16, color: '#ffffff' },
        { row: 16, col: 17, color: '#f0f0f0' },
        { row: 16, col: 18, color: '#ffffff' },
        // Red ember tip
        { row: 16, col: 19, color: '#ff5020' },
        { row: 16, col: 20, color: '#a02010' },
        // Smoke trail rising up — starts AT the ember, drifts up and right.
        // Now well away from the face since the cigarette is longer.
        { row: 15, col: 20, color: '#ff8040' }, // ember glow above tip
        { row: 14, col: 20, color: '#c8c0b0' },
        { row: 13, col: 21, color: '#a8a0a0' },
        { row: 12, col: 21, color: '#888888' },
      ];
    case 'cigar':
      // Chunky brown cigar with prominent ember + smoke.
      return [
        { row: 16, col: 13, color: '#3a2010' }, // dark wrap (mouth side)
        { row: 16, col: 14, color: '#6a3a20' },
        { row: 16, col: 15, color: '#8a4a30' }, // body highlight
        { row: 16, col: 16, color: '#6a3a20' },
        { row: 16, col: 17, color: '#3a2010' }, // dark wrap (ember side)
        { row: 16, col: 18, color: '#ff5020' }, // ember
        { row: 16, col: 19, color: '#ffc020' }, // hot core
        // Wrap detail (band line above)
        { row: 15, col: 16, color: '#a07410' }, // gold band
        // Smoke
        { row: 15, col: 19, color: '#ff8040' },
        { row: 14, col: 19, color: '#c8c0b0' },
        { row: 13, col: 20, color: '#a8a0a0' },
        { row: 12, col: 20, color: '#888888' },
      ];
    case 'grill':
      // Solid bright gold grill — 4 cells of pure gold at row 16 cols
      // 10-13, exactly aligned with the bull's mouth. Clean, simple,
      // unmistakably gold.
      return [
        { row: 16, col: 10, color: '#f0c850' },
        { row: 16, col: 11, color: '#f0c850' },
        { row: 16, col: 12, color: '#f0c850' },
        { row: 16, col: 13, color: '#f0c850' },
      ];
    case 'smug':
      // Removed from collection (weight = 0). Inert no-op preserved for
      // backwards-compat with any tooling that references the index.
      return [];
    case 'smile':
      // Removed from collection (weight = 0). Inert no-op preserved for
      // backwards-compat with any tooling that references the index.
      return [];
    case 'pacifier':
      // Pudgy-Penguins-style baby pacifier — colored guard plate (blue) with
      // a central nipple (cream/tan) sticking out below. Cute baby bull.
      //
      // Palette: guard_main #2880d8 / guard_dark #1a4890 / guard_light #80c0ff
      //          nipple_main #f0d8b0 / nipple_dark #c8a070
      return [
        // Pacifier guard plate (rounded square covering mouth, rows 16-17)
        // Top edge of guard
        { row: 16, col: 9,  color: '#1a4890' },
        { row: 16, col: 10, color: '#2880d8' },
        { row: 16, col: 11, color: '#80c0ff' }, // shine highlight
        { row: 16, col: 12, color: '#2880d8' },
        { row: 16, col: 13, color: '#2880d8' },
        { row: 16, col: 14, color: '#1a4890' },
        // Middle of guard
        { row: 17, col: 9,  color: '#1a4890' },
        { row: 17, col: 10, color: '#2880d8' },
        { row: 17, col: 11, color: '#2880d8' },
        { row: 17, col: 12, color: '#2880d8' },
        { row: 17, col: 13, color: '#2880d8' },
        { row: 17, col: 14, color: '#1a4890' },
        // Nipple (cream colored, hanging below the guard)
        { row: 18, col: 11, color: '#c8a070' },
        { row: 18, col: 12, color: '#f0d8b0' },
      ];
    case 'open_shout':
      // Wide-open shouting mouth — clearly reads as an open mouth at
      // thumbnail size: top row of WHITE TEETH framed by dark lip
      // corners, with a dark mouth cavity below containing a PINK
      // TONGUE in the center.
      //
      // The default M mouth-line at row 16 cols 10-13 is overwritten
      // (no leftover dark line interfering with the teeth).
      //
      // Palette: cavity #0a0a0a / tooth #ffffff / tongue #d04060
      return [
        // === TOP ROW (row 16): teeth between dark lip corners ===
        { row: 16, col: 9,  color: '#0a0a0a' }, // left lip corner
        { row: 16, col: 10, color: '#ffffff' }, // tooth
        { row: 16, col: 11, color: '#ffffff' }, // tooth
        { row: 16, col: 12, color: '#ffffff' }, // tooth
        { row: 16, col: 13, color: '#ffffff' }, // tooth
        { row: 16, col: 14, color: '#0a0a0a' }, // right lip corner
        // === BOTTOM ROW (row 17): dark cavity with pink tongue inside ===
        { row: 17, col: 9,  color: '#0a0a0a' }, // dark cavity left
        { row: 17, col: 10, color: '#0a0a0a' },
        { row: 17, col: 11, color: '#d04060' }, // pink tongue
        { row: 17, col: 12, color: '#d04060' }, // pink tongue
        { row: 17, col: 13, color: '#0a0a0a' },
        { row: 17, col: 14, color: '#0a0a0a' }, // dark cavity right
      ];
    case 'tongue_out':
      // Playful tongue-out: open mouth with pink tongue hanging down.
      // Single tooth glint at top. Pudgy / cute energy.
      //
      // Palette: mouth_dark #181010 / tongue_pink #ff80a8 / tongue_dark #c84878
      //          tooth #ffffff
      return [
        // Mouth opening (dark interior)
        { row: 16, col: 10, color: '#181010' },
        { row: 16, col: 11, color: '#181010' },
        { row: 16, col: 12, color: '#181010' },
        { row: 16, col: 13, color: '#181010' },
        // Tooth glint at top of opening
        { row: 16, col: 11, color: '#ffffff' },
        // Tongue body (pink, hanging out the bottom)
        { row: 17, col: 11, color: '#ff80a8' },
        { row: 17, col: 12, color: '#ff80a8' },
        { row: 17, col: 13, color: '#c84878' }, // tongue right edge shadow
        { row: 18, col: 11, color: '#c84878' },
        { row: 18, col: 12, color: '#ff80a8' },
        { row: 18, col: 13, color: '#c84878' },
      ];
    case 'frown':
      // Sad downturned mouth: inverse of smile — corners drop, center peaks up.
      return [
        // Mouth top center (peak)
        { row: 16, col: 10, color: '#181010' },
        { row: 16, col: 11, color: '#181010' },
        { row: 16, col: 12, color: '#181010' },
        { row: 16, col: 13, color: '#181010' },
        // Mouth corners drop
        { row: 17, col: 9,  color: '#181010' },
        { row: 17, col: 14, color: '#181010' },
        // Optional tear-drop on left cheek for sad emphasis
        { row: 13, col: 7, color: '#80c8ff' }, // small blue tear
      ];
    case 'bubblegum':
      // Big round pink bubble being blown out from the mouth.
      // Sphere centered at (col 17, row 15.5) with proper round silhouette.
      // Palette: pink_dark #c83878 / pink #ff80b8 / pink_light #ffd0e0 / shine #ffffff
      return [
        // Bubble top arc (row 13)
        { row: 13, col: 16, color: '#c83878' },
        { row: 13, col: 17, color: '#c83878' },
        { row: 13, col: 18, color: '#c83878' },
        // Bubble upper body (row 14)
        { row: 14, col: 15, color: '#c83878' },
        { row: 14, col: 16, color: '#ffd0e0' }, // shine highlight (top-left)
        { row: 14, col: 17, color: '#ff80b8' },
        { row: 14, col: 18, color: '#ff80b8' },
        { row: 14, col: 19, color: '#c83878' },
        // Bubble middle widest row (row 15)
        { row: 15, col: 14, color: '#c83878' }, // attach side toward mouth
        { row: 15, col: 15, color: '#ffd0e0' }, // shine
        { row: 15, col: 16, color: '#ff80b8' },
        { row: 15, col: 17, color: '#ff80b8' },
        { row: 15, col: 18, color: '#ff80b8' },
        { row: 15, col: 19, color: '#c83878' },
        // Bubble lower body (row 16) — connecting to mouth via a "neck" at col 14
        { row: 16, col: 14, color: '#ff80b8' }, // attach to mouth
        { row: 16, col: 15, color: '#ff80b8' },
        { row: 16, col: 16, color: '#ff80b8' },
        { row: 16, col: 17, color: '#ff80b8' },
        { row: 16, col: 18, color: '#ff80b8' },
        { row: 16, col: 19, color: '#c83878' },
        // Bubble lower curve (row 17)
        { row: 17, col: 15, color: '#c83878' },
        { row: 17, col: 16, color: '#ff80b8' },
        { row: 17, col: 17, color: '#ff80b8' },
        { row: 17, col: 18, color: '#c83878' },
        // Bubble bottom arc (row 18)
        { row: 18, col: 16, color: '#c83878' },
        { row: 18, col: 17, color: '#c83878' },
      ];
    default:
      return [];
  }
}

const ACC_NAMES = [
  'none',           //  0
  'nose_ring',      //  1
  'bell',           //  2
  'war_paint',      //  3
  'gold_chain',     //  4
  'cowboy_hat',     //  5
  'dubai_hat',      //  6  Remilio Babies reference
  'strawberry_hat', //  7  Milady reference
  'apple',          //  8
  'crown',          //  9
  'halo',           // 10
  'devil_aura',     // 11
  'diamond_aura',   // 12  Moonbirds reference
  'fire_aura',      // 13  Moonbirds reference
  'beanie',         // 14  CryptoPunks reference
  'tinfoil',        // 15  metallic-silver tinfoil head wrap
  'headband',       // 16  CryptoPunks reference (sport style)
  'mohawk',         // 17  CryptoPunks reference
  'top_hat',        // 18  CryptoPunks reference (formal)
  'sheriff_hat',    // 19  black sheriff cowboy hat (silver-star variant)
  'tiara',          // 20  CryptoPunks reference
  'halo_stars',     // 21  Star halo (celestial)
  'earring',        // 22  CryptoPunks reference (face mark)
  'mole',           // 23  CryptoPunks reference (face mark)
  'rosy_cheeks',    // 24  Cute face mark
  'scar',           // 25  Battle bull face mark
  'pump',           // 26  Rare — green/white capsule floating between horns
  'phantom',        // 27  Rare — tiny ghost floating between horns
];

// Eyewear (overlays the eye area, hiding eyes when not "none").
// One canonical Mog (Pit-Viper-style yellow wraparound) — no color
// variants, keeping the trait list tight.
const EYEWEAR_NAMES = [
  'none',                //  0
  'mog',                 //  1  yellow wraparound visor
  'sunglasses_classic',  //  2  black wraparound
  'clout_shades',        //  3  Remilio reference
  'thug_life',           //  4  iconic black bar
  '3d_glasses',          //  5  red/cyan anaglyph
  'big_shades',          //  6  CryptoPunks reference (oversized square)
  'swag',                //  7  Pudgy Penguins style — chunky black + diagonal reflections
  'lasers',              //  8  red laser beams (mutually exclusive with glasses)
];

// Mouth-piece accessories (overlays the lower face)
const MOUTH_NAMES = ['none', 'cigarette', 'cigar', 'grill', 'smug', 'bubblegum', 'smile', 'frown', 'tongue_out', 'open_shout', 'pacifier'];

// Wraparound-visor lens colors. Single canonical Mog (yellow) and a
// classic black sunglasses variant. clout_shades / thug_life / swag are
// rendered separately in buildEyewearOverlay().
const MOG_LENS = {
  mog:                { lens: '#f0d028', frame: '#181818', highlight: '#fff0a0' }, // OG yellow
  sunglasses_classic: { lens: '#181818', frame: '#080808', highlight: '#404040' }, // black wraparound
};

// ============================================================
// Seed-based trait selection
// ============================================================

function pickWeighted(seedByte, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  const r = (seedByte / 256) * total;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (r < acc) return i;
  }
  return weights.length - 1;
}

export function selectTraits(seedBytes) {
  return {
    body:    pickWeighted(seedBytes[0], BODY_WEIGHTS),
    horn:    pickWeighted(seedBytes[1], HORN_WEIGHTS),
    eye:     pickWeighted(seedBytes[2], EYE_WEIGHTS),
    bg:      pickWeighted(seedBytes[3], BG_WEIGHTS),
    acc:     pickWeighted(seedBytes[4], ACC_WEIGHTS),
    eyewear: pickWeighted(seedBytes[5], EYEWEAR_WEIGHTS),
    mouth:   pickWeighted(seedBytes[6], MOUTH_WEIGHTS),
  };
}

// ============================================================
// Layout assembly
// ============================================================

function buildGrid(traitIdx, accName) {
  // Start from the base layout (fixed horn silhouette).
  // Horns are NEVER stripped here — they get re-painted on top of every
  // accessory at the very end of renderBullSvg, so cowboy hat / strawberry
  // hat / dubai hat all have horns visibly poking through.
  return LAYOUT.map(row => row.split(''));
}

// Build the cells that make up the eyes (replacing W/E cells in the grid).
// Supports structural variants: 'default', 'closed', 'angry'.
//
// Eye positions in LAYOUT:
//   Row 9:  cols 9, 10 (left sclera)   cols 13, 14 (right sclera)
//   Row 10: col 9 (E pupil) col 10 (W) col 13 (W) col 14 (E pupil)
//
// All variants stay STRICTLY within rows 9-10 cols 9-10 / 13-14 — no beams
// or extensions outside the eye area.
function buildEyeCells(eye, body) {
  if (eye.type === 'closed') {
    // Sleepy/closed eyes: replace eye cells with body fill, then a single
    // dark eyelid line across the middle of the eye area.
    return [
      // Body fills above + below the lid line
      { row: 9,  col: 9,  color: body.shade },
      { row: 9,  col: 10, color: body.shade },
      { row: 9,  col: 13, color: body.shade },
      { row: 9,  col: 14, color: body.shade },
      // Closed-eyelid dark line (subtle, not full-cell black)
      { row: 10, col: 9,  color: '#181818' },
      { row: 10, col: 10, color: '#181818' },
      { row: 10, col: 13, color: '#181818' },
      { row: 10, col: 14, color: '#181818' },
    ];
  }

  if (eye.type === 'angry') {
    // Narrowed/angry eyes: V-shape with single dark cell per eye in the
    // bottom-outer corner, body fill elsewhere. Reads as a downward scowl.
    return [
      // Top row body fill (no sclera shown — angry brows obscure)
      { row: 9, col: 9,  color: body.shade },
      { row: 9, col: 10, color: '#181818' }, // angry brow inner-top
      { row: 9, col: 13, color: '#181818' }, // angry brow inner-top
      { row: 9, col: 14, color: body.shade },
      // Bottom row: white sclera + dark pupils on inner side (looking forward angrily)
      { row: 10, col: 9,  color: '#181818' }, // dark pupil outer
      { row: 10, col: 10, color: '#ffffff' }, // sclera inner
      { row: 10, col: 13, color: '#ffffff' }, // sclera inner
      { row: 10, col: 14, color: '#181818' }, // dark pupil outer
    ];
  }

  if (eye.type === 'crying') {
    // Crying eyes: standard sclera + pupil, plus blue tear droplets
    // trickling down from each outer corner across the cheek. Tears
    // overlay the body cells in rows 11-12 (cheekbone area).
    return [
      // Left eye (default sclera + pupil)
      { row: 9,  col: 9,  color: eye.sclera },
      { row: 9,  col: 10, color: eye.sclera },
      { row: 10, col: 9,  color: eye.pupil },  // E pupil (outer-bottom)
      { row: 10, col: 10, color: eye.sclera },
      // Right eye
      { row: 9,  col: 13, color: eye.sclera },
      { row: 9,  col: 14, color: eye.sclera },
      { row: 10, col: 13, color: eye.sclera },
      { row: 10, col: 14, color: eye.pupil },  // E pupil (outer-bottom)
      // Tear streaks down outer corners (rows 11-12, cols 9 and 14)
      { row: 11, col: 9,  color: eye.tear_light },
      { row: 12, col: 9,  color: eye.tear },
      { row: 11, col: 14, color: eye.tear_light },
      { row: 12, col: 14, color: eye.tear },
    ];
  }

  if (eye.type === 'ski_mask') {
    // Black ski mask covering the ENTIRE bull head — from the top of
    // the head between the horns (rows 4-6) all the way down to the
    // chin (row 17). Mask cells follow the head silhouette row-by-row.
    //
    // Two 2x2 eye cutouts at rows 9-10 cols 9-10 (left) and cols 13-14
    // (right) keep the eyes visible — each shows white sclera with a
    // black pupil at the outer-bottom corner.
    //
    // Horns are NOT covered: they fall outside the head body cells, and
    // the horn-on-top render pass repaints them last so they always show.
    const m = eye.mask;
    const cells = [];
    // === TOP OF HEAD between horns (rows 4-6) — matches head body width ===
    for (let c = 9;  c <= 14; c++) cells.push({ row: 4, col: c, color: m });
    for (let c = 8;  c <= 15; c++) cells.push({ row: 5, col: c, color: m });
    for (let c = 7;  c <= 16; c++) cells.push({ row: 6, col: c, color: m });
    // === FOREHEAD (row 7) — between the brow horns at cols 5, 18 ===
    for (let c = 6;  c <= 17; c++) cells.push({ row: 7, col: c, color: m });
    // === TEMPLE / FACE (row 8) ===
    for (let c = 5;  c <= 18; c++) cells.push({ row: 8, col: c, color: m });
    // === EYE LEVEL (rows 9-10) — with 2x2 cutouts at cols 9-10 and 13-14 ===
    for (const r of [9, 10]) {
      for (let c = 4; c <= 19; c++) {
        if (c >= 9 && c <= 10) continue;   // left eye cutout
        if (c >= 13 && c <= 14) continue;  // right eye cutout
        cells.push({ row: r, col: c, color: m });
      }
    }
    // === CHEEKBONES (row 11, widest face row) ===
    for (let c = 4; c <= 19; c++) cells.push({ row: 11, col: c, color: m });
    // === MUZZLE (rows 12-15) — covers nostrils ===
    for (const r of [12, 13, 14, 15]) {
      for (let c = 5; c <= 18; c++) cells.push({ row: r, col: c, color: m });
    }
    // === MOUTH (row 16) — covers the mouth line ===
    for (let c = 7;  c <= 16; c++) cells.push({ row: 16, col: c, color: m });
    // === CHIN (row 17) ===
    for (let c = 8;  c <= 15; c++) cells.push({ row: 17, col: c, color: m });
    // === JAW LINE (row 18) — completes "full head" coverage; neck (row 19+) is body, not head ===
    for (let c = 8;  c <= 15; c++) cells.push({ row: 18, col: c, color: m });

    // === EYES visible through the 2x2 cutouts ===
    // 3 white sclera cells + 1 black pupil per eye (pupils at outer
    // corners, matching the W/E layout in the base grid).
    cells.push({ row: 9,  col: 9,  color: eye.sclera });
    cells.push({ row: 9,  col: 10, color: eye.sclera });
    cells.push({ row: 10, col: 9,  color: eye.pupil });   // BLACK pupil
    cells.push({ row: 10, col: 10, color: eye.sclera });
    cells.push({ row: 9,  col: 13, color: eye.sclera });
    cells.push({ row: 9,  col: 14, color: eye.sclera });
    cells.push({ row: 10, col: 13, color: eye.sclera });
    cells.push({ row: 10, col: 14, color: eye.pupil });   // BLACK pupil
    return cells;
  }

  // Default: standard 2x2 sclera + pupil eyes (forward-looking).
  // Pupil positions match the W/E layout in LAYOUT (E at outer corners).
  return [
    // Left eye
    { row: 9,  col: 9,  color: eye.sclera },
    { row: 9,  col: 10, color: eye.sclera },
    { row: 10, col: 9,  color: eye.pupil },  // E pupil (outer-bottom)
    { row: 10, col: 10, color: eye.sclera },
    // Right eye
    { row: 9,  col: 13, color: eye.sclera },
    { row: 9,  col: 14, color: eye.sclera },
    { row: 10, col: 13, color: eye.sclera },
    { row: 10, col: 14, color: eye.pupil },  // E pupil (outer-bottom)
  ];
}

// ============================================================
// SVG rendering
// ============================================================

function cellColor(roleChar, body, horn, eye) {
  switch (roleChar) {
    case 'B': return body.base;
    case 'b': return body.shade;
    case 'L': return body.light;
    case 'H': return horn.base;
    case 'h': return horn.tip;
    case 'W': return eye.sclera;
    case 'E': return eye.pupil;
    case 'N': return body.nose;
    case 'R': return '#181010';
    case 'M': return '#281818';
    default:  return null;
  }
}

// Vertical offset applied to ALL bull cells (body, horns, accessories,
// eyewear, mouth, lasers). The bg gradient is rendered separately and
// covers the full canvas regardless. Increasing this value pushes the
// bull DOWN within the 24x24 canvas.
const BULL_Y_OFFSET = 1;

function svgRect(x, y, color) {
  // x is bull-relative column 0..23; y is bull-relative row 0..23.
  // We add BULL_Y_OFFSET to translate to canvas coordinates so the bull
  // sits anchored to the bottom of the frame instead of floating up top.
  return `<rect x="${x}" y="${y + BULL_Y_OFFSET}" width="1" height="1" fill="${color}"/>`;
}

export function renderBullSvg(seedBytes, scale = 24) {
  const t = selectTraits(seedBytes);
  const body    = BODY_PALETTES[t.body];
  const horn    = HORN_PALETTES[t.horn];
  const eye     = EYE_PALETTES[t.eye];
  const bg      = BG_PALETTES[t.bg];
  const accName = ACC_NAMES[t.acc];
  const acc     = ACCESSORIES[accName] || [];
  // Headwear hats hide eyewear (no shades through a hat brim/cloth)
  const headwearHat = accName === 'cowboy_hat' || accName === 'dubai_hat' || accName === 'sheriff_hat';
  const eyewear = headwearHat ? 'none' : EYEWEAR_NAMES[t.eyewear];
  const mouth   = MOUTH_NAMES[t.mouth];

  const grid = buildGrid(t, accName);

  const parts = [];
  // Background gradient (2-color split, top half / bottom half)
  parts.push(
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="${bg.top}"/>` +
    `<stop offset="100%" stop-color="${bg.bot}"/>` +
    `</linearGradient></defs>`
  );
  parts.push(`<rect width="24" height="24" fill="url(#bg)"/>`);

  // Body / head / horns / nose / mouth (skip W/E cells — handled separately
  // below so structural eye variants like "closed" and "angry" can override
  // the default 2x2 eye rendering).
  for (let r = 0; r < 24; r++) {
    for (let c = 0; c < 24; c++) {
      const ch = grid[r][c];
      if (ch === '.') continue;
      if (ch === 'W' || ch === 'E') continue; // handled by buildEyeCells
      const col = cellColor(ch, body, horn, eye);
      if (!col) continue;
      parts.push(svgRect(c, r, col));
    }
  }

  // Eye cells (rendered before eyewear so eyewear can paint over them).
  for (const e of buildEyeCells(eye, body)) {
    parts.push(svgRect(e.col, e.row, e.color));
  }

  // Eyewear overlay (covers eyes if mog / sunglasses)
  for (const a of buildEyewearOverlay(eyewear)) {
    parts.push(svgRect(a.col, a.row, a.color));
  }

  // Mouth-piece overlay
  for (const a of buildMouthOverlay(mouth, body)) {
    parts.push(svgRect(a.col, a.row, a.color));
  }

  // Accessories (overlay body + eyewear + mouth)
  for (const a of acc) {
    parts.push(svgRect(a.col, a.row, a.color));
  }

  // Horns-on-top pass: re-paint horn cells (H/h) AFTER all accessories so
  // they always poke through hats (cowboy, strawberry, dubai, even crown
  // overlays). This is what makes a horned bull wearing a hat read correctly:
  // the horns don't disappear under the brim/cloth.
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 24; c++) {
      const ch = grid[r][c];
      if (ch === 'H' || ch === 'h') {
        const col = cellColor(ch, body, horn, eye);
        if (col) parts.push(svgRect(c, r, col));
      }
    }
  }

  // Holographic body shimmer: subtle sparkle highlights only on the upper-head
  // corners. (Center body dots removed — they read as random specks.)
  if (body.name === 'holo') {
    parts.push(svgRect(7,  8,  '#ffffff'));
    parts.push(svgRect(16, 8,  '#ffffff'));
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ` +
    `width="${scale * 24}" height="${scale * 24}" ` +
    `shape-rendering="crispEdges">` +
    parts.join('') +
    `</svg>`;

  return { svg, traits: t, names: {
    body:    body.name,
    horn:    horn.name,
    eye:     eye.name,
    bg:      bg.name,
    acc:     ACC_NAMES[t.acc],
    eyewear: eyewear,
    mouth:   mouth,
  }};
}

// ============================================================
// Seed derivation (cranker-side; Anchor will mirror with blake3)
// ============================================================

// Derive 32-byte deterministic seed from the NFT's mint address.
//
// Visuals are locked to the NFT mint, not the owner — so when an NFT
// trades on Magic Eden / Tensor, the bull's art stays consistent. When
// a tier_index is reused after unwrap, the new wrap creates a fresh NFT
// mint => a different seed => a different bull (re-roll behavior).
//
// nftMintPubkey58: base58-encoded NFT mint pubkey (44 chars typically).
export function deriveSeed(nftMintPubkey58) {
  const h = crypto.createHash('sha256');
  h.update(Buffer.from(nftMintPubkey58, 'utf8'));
  return h.digest();
}
