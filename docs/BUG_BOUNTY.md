# Bug bounty scope and rules

WrappedBulls runs an open bug bounty against the WrappedFactory program and its supporting infrastructure. Reports that demonstrate genuine, reproducible vulnerabilities receive payouts in proportion to the severity bands defined below.

This document is canonical. The most recent published version on `release/v1.0` of the public repo overrides any older or informal statement.

---

## In scope

### Program (highest priority)

- `programs/wrappedfactory` (Rust, deployed to mainnet at program ID `WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh`).

Specifically, we care about:

- Any path that moves funds out of a wrap layer's vault to a wallet other than the NFT holder.
- Any path that drains the `bull_treasury_vault` outside the documented `claim_treasury` flow (gated to upgrade authority + 7 day per deposit lock).
- Any path that creates NFTs without the expected token lock.
- Any path that flips `FactoryConfig.paused` or `WrappedCollection.verified` without the upgrade authority.
- Any path that pauses unwrap (the load bearing invariant; if you find one, see severity table below).
- Pricing or fee bypass: deploying a wrap layer without the 1M $WBULL transfer.
- PDA collision or seed confusion that lets one deployment's state be read or mutated from another deployment's ix.
- Compute budget exhaustion that bricks a specific deployment.
- Metaplex CPI shape mismatches that leave deployments in unsafe partial states.

### Web (medium priority)

- `web/app/api/factory/*` (Next.js API routes that build wrap, unwrap, deploy, claim, set verified, set paused transactions).
- `web/app/launch/*` (deployment dashboards, wizard, treasury, health pages).
- `web/lib/factory.ts` (PDA derivation, on chain reader).

Specifically:

- Server side transaction construction bugs that produce a malicious ix the user does not realize they are signing.
- Bypass of the canary deployer allowlist when active.
- Reflected or stored injection on any public page.
- Authentication or authorization bypass for any privileged ix (claim_treasury, set_verified, set_factory_paused).

### Infrastructure (lower priority)

- `wrappedbulls.com` (Caddy + Next.js server on the production VPS).
- `/embed.js` (the cross origin embeddable widget).
- The CI pipeline if a compromised CI could push to mainnet.

---

## Out of scope

We will close reports in these categories without payout:

- Issues in the parent `wrappedbulls` program (mainnet live for months; a separate bounty applies if you find anything). Factory and wrappedbulls share no on chain state.
- Issues in pump.fun's token program, Metaplex Token Metadata, Solana itself, Jupiter, Magic Eden, Tensor, or any other upstream protocol. Report those to the relevant team directly.
- Social engineering or impersonation attacks against the operator.
- Issues that require the operator's upgrade authority keypair to be already compromised. Compromising the key itself is not a Factory vulnerability.
- Phishing / lookalike domains. These are a comms issue, not a code issue.
- UI annoyances, broken images, marketing copy, typos. Open a GitHub issue instead.
- Denial of service that costs the attacker more than the impact (e.g., spamming 256 deploys to fill the treasury queue at 1M $WBULL each; that's the intended economic disincentive).
- Issues in dependencies (Anchor, web3.js, etc.) unless we have a path to exploit them through our specific use.
- Issues that require physical access to the operator's VPS or laptop.
- Bypass of marketplace royalty enforcement. We do not collect royalties at the protocol level; royalty payout is a marketplace concern.

---

## Severity bands and payouts

Payouts are in USDC, sent to a wallet of the reporter's choice on Solana. Funded from the bull treasury claim path; budget is capped at the operator's discretion but the bands below are honored to the limit of the treasury balance at the time the report is validated.

| Severity | Definition | Payout band |
|---|---|---|
| **Critical** | Drains user funds at any deployment, breaks the unwrap path, or grants admin authority to a non upgrade authority key. | 1 to 5 SOL equivalent in USDC |
| **High** | Drains treasury or freezes treasury, bypasses the 7 day deposit lock, or sustains a wrap rate cap below intended (DoS against existing deployments). | 0.25 to 1 SOL equivalent |
| **Medium** | Lets a deployer bypass the 1M $WBULL fee, lets a non admin call `set_verified` or `set_factory_paused`, or escalates server side via a transaction construction bug. | 0.05 to 0.25 SOL equivalent |
| **Low** | Information disclosure, minor griefing, off chain caching tricks. | 0.01 to 0.05 SOL equivalent |
| **Informational** | Best practice recommendations, ergonomic improvements. | thank you, public acknowledgment optional |

**The protocol's load bearing invariant** is that `unwrap` is always available to the NFT holder. A path that defeats this is treated as Critical with the upper end of the band, regardless of how it was achieved.

---

## How to report

Email: `degencapital999@gmail.com`
Subject prefix: `[BUG BOUNTY]`

We do not run a public Discord or Telegram inbox for security reports. Email is the canonical channel because it gives the operator time to evaluate and act before the issue is public.

For Critical or High severity, optionally include a PGP public key in your first email; we will reply with ours so the rest of the disclosure can be encrypted.

### What to include

- A description of the vulnerability in plain language.
- A reproduction path: which ix, which accounts, which inputs produce the bug.
- Where applicable, a proof of concept transaction signature on devnet (preferred) or a Rust / TypeScript snippet that builds the malicious tx.
- Suggested severity (we will adjust if we disagree, and explain why).
- Suggested fix if you have one (not required for the bounty).

### What we will do

- Acknowledge receipt within 24 hours.
- Respond with our severity assessment within 72 hours.
- Patch + redeploy as fast as the fix complexity allows; usually within a week for High and Critical.
- Pay out within 7 days of confirming the fix on mainnet.
- Credit you publicly (X handle or alternative) at your discretion when the fix is announced.

---

## Disclosure timeline

We follow a standard coordinated disclosure model:

1. Reporter submits via email.
2. We acknowledge + assess + assign severity.
3. We patch internally and prepare a mainnet upgrade.
4. We deploy the upgrade and confirm bytecode parity.
5. We pay the reporter.
6. We disclose publicly on `@wrappedbulls` and in this document's changelog.

For Critical findings, if 60 days pass without a patch, the reporter is welcome to disclose publicly. We have not hit this threshold and do not expect to; it is documented here so the timeline is unambiguous.

---

## Safe harbor

Good faith research conducted under this policy will not result in legal action from us. We will not pursue takedowns, copyright claims, or other legal action against a reporter who:

- Made a good faith effort to avoid actual user fund loss during testing.
- Used a non production cluster (devnet) or self funded tokens on mainnet wherever possible.
- Disclosed privately first and gave us reasonable time to fix.
- Did not exfiltrate user data or hold the protocol hostage.

We do not represent users or operate as their custodian; if your testing actually moved real user funds, the safe harbor narrows because the impact extends beyond our consent.

---

*Last updated 2026-06-03 alongside release/v1.0.*
