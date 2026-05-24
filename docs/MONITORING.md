# Monitoring

What needs to be alive at all times, how to know if it isn't, and what to do if it isn't.

## What needs to be up

| Component | URL / target | Failure mode | Recovery |
|---|---|---|---|
| Web frontend | https://wrappedbulls.com/ | 5xx or timeout | `systemctl restart wrappedbulls-web` on bulls box |
| Render API | https://wrappedbulls.com/api/render/1 | 5xx, slow > 3s, wrong content-type | restart wrappedbulls-web; check Helius/Solana RPC status |
| Metadata API | https://wrappedbulls.com/api/metadata/1 | 5xx | same as render |
| Caddy / TLS | TLS valid, cert > 14 days from expiry | cert expired | Caddy auto-renews; if expired manually run `systemctl restart caddy` |
| Anchor program | program account exists on-chain | program upgraded out from under us | check `solana program show` matches expected ID |

## UptimeRobot setup (recommended — free, 5-minute resolution)

1. Sign up at https://uptimerobot.com (free tier: 50 monitors, 5-min interval)
2. Add monitor:
   - **Type:** HTTPS
   - **URL:** `https://wrappedbulls.com/api/render/1`
   - **Friendly name:** `WrappedBulls render API`
   - **Interval:** 5 minutes
   - **Timeout:** 30 seconds (PNG render can be slow on cold cache)
   - **Keyword monitoring:** off (we just want HTTP 200)
3. Add a second monitor for the landing page:
   - **URL:** `https://wrappedbulls.com/`
   - **Friendly name:** `WrappedBulls landing`
   - Same other settings
4. Configure alert contacts:
   - Email to `degencapital999@gmail.com`
   - Optional: SMS / Slack / Discord webhook
5. Public status page (optional):
   - UptimeRobot offers a free public status URL like `stats.uptimerobot.com/<your-id>`. Pin it from the website footer if you want public transparency.

## DIY alternative (no third party)

A 5-line bash loop on a separate VPS or your laptop:

```bash
# /opt/wrappedbulls-monitor.sh
while true; do
  if ! curl -sf --max-time 30 -o /dev/null https://wrappedbulls.com/api/render/1; then
    echo "$(date -u +%FT%TZ) DOWN" | tee -a /var/log/wrappedbulls-monitor.log
    # Optional: send via Telegram bot, Discord webhook, mailx, etc.
  fi
  sleep 300
done
```

Keep this off the bulls box itself — if the box is down the monitor goes down with it.

## On-chain monitoring (Day 1+)

Beyond uptime, watch for state-level anomalies:

```bash
# Daily sanity script — run via cron, alert on diff
solana account <BANK_PDA> --output json --url mainnet-beta | jq '...'
# Check: in_circulation == total_wrapped - total_unwrapped
# Check: free_tiers.length == total_unwrapped (allowing for tier cycling)
# Check: vault accounts holding exactly 1,000,000 each (fetch all, sum should equal in_circulation * 1M)
```

If the vault total doesn't equal `in_circulation * 1,000,000`, **something is wrong** — pause wraps via website (remove the wrap button) and investigate.

## Logs

```bash
# Web service (Next.js stdout/stderr)
journalctl -u wrappedbulls-web -f

# Caddy access + error
tail -f /var/log/caddy/wrappedbulls.log
journalctl -u caddy -f

# System-level (OOM, network)
dmesg -T | tail -50
journalctl --since "1 hour ago" --priority=err
```

## Resource ceilings (bulls box, 2GB RAM)

The 2GB box runs:
- Caddy (~13 MB)
- Next.js standalone server (~30 MB cold, grows to ~80-100 MB with cache + Solana web3 connection pool)
- Optional: cranker indexer (~50-100 MB if added)

Total comfortably under 200 MB — leaves ~1.7 GB free for OS / page cache. Should not hit memory pressure even at high traffic.

If we ever do hit OOM:
- Add a 4 GB swap file: `fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab`
- Or resize droplet to 4 GB (DigitalOcean panel → Resize, $24/mo vs current $18/mo)

## When things go wrong

1. **First check:** `systemctl status wrappedbulls-web caddy` — is anything dead?
2. **Then:** `journalctl -u wrappedbulls-web --since "10 minutes ago"` — what's the last error?
3. **Network:** `curl -v --max-time 10 https://api.mainnet-beta.solana.com` — is RPC reachable from the box?
4. **Disk:** `df -h /` — disk full will crash the service silently
5. **Firewall:** `ufw status` — should allow 22, 80, 443 only

## Backup

The bulls box itself isn't strictly stateful — all the state lives on Solana. But:
- The deployer keypair at `/root/.config/solana/id.json` is irreplaceable. **Cold-back the seed phrase before mainnet deploy.**
- Caddy auto-issued certs at `/var/lib/caddy/.local/share/caddy/certificates/` — Caddy will re-fetch them if lost, but you'd be without TLS for ~30 sec to a few min.
- DigitalOcean snapshots are $0.06/GB-month — enable weekly backups for $1.20/month for the 70GB box. Worth it.

## Health endpoint (TODO)

Currently no `/health` endpoint on the website. Recommended addition:

```ts
// web/app/api/health/route.ts
export async function GET() {
  // 1. Quick chain ping (1 RPC call, ~100ms)
  // 2. Cache stats (in-memory)
  // 3. Process uptime, memory
  return Response.json({ ok: true, ... });
}
```

Add this as the next polish — useful for deeper monitoring (e.g. UptimeRobot keyword check on `"ok":true`).
