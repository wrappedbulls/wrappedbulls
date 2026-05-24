#!/usr/bin/env bash
# clone_to_new_project.sh — rebrand the relaunch baseline for a new
# pump.fun-style project. Designed to be run in a FRESH clone of the
# baseline bundle so any mistake is recoverable (re-clone and retry).
#
# Prerequisites the operator runs FIRST:
#   1. Restore the bundle:
#        git clone /path/to/wrappedbulls-full-history.bundle ~/projects/<slug>
#   2. cd into it and delete the old git origin / history if you want
#      a fresh repo (recommended — see docs/POSTMORTEM.md on the
#      "first ever" narrative):
#        cd ~/projects/<slug>
#        rm -rf .git && git init
#   3. Then run this script from that directory.
#
# What this script does (in order, fail-fast):
#   1. Validate CLI flags and pwd shape.
#   2. Generate a fresh Anchor program keypair (Solana keygen).
#   3. Overwrite config/launch.toml with the new values + new program ID.
#   4. Overwrite web/config/brand.json with new social / brand surface.
#   5. Re-run the build.rs codegen + the web TOML→TS generator so the
#      generated files reflect the new config before any verification.
#   6. Sed-rebrand high-confidence text occurrences (WrappedBulls →
#      <name>, wrappedbulls.com → <domain>, $WBULL → $<ticker>, etc.)
#      across the source tree. Skips binary files and node_modules.
#   7. Update Cargo.toml package name, Anchor.toml [programs.*], and
#      web/package.json name + description to the new slug.
#   8. Run verification: cargo test --lib (no SBPF needed) + tsc.
#   9. Print a "manual review" report of identifiers the script
#      DELIBERATELY did not touch (struct names like WrapBull, file
#      names containing "bull", etc.) — these require human judgement.
#
# Anti-patterns this script intentionally avoids:
#   - Touching .git history (operator's responsibility — see prerequisite 2).
#   - Renaming Rust structs (high risk of breaking tests + IDL).
#   - Renaming source files (high risk of breaking module paths).
#   - Network calls (everything is local). No remote pushes.

set -euo pipefail

# ---------- helpers --------------------------------------------------

usage() {
  cat <<'EOF'
Usage:
  ./scripts/clone_to_new_project.sh \
    --name "<Project Name>"          # e.g. "Rocks"
    --ticker "<TICKER>"              # e.g. "ROCK"
    --unit-singular "<Unit>"         # e.g. "Rock" (PascalCase singular)
    --domain "<host>"                # e.g. "cryptorocks.fun"
    --royalty-bps <int>              # e.g. 500 (5%)
    --treasury <pubkey>              # base58 Solana pubkey
    --twitter "<handle>"             # e.g. "@cryptorocksfun"
    [--twitter-url "<url>"]          # optional, derived from handle if omitted
    [--max-supply <int>]             # default: 1000
    [--tokens-per-nft <int>]         # default: 1_000_000
    [--token-decimals <int>]         # default: 6 (pump.fun standard)
    [--package-slug <slug>]          # default: lowercased <Unit>+"peg" (e.g. "rockpeg")
    [--skip-verify]                  # skip cargo test + tsc at end

After this script: review the printed "manual review" report. Edit any
remaining brand strings the script flagged, then commit.
EOF
}

red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }

require() {
  for cmd in "$@"; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      red "missing required command: $cmd"
      exit 1
    fi
  done
}

# Cross-platform in-place sed. GNU sed wants `-i ''` to NOT use a
# backup ext; BSD/macOS sed wants the empty string explicitly. This
# wrapper handles both.
inplace_sed() {
  local pattern="$1"
  shift
  if sed --version >/dev/null 2>&1; then
    # GNU
    sed -i -e "$pattern" "$@"
  else
    # BSD
    sed -i '' -e "$pattern" "$@"
  fi
}

# ---------- argparse -------------------------------------------------

