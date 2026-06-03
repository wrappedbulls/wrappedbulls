#!/usr/bin/env bash
# factory_prelaunch_smoke.sh - HTTP-level smoke test for the launch surface.
#
# Run this against the green slot BEFORE the Caddy flip in Step 7 of
# FACTORY_LAUNCH_RUNBOOK.md. Catches stupid bugs (missing pages, 500
# from server side render, env var misconfigured) in 30 seconds before
# the public surface goes live.
#
# Default target: http://localhost:3001 (the green slot during blue green).
# Override: BASE_URL=https://staging.wrappedbulls.com ./factory_prelaunch_smoke.sh
#
# Exit codes: 0 = all smoke routes responded as expected, 1 = at least
# one failed (the script keeps going to surface every failure, then exits 1
# at the end).

set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
TIMEOUT_S=10

red()    { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

FAIL=0
PASS_COUNT=0
FAIL_COUNT=0

check_route() {
  local path="$1"
  local expected_status="$2"
  local expected_substring="${3:-}"

  local url="${BASE_URL}${path}"
  local response
  response=$(curl -s --max-time "${TIMEOUT_S}" -o /tmp/smoke_body.txt -w '%{http_code}' "$url" || echo "000")
  local status="$response"

  if [ "$status" != "$expected_status" ]; then
    red "FAIL ${path} -> ${status} (expected ${expected_status})"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAIL=1
    return
  fi

  if [ -n "$expected_substring" ]; then
    if ! grep -q "$expected_substring" /tmp/smoke_body.txt; then
      red "FAIL ${path} -> status ok but body missing '${expected_substring}'"
      FAIL_COUNT=$((FAIL_COUNT + 1))
      FAIL=1
      return
    fi
  fi

  green "OK   ${path}"
  PASS_COUNT=$((PASS_COUNT + 1))
}

check_json_field() {
  local path="$1"
  local jq_path="$2"
  local expected_value="$3"

  local url="${BASE_URL}${path}"
  local actual
  actual=$(curl -s --max-time "${TIMEOUT_S}" "$url" | jq -r "$jq_path" 2>/dev/null || echo "")

  if [ "$actual" != "$expected_value" ]; then
    red "FAIL ${path} ${jq_path} = '${actual}' (expected '${expected_value}')"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAIL=1
    return
  fi

  green "OK   ${path} ${jq_path} = ${expected_value}"
  PASS_COUNT=$((PASS_COUNT + 1))
}

echo "Smoke testing ${BASE_URL}"
echo

# ----- Public pages -----
check_route "/"                "200" "WRAPPEDBULLS"
check_route "/launch"          "200" "launch"
check_route "/launch/new"      "200" ""
check_route "/launches"        "200" ""
check_route "/launch/embed"    "200" ""
check_route "/launch/treasury" "200" ""
check_route "/launch/health"   "200" "FACTORY HEALTH"
check_route "/terms"           "200" "Terms of use"
check_route "/faq"             "200" "FAQ"
check_route "/security"        "200" "WrappedFactory program"
check_route "/wrap"            "200" ""
check_route "/unwrap"          "200" ""
check_route "/gallery"         "200" ""
check_route "/status"          "200" ""

# ----- Public API endpoints -----
check_route "/api/factory/activity"   "200" ""
check_route "/api/factory/health"     "200" "programId"
check_route "/api/health"             "200" ""

# ----- Embed asset -----
check_route "/embed.js"        "200" ""

# ----- /api/factory/health field assertions -----
check_json_field "/api/factory/health" ".programId" "WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh"
check_json_field "/api/factory/health" ".cluster" "mainnet"

# ----- Canary allowlist check (if configured to reject non-allowlisted) -----
# Post a deploy attempt from a wallet that is NOT in the allowlist; expect
# HTTP 403 with code=canary. Skip if FACTORY_CANARY_ALLOWLIST is unset on
# the server (the route accepts everyone).
echo
echo "Canary gate probe (will succeed if allowlist active, skip otherwise):"
canary_status=$(curl -s --max-time "${TIMEOUT_S}" -o /tmp/smoke_canary.txt -w '%{http_code}' \
  -X POST "${BASE_URL}/api/factory/deploy-tx" \
  -H "Content-Type: application/json" \
  -d '{"deployer":"3rNh9TXTKkz9k1xQGtjF7t9j8VWHHM2bn5gB5pZmXxiQ","tokenMint":"So11111111111111111111111111111111111111112","name":"Smoke","ticker":"SMK","maxSupply":100,"tokensPerWrap":"1000000","artSource":{"kind":"baseUri","uri":"https://example.com/"},"collectionUri":"https://example.com/c"}' || echo "000")
if [ "$canary_status" = "403" ] && grep -q '"code":"canary"' /tmp/smoke_canary.txt; then
  green "OK   canary allowlist is active and rejecting non listed wallets"
  PASS_COUNT=$((PASS_COUNT + 1))
elif [ "$canary_status" = "400" ] || [ "$canary_status" = "200" ]; then
  yellow "INFO canary allowlist appears INACTIVE (status ${canary_status}); this is expected post launch"
else
  yellow "INFO canary probe got status ${canary_status}, not asserting"
fi

# ----- Summary -----
echo
if [ "$FAIL" -eq 0 ]; then
  green "SMOKE TEST PASSED (${PASS_COUNT} checks)"
  exit 0
else
  red "SMOKE TEST FAILED (${PASS_COUNT} passed, ${FAIL_COUNT} failed)"
  exit 1
fi
