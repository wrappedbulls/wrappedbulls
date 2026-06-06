// Orb theme.
//
// Pure vector composition. No bundled raster assets. Every visual is
// derived from a PRNG seeded by (collection_mint, tier_index). Same seed
// renders the same SVG string byte for byte across server and browser.
//
// Visual design: a glowing orb on a tinted backdrop, with seed driven
// variation across hue, gradient style, particle rings, aura intensity,
// iris pattern, and backdrop pattern. Looks professional at any scale,
// works as a default identity for any project that hasn't commissioned
// custom art, and the variance keeps a collection feeling distinct
// without ever falling into procedural-art ugliness.

import { PRNG, type Theme } from "../../index";

// =====================================================================
// Palette. 12 base hues, each with a curated companion stack. Every
// number is intentional; mass-changing these will produce a visually
// different theme. If you want a new look, register a new theme rather
// than tweaking these.
// =====================================================================

interface ColorStack {
  base: string;
  highlight: string;
  shadow: string;
  background: string;
  accent: string;
  name: string;
}

const PALETTE: readonly ColorStack[] = [
  { name: "amber",   base: "#f59e0b", highlight: "#fde68a", shadow: "#78350f", background: "#1c1917", accent: "#ea580c" },
  { name: "rose",    base: "#fb7185", highlight: "#fecdd3", shadow: "#881337", background: "#1f1419", accent: "#e11d48" },
  { name: "iris",    base: "#a78bfa", highlight: "#ddd6fe", shadow: "#4c1d95", background: "#1a1632", accent: "#7c3aed" },
  { name: "ocean",   base: "#38bdf8", highlight: "#bae6fd", shadow: "#0c4a6e", background: "#0f172a", accent: "#0284c7" },
  { name: "lime",    base: "#84cc16", highlight: "#d9f99d", shadow: "#365314", background: "#14181c", accent: "#65a30d" },
  { name: "ember",   base: "#f97316", highlight: "#fed7aa", shadow: "#7c2d12", background: "#1a1209", accent: "#dc2626" },
  { name: "mint",    base: "#34d399", highlight: "#a7f3d0", shadow: "#064e3b", background: "#0f1f1a", accent: "#059669" },
  { name: "amethyst",base: "#c084fc", highlight: "#e9d5ff", shadow: "#581c87", background: "#1c1428", accent: "#9333ea" },
  { name: "neon",    base: "#22d3ee", highlight: "#a5f3fc", shadow: "#155e75", background: "#0d1b22", accent: "#06b6d4" },
  { name: "blossom", base: "#f472b6", highlight: "#fbcfe8", shadow: "#831843", background: "#1d1018", accent: "#db2777" },
  { name: "honey",   base: "#facc15", highlight: "#fef08a", shadow: "#713f12", background: "#1a1609", accent: "#ca8a04" },
  { name: "void",    base: "#94a3b8", highlight: "#e2e8f0", shadow: "#1e293b", background: "#0a0a0e", accent: "#475569" },
];

// =====================================================================
// Variation knobs. Each is a small enum of named choices. The PRNG
// picks one per knob. Listing them named keeps the metadata trait list
// human readable.
// =====================================================================

const GRADIENT_STYLES = ["radial-soft", "radial-sharp", "dual-stop", "conic"] as const;
type GradientStyle = (typeof GRADIENT_STYLES)[number];

const AURA_LEVELS = ["subtle", "medium", "intense"] as const;
type AuraLevel = (typeof AURA_LEVELS)[number];

const IRIS_PATTERNS = ["none", "concentric", "spiral"] as const;
type IrisPattern = (typeof IRIS_PATTERNS)[number];

const BACKDROP_PATTERNS = ["plain", "vignette", "starfield"] as const;
type BackdropPattern = (typeof BACKDROP_PATTERNS)[number];

const RING_COUNTS = [0, 1, 2] as const;

// =====================================================================
// Public Theme implementation.
// =====================================================================

interface OrbConfig {
  palette: ColorStack;
  gradient: GradientStyle;
  aura: AuraLevel;
  iris: IrisPattern;
  backdrop: BackdropPattern;
  ringCount: number;
  ringDots: number;
  ringRadius: number;     // px from center
  ringRotation: number;   // degrees
  irisRingCount: number;  // only used when iris !== 'none'
}

