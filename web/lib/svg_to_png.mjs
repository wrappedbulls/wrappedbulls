// Tiny SVG -> PNG converter for our specific 24x24 <rect>-grid SVGs.
// Pure Node (zlib only). Not a general SVG renderer; just enough to
// turn our renderer's output into PNG bytes for inline display.
//
// Outputs:
//  - Individual PNG per bull at given scale
//  - Optional contact sheet (grid of all bulls)

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// --- Minimal PNG encoder (RGB, no alpha, scanline filter 0) ---

function crc32(buf) {
  // Standard CRC-32. Lookup table built once.
  if (!crc32.table) {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    crc32.table = t;
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crc32.table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crcBuf]);
}

export function encodePng(width, height, rgb) {
  // rgb: Buffer of length width*height*3 (RGB, no alpha).
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8;   // bit depth
  ihdr[9]  = 2;   // color type: RGB
  ihdr[10] = 0;   // compression
  ihdr[11] = 0;   // filter
  ihdr[12] = 0;   // interlace

  // Add filter byte (0 = None) at start of each scanline
  const stride = width * 3;
  const filtered = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0;
    rgb.copy(filtered, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(filtered);

  const iend = Buffer.alloc(0);

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', iend),
  ]);
}

// --- SVG parsing (just our specific format) ---

function parseHex(hex) {
  // #rrggbb
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

export function svgToPixels(svgText, scale = 1) {
  // Build a 24x24 RGB array from our renderer's SVG (background rect + 1x1 cells).
  const W = 24, H = 24;

  // Find the background gradient stops (first stop = top color).
  // For simplicity we just pull the first <stop offset="0%" stop-color="#xxxxxx"/> as bg.
  const bgMatch = svgText.match(/stop offset="0%" stop-color="(#[0-9a-f]{6})"/i);
  const bgBotMatch = svgText.match(/stop offset="100%" stop-color="(#[0-9a-f]{6})"/i);
  const bgTop = bgMatch ? parseHex(bgMatch[1]) : [16, 16, 24];
  const bgBot = bgBotMatch ? parseHex(bgBotMatch[1]) : [8, 8, 16];

  const px = new Uint8Array(W * H * 3);
  // Fill background gradient (linear top->bottom)
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    const r = Math.round(bgTop[0] * (1 - t) + bgBot[0] * t);
    const g = Math.round(bgTop[1] * (1 - t) + bgBot[1] * t);
    const b = Math.round(bgTop[2] * (1 - t) + bgBot[2] * t);
    for (let x = 0; x < W; x++) {
      px[(y * W + x) * 3 + 0] = r;
      px[(y * W + x) * 3 + 1] = g;
      px[(y * W + x) * 3 + 2] = b;
    }
  }

  // Overlay <rect x="N" y="N" width="1" height="1" fill="#xxxxxx"/>
  const rectRe = /<rect x="(\d+)" y="(\d+)" width="1" height="1" fill="(#[0-9a-f]{6})"\/>/gi;
  for (const m of svgText.matchAll(rectRe)) {
    const x = +m[1], y = +m[2];
    const c = parseHex(m[3]);
    if (!c || x < 0 || x >= W || y < 0 || y >= H) continue;
    px[(y * W + x) * 3 + 0] = c[0];
    px[(y * W + x) * 3 + 1] = c[1];
    px[(y * W + x) * 3 + 2] = c[2];
  }

  if (scale === 1) return { width: W, height: H, rgb: Buffer.from(px) };

  // Nearest-neighbor scale up
  const sw = W * scale, sh = H * scale;
  const out = Buffer.alloc(sw * sh * 3);
  for (let y = 0; y < sh; y++) {
    const sy = (y / scale) | 0;
    for (let x = 0; x < sw; x++) {
      const sx = (x / scale) | 0;
      const si = (sy * W + sx) * 3;
      const di = (y * sw + x) * 3;
      out[di + 0] = px[si + 0];
      out[di + 1] = px[si + 1];
      out[di + 2] = px[si + 2];
    }
  }
  return { width: sw, height: sh, rgb: out };
}

// --- Contact sheet ---

export function contactSheet(svgs, opts = {}) {
  const cellScale  = opts.cellScale  || 8;       // 24*8 = 192 px per bull
  const cols       = opts.cols       || 5;
  const margin     = opts.margin     || 8;
  const bgColor    = opts.bgColor    || [14, 14, 18];

  const cellW = 24 * cellScale;
  const cellH = 24 * cellScale;
  const rows  = Math.ceil(svgs.length / cols);
  const W = cols * cellW + (cols + 1) * margin;
  const H = rows * cellH + (rows + 1) * margin;

  const out = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    out[i * 3 + 0] = bgColor[0];
    out[i * 3 + 1] = bgColor[1];
    out[i * 3 + 2] = bgColor[2];
  }

  svgs.forEach((svg, idx) => {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const ox = margin + c * (cellW + margin);
    const oy = margin + r * (cellH + margin);
    const { rgb } = svgToPixels(svg, cellScale);
    for (let y = 0; y < cellH; y++) {
      for (let x = 0; x < cellW; x++) {
        const si = (y * cellW + x) * 3;
        const di = ((oy + y) * W + (ox + x)) * 3;
        out[di + 0] = rgb[si + 0];
        out[di + 1] = rgb[si + 1];
        out[di + 2] = rgb[si + 2];
      }
    }
  });

  return { width: W, height: H, rgb: out };
}

// --- Direct CLI usage: convert all samples to PNG + contact sheet ---

if (import.meta.url === `file://${process.argv[1].replaceAll('\\', '/')}`
  || process.argv[1]?.endsWith('svg_to_png.mjs')) {
  const SAMPLES = path.resolve(import.meta.dirname, '..', '..', 'samples');
  const svgs = [];
  const files = fs.readdirSync(SAMPLES)
    .filter(f => /^bull_\d{4}\.svg$/.test(f))
    .sort();
  for (const fname of files) {
    const file = path.join(SAMPLES, fname);
    const text = fs.readFileSync(file, 'utf8');
    svgs.push(text);

    // Per-bull PNG at 12x
    const { width, height, rgb } = svgToPixels(text, 12);
    const png = encodePng(width, height, rgb);
    fs.writeFileSync(file.replace('.svg', '.png'), png);
  }

  // Contact sheet — scale layout to count.
  // Aim for ~roughly square sheets that fit on screen.
  let cols, cellScale, margin;
  if (svgs.length >= 100) {
    cols = 20;
    cellScale = 3;       // 24*3 = 72 px per bull
    margin = 2;
  } else if (svgs.length >= 30) {
    cols = 8;
    cellScale = 6;
    margin = 4;
  } else {
    cols = 5;
    cellScale = 8;
    margin = 6;
  }
  const sheet = contactSheet(svgs, { cellScale, cols, margin });
  const sheetPng = encodePng(sheet.width, sheet.height, sheet.rgb);
  fs.writeFileSync(path.join(SAMPLES, 'contact_sheet.png'), sheetPng);

  console.log(`Wrote ${svgs.length} per-bull PNGs and contact_sheet.png to ${SAMPLES}`);
}