NAME=""
TICKER=""
UNIT_SINGULAR=""
DOMAIN=""
ROYALTY_BPS=""
TREASURY=""
TWITTER=""
TWITTER_URL=""
MAX_SUPPLY=1000
TOKENS_PER_NFT=1000000
TOKEN_DECIMALS=6
PACKAGE_SLUG=""
SKIP_VERIFY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)            NAME="$2"; shift 2 ;;
    --ticker)          TICKER="$2"; shift 2 ;;
    --unit-singular)   UNIT_SINGULAR="$2"; shift 2 ;;
    --domain)          DOMAIN="$2"; shift 2 ;;
    --royalty-bps)     ROYALTY_BPS="$2"; shift 2 ;;
    --treasury)        TREASURY="$2"; shift 2 ;;
    --twitter)         TWITTER="$2"; shift 2 ;;
    --twitter-url)     TWITTER_URL="$2"; shift 2 ;;
    --max-supply)      MAX_SUPPLY="$2"; shift 2 ;;
    --tokens-per-nft)  TOKENS_PER_NFT="$2"; shift 2 ;;
    --token-decimals)  TOKEN_DECIMALS="$2"; shift 2 ;;
    --package-slug)    PACKAGE_SLUG="$2"; shift 2 ;;
    --skip-verify)     SKIP_VERIFY=1; shift ;;
    -h|--help)         usage; exit 0 ;;
    *) red "unknown flag: $1"; usage; exit 1 ;;
  esac
done

for var in NAME TICKER UNIT_SINGULAR DOMAIN ROYALTY_BPS TREASURY TWITTER; do
  if [[ -z "${!var}" ]]; then
    flag_name="$(printf '%s' "$var" | tr '[:upper:]' '[:lower:]' | tr '_' '-')"
    red "missing required flag: --$flag_name"
    usage; exit 1
  fi
done

# Derived case forms of the unit singular.
UNIT_LOWER="$(printf '%s' "$UNIT_SINGULAR" | tr '[:upper:]' '[:lower:]')"
UNIT_UPPER="$(printf '%s' "$UNIT_SINGULAR" | tr '[:lower:]' '[:upper:]')"
PACKAGE_SLUG="${PACKAGE_SLUG:-${UNIT_LOWER}peg}"

# Default twitter URL if not provided. Strip leading @.
if [[ -z "$TWITTER_URL" ]]; then
  TWITTER_HANDLE_NO_AT="${TWITTER#@}"
  TWITTER_URL="https://x.com/${TWITTER_HANDLE_NO_AT}"
fi

# ---------- preflight ------------------------------------------------

require git solana cargo node npm sed

if [[ ! -f "config/launch.toml" || ! -d "programs/wrappedbulls" ]]; then
  red "not in a baseline-shaped repo (expected config/launch.toml + programs/wrappedbulls/ at pwd)"
  red "did you run this from the cloned project root?"
  exit 1
fi

if [[ -f "target/deploy/${PACKAGE_SLUG}-keypair.json" ]]; then
  red "target/deploy/${PACKAGE_SLUG}-keypair.json already exists. Refusing to overwrite."
  red "Delete it manually if you really want a new keypair, then re-run."
  exit 1
fi

bold "=== clone_to_new_project ==="
echo "name:           $NAME"
echo "ticker:         $TICKER"
echo "unit_singular:  $UNIT_SINGULAR (lower=$UNIT_LOWER, upper=$UNIT_UPPER)"
echo "domain:         $DOMAIN"
echo "royalty_bps:    $ROYALTY_BPS"
echo "treasury:       $TREASURY"
echo "twitter:        $TWITTER"
echo "twitter_url:    $TWITTER_URL"
echo "max_supply:     $MAX_SUPPLY"
echo "tokens_per_nft: $TOKENS_PER_NFT"
echo "token_decimals: $TOKEN_DECIMALS"
echo "package_slug:   $PACKAGE_SLUG"
echo

# ---------- 1. Generate fresh program keypair ------------------------

