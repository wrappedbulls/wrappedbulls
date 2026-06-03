# Incident response playbook

**Audience:** the WrappedBulls operator (you).
**Use:** the moment you suspect something is wrong on mainnet. Not for routine deploys, not for normal monitoring; for "wait, that's not right" moments.

This document compresses [`PRE_MORTEM_FACTORY.md`](PRE_MORTEM_FACTORY.md) (failure modes) and [`RECOVERY.md`](RECOVERY.md) (recovery procedures) into the operator action path. The pre mortem catalogs *what can go wrong*; this catalogs *what to do when it does*.

---

## 0. First five minutes: classify

Before doing anything, decide which of these you're dealing with. Wrong classification ruins the response.

| Class | Signal | Action root |
|---|---|---|
| **A. Live exploit** | Funds moving on chain in a way the program logic should not permit. Unwrap firing for wallets that don't hold the NFT, vault balances dropping with no unwrap tx, treasury draining without a `claim_treasury` signed by you. | Skip to §1. |
| **B. Wrap pipeline broken** | New wraps failing for legitimate users. Wallet rejects the tx. Simulation error. Metaplex CPI fail. No funds moved; users are blocked. | §2. |
| **C. Operator key compromise** | A program upgrade you didn't push appears on chain. A `claim_treasury` tx you didn't sign. Suspicious `last logged in` on the VPS. | §3. |
| **D. Brand or comms attack** | Phishing lookalike domain. Fake @wrappedbulls account. False X claims about a "rug". No on chain compromise. | §4. |
| **E. Marketplace / indexer breakage** | Magic Eden / Tensor not showing NFTs correctly. Solscan misrendering. Web UI broken. On chain is fine. | §5. |

If you can't classify it in five minutes, **default to A**. The cost of unnecessary pause is small; the cost of letting a live exploit continue is catastrophic.

---

## 1. Live exploit (Class A)

### 1A. Pause within 10 minutes of detection

```bash
# From the operator workstation, with the upgrade authority keypair loaded:
anchor run set-factory-paused --provider.cluster mainnet -- --paused true
```

(Or via the SDK / direct ix invocation. See [`set_factory_paused.rs`](../programs/wrappedfactory/src/instructions/set_factory_paused.rs) for the account structure. The ix takes one `bool` arg and signs from the program upgrade authority.)

Confirm the on chain state:
```bash
solana account <FACTORY_CONFIG_PDA> --url mainnet-beta --output json | jq
```
The `paused` byte must read `01`. While true, new wraps and deploys reject with `FactoryPaused`. **Unwrap continues to work** — this is intentional and required.

### 1B. Take the wrap UI down within 20 minutes

Even with the on chain pause, leave the website pointing at the now paused program would surface confusing errors. Update the web environment:

```bash
# On the VPS:
NEXT_PUBLIC_LAUNCH_STATE=paused
pm2 restart wrappedbulls-web
```

The frontend should already render a "factory is paused for investigation" banner; verify it does. Unwrap UI must remain reachable.

### 1C. Capture forensics before doing anything else

```bash
# Last hour of program activity:
solana transaction-history WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh \
  --url mainnet-beta --limit 200 > /tmp/incident-$(date +%s).txt

# Snapshot every WrappedCollection PDA:
node scripts/factory_snapshot.ts > /tmp/incident-snapshot-$(date +%s).json
```

Push both to a private gist immediately. You will need them for the post mortem and possibly for any disclosure conversation with affected users.

### 1D. Communicate within 60 minutes

Post on X (@wrappedbulls):
> The Factory is paused for investigation. Unwraps remain available; new wraps and deploys are temporarily disabled. We are inspecting <visible artifact>. Updates within the hour.

Then thread the affected token mints, the on chain pause tx signature, and the planned investigation timeline. Do NOT speculate about the cause until you have evidence.

### 1E. Diagnose, patch, redeploy

1. Reproduce the exploit on devnet (clone account state via `solana account ... --output raw`).
2. Write the fix.
3. Add a regression test to `tests/wrappedfactory_*.ts`.
4. Tag a new release on `release/v1.0.1` (or higher).
5. `anchor upgrade` to mainnet, signed by the upgrade authority.
6. Verify the bytecode hash matches what you tested.
7. `set_factory_paused(false)`.

If the bug cannot be fixed with an upgrade (e.g., a Metaplex CPI shape change requires a coordinated Metaplex Foundation deploy), the pause stays on until upstream is fixed.

### 1F. Post mortem within 7 days

Use the template at the bottom of this doc. Publish on `/security` or as a markdown file in the public repo. Include: timeline, root cause, scope of impact, what was paid out (if any), changes that prevent recurrence.

---

## 2. Wrap pipeline broken (Class B)

### 2A. Determine scope

Is it one deployment or all deployments?
- **One:** likely a deployment specific renderer URL outage, art_source typo, or a specific Token-2022 extension. Patch the deployment's off chain artifacts; the program is fine.
- **All:** likely RPC degradation, Metaplex CPI regression, or a recently shipped web change. Roll back.

### 2B. Common causes and fixes