function configFromSeed(seed: bigint): OrbConfig {
  const r = new PRNG(seed);
  return {
    palette: r.pick(PALETTE),
    gradient: r.pick(GRADIENT_STYLES),
    aura: r.pick(AURA_LEVELS),
    iris: r.pick(IRIS_PATTERNS),
    backdrop: r.pick(BACKDROP_PATTERNS),
    ringCount: r.pick(RING_COUNTS),
    ringDots: 12 + r.nextInt(24),       // 12..35 inclusive
    ringRadius: 360 + r.nextInt(80),    // 360..439 px
    ringRotation: r.nextInt(360),
    irisRingCount: 2 + r.nextInt(4),    // 2..5
  };
}

// Map enum -> opacity for the aura glow circles.
const AURA_OPACITY: Record<AuraLevel, number> = {
  subtle: 0.18,
  medium: 0.32,
  intense: 0.5,
};

function renderBackdrop(size: number, cfg: OrbConfig): string {
  const cx = size / 2;
  const cy = size / 2;
  switch (cfg.backdrop) {
    case "vignette":
      // soft radial darkening from center to edges
      return `
  <defs>
    <radialGradient id="bg" cx="50%" cy="50%" r="70%">
      <stop offset="0%" stop-color="${cfg.palette.background}" stop-opacity="1"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="1"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#bg)"/>`;
    case "starfield": {
      // 36 small dots scattered with the same PRNG branch so the
      // backdrop varies with the seed but stays deterministic.
      const r = new PRNG(cfg.ringRadius === 0 ? 1n : BigInt(cfg.ringRadius * 17 + cfg.ringDots * 31));
      const dots = Array.from({ length: 36 }).map(() => {
        const x = r.nextInt(size);
        const y = r.nextInt(size);
        const radius = 1 + r.nextInt(3);
        const opacity = 0.2 + r.nextFloat() * 0.4;
        return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${cfg.palette.highlight}" opacity="${opacity.toFixed(3)}"/>`;
      }).join("");
      return `
  <rect width="${size}" height="${size}" fill="${cfg.palette.background}"/>
  ${dots}`;
    }
    case "plain":
    default:
      return `<rect width="${size}" height="${size}" fill="${cfg.palette.background}"/>`;
  }
}

function renderOrbGradient(cfg: OrbConfig): string {
  switch (cfg.gradient) {
    case "radial-sharp":
      return `
    <radialGradient id="orb" cx="40%" cy="38%" r="55%">
      <stop offset="0%" stop-color="${cfg.palette.highlight}" stop-opacity="1"/>
      <stop offset="35%" stop-color="${cfg.palette.base}" stop-opacity="1"/>
      <stop offset="100%" stop-color="${cfg.palette.shadow}" stop-opacity="1"/>
    </radialGradient>`;
    case "dual-stop":
      return `
    <radialGradient id="orb" cx="50%" cy="50%" r="60%">
      <stop offset="0%" stop-color="${cfg.palette.base}" stop-opacity="1"/>
      <stop offset="55%" stop-color="${cfg.palette.accent}" stop-opacity="1"/>
      <stop offset="100%" stop-color="${cfg.palette.shadow}" stop-opacity="1"/>
    </radialGradient>`;
    case "conic":
      // SVG has no native conic gradient, approximate with a 6 stop
      // sweep on a rotated linear gradient pattern. Visually distinct
      // from radial without needing custom mesh.
      return `
    <linearGradient id="orb" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${cfg.palette.highlight}"/>
      <stop offset="40%" stop-color="${cfg.palette.base}"/>
      <stop offset="70%" stop-color="${cfg.palette.accent}"/>
      <stop offset="100%" stop-color="${cfg.palette.shadow}"/>
    </linearGradient>`;
    case "radial-soft":
    default:
      return `
    <radialGradient id="orb" cx="45%" cy="42%" r="65%">
      <stop offset="0%" stop-color="${cfg.palette.highlight}" stop-opacity="1"/>
      <stop offset="60%" stop-color="${cfg.palette.base}" stop-opacity="1"/>
      <stop offset="100%" stop-color="${cfg.palette.shadow}" stop-opacity="1"/>
    </radialGradient>`;
  }
}

function renderAura(size: number, cfg: OrbConfig): string {
  const cx = size / 2;
  const cy = size / 2;
  const opacity = AURA_OPACITY[cfg.aura];
  const orbRadius = size * 0.28; // 28% of viewport
  // Three concentric haloes with decreasing opacity, giving the soft
  // glow without depending on SVG filters (which render inconsistently
  // across older marketplace image preview pipelines).
  return `
  <circle cx="${cx}" cy="${cy}" r="${orbRadius * 1.6}" fill="${cfg.palette.base}" opacity="${(opacity * 0.3).toFixed(3)}"/>
  <circle cx="${cx}" cy="${cy}" r="${orbRadius * 1.3}" fill="${cfg.palette.base}" opacity="${(opacity * 0.55).toFixed(3)}"/>
  <circle cx="${cx}" cy="${cy}" r="${orbRadius * 1.1}" fill="${cfg.palette.accent}" opacity="${(opacity * 0.8).toFixed(3)}"/>`;
}

