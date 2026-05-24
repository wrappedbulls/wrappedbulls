# Deploy: zero downtime blue green web hosting

How the web tier is hosted and deployed. Internal reference.

The hard requirement behind this whole design: **the website never
goes down.** A rebuild in place can 502 the site at the worst
possible moment; blue green removes the downtime window entirely.

## CARDINAL RULE: never take the live site down to fix something

If something is wrong with the live site, **the live site stays up**
while it is corrected. You do NOT:

- restart or rebuild the **live** instance to "quickly fix" it,
- edit the live checkout / live bundle in place,
- stop the web service to make a change.

Every fix is made on the **standby** color (a separate checkout , 
see the model below), built, health-checked, and cut over only once
it is proven healthy. If a fix turns out wrong, the live color never
moved. zero downtime. An outage is never an acceptable price for a
fix. This rule holds during launches above all else.

For the full uptime guarantee analysis. including the one honest
residual risk (a single VPS). see [`UPTIME.md`](UPTIME.md).

## Model

```
                  ┌─────────┐
  browser ────────┤  Caddy  │  TLS terminator
                  └────┬────┘
                       │ import upstream.conf  ← rewritten per deploy
                       │ lb_policy first + active health checks
            ┌──────────┴───────────┐
            ▼                      ▼
   ┌──────────────────┐   ┌──────────────────┐
   │  web-blue :3001  │   │  web-green :3002 │
   │  <blue-dir>/web  │   │  <green-dir>/web │   SEPARATE checkouts , 
   │  own .next       │   │  own .next       │   own node_modules, own
   └──────────────────┘   └──────────────────┘   build. Never shared.
```

- Two systemd services, `<slug>-web-blue` (:3001) and
  `<slug>-web-green` (:3002), each running from its **own separate
  checkout directory**. A deploy of one physically cannot touch the
  other's build artifacts. (An earlier design shared one `.next` , 
  that flaw is fixed; see [`UPTIME.md`](UPTIME.md).)
- Caddy lists **both** upstreams with `lb_policy first` + active
  health checks. All traffic goes to the first healthy one; the other
  is a **hot spare**. If the active instance crashes, Caddy fails over
  to the spare within ~one health interval (3s). no operator action.
- A deploy builds the **standby** checkout, health-checks it, then
  atomically rewrites `upstream.conf` to list the standby first and
  `caddy reload`s (graceful. no dropped connections).
- The previous color is **left running** on its previous build: it is
  both the instant rollback target and the crash-failover spare.

## One-time setup

1. **Pick a slug**. the systemd service prefix, e.g. `rockpeg`.

2. **Create two separate checkouts.** Each color is its own full clone
   so a deploy of one never touches the other:
   ```bash
   sudo mkdir -p /srv/<slug>
   git clone <repo-or-bundle> /srv/<slug>/blue
   git clone <repo-or-bundle> /srv/<slug>/green
   ( cd /srv/<slug>/blue/web  && npm ci && npm run build )
   ( cd /srv/<slug>/green/web && npm ci && npm run build )
   ```

3. **Install both systemd units.** Copy the templates from
   [`deploy/systemd/`](../deploy/systemd/), replace the placeholders
   (`__SLUG__`, `__USER__`, and `__BLUE_DIR__` / `__GREEN_DIR__` , 
   note the blue and green units point at DIFFERENT directories):
   ```bash
   sudo cp deploy/systemd/PROJECT-web-blue.service  /etc/systemd/system/<slug>-web-blue.service
   sudo cp deploy/systemd/PROJECT-web-green.service /etc/systemd/system/<slug>-web-green.service
   # blue unit:  __BLUE_DIR__  = /srv/<slug>/blue
   # green unit: __GREEN_DIR__ = /srv/<slug>/green
   sudo systemctl daemon-reload
   sudo systemctl enable <slug>-web-blue <slug>-web-green
   ```

4. **Create the secrets env file** `/etc/<slug>/web.env` (referenced
   by both units, never committed):
   ```
   SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<KEY>
   LAUNCH_STATE_FILE=/var/lib/<slug>/state.json
   GIT_SHA=<filled by the deploy, optional>
   ```
   `chmod 600` it. The Helius key lives ONLY here. never in the repo,
   never in `NEXT_PUBLIC_*` (it would land in the client bundle).

