#!/usr/bin/env bash
# check_unwrap_unguarded.sh — load-bearing safety invariant guard.
#
# THE INVARIANT: the unwrap instruction MUST NOT reference
# factory_config.paused or any pause-gating logic. A paused unwrap is
# fund capture: users would be unable to recover their locked tokens
# during an incident. The circuit breaker exists specifically to give
# the operator a tool that does NOT touch user funds.
#
# THE GUARD: this script greps unwrap.rs for any reference to
# factory_config or .paused. If found, it fails the build. This is a
# negative assertion, encoded as a script so it survives across
# refactors. The pause test file (wrappedfactory_pause.ts) references
# this script to point reviewers at the static check.
#
# Exit codes: 0 = unwrap is correctly unguarded, 1 = a pause guard
# has leaked into unwrap.

set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

FILE="programs/wrappedfactory/src/instructions/unwrap.rs"

if [ ! -f "$FILE" ]; then
  echo "ERROR: $FILE not found" >&2
  exit 1
fi

# We scan for two forbidden patterns:
#   1. factory_config in the Accounts struct or handler body
#   2. .paused field access (independent guard in case factory_config
#      is renamed but the underlying field reference remains)
BAD=0

if grep -nE "factory_config" "$FILE"; then
  echo "FAIL: unwrap.rs must not reference factory_config" >&2
  echo "Pausing unwrap would be fund capture. See docs/INCIDENT_RESPONSE.md." >&2
  BAD=1
fi

if grep -nE "\.paused\b" "$FILE"; then
  echo "FAIL: unwrap.rs must not reference the paused flag" >&2
  echo "Pausing unwrap would be fund capture. See docs/INCIDENT_RESPONSE.md." >&2
  BAD=1
fi

if [ "$BAD" -ne 0 ]; then
  exit 1
fi

echo "OK: unwrap is correctly unguarded by pause (users can always withdraw locked tokens)."
exit 0
