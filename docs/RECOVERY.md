> # ⚠️ PARTIALLY STALE. verify against authoritative docs first
> As of 2026-05-15: the upgrade-authority/deployer keypair is
> `GMrJpP7Sa…` (the bulls-box `/root/deployer-keypair.json`), **not**
> `FRZJ…TwQ` (that is the royalty treasury). "Scenario 1. mid-launch
> failure" assumes the deprecated `launch.sh` step structure. the real
> launch is the **manual** [`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md)
> sequence (its "Rollback" section is authoritative). The "email Phantom /
> whitelist thread" scenario is obsolete (root cause was
> program-not-on-mainnet, resolved by deploying). General incident
> guidance (box restore, RPC fallback, keypair backup) is still useful.

# Recovery + incident playbook

What to do when something breaks. Each scenario is independent. start
with the symptom that matches.

## Critical assets and their recovery posture

| Asset | Where it lives | Backup status |
|---|---|---|
| Mainnet deployer keypair (`FRZJp…`) | Your local machine, never on the bulls box except during launch.sh | **YOU must back this up.** See "Deployer keypair" below |
| Program upgrade authority | Same as above (deployer is the upgrade authority) | Same as above |
| Program ID + .so | `target/deploy/wrappedbulls.so` + `wrappedbulls-keypair.json` in this repo (committed to git) | ✅ source-controlled |
| `BullBank` state on chain | Solana mainnet (PDA, immutable address) | ✅ chain is the backup |
| Per-bull NFTs + vaults | Solana mainnet | ✅ chain is the backup |
| Caddy config | `/etc/caddy/Caddyfile` on the bulls box | ⚠️ source-control via this doc |
| systemd unit | `/etc/systemd/system/wrappedbulls-web.service` | ⚠️ source-control via this doc |
| `wrappedbulls.com` domain | Namecheap account | DNS records also documented below |
| DigitalOcean droplet | DigitalOcean account, weekly snapshots if enabled | ⚠️ enable snapshots ($1.20/mo) |
| Helius RPC API key | Stored in systemd unit `Environment=` | ⚠️ rotate via Helius dashboard |
| Source code | github.com/wrappedbulls/wrappedbulls | ✅ github + your local clone |

## Deployer keypair. your single most important secret

The mainnet deployer keypair is the **only thing that controls program
upgrades and collection metadata updates** post-launch. Lose it and:

- You cannot patch program bugs
- You cannot update the collection NFT's metadata (name, description,
  banner_image URI)
- An attacker who steals it can replace the program with malicious code

**Required backups (do all three before launch):**

1. **Encrypted file backup**. `gpg --symmetric` the keypair JSON, store
   the encrypted blob in two cloud locations (e.g., Google Drive +
   iCloud) using two different passphrases.
2. **Hardware backup**. write the seed/key to paper or steel, store
   in a physical safe.
3. **Test recovery**. before launch, prove you can restore from your
   backups by deriving the same pubkey on a fresh machine.

**Operational rules:**

- Never leave the keypair on the bulls box. After `launch.sh` finishes:
  `shred -u /tmp/mainnet-deployer.json` (already in launch.sh docs).
- Never paste the keypair into any tool / website / Discord / etc.
- Never store the unencrypted keypair on a machine connected to the
  internet.

**If lost:** there is **no recovery**. The program upgrade authority is
locked to that pubkey. The collection NFT update authority is a program
PDA (controlled by the program), so the collection survives, but you'd
have to launch a new program with a new authority for any future
patches.

**Mitigation:** post-launch, after a 30-60 day soak period and once
you're confident the program is stable, **freeze the upgrade authority**
(see `docs/AUTHORITY.md`). After freeze, the deployer keypair losing
its value mostly mitigates this risk.

## Scenario 1. Mid-launch failure

`launch.sh` halts in the middle. Symptoms vary by step.

### Step 0.5 (web MCC swap) failed
- **Effect:** chain untouched. Web client may be in a half-applied state.
- **Recovery:**
  ```bash
  cd /root/wrappedbulls-sol
  git checkout -- web/lib web/app/wrap web/app/unwrap
  cd web && npm run build
  rsync .next/standalone/. /opt/wrappedbulls-web/
  rsync .next/static/. /opt/wrappedbulls-web/.next/static/
  rsync public/. /opt/wrappedbulls-web/public/
  systemctl restart wrappedbulls-web
  ```
  Then fix whatever caused web_apply_mcc.sh to fail and re-run launch.sh.

### Step 1 (deploy) failed
- **Effect:** program may be partially deployed (some pages of bytecode
  uploaded, but program account not finalized). Solana CLI prints a
  buffer pubkey at the bottom of the error.
- **Recovery:**
  ```bash
  # Resume from buffer
  solana program deploy --program-id target/deploy/wrappedbulls-keypair.json \
    --buffer <BUFFER_PUBKEY> --keypair "$DEPLOYER_KEYPAIR"
  # OR recover the lamports if you want to restart fresh:
  solana program close <BUFFER_PUBKEY> --keypair "$DEPLOYER_KEYPAIR"
  ```
  Then re-run launch.sh. the idempotency guards skip already-completed
  steps.

### Step 2 (initialize) failed
- **Effect:** BullBank PDA may already be created with bad data, or not
  created at all. Fund check at start of script catches this case.
- **Recovery:** check the bank state via `audit_chain.sh`. If
  `total_wrapped == 0 && in_circulation == 0`, the bank is fresh , 
  re-running launch.sh will skip Step 2 because the PDA exists. If the
  data looks corrupted, contact the team (this should be impossible
  given the program's `init` semantics).

### Step 2.5 (initialize_collection) failed
- **Effect:** bank.collection_mint may be set or unset depending on how
  far it got. The script is idempotent. re-running launch.sh skips it
  if collection_mint is already set.
- **Recovery:** re-run launch.sh.

### Step 3 (web env switch) failed
- **Effect:** systemd unit may have a partial sed result. Web service
  may not restart.
- **Recovery:**
  ```bash
  # Restore from the env file Caddy was using before launch
  diff /etc/systemd/system/wrappedbulls-web.service.bak.* /etc/systemd/system/wrappedbulls-web.service
  # If unit is corrupt, manually edit Environment= lines back to mainnet
  vim /etc/systemd/system/wrappedbulls-web.service
  systemctl daemon-reload
  systemctl restart wrappedbulls-web
  ```

## Scenario 2. Bulls box dies (DigitalOcean droplet failure)

- **Symptom:** wrappedbulls.com unreachable, ssh times out
- **Recovery (with snapshots enabled):**
  1. DigitalOcean panel → Snapshots → Restore most recent snapshot
  2. Wait ~5 min for new droplet to come up
  3. Update DNS A record at Namecheap to new IP if it changed (otherwise
     reattach floating IP)
  4. SSH in, verify systemd units active, verify Caddy serving
  5. Run `audit_chain.sh --url https://api.mainnet-beta.solana.com` to
     confirm chain state intact
- **Recovery (without snapshots):**
  1. Spin a fresh DO Ubuntu droplet
  2. Re-create the bulls box from scratch following the
     environment-rebuild steps below
  3. The chain state is fine. bulls box is purely frontend + cranker
- **Estimated downtime:**
  - With snapshots: 10 to 20 min
  - Without snapshots: 1 to 2 hours

## Scenario 3. Caddy config breaks / TLS fails

- **Symptom:** site returns 502 / TLS error / `caddy` service inactive
- **Recovery:**
  ```bash
  # 1. Restore from last known good backup
  ls -la /etc/caddy/Caddyfile.bak.*
  cp /etc/caddy/Caddyfile.bak.<latest> /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile
  systemctl reload caddy
  # 2. If TLS is the issue, force Caddy to reissue:
  systemctl restart caddy
  # 3. If ZeroSSL is rate-limiting, switch to LetsEncrypt by removing
  #    `acme_ca` line from Caddyfile and reloading
  ```
- The minimal known-good Caddyfile is:
  ```caddyfile
  wrappedbulls.com, www.wrappedbulls.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
  }
  ```
  (Plus the headers block we added.)

## Scenario 4. Web service crashed / 502

- **Symptom:** Caddy returns 502 / `systemctl is-active wrappedbulls-web`
  returns `failed`
- **Diagnosis:** `journalctl -u wrappedbulls-web -n 100 --no-pager`
- **Common causes + fixes:**
  - Out of memory: `free -h` shows full swap. Restart resolves.
  - Helius RPC outage: web tries to start but can't read chain. Check
    https://status.helius.dev/. Switch to public mainnet RPC by editing
    systemd unit `SOLANA_RPC_URL` and restarting.
  - Bad systemd Environment= value: `journalctl` shows env parse error.
    Restore from backup `/etc/systemd/system/wrappedbulls-web.service.bak.*`.
- **Generic recovery:**
  ```bash
  systemctl restart wrappedbulls-web
  sleep 4
  systemctl is-active wrappedbulls-web
  curl -sI --max-time 10 --resolve wrappedbulls.com:443:127.0.0.1 https://wrappedbulls.com/api/health
  ```

## Scenario 5. On-chain anomaly detected

- **Symptom:** `audit_chain.sh` reports invariant failure
- **Reading the report:**
  - **Invariant 1 fails** (in_circulation != total_wrapped - total_unwrapped):
    counter desync. Should be impossible given program code. Investigate
    via `solana program logs <PROGRAM_ID>` and recent txs.
  - **Invariant 2 fails** (live BullAsset count != in_circulation):
    a BullAsset PDA was closed without going through `unwrap_bull`.
    Should be impossible. Investigate.
  - **Invariant 3 fails** (sum vault.amount != in_circulation × 1M):
    a vault was drained outside `unwrap_bull`. Major issue. Halt
    public communication, contact the team.
  - **Invariant 7 fails** (collection_mint not set): only failure mode
    is that `initialize_collection` was skipped. Re-run launch.sh. the
    idempotency guard will run it.
- **Anomaly tx investigation:**
  ```bash
  solana confirm <TX_SIG> --url mainnet-beta -v
  solana logs <PROGRAM_ID> --url mainnet-beta
  ```

## Scenario 6. Phantom flags us again post-launch

- **Symptom:** users report the "Request blocked / dApp could be
  malicious" warning after we were previously cleared
- **Recovery:**
  1. Email review@phantom.com immediately with the original whitelist
     reply thread
  2. Check if anything changed: did we deploy a different program ID?
     Different domain? New on-chain pattern that triggered a heuristic?
  3. While waiting, post a banner on the site telling users to use
     Tensor or Magic Eden directly to trade (these don't go through
     Phantom's Blowfish layer for listings)

## Scenario 7. Helius RPC API key compromised

- **Symptom:** unexpected RPC quota usage on Helius dashboard
- **Recovery:**
  1. Helius dashboard → rotate the API key
  2. Update `/etc/systemd/system/wrappedbulls-web.service`:
     ```
     Environment=SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<NEW_KEY>
     ```
  3. `systemctl daemon-reload && systemctl restart wrappedbulls-web`
  4. Verify `/api/health` returns 200 with new RPC

## Bulls box environment rebuild (worst-case scenario)

Full rebuild from a fresh Ubuntu droplet. Time: 60-90 min.

```bash
# 1. SSH in as root (assumes new droplet)
# 2. System deps
apt update && apt upgrade -y
apt install -y build-essential pkg-config libssl-dev curl git python3 \
               nodejs npm caddy ufw fail2ban

# 3. Solana toolchain
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# 4. Rust + Anchor
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
. $HOME/.cargo/env
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked

# 5. Clone repo
cd /root
git clone https://github.com/wrappedbulls/wrappedbulls.git wrappedbulls-sol
cd wrappedbulls-sol
npm install
cd web && npm install && cd ..

# 6. Build
anchor build

# 7. Restore Caddyfile (paste content from this doc)
vim /etc/caddy/Caddyfile

# 8. Restore systemd unit (paste content from below)
vim /etc/systemd/system/wrappedbulls-web.service
systemctl daemon-reload
systemctl enable wrappedbulls-web

# 9. Build + sync web
cd web && npm run build && cd ..
mkdir -p /opt/wrappedbulls-web/.next/static /opt/wrappedbulls-web/public
cp -r web/.next/standalone/. /opt/wrappedbulls-web/
cp -r web/.next/static/. /opt/wrappedbulls-web/.next/static/
cp -r web/public/. /opt/wrappedbulls-web/public/

# 10. Start services
systemctl restart caddy wrappedbulls-web

# 11. Verify
curl -I https://wrappedbulls.com/api/health
```

## Reference: known-good systemd unit template

```ini
[Unit]
Description=WrappedBulls Next.js web (wrappedbulls.com)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/wrappedbulls-web
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1
Environment=NEXT_PUBLIC_PROGRAM_ID=F7qXskG73efUwbDo2B97tZgpPAqX7zHMApXbPUimcFdS
Environment=NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta
Environment=NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
Environment=SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<HELIUS_KEY>
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

## Reference: DNS records (Namecheap)

| Host | Type | Value | TTL |
|---|---|---|---|
| `@` | A | `165.22.167.96` | Auto |
| `www` | A | `165.22.167.96` | Auto |

If you ever change droplet IP, update both A records here.

## Pre-launch checklist for backup posture

- [ ] Mainnet deployer keypair backed up in 2+ locations (encrypted)
- [ ] Hardware/paper backup of deployer seed
- [ ] Recovery test: derive deployer pubkey from backup on a fresh
      machine
- [ ] DigitalOcean weekly snapshots enabled
- [ ] Bookmark + tested: Helius dashboard login
- [ ] Bookmark + tested: Namecheap DNS dashboard login
- [ ] Note the DO droplet ID + region (handy if you're on the phone with
      DO support during an incident)
- [ ] Save this RECOVERY.md somewhere off-server (not just on the bulls
      box) so you can read it during a bulls-box outage