mkdir -p target/deploy
KEYPAIR_PATH="target/deploy/${PACKAGE_SLUG}-keypair.json"
solana-keygen new --no-bip39-passphrase --silent --outfile "$KEYPAIR_PATH" >/dev/null
PROGRAM_ID="$(solana address -k "$KEYPAIR_PATH")"
green "[1/9] Generated program keypair: $PROGRAM_ID"
echo "       Stored at: $KEYPAIR_PATH"

# ---------- 2. Rewrite config/launch.toml ----------------------------

cat > config/launch.toml <<EOF
# launch.toml — single source of truth for $NAME.
# See docs/ARCHITECTURE.md §1 for what each field controls.
# Edit values here → re-run \`anchor build\` (regenerates Rust constants)
# → re-run \`npm run sync-config\` (regenerates web/lib/launch-config.generated.ts).

[project]
name          = "$NAME"
unit_singular = "$UNIT_SINGULAR"
ticker        = "$TICKER"
domain        = "$DOMAIN"

[supply]
max_supply     = $MAX_SUPPLY
tokens_per_nft = $TOKENS_PER_NFT
token_decimals = $TOKEN_DECIMALS

[royalty]
bps             = $ROYALTY_BPS
treasury_pubkey = "$TREASURY"

[metadata]
collection_uri   = "https://$DOMAIN/api/metadata/collection"
nft_uri_template = "https://$DOMAIN/api/metadata/{tier}"

[program]
id = "$PROGRAM_ID"
EOF
green "[2/9] Wrote config/launch.toml"

# ---------- 3. Rewrite web/config/brand.json -------------------------

cat > web/config/brand.json <<EOF
{
  "\$schema-note": "Web-only brand surface. project/ticker/domain/royalty live in config/launch.toml.",

  "social": {
    "twitter":     "$TWITTER",
    "twitter_url": "$TWITTER_URL",
    "github":      null,
    "discord":     null,
    "telegram":    null
  },

  "art": {
    "mascot_path":   "/mascot.png",
    "banner_path":   "/banner.png",
    "favicon_path":  "/favicon.ico",
    "og_image_path": "/og.png"
  },

  "copy": {
    "tagline":       "Trade-as-mint NFTs on Solana.",
    "hero_subtitle": "Lock $TOKENS_PER_NFT \$$TICKER into a unique on-chain $UNIT_SINGULAR. Sell the NFT, the tokens follow.",
    "description":   "$NAME is an ERC404-style hybrid token-NFT layer on top of a pump.fun token. Each $UNIT_LOWER NFT carries $(printf "%'d" $TOKENS_PER_NFT) \$$TICKER in an NFT-owned vault; the tokens follow the NFT through every transfer.",
    "footer_blurb":  "Built on Solana. Permissionless wrap and unwrap. Vault-follows-NFT mechanic."
  },

  "colors": {
    "bg":          "#0a0a0c",
    "card":        "#15151a",
    "card_hi":     "#1c1c24",
    "accent":      "#f0d028",
    "accent_hi":   "#fff0a0",
    "ink":         "#e8e4dc",
    "dim":         "#8a8a92",
    "brown":       "#7a4a2a",
    "pasture_top": "#a8d878",
    "pasture_bot": "#6c9844",
    "success":     "#3acf6b",
    "danger":      "#e84848"
  },

  "analytics": {
    "plausible_domain": null,
    "umami_id": null
  }
}
EOF
green "[3/9] Wrote web/config/brand.json"

# ---------- 4. Regenerate codegen artifacts --------------------------

node scripts/sync_web_config.mjs >/dev/null
green "[4/9] Re-ran web TOML→TS generator"

# build.rs runs as part of cargo build/check; we just trigger a check
# to materialize $OUT_DIR/generated.rs with the new values.
( cargo check --manifest-path programs/wrappedbulls/Cargo.toml >/dev/null 2>&1 ) || \
  yellow "[4/9] cargo check failed; build.rs generated.rs may be stale (continuing)"

# ---------- 5. Sed-rebrand high-confidence text ----------------------

