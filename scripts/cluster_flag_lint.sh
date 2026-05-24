#!/usr/bin/env bash
# cluster_flag_lint.sh — catch the Anchor-vs-Solana cluster-name trap.
#
# THE BUG (docs/LESSONS_LEARNED.md L5): the Solana CLI and the Anchor
# CLI use DIFFERENT names for mainnet.
#   - Solana CLI:  solana config set --url mainnet-beta     (correct)
#   - Anchor CLI:  anchor deploy --provider.cluster mainnet  (correct)
# Passing the Solana name to Anchor silently no-ops in some code paths.
# Last launch this cost 30+ minutes of fake-successful deploys.
#
# This linter scans executable scripts + Anchor.toml for the bad
# pairing and fails closed. Run it before any deploy and in CI.
#
# Docs (*.md) are NOT scanned — they deliberately quote the bad
# pattern as a teaching example.
#
# Exit codes: 0 = clean, 1 = a bad pairing was found.

set -euo pipefail

red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$*"; }

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SELF="scripts/$(basename "${BASH_SOURCE[0]}")"
FAIL=0

# Enumerate files to scan. We want tracked AND untracked files (a
# bad flag in a script someone just wrote, not yet committed, must
# still be caught) — but NOT gitignored files (target/, node_modules/).
# `--cached --others --exclude-standard` gives exactly that, instantly.
# Fall back to a pruned find if this is somehow not a git repo.
list_files() {
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git ls-files --cached --others --exclude-standard
  else
    find . -type d \( -name .git -o -name node_modules -o -name target \) -prune -o \
         -type f -print | sed 's|^\./||'
  fi
}

# The bad pattern: `anchor` ... `--provider.cluster` ... `mainnet-beta`
# on a single line. Matched only in files that actually run.
BAD_RE='--provider\.cluster[= ]+mainnet-beta'

echo "[1/2] Scanning *.sh + package.json for the bad Anchor cluster flag ..."
while IFS= read -r file; do
  [[ "$file" == "$SELF" ]] && continue          # don't flag this linter
  case "$file" in
    *.sh|*/package.json|package.json) ;;        # scan these
    *) continue ;;                              # skip everything else
  esac
  [[ -f "$file" ]] || continue
  # -e marks the pattern explicitly — required because BAD_RE starts
  # with '--', which grep would otherwise parse as an option.
  if matches="$(grep -nE -e "$BAD_RE" "$file" || true)"; then
    if [[ -n "$matches" ]]; then
      red "  BAD: $file"
      echo "$matches" | sed 's/^/       /'
      FAIL=1
    fi
  fi
done < <(list_files)

echo "[2/2] Checking Anchor.toml section names ..."
if [[ -f Anchor.toml ]]; then
  if grep -qE '^\[programs\.mainnet-beta\]' Anchor.toml; then
    red "  BAD: Anchor.toml has [programs.mainnet-beta] — must be [programs.mainnet]"
    FAIL=1
  else
    green "  Anchor.toml section names OK"
  fi
else
  yellow "  Anchor.toml not found (skipping)"
fi

echo
if [[ $FAIL -eq 0 ]]; then
  green "cluster_flag_lint: PASS — no Anchor/mainnet-beta mismatches."
  exit 0
else
  red "cluster_flag_lint: FAIL — fix the above before deploying."
  red "Reminder: Anchor wants 'mainnet'. Solana CLI wants 'mainnet-beta'."
  exit 1
fi
