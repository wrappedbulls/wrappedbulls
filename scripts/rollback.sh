#!/usr/bin/env bash
# Emergency rollback: restore pre-launch gated state in ~30s.
# Requires that fire_at_launch.sh ran step 1 (backup) before any flip.
set -uo pipefail

WEB_LIVE="/opt/wrappedbulls-web"
WEB_BACKUP="/opt/wrappedbulls-web.prelaunch-backup"

echo "=== ROLLBACK $(date -u) ==="
if [ ! -d "$WEB_BACKUP" ]; then
  echo "NO BACKUP at $WEB_BACKUP -- refuse to rollback (no safe state to restore)"
  exit 1
fi

systemctl stop wrappedbulls-web
rm -rf "$WEB_LIVE"
cp -a "$WEB_BACKUP" "$WEB_LIVE"
rm -f /etc/systemd/system/wrappedbulls-web.service.d/launch.conf
systemctl daemon-reload
systemctl start wrappedbulls-web
sleep 3
systemctl is-active wrappedbulls-web
echo ""
echo "homepage state after rollback:"
curl -s -m 8 https://wrappedbulls.com | grep -oE "Launching soon|live|Wrap" | head -3
echo ""
echo "NOTE: on-chain initialize is IRREVERSIBLE. This rollback only re-gates the site UI."
echo "The mainnet bank + collection remain initialized. Re-flipping forward is just re-running fire_at_launch.sh."
echo "=== ROLLBACK DONE $(date -u) ==="