| Symptom | Likely cause | Action |
|---|---|---|
| `Insufficient lamports` on wrap | User wallet underfunded | UX, no action |
| `MaxSupplyReached` | Collection sold out | Surface on UI; no action |
| `WrongTokenMint` | UI calling wrong route | Check recent web deploy |
| Metaplex CPI shape error in simulation | Upstream regression | See [PRE_MORTEM_FACTORY 1.5](PRE_MORTEM_FACTORY.md) |
| `RPC: 5xx` consistently | Helius degraded | Switch to backup RPC env var, restart web |
| `transaction reverted during simulation` (Phantom) | Lighthouse assertion mismatch | See PRE_MORTEM_FACTORY 6.2 |

### 2C. Communicate

Class B doesn't always need an X post; a status note on `/launch` or a pinned message in the Discord/Telegram is usually enough. If it lasts > 2h, post on X.

---

## 3. Operator key compromise (Class C)

This is the worst case category. The upgrade authority key is the same key that can flip `paused`, `verified`, and call `claim_treasury`. A compromise = full admin access.

### 3A. Pre check (5 seconds)

Are you sure it's a compromise and not your own forgotten action? Check `~/.bash_history` and the VPS audit log. Operators have lost hours chasing "compromises" that turned out to be their own forgotten commands.

### 3B. If confirmed compromise

1. **Don't pause from the compromised key.** Pause status flipped by an attacker can be flipped back by the attacker; you have no advantage.
2. **Sever access.** Lock the VPS (close port 22 at the firewall), rotate all SSH keys, kill all sessions.
3. **Transfer upgrade authority** to a clean key (ideally a Ledger hardware wallet) immediately:
   ```bash
   solana program set-upgrade-authority \
     WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh \
     --new-upgrade-authority <CLEAN_KEY> \
     --keypair <COMPROMISED_KEY>
   ```
   This is a race with the attacker. If you lose the race, the program is now adversarial and the only path is communication + new program deploy.
4. **Disclose within 1 hour.** Holders need to know whether to unwrap immediately.

### 3C. If the attacker won the race

Disclose immediately. Direct holders to unwrap (unwrap is not pauseable, so locked tokens are still recoverable even on an adversarial program). Plan a new program deploy at a fresh program ID with a migration script for new wraps.

---

## 4. Brand or comms attack (Class D)

No on chain compromise; reputation attack. Examples:
- Phishing domain (e.g., `wrappedbu11s.com`)
- Fake X account impersonating @wrappedbulls
- Coordinated FUD claiming a "rug" that hasn't happened

### Action

1. **Public correction.** Reply once with proof (program ID, treasury PDA, audit doc link).
2. **Do not feed the engagement.** A single corrective tweet wins; thread length amplifies.
3. **DMCA the phishing host** if applicable.
4. **Take down lookalike accounts** via X support.
5. **Add a banner on wrappedbulls.com** if traffic is being driven to the lookalike at scale.

---

## 5. Marketplace / indexer breakage (Class E)

On chain is fine; downstream display is broken.

| Symptom | Action |
|---|---|
| Magic Eden not loading deployments | DM ME support with token mint + collection mint; usually a cache flush is enough |
| Tensor missing NFTs | They auto index from collection mint; wait or DM their indexer team |
| Solscan misrendering metadata URI | They cache hard; usually self resolves within 24h |
| Phantom "could be malicious" warning | Email Solscan link to `dapps@phantom.com` per the [Phantom review protocol](https://x.com/wrappedbulls) |

None of these need on chain action. The protocol is unaffected.

---

## Communication templates

### Pause announcement (Class A)

> The WrappedFactory is paused for investigation following <visible artifact>. Unwraps remain available at all deployment pages; new wraps and deploys are temporarily disabled. We will update with findings within 60 minutes. Affected scope: <one sentence>. Tx hash of the pause action: <sig>.

### Post resolution (Class A)

> The Factory is live again. Pause was lifted at <timestamp> after <one sentence summary of root cause + fix>. Full post mortem within 7 days at <link>. All locked funds are accounted for; <if relevant: any user remediation>.

### Disclosure (Class C, key compromise)

> SECURITY ALERT: WrappedFactory upgrade authority appears compromised. Unwrap your NFTs immediately to recover locked tokens. Unwrap is permissionless and not affected by the upgrade authority. We will publish a full incident report within 24 hours. Do NOT sign any tx prompted by an upgrade banner on the site until further notice.

---

## Post mortem template

```markdown
# Incident YYYY-MM-DD: <one line summary>

## Timeline
- HH:MM detection signal
- HH:MM operator action
- HH:MM communication
- HH:MM mitigation deployed
- HH:MM resolution

## Root cause
<one paragraph>

## Scope of impact
- Affected deployments: <list>
- User funds at risk: <amount + count>
- User funds actually moved: <amount + count>

## Response evaluation
- What we did well:
- What we did slowly:
- What we did wrong:

## Changes to prevent recurrence
- Code changes: <commit links>
- Test additions: <commit links>
- Process changes: <updates to this runbook or PRE_MORTEM>

## Public disclosure
- X thread: <link>
- /security update: <link>
```

---

## Do not improvise

In an active incident, the temptation to "just try something" is the highest cost mistake. Follow the playbook. The playbook lives here because at 2 AM with adrenaline burning, you will not invent better steps. Stop. Classify. Execute.

If a situation does not fit any class, **default to Class A** (pause first, investigate second). Recovery from an unnecessary pause is trivial; recovery from a wrong active intervention can be irreversible.
