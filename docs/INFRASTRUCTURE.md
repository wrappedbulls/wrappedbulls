# Infrastructure (live state)

Snapshot of the production infrastructure running https://wrappedbulls.com as of 2026-05-27. This is the canonical reference. If you change something on the VPS, update this file.

## DigitalOcean droplet

- IP: `165.22.167.96`
- Ubuntu 24.04, 1 vCPU / 2 GB RAM / 70 GB disk
- SSH per [`reference_ssh`](../../.claude/memory/reference_ssh.md): `ssh -i ~/.ssh/id_ed25519 root@165.22.167.96`
- DigitalOcean snapshots: **NOT ENABLED YET** (action item; ~$1.20/mo enables ~20 min disaster recovery)

## DNS

- `wrappedbulls.com` and `www.wrappedbulls.com` A records → `165.22.167.96` (Namecheap)

## Caddy (reverse proxy + TLS)

- Active provider: ZeroSSL DV (switched from Lets Encrypt due to LE outage 2026-05-08)
- Certs auto renew
- Config: `/etc/caddy/Caddyfile` (backed up to `/etc/caddy/Caddyfile.bak.YYYYMMDD-HHMMSS-*` on every change)
- Reload via admin API (zero downtime): `caddy reload --config /etc/caddy/Caddyfile`

### Site blocks

```
wrappedbulls.com, www.wrappedbulls.com {
  # API: blue/green Next.js, blue preferred, green takes over on health failure
  handle /api/* {
    reverse_proxy 127.0.0.1:3001 127.0.0.1:3002 {
      lb_policy first
      health_uri /api/health
      health_interval 5s
      health_timeout 3s
      fail_duration 30s
      max_fails 3
    }
  }
  # Everything else: static prelaunch HTML
  handle {
    root * /var/www/wrappedbulls
    try_files {path} {path}.html {path}/
    file_server
  }
  handle_errors {
    @404 expression {err.status_code} == 404
    rewrite @404 /404.html
    root * /var/www/wrappedbulls
    file_server
  }
}

# Catch-all for direct-IP hits or unknown hosts
:80 { redir https://wrappedbulls.com{uri} permanent }
```

## Next.js API layer (blue/green)

Both instances run the same standalone Next.js bundle from `web/`. Same env. Different ports.

| Color | Service | Port | Working Dir |
|---|---|---|---|
| Blue | `wrappedbulls-web.service` | 3001 | `/opt/wrappedbulls-web` |
| Green | `wrappedbulls-web-green.service` | 3002 | `/opt/wrappedbulls-web-green` |

### systemd env (both colors share)

```
NODE_ENV=production
PORT=3001 (or 3002)
HOSTNAME=127.0.0.1
NEXT_PUBLIC_PROGRAM_ID=F7qXskG73efUwbDo2B97tZgpPAqX7zHMApXbPUimcFdS
NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<key>
NEXT_PUBLIC_LAUNCH_STATE=pre-launch
```

The Helius key is stored in systemd Environment only. Never committed. Never client-side.

### Routes served

| Route | Behavior |
|---|---|
| `/api/health` | Per-instance health JSON. Caddy active health check hits this. |
| `/api/metadata/[tier]` | Per-bull Metaplex JSON (404 if tier not currently wrapped). Marketplaces crawl this. |
| `/api/render/[tier]` | Per-bull PNG (default) or SVG. Image served at the URL referenced by /api/metadata/[tier]. |
| `/api/metadata/collection` | Collection NFT JSON (banner, mascot, description). |
| `/api/rpc` | Same-origin Solana RPC proxy. Method allowlist + per-IP 240 req / 10 s rate limit + 100 KB body cap. |
| `/api/launch-state` | Reads `/var/lib/wrappedbulls/state.json` (runtime launch state flip, no rebuild). |
| `/api/recently-wrapped` | Recent wrap activity feed. |

## Static prelaunch site

Served from `/var/www/wrappedbulls/`. Source of truth is `wrappedbulls-preview/` in this repo. Deploy via `scp wrappedbulls-preview/*.html *.png *.css root@vps:/var/www/wrappedbulls/`.

## Watchdog

- `wrappedbulls-watchdog.timer` fires every 60s
- Runs `/usr/local/bin/wrappedbulls-watchdog.sh`
- Probes `http://127.0.0.1:3001/api/health` and `http://127.0.0.1:3002/api/health`
- Restarts a color that fails 2 consecutive probes
- Caddy `lb_policy first` routes around the restarting color via its own 5s health interval
- Net effect: a hung Node process is auto-recovered within ~2 minutes; a crashed process within ~3 seconds (systemd Restart=on-failure)

## Monitoring + alerting

- UptimeRobot probes `https://wrappedbulls.com` every 5 min
- Caddy logs: `/var/log/caddy/wrappedbulls.log` (JSON)
- systemd logs: `journalctl -u wrappedbulls-web` and `-u wrappedbulls-web-green`
- Watchdog logs: `journalctl -t wrappedbulls-watchdog`

## Verified launch behavior

- **Burst load**: 200 parallel `/api/metadata/[tier]` + `/api/render/[tier]` requests complete in 2.7 s, zero 5xx (post-Helius-upgrade). Marketplace crawl will be served cleanly.
- **Zero-downtime reload**: Caddyfile changes reload via admin API without dropping connections (proven multiple times).
- **Color failover**: blue can be restarted without dropping requests (Caddy fails over to green within one health interval).

## Deploy flow for code changes to `/api/*`

1. Locally: `cd web && npm run build`
2. Stage: `cp -r .next/standalone/. /tmp/wb-stage/ && cp -r .next/static/. /tmp/wb-stage/.next/static/ && cp -r public/. /tmp/wb-stage/public/`
3. Tarball + scp to VPS
4. Extract to **STANDBY color** dir (the one NOT receiving traffic): `tar -xzf /tmp/wb-web.tar.gz -C /opt/wrappedbulls-web-green/`
5. `systemctl restart wrappedbulls-web-green`
6. Verify green is healthy: `curl http://127.0.0.1:3002/api/health`
7. To swap colors as primary: edit Caddyfile to reorder `reverse_proxy 127.0.0.1:3002 127.0.0.1:3001`, reload
8. Once green is verified live, deploy the same bundle to blue

The first-cut deploy script can just restart whichever color is currently primary — Caddy fails over to standby during the ~3 s restart. For zero-downtime hard requirement, use the manual color-swap sequence above.

## Action items still open

See [`LAUNCH_AUDIT.md`](LAUNCH_AUDIT.md) for the prioritized list. Top remaining:

- Enable DigitalOcean snapshots (~$1.20/mo) for disaster recovery
- End to end devnet rehearsal with the new program ID
- Anchor integration tests with the new program ID
- pump.fun token launch + program deploy (the actual launch sequence)
