#!/usr/bin/env bash
# verified_build.sh — deterministic program build via solana-verify,
# then print the executable hash. See docs/VERIFIABLE_BUILD.md.
#
# The hash this prints is the fingerprint you deploy and register. A
# verified program is a real trust signal during Phantom / explorer
# review — worth the extra step for a fresh memecoin.
#
# Usage:
#   ./scripts/verified_build.sh
#
# Requires: Docker running, `solana-verify` installed
#   (cargo install solana-verify).

set -euo pipefail

red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v solana-verify >/dev/null 2>&1; then
  red "solana-verify not found. Install it:  cargo install solana-verify"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  red "Docker is not running. solana-verify builds inside a container."
  exit 1
fi

# Cargo.lock must be committed for a reproducible dependency tree.
if [[ ! -f Cargo.lock ]]; then
  red "Cargo.lock is missing — a verifiable build needs a locked"
  red "dependency tree. Run 'cargo generate-lockfile' and commit it."
  exit 1
fi

green "[1/2] Running deterministic build (solana-verify build) ..."
solana-verify build

# Locate the produced .so.
SO_FILE="$(ls target/deploy/*.so 2>/dev/null | head -1 || true)"
if [[ -z "$SO_FILE" || ! -f "$SO_FILE" ]]; then
  red "build finished but no target/deploy/*.so found."
  exit 1
fi

green "[2/2] Executable hash:"
HASH="$(solana-verify get-executable-hash "$SO_FILE")"
echo
green "  artifact: $SO_FILE"
green "  sha256:   $HASH"
echo
echo "Next:"
echo "  1. Deploy THIS artifact (do not rebuild with plain anchor build)."
echo "  2. After deploy, confirm it matches on-chain:"
echo "       solana-verify get-program-hash <PROGRAM_ID> --url mainnet-beta"
echo "  3. Register: solana-verify verify-from-repo ... (see docs/VERIFIABLE_BUILD.md)"