function renderRings(size: number, cfg: OrbConfig): string {
  if (cfg.ringCount === 0) return "";
  const cx = size / 2;
  const cy = size / 2;
  const rings: string[] = [];
  for (let ring = 0; ring < cfg.ringCount; ring++) {
    const radius = cfg.ringRadius + ring * 35;
    const rotation = cfg.ringRotation + ring * 17;
    const dotRadius = 6 - ring * 2;
    const dots: string[] = [];
    for (let i = 0; i < cfg.ringDots; i++) {
      const angle = (i / cfg.ringDots) * 2 * Math.PI + (rotation * Math.PI) / 180;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      dots.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${dotRadius}" fill="${cfg.palette.highlight}" opacity="0.7"/>`);
    }
    rings.push(dots.join(""));
  }
  return rings.join("\n  ");
}

function renderIris(size: number, cfg: OrbConfig): string {
  if (cfg.iris === "none") return "";
  const cx = size / 2;
  const cy = size / 2;
  const orbRadius = size * 0.28;
  if (cfg.iris === "concentric") {
    const rings: string[] = [];
    for (let i = 0; i < cfg.irisRingCount; i++) {
      const r = orbRadius * (0.3 + i * (0.6 / cfg.irisRingCount));
      const opacity = 0.18 - i * 0.025;
      rings.push(`<circle cx="${cx}" cy="${cy}" r="${r.toFixed(2)}" fill="none" stroke="${cfg.palette.highlight}" stroke-width="2" opacity="${opacity.toFixed(3)}"/>`);
    }
    return rings.join("\n  ");
  }
  // spiral: a path approximated with line segments
  const segments: string[] = [];
  const turns = cfg.irisRingCount;
  const points = 80;
  let path = `M ${cx} ${cy}`;
  for (let i = 1; i <= points; i++) {
    const t = (i / points) * turns * 2 * Math.PI;
    const r = (orbRadius * 0.8) * (i / points);
    const x = cx + Math.cos(t) * r;
    const y = cy + Math.sin(t) * r;
    path += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  segments.push(`<path d="${path}" fill="none" stroke="${cfg.palette.highlight}" stroke-width="1.5" opacity="0.22"/>`);
  return segments.join("\n  ");
}

function renderHighlight(size: number, cfg: OrbConfig): string {
  // Crescent highlight on the upper left of the orb. Sells the 3D
  // illusion without complex shading.
  const cx = size * 0.42;
  const cy = size * 0.40;
  const rx = size * 0.10;
  const ry = size * 0.06;
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${cfg.palette.highlight}" opacity="0.55" transform="rotate(-25 ${cx} ${cy})"/>`;
}

export const orb: Theme = {
  slug: "orb",
  name: "Orb",
  description:
    "A glowing vector orb. One theme, twelve palettes, infinite seed driven variance. Looks at home for any project that wants a clean default identity.",
  preview: [1, 7, 23, 51, 99, 142, 256, 488, 777],

  render(seed: bigint, _tier: number, size: number): string {
    const cfg = configFromSeed(seed);
    const cx = size / 2;
    const cy = size / 2;
    const orbRadius = size * 0.28;

    const backdrop = renderBackdrop(size, cfg);
    const orbGradient = renderOrbGradient(cfg);
    const aura = renderAura(size, cfg);
    const rings = renderRings(size, cfg);
    const iris = renderIris(size, cfg);
    const highlight = renderHighlight(size, cfg);

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  ${backdrop.trim()}
  <defs>${orbGradient}</defs>
  ${aura.trim()}
  ${rings}
  <circle cx="${cx}" cy="${cy}" r="${orbRadius}" fill="url(#orb)"/>
  ${iris}
  ${highlight}
</svg>`;
  },

  attributes(seed: bigint, _tier: number) {
    const cfg = configFromSeed(seed);
    return [
      { trait_type: "Palette", value: cfg.palette.name },
      { trait_type: "Gradient", value: cfg.gradient },
      { trait_type: "Aura", value: cfg.aura },
      { trait_type: "Iris", value: cfg.iris },
      { trait_type: "Backdrop", value: cfg.backdrop },
      { trait_type: "Rings", value: String(cfg.ringCount) },
    ];
  },
};
