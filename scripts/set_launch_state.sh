#!/bin/bash
# Atomic launch-state flip. No rebuild, no restart. Effect is immediate
# on the next /api/launch-state read (file is read fresh per request).
#
# Install location on the VPS: /usr/local/bin/wrappedbulls-set-launch-state
#
# Usage on the VPS:
#   wrappedbulls-set-launch-state pre-launch         # rollback
#   wrappedbulls-set-launch-state live <TOKEN_MINT>  # go live with the
#                                                    # $WBULL mint
#
# After running, the script curls /api/launch-state so you can see the
# flipped value. The site never goes down for this. Caddy stays up,
# both Next.js colors keep serving, only the file under
# /var/lib/wrappedbulls/state.json changes.
set -eu
STATE_FILE=/var/lib/wrappedbulls/state.json
ARG=${1:-}
case "$ARG" in
  pre-launch)
    NEW=$(printf '{"state":"pre-launch","tokenMint":null,"updatedAt":"%s"}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
    ;;
  live)
    MINT=${2:-}
    if [ -z "$MINT" ]; then
      echo "usage: $0 live <TOKEN_MINT>"
      exit 2
    fi
    NEW=$(printf '{"state":"live","tokenMint":"%s","updatedAt":"%s"}' "$MINT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
    ;;
  *)
    echo "usage: $0 pre-launch | live <TOKEN_MINT>"
    echo "current state file:"
    cat "$STATE_FILE" 2>/dev/null || echo "(no state file at $STATE_FILE)"
    echo ""
    echo "live API view:"
    curl -s https://wrappedbulls.com/api/launch-state || true
    echo
    exit 2
    ;;
esac
echo "$NEW" > "${STATE_FILE}.new"
mv "${STATE_FILE}.new" "$STATE_FILE"
echo "OK. new state file:"
cat "$STATE_FILE"
echo
echo "live API view (should match):"
curl -s https://wrappedbulls.com/api/launch-state
echo
