#!/usr/bin/env node
// rebrand.mjs — CryptoBulls -> WrappedBulls across the entire repo.
// Excludes binaries, build artifacts, the keypair files, the clone
// script (which relies on the old patterns to work), and the dedash /
// rebrand scripts themselves.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const RULES = [
  // Order: longer/more-specific patterns FIRST
  [/cryptobulls\.fun/g,    'wrappedbulls.com'],
  [/CryptoBulls/g,         'WrappedBulls'],
  [/CRYPTOBULLS/g,         'WRAPPEDBULLS'],
  [/cryptobulls/g,         'wrappedbulls'],
  [/@CTBullsfun/g,         '@wrappedbulls'],
  [/CTBullsfun/g,          'wrappedbulls'],
  [/\$BULLS\b/g,           '$WBULL'],
  // Standalone BULLS as a word (ticker, symbol). \b avoids matching
  // inside identifiers like MAX_BULLS because _ is a word char so
  // there is no word boundary between _ and B.
  [/\bBULLS\b/g,           'WBULL'],
  // Shell variables / placeholders that embed the ticker.
  [/BULLS_MINT/g,          'WBULL_MINT'],
];

const EXCLUDE_FILES = new Set([
  'scripts/clone_to_new_project.sh',  // depends on the old patterns
  'scripts/dedash.mjs',
  'scripts/rebrand.mjs',
  'web/lib/launch-config.generated.ts',  // regenerated from launch.toml
  'web/config/launch-state.json',         // runtime state, gitignored
  '.operator-session.lock',
]);

const EXCLUDE_DIRS = new Set([
  'target', 'node_modules', '.git', '.next', 'out', 'dist', '.cache',
  'wrappedbulls-preview',  // already clean
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
let totalChanges = 0;
let modifiedFiles = 0;
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

console.log(`\nModified ${modifiedFiles} files. Total replacements: ${totalChanges}\n`);
perFile.sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(
  ([f, n]) => console.log(`  ${String(n).padStart(3)}  ${f}`)
);
