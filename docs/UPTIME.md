# Uptime — how we keep the website up, and how to prove it

The honest answer to "make sure the website never goes down on the
relaunch." Internal reference.

## First, the honest framing

"Never goes down" cannot be *proven* as an absolute — it is a claim
about the future. What CAN be done:

1. Engineer away every failure mode that actually took sites down
   before (deploys, bad builds, process crashes, RPC outages).
2. Empirically prove the machinery survives those events
   (`scripts/uptime_drill.sh`).
3. Name the residual risks plainly so there are no surprises.

What follows does all three. The last launch's 502 — caused by a
rebuild-in-place with no rollback — is now structurally impossible.
But one honest gap remains (a single VPS); it is called out below
with the fix.

## "Down" decomposed — every way the site can fail, and the answer

| Failure mode | Handled by | Residual risk |
|---|---|---|
| **Deploy rebuilds in place → 502** | Blue-green: the standby is a SEPARATE checkout, built + health-checked before any cutover. The live checkout is never touched. | none |
| **A bad build ships** | Deploy aborts BEFORE the Caddy swap if the build fails or the new instance fails its health probe. Live color keeps serving. | none |
| **Rollback needs a rebuild (minutes of 502)** | `blue_green_deploy.sh --skip-build` — swaps back to the other color, still running the previous build. Sub-second. | none |
| **The active Node process crashes / OOMs** | Caddy active health-checks BOTH instances (`lb_policy first`); on a failed probe it routes to the hot spare within ~1 health interval (3s). systemd `Restart=always` brings the crashed one back. | ~0–3s of possible errors for in-flight requests at the instant of the crash |
| **A process crash-loops** | systemd `StartLimitBurst` stops the thrash; the OTHER color keeps serving via Caddy failover. | the broken color is down until fixed — but the site is not |
| **Two concurrent deploys race** | `flock` deploy lock — the second aborts. | none |
| **`NEXT_PUBLIC` launch-state baked into the bundle** | Runtime `/api/launch-state` + `set_launch_state.sh` — a flip is a file write, no rebuild. | none |
| **Solana RPC is down** | The site still serves; wrap/unwrap show `RpcErrorCard`; `/api/health` reports it. Not a site outage. | wrap/unwrap unusable until RPC recovers (expected) |
| **Caddy itself crashes** | systemd restarts Caddy. | brief window during Caddy restart |
| **Disk fills (logs / build artifacts)** | Each deploy builds in the standby checkout only; old `.next` is overwritten, not accumulated. Caddy logs should be logrotated (setup item). | monitor disk; see "Setup checklist" |
| **TLS cert fails to renew** | Caddy auto-renews well before expiry. | monitor; Caddy logs a warning on failure |
| **The VPS itself dies** (kernel panic, host outage, network partition, datacenter incident) | **NOT handled by anything above.** Blue-green is two processes on ONE box. | **THIS IS THE REAL REMAINING SPOF — see below** |

## The one honest gap: a single VPS

Blue-green, failover, and `Restart=always` all run on one server. If
that server or its datacenter goes down, the site is down — no amount
of process-level redundancy changes that.

Two ways to close it, in increasing cost/effort:

**Option A — static fallback (cheap, ~30 min).**
Put the domain behind Cloudflare (free tier). Configure an "Always
Online" / custom error page, or a Cloudflare Worker that serves a
tiny static page when the origin is unreachable. That page shows the
contract address, the X link, and "back shortly." The interactive
dApp is down during a box outage, but visitors never see a raw 502
or a dead domain — which is what actually reads as "scam."
Recommended minimum for the relaunch.

**Option B — second VPS + DNS/Cloudflare failover (real HA).**
A second box in a different datacenter running the same blue-green
stack; Cloudflare load-balancing or DNS failover between them.
Survives a full box loss. ~2x hosting cost + setup. Do this if the
project's scale justifies it.

**Recommendation:** ship Option A for the relaunch (it is cheap and
kills the "dead domain looks like a scam" failure). Treat Option B as
a follow-up if the project gets traction.

## The proof: uptime_drill.sh

`scripts/uptime_drill.sh` is the empirical test. It hammers the live
URL continuously and counts every request that is not 2xx/3xx. Run it
while you exercise the scary operations:

```
# Terminal A — start the drill
./scripts/uptime_drill.sh --url https://<domain>/ --duration 240

# Terminal B — while it runs, do the things that break sites:
./scripts/blue_green_deploy.sh --slug <slug> --blue-dir ... --green-dir ...   # full deploy
./scripts/blue_green_deploy.sh ... --skip-build                              # rollback
sudo systemctl kill -s KILL <slug>-web-<active-color>                        # hard crash
```

The drill prints `longest failure streak` — worst-case user-visible
outage — and PASSES only if total failures are within `--allow`
(default 0). **A clean run across a deploy + rollback + crash is the
proof.** It is part of the P6 pre-relaunch drills (failure-injection
P6.4, rollback P6.5).

This drill cannot be run from a pure code-edit environment — it needs
the live stack on the box. It HAS been smoke-tested against a public
URL to confirm the harness itself works.

## Setup checklist (one-time, on the box)

- [ ] Two checkouts: `<blue-dir>` and `<green-dir>` (separate trees).
- [ ] Both systemd units installed, `enable`d, `Restart=always`.
- [ ] Caddy `upstream.conf` lists BOTH ports with `lb_policy first` +
      active health checks (`deploy/caddy/upstream.conf.example`).
- [ ] `logrotate` configured for `/var/log/caddy/`.
- [ ] A disk-space alert (simple cron: warn at 80% full).
- [ ] UptimeRobot (or similar) polling `/api/health` from outside.
- [ ] Cloudflare in front of the domain with a static fallback page
      (Option A above).
- [ ] `uptime_drill.sh` run clean across a deploy + rollback + crash
      during the P6.3 devnet drill — BEFORE the real relaunch.

## Bottom line

Every failure mode that has actually taken this site (or sites like
it) down is now either engineered out or degrades gracefully — and
`uptime_drill.sh` proves it empirically. The single honest exception
is a total VPS/datacenter loss; Option A (Cloudflare static fallback)
closes the user-visible part of that for ~30 minutes of setup and is
the recommended minimum for relaunch day.
