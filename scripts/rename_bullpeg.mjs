#!/usr/bin/env node
// rename_bullpeg.mjs — substitute `bullpeg` → `wrappedbulls` and
// `Bullpeg` → `Wrappedbulls` everywhere in the repo (the internal
// codename was meaningless; align with the project name).
//
// Run after `mv programs/bullpeg programs/wrappedbulls` and
//           `mv tests/bullpeg.ts tests/wrappedbulls.ts`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// PascalCase rule MUST run before lowercase (otherwise "Bullpeg"
// becomes "Bwrappedbulls" — capital B stays + "ullpeg" replaced).
const RULES = [
  [/Bullpeg/g, 'Wrappedbulls'],   // PascalCase first (Anchor-generated struct)
  [/bullpeg/g, 'wrappedbulls'],   // lowercase (mod name, crate name, paths)
];

const EXCLUDE_FILES = new Set([
  'scripts/rename_bullpeg.mjs',
  'scripts/rebrand.mjs',
  'scripts/dedash.mjs',
  '.operator-session.lock',
]);

const EXCLUDE_DIRS = new Set([
  'target', 'node_modules', '.git', '.next', 'out', 'dist', '.cache',
]);

const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.bundle',
  '.pdf', '.zip', '.tar', '.gz', '.exe', '.dll', '.so', '.dylib',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile()) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(ROOT, full).replaceAll('\\', '/');
      if (EXCLUDE_FILES.has(rel)) continue;
      if (entry.name.endsWith('-keypair.json')) continue;
      if (BINARY_EXTS.has(path.extname(entry.name).toLowerCase())) continue;
      out.push(full);
    }
  }
  return out;
}

const files = walk(ROOT);
let totalChanges = 0, modifiedFiles = 0;
const perFile = [];

for (const f of files) {
  let src;
  try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const before = src;
  let n = 0;
  for (const [re, repl] of RULES) {
    src = src.replace(re, () => { n++; return repl; });
  }
  if (src !== before) {
    fs.writeFileSync(f, src);
    modifiedFiles++;
    totalChanges += n;
    perFile.push([path.relative(ROOT, f).replaceAll('\\', '/'), n]);
  }
}

console.log(`Modified ${modifiedFiles} files. Total: ${totalChanges} replacements.\n`);
perFile.sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(
  ([f, n]) => console.log(`  ${String(n).padStart(3)}  ${f}`)
);