5. **Create the runtime launch-state file** the operator flips:
   ```bash
   sudo mkdir -p /var/lib/<slug>
   LAUNCH_STATE_FILE=/var/lib/<slug>/state.json \
     ./scripts/set_launch_state.sh pre-launch
   ```

6. **Install the Caddy config.** From [`deploy/caddy/`](../deploy/caddy/):
   ```bash
   sudo cp deploy/caddy/Caddyfile.example     /etc/caddy/Caddyfile      # set __DOMAIN__
   sudo cp deploy/caddy/upstream.conf.example /etc/caddy/upstream.conf  # both upstreams, blue first
   sudo systemctl reload caddy
   ```

7. **First boot.** Start both instances:
   ```bash
   sudo systemctl start <slug>-web-blue <slug>-web-green
   ```

## Deploying

```bash
./scripts/blue_green_deploy.sh --slug <slug> \
  --blue-dir /srv/<slug>/blue --green-dir /srv/<slug>/green
```

First make sure the **standby** checkout has the code you want to
ship (`git -C /srv/<slug>/<standby> pull`). The script then acquires
the deploy lock, builds the standby checkout, restarts the standby
instance, waits for `/api/launch-state` on the standby port to answer
200, rewrites `upstream.conf` to put the standby first, and
`caddy reload`s. If the build fails or the new instance never gets
healthy, it aborts **before** the swap. the live color keeps serving.
No downtime, no half-deploy.

## Rolling back

The previous color is still running the previous build. Swap back:

```bash
./scripts/blue_green_deploy.sh --slug <slug> \
  --blue-dir /srv/<slug>/blue --green-dir /srv/<slug>/green --skip-build
```

`--skip-build` skips the rebuild and just swaps to the other color , 
typically a sub-second cutover.

## Proving it stays up

`scripts/uptime_drill.sh` hammers the live URL while you run a deploy /
rollback / crash in another terminal, and reports any failed request.
A clean run is the empirical proof. See [`UPTIME.md`](UPTIME.md) for
the procedure. it is a required P6 pre-relaunch drill.

## Flipping launch state (separate from deploying)

Going live / rolling back the **launch state** (pre-launch ↔ live) is
NOT a deploy. it is a single file write picked up on the next request:

```bash
./scripts/set_launch_state.sh live --mint <TOKEN_MINT>
./scripts/set_launch_state.sh pre-launch          # roll back
./scripts/set_launch_state.sh status
```

See [`web/lib/launch-state.ts`](../web/lib/launch-state.ts).

## Observability

- `/api/health`. chain reachability, process stats, launch state,
  build version. Returns 503 if the chain is unreachable. Wire
  UptimeRobot here.
- `/status`. human-readable page rendering `/api/health` +
  `/api/rpc` proxy metrics.
- `journalctl -u <slug>-web-blue -f` (or `-green`). instance logs.

## Why the deploy probes /api/launch-state, not /api/health

`/api/health` returns 503 when the Solana RPC is degraded. That is
correct for an uptime monitor but wrong for a deploy readiness probe:
a degraded RPC must not fail a deploy whose web tier is perfectly
fine. `/api/launch-state` is served purely by Next.js with no external
dependency, so a 200 from it means exactly "the new instance is up".

## Failure modes this design removes

| Old failure                                  | Now |
|-----------------------------------------------|-----|
| Rebuild-in-place 502s the site                | Standby is a separate checkout, built + verified before any cutover |
| A broken build takes the site down            | Deploy aborts pre-swap; live color untouched |
| Rollback needs a rebuild (minutes of 502)     | `--skip-build` swap, sub-second |
| Active process crashes                        | Caddy active-health-check failover to the hot spare (~3s) |
| Two deploys race                              | flock deploy lock, second aborts |
| `NEXT_PUBLIC` launch-state baked into bundle  | Runtime `/api/launch-state` + `set_launch_state.sh` |

For the failure mode this design does NOT remove. total VPS loss , 
and what to do about it, see [`UPTIME.md`](UPTIME.md) "the one honest
gap".