# Files to scan. Excluding: .git/, target/, node_modules/, lockfiles,
# binary assets (PNG/JPG), the bundle archive, and the generated files
# (they'll get regenerated from the configs).
mapfile -t FILES < <(git ls-files 2>/dev/null || find . \
  -type d \( -name .git -o -name target -o -name node_modules -o -name .next \) -prune -o \
  -type f -print | sed 's|^\./||')

# Filter to text files we want to touch. Exclude generated files
# (they'll regenerate), lockfiles, and binary types.
TEXT_FILES=()
for f in "${FILES[@]}"; do
  case "$f" in
    *.png|*.jpg|*.jpeg|*.gif|*.ico|*.webp|*.bundle|*.lock|*-keypair.json) ;;
    web/lib/launch-config.generated.ts) ;;
    target/*) ;;
    *) [[ -f "$f" ]] && TEXT_FILES+=("$f") ;;
  esac
done

# High-confidence replacements: unambiguous strings tied to the old
# project. Order matters — longer / more specific FIRST so shorter
# matches don't pre-empt them.
for f in "${TEXT_FILES[@]}"; do
  inplace_sed "s|wrappedbulls.com|$DOMAIN|g" "$f"
  inplace_sed "s|WrappedBulls|$NAME|g" "$f"
  inplace_sed "s|wrappedbulls|${TWITTER#@}|g" "$f"
  inplace_sed "s|@wrappedbulls|$TWITTER|g" "$f"
  inplace_sed "s|\\\$WBULL|\$$TICKER|g" "$f"
done

green "[5/9] Sed-rebranded ${#TEXT_FILES[@]} text files"

# ---------- 6. Update package metadata + program identity ------------

# --- 6a. Package names ---
# Cargo.toml package + lib names (both `name = "wrappedbulls"`). Single sed
# pass mutates both since the pattern is anchored to the start of line.
inplace_sed "s|^name = \"wrappedbulls\"|name = \"$PACKAGE_SLUG\"|" programs/wrappedbulls/Cargo.toml
inplace_sed "s|^description = \".*\"|description = \"$NAME: hybrid token-NFT layer for pump.fun-launched memecoins\"|" programs/wrappedbulls/Cargo.toml
# web/package.json name + description.
inplace_sed "s|\"name\": \"wrappedbulls-web\"|\"name\": \"${PACKAGE_SLUG}-web\"|" web/package.json
inplace_sed "s|\"description\": \"WrappedBulls website.*\"|\"description\": \"$NAME website + metadata/render API ($DOMAIN)\"|" web/package.json

# --- 6b. Program identity ---
# These are NOT brand strings — they are the program's on-chain
# identity. Getting them wrong makes `anchor deploy` deploy to the
# wrong address or fail outright, so the script MUST propagate them.
#
# Capture the OLD program ID from declare_id! BEFORE rewriting anything.
OLD_PROGRAM_ID="$(grep -oE 'declare_id!\("[1-9A-HJ-NP-Za-km-z]{32,44}"\)' \
  programs/wrappedbulls/src/lib.rs | grep -oE '[1-9A-HJ-NP-Za-km-z]{32,44}' | head -1)"
if [[ -z "$OLD_PROGRAM_ID" ]]; then
  red "could not read the old program ID from lib.rs declare_id! — aborting"
  exit 1
fi
# PascalCase of the package slug — the Anchor-generated program struct.
PASCAL_SLUG="$(printf '%s' "${PACKAGE_SLUG:0:1}" | tr '[:lower:]' '[:upper:]')${PACKAGE_SLUG:1}"

# New program ID into declare_id!, Anchor.toml, and the committed IDL.
# (config/launch.toml already got the new id when it was rewritten in
# step 2.) `anchor build` later regenerates the IDL, but fixing the
# committed copy keeps the repo consistent before that first build.
for f in programs/wrappedbulls/src/lib.rs Anchor.toml web/lib/idl.json; do
  [[ -f "$f" ]] && inplace_sed "s|$OLD_PROGRAM_ID|$PROGRAM_ID|g" "$f"
done
# Anchor.toml [programs.*] keys: wrappedbulls -> slug.
inplace_sed "s|^wrappedbulls = |$PACKAGE_SLUG = |g" Anchor.toml
# The #[program] module name + the Anchor-generated struct reference,
# so the crate / lib / program-module / Anchor.toml key / IDL name all
# agree (a mismatch confuses anchor build + deploy).
inplace_sed "s|pub mod wrappedbulls|pub mod $PACKAGE_SLUG|" programs/wrappedbulls/src/lib.rs
inplace_sed "s|crate::program::Wrappedbulls|crate::program::$PASCAL_SLUG|g" \
  programs/wrappedbulls/src/instructions/initialize.rs
inplace_sed "s|\"name\": \"wrappedbulls\"|\"name\": \"$PACKAGE_SLUG\"|" web/lib/idl.json
# On-chain log string.
inplace_sed "s|\"Wrappedbulls initialized|\"$NAME initialized|" \
  programs/wrappedbulls/src/instructions/initialize.rs

green "[6/9] Updated package names + program identity"
echo "       program id:  $OLD_PROGRAM_ID  ->  $PROGRAM_ID"
echo "       program mod: wrappedbulls -> $PACKAGE_SLUG   struct: Wrappedbulls -> $PASCAL_SLUG"

# ---------- 7. Verification ------------------------------------------

if [[ $SKIP_VERIFY -eq 1 ]]; then
  yellow "[7/9] Skipping verification (--skip-verify)"
else
  echo "[7/9] Verifying: cargo test --lib ..."
  if cargo test --manifest-path programs/wrappedbulls/Cargo.toml --lib 2>&1 | tail -3; then
    green "[7/9] cargo test --lib passed"
  else
    red "[7/9] cargo test --lib FAILED — investigate before continuing"
    exit 1
  fi

  echo "[8/9] Verifying: web typecheck ..."
  ( cd web && npx tsc --noEmit ) && green "[8/9] tsc --noEmit passed" || {
    yellow "[8/9] tsc --noEmit failed — likely a leftover brand string. Inspect."
  }
fi

# ---------- 8. Manual review report ----------------------------------

bold ""
bold "=== [9/9] MANUAL REVIEW REPORT ==="
echo
echo "The script handled the high-confidence renames. The following may"
echo "still need human attention (review each before committing):"
echo
echo "--- Rust struct / identifier names (kept intentionally — tests"
echo "    + IDL reference them; rename only if you understand the blast"
echo "    radius):"
grep -rEnH 'WrapBull|UnwrapBull|BullBank|BullAsset|MAX_BULLS|TOKENS_PER_BULL' \
  programs/ tests/ web/lib/idl.json 2>/dev/null | head -20 || true
echo
echo "--- Files named with the old slug (manual rename if you care):"
git ls-files 2>/dev/null | grep -iE 'bull|wrappedbulls' | head -20 || \
  find . -path ./target -prune -o -path ./node_modules -prune -o \
       -type f -iname '*bull*' -print 2>/dev/null | head -20
echo
echo "--- Remaining 'bull'/'wrappedbulls' occurrences — review each; mostly"
echo "    comments + the programs/wrappedbulls/ directory name (left as-is;"
echo "    the crate inside is already renamed, dir name is cosmetic):"
grep -rinH --include='*.rs' --include='*.ts' --include='*.tsx' --include='*.toml' \
  -E '\bbull' programs/ web/ scripts/ tests/ 2>/dev/null | head -25 || true
echo
yellow "Next steps:"
echo "  1. Review the report above. Apply manual edits as needed."
echo "  2. Swap art assets: web/public/{mascot,banner,og,favicon}.{png,ico}"
echo "  3. Edit docs/ to remove dead references."
echo "  4. cd web && npm install (if you haven't already)."
echo "  5. cd .. && anchor build  # full SBPF compile against new program ID"
echo "  6. anchor test  # runs the integration suite against the new id"
echo "  7. git add -A && git commit -m 'init: $NAME baseline'"
echo "  8. (When ready) see docs/RELAUNCH_PLAYBOOK.md for deploy sequence."
echo
green "Done. New baseline: $NAME ($TICKER) at program $PROGRAM_ID"
