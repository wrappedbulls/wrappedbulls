# Factory Mainnet Pre Mortem

**Exercise:** Imagine the Factory mainnet launch has failed catastrophically six months from now. Walk back: what failure modes plausibly caused it? For each, record probability, impact, detection, and response so we can either pre empt or be ready.

This document is read once before pressing the deploy button on the `FACTORY_LAUNCH_RUNBOOK`, and again on the morning of launch.

---

## Upgrade authority posture

Factory mainnet launches with a **single hot keypair** as upgrade authority (matches the current wrappedbulls posture). No Squads multisig. Solo operator reality: the operator alone holds the keypair, signs upgrades, and signs `claim_treasury` / `set_verified` admin calls.

This trades multisig safety for operational simplicity. The failure modes below reflect that posture honestly. Two future paths remain available without a redeploy: transfer the upgrade authority to a hardware wallet (Ledger), or revoke it entirely (`set-upgrade-authority --new-upgrade-authority null`) to make the program immutable. The latter also disables `claim_treasury` permanently, so the treasury is locked if it is ever invoked.

---

## 1. Program logic bugs

The highest impact category. After launch, any program change requires the upgrade authority keypair to sign a redeploy. A logic bug discovered after launch can be hotfixed quickly **only if the keypair is accessible and uncompromised**. Treat upgrades as exception paths, not routine.

### 1.1 Vault drain via NFT confusion

| Field | Value |
|---|---|
| Description | Attacker tricks `unwrap` into transferring tokens out of a vault that belongs to a different NFT or collection. |
| Probability | Low. The `vault` ATA is canonically derived from `nft_mint` so the derivation check is mechanical, and the same pattern is mainnet proven on wrappedbulls. |
| Impact | Catastrophic. Drains user funds. |
| Detection | `total_in_circulation` count diverges from on chain BullAsset PDA count. `security_monitor.ts` reads both every minute. |
| Response | Pause new wraps via web (set `NEXT_PUBLIC_LAUNCH_STATE=paused`). Sign and push a patched program. Disclose on X within 1 hour. |
| Pre empt | Tests cover NFT mint mismatch + wrong collection (see `tests/wrappedfactory.ts`, `tests/wrappedfactory_claim_success.ts`). Same CPI pattern as wrappedbulls (16/16 tests). |

### 1.2 Treasury drain via claim_treasury bypass

| Field | Value |
|---|---|
| Description | Caller other than upgrade authority manages to call `claim_treasury` and drain the bull treasury vault. |
| Probability | Low. The ix is gated to `program.programdata_address()` and `program_data.upgrade_authority_address`. Cannot bypass without compromising the upgrade authority itself. |
| Impact | Catastrophic. Drains accumulated 1M $WBULL deposits across every Factory deployment. |
| Detection | `bull_treasury_vault` SPL balance drops without a `claim_treasury` tx signed by the upgrade authority keypair. |
| Response | The only path to drain the treasury that bypasses the upgrade authority is a program logic bug. Pause new wraps. Sign and push a patched program (assumes the upgrade authority key is still secure). If the upgrade authority key itself is the compromise vector, see 4.2. |
| Pre empt | `claim_treasury` success path test now end to end on bankrun (proves the constraint chain). The `SetVerifiedTx` ix uses an identical authority gate. |

### 1.3 7 day lock bypass

| Field | Value |
|---|---|
| Description | A deposit becomes claimable before its 7 day per deposit lock expires. |
| Probability | Very low. `sweep_expired(now)` uses on chain Clock; the only way to advance Clock is the validator's clock. |
| Impact | Serious. Compromises the public commitment that funds are time locked. |
| Detection | `lifetime_claimed` increases by an amount whose `deposited_at` field on the corresponding `DepositEntry` is less than 7 days old. |
| Response | Public disclosure, sign and push a patch, optionally a refund commitment for affected deposits. |
| Pre empt | 7/7 treasury accounting unit tests cover sweep semantics. Bankrun test sets clock to exactly `PENDING_LOCK_SECONDS + 1` and proves the boundary. |

### 1.4 Pending queue overflow

| Field | Value |
|---|---|
| Description | An attacker spams 256 deploys (the `PENDING_CAP`) faster than sweep can drain them, blocking any further deploys until 7 days pass. |
| Probability | Medium. Each deploy costs 1M $WBULL. 256M $WBULL is large but not unattainable for a coordinated attack at low $WBULL price. |
| Impact | Cosmetic to Serious. Deploys are bricked for up to 7 days. Existing deployments continue to function. |
| Detection | `BullTreasuryState.pending.length` > 200. `/launch/treasury` page surfaces this; alert manually if exceeded. |
| Response | Run `claim_treasury` immediately to sweep whatever has expired. Communicate publicly that a queue is filling. Consider expediting the `claim_treasury` cadence. |
| Pre empt | The 7 day lock is a deliberate slow drain mechanism; rapid spam attacks become economic suicide as price drops. Anti farming spec (`docs/ANTI_FARMING_SPEC.md`) is the V2 contingency. |

### 1.5 deploy_collection griefing via Metaplex CPI failure

| Field | Value |
|---|---|
| Description | A future Metaplex Token Metadata upgrade breaks the `verify_sized_collection_item` CPI mid wrap, leaving collections in a partially initialized state. |
| Probability | Low. Metaplex is conservative about breaking changes; mainnet pinned versions for years. |
| Impact | Serious. Existing deployments may have broken wrap; their NFTs may not display correctly on marketplaces. |
| Detection | Wrap success rate (tracked via `/api/factory/activity`) drops sharply. Marketplace listings 404. |
| Response | Pause new deploys via UI. Sign and push a patch to swap Metaplex program ID (if a forked Metaplex exists) or update the CPI shape. |
| Pre empt | Pin against the exact Metaplex version (anchor spl 1.0.2 pins mpl token metadata 5.1.2 alpha 2). Monitor Metaplex release notes. |

---

## 2. Deploy operation failures

Failures during Runbook execution. Reversibility decreases with each step.

### 2.1 Deploy interrupted mid sequence

| Field | Value |
|---|---|
| Description | Network drops, machine crashes, or operator stops mid sequence with the program partially deployed. |
| Probability | Medium. Solo operator, long sequence. |
| Impact | Serious if the deployer keypair file leaks during the partial state. Cosmetic if just resumed. |
| Detection | Operator self detected (the sequence didn't finish). |
| Response | Resume the sequence. Specifically: a failed `program deploy` leaves a buffer that can be resumed (`solana program deploy --buffer ...`). Initialize and smoke test the deployment as soon as the program lands. |
| Pre empt | Run the entire sequence on a wired connection, in one sitting. Pre stage all commands in a single shell. Keep the deployer keypair file in `/root/deployer-keypair.json` only, never in pastebins or chat. |

### 2.2 Upgrade authority transferred to wrong destination

| Field | Value |
|---|---|
| Description | Operator runs `solana program set-upgrade-authority --new-upgrade-authority <PUBKEY>` with a typo (or in the wrong moment, e.g., to `null` before mainnet smoke testing). Authority lands somewhere unintended or is revoked. |
| Probability | Low. Long pubkeys are conventionally copy pasted, not typed. The `null` variant is a deliberate command, not a typo. |
| Impact | Catastrophic. Permanent loss of program upgrade ability. If the destination is also the `claim_treasury` caller, the treasury becomes uncallable. |
| Detection | `solana program show <VANITY> --url mainnet beta` immediately after the transfer. Authority field should be exactly what the operator intended (default: the original deployer keypair). |
| Response | If the wrong destination is someone you can contact: coordinate to have them sign back. If the destination is `null`: not recoverable; redeploy with a new vanity. |
| Pre empt | Default to leaving authority on the deployer keypair after launch. Do not run `set-upgrade-authority` casually. The runbook intentionally has no handoff step in the single keypair posture. |

### 2.3 IDL publish step fails or wrong IDL published

| Field | Value |
|---|---|
| Description | `anchor idl init` fails (rare) or succeeds with a stale IDL that doesn't match the deployed bytecode. |
| Probability | Low. The IDL build is reproducible from `target/idl/wrappedfactory.json` which we sync to local + sdk + web. |
| Impact | Cosmetic to Serious. Block explorers can't decode tx instructions. SDK clients fetching the on chain IDL get the wrong shape. |
| Detection | A test query via `anchor idl fetch <VANITY>` returns mismatched data. |
| Response | `anchor idl upgrade --filepath <correct>` signed by the upgrade authority keypair. |
| Pre empt | Diff `target/idl/wrappedfactory.json` against `web/lib/idl-factory.json` and `sdk/src/idl-factory.json` before deploy. All three should be byte identical (set during the vanity swap session). |

### 2.4 Insufficient deployer SOL mid deploy

| Field | Value |
|---|---|
| Description | Deployer wallet (`/root/deployer-keypair.json`) has less than the 3 SOL the runbook requires. Deploy halts after a buffer is allocated but before the program upload completes. |
| Probability | Low if checklist is honored. |
| Impact | Serious. The buffer holds funds until manually closed; the program is not deployed. |
| Detection | `solana balance` shows < 3 SOL. Deploy command errors. |
| Response | Fund the wallet. Resume with `solana program deploy --buffer <BUFFER_PUBKEY>`. |
| Pre empt | Pre launch checklist (runbook) requires `solana balance >= 3 SOL` before any other step. |

---

## 3. Economic attacks

### 3.1 Spam deploy attack

Already covered in 1.4 (pending queue overflow). Worth re emphasizing the economic asymmetry: each spam deploy costs 1M $WBULL which goes to the treasury (not the attacker). The attack burns the attacker's capital permanently in service of stalling new deploys. Economic disincentive is the defense.

### 3.2 Zero royalty NFT misuse

| Field | Value |
|---|---|
| Description | Per deployment NFTs have `seller_fee_basis_points: 0`. A copycat marketplace mints look alike NFTs and sells them at scale. |
| Probability | Low. The MCC verification + the on chain `verified` flag (`set_verified` ix) lets us distinguish real Factory NFTs from copies. |
| Impact | Cosmetic. Affects perception, not user funds. |
| Detection | Manual marketplace surveillance. Discord reports. |
| Response | Surface the `verified` chip on every Factory page; communicate that unverified collections are the user's risk. |
| Pre empt | The `/launches` directory is the canonical source of truth. Verified chips drive trust to the on chain `verified` boolean. |

### 3.3 $WBULL price manipulation

| Field | Value |
|---|---|
| Description | Coordinated dump of $WBULL drops the deploy cost (in dollar terms) to near zero, enabling spam deploys to dilute the treasury or stall the queue. |
| Probability | Medium for any pump.fun token. |
| Impact | Cosmetic to Serious. Deploy cap dilution; if the queue spam coincides, see 1.4. |
| Detection | Combination of 1.4 (queue size) + abnormal deploy rate + $WBULL volume on pump.fun. |
| Response | Decide whether to activate `ANTI_FARMING_SPEC.md` (currently deferred). Could also raise `DEPLOY_BURN_AMOUNT_UI` via program upgrade. |
| Pre empt | The 7 day lock and the upgrade authority gated treasury claim are buffers that turn fast attacks into slow burns. |

---

## 4. Operational failures

### 4.1 Upgrade authority keypair lost or compromised

| Field | Value |
|---|---|
| Description | `/root/deployer-keypair.json` (or whichever file holds the upgrade authority keypair) is copied off the box, destroyed, or its content is exposed in logs / chat / pastebin. |
| Probability | Low if VPS is properly secured and the operator does not paste the file content anywhere. Higher if multiple people touch the box or the operator works in cafes. |
| Impact | Catastrophic. Attacker can deploy a malicious upgrade, drain the treasury via `claim_treasury`, or flip `set_verified` to mark scam deployments as verified. The same key controls all three admin paths. |
| Detection | `solana program show` shows a program data version you did not push, OR `bull_treasury_vault` balance drops via a `claim_treasury` tx you did not sign. |
| Response | If still in your control: immediately transfer authority to a fresh secure keypair via `set-upgrade-authority`. If compromised: assume the program is now adversarial. Public disclosure within 1 hour. Cold storage backups of the keypair (if any) only help with the "lost" case, not the "compromised" case. |
| Pre empt | Cold backup the keypair file the moment it is generated, in an offline location separate from the VPS. Audit VPS `last logged in` and SSH keys after launch. Optionally transfer authority to a Ledger hardware wallet so signing requires physical presence. |

### 4.2 Upgrade authority keypair lost (no backup)

| Field | Value |
|---|---|
| Description | The keypair file is destroyed and there is no backup. |
| Probability | Low if cold backup discipline is enforced. |
| Impact | Catastrophic. Program is effectively immutable. `claim_treasury` becomes uncallable; the bull treasury is locked forever. Same effective outcome as `set-upgrade-authority --new-upgrade-authority null`, but unintended. |
| Detection | Operator self detected (you go to upgrade and discover the keypair is missing). |
| Response | Not recoverable. Publicly disclose the bull treasury is locked. Redeploy at a new vanity if you want to keep operating the Factory product. Old deployments under the lost authority keep working at the user level; their per deployment vaults are NFT controlled, not authority controlled. |
| Pre empt | Cold backup at keypair generation time. Verify the backup is readable before the deploy session. |

### 4.3 Compute budget too low on user transactions

| Field | Value |
|---|---|
| Description | A user's wrap or deploy tx runs out of CU because client side did not set a `ComputeBudgetProgram.setComputeUnitLimit` instruction. |
| Probability | Low. The web client sets 600,000 CU. SDK does the same. |
| Impact | Cosmetic. The tx fails, no funds lost. User retries. |
| Detection | User complaint or `getRecentPrioritizationFees` based monitoring. |
| Response | Bump the default CU in client. Code change, redeploy web. |
| Pre empt | The 600k CU bump is baked into `wrap-tx`, `unwrap-tx`, `deploy-tx` API responses. Stress test the integration on devnet (`scripts/factory_devnet_stress_test.ts`). |

---

## 5. External dependency failures

### 5.1 Helius RPC degraded during launch

| Field | Value |
|---|---|
| Description | Our paid Helius RPC returns 5xx during Step 2 or Step 5 of the runbook. |
| Probability | Low. Helius mainnet has multi nine uptime. |
| Impact | Serious if it happens mid sequence. |
| Detection | Deploy/init commands time out. |
| Response | Switch to a backup RPC. Triton, Quicknode, or `api.mainnet beta.solana.com` (rate limited but free). Update `SOLANA_RPC_URL` env on the deploy shell, retry. |
| Pre empt | Pre stage the backup URL in the runbook before starting Step 1. |

### 5.2 Metaplex Token Metadata changes behavior

See 1.5.

### 5.3 pump.fun changes Token-2022 behavior

| Field | Value |
|---|---|
| Description | pump.fun rolls out an update that changes the SPL Token program ID or extension behavior of the underlying token mints. Existing Factory wrap layers may not handle new behavior. |
| Probability | Medium over a 12 month horizon. |
| Impact | Cosmetic to Serious. Old deployments keep working at their pinned mint behavior; new deployments may need an upgraded Factory ix. |
| Detection | pump.fun release notes / public posts. New token deploys fail on Factory. |
| Response | Patch ix to handle new extension. Multisig signed upgrade. |
| Pre empt | The `TokenInterface` accepts both classic SPL and Token-2022 transparently. Most extension changes don't affect the basic transfer + balance reads we use. |

---

## 6. UX and discovery failures

### 6.1 Marketplace stale art (already mitigated)

| Field | Value |
|---|---|
| Description | Per tier render URL was stable across re mints, marketplaces cached stale bytes. |
| Probability | Solved. |
| Impact | n/a |
| Detection | n/a |
| Response | Already shipped: `/api/render/mint/[mint]` per mint endpoint. |
| Pre empt | Hold the line: never key marketplace images on a value that can be re minted. |

### 6.2 Phantom domain reputation warning on `/launch/new`

| Field | Value |
|---|---|
| Description | First time deployers see Phantom's "could be malicious" warning, killing conversion. |
| Probability | High in the first 48 hours. Domain reputation is built over time. |
| Impact | Serious for partner adoption. Cosmetic for security. |
| Detection | Discord reports. |
| Response | Email the Solscan link of the upgrade authority wallet to Phantom dApp review at `dapps@phantom.com` per `reference_phantom_review` memory. |
| Pre empt | Do not pre review with Phantom. Wait until the first warning is reported, then send the Solscan link. This is documented standing protocol. |

### 6.3 Embeddable widget breaks a partner site

| Field | Value |
|---|---|
| Description | `/embed.js` widget polls `/api/factory/activity` and updates the partner page. If our API breaks or the widget throws, the partner sees a broken section. |
| Probability | Low. The widget is defensive (cache control no store, displays a warning on error). |
| Impact | Cosmetic. Partner perception. |
| Detection | Partner complaint or `/api/factory/activity` error rate spike. |
| Response | Roll back the widget JS via blue green deploy. |
| Pre empt | Ship the widget with a version pinned URL. Major changes require a new versioned URL so existing embeds stay on the working build. |

---

## 7. Security incidents

### 7.1 Upgrade authority compromise

Already covered in 4.1 (compromise) and 4.2 (loss).

### 7.2 Phishing site spoofing wrappedbulls.com

| Field | Value |
|---|---|
| Description | Domain like `wrappedbulls.cc` or `wrappedbu11s.com` runs a clone site that prompts users to sign a malicious tx. |
| Probability | High over time. Standard crypto phishing pattern. |
| Impact | User funds at the phishing site, not the protocol. |
| Detection | Discord, X reports, brand monitoring. |
| Response | DMCA the host, public warning on X, optionally add a banner on the real site warning of the lookalike. |
| Pre empt | Register obvious lookalikes pre launch. Set up a brand monitoring alert (out of scope for this doc but worth doing). |

---

## 8. Strategic failures (not technical)

### 8.1 Zero partner deploys in week 1

| Field | Value |
|---|---|
| Description | Despite the technical launch, no pump.fun token holders actually deploy a Wrap layer in the first week. |
| Probability | Medium. New product, niche audience. |
| Impact | Serious for narrative. Cosmetic for funds. |
| Detection | `/api/economy` shows `totalDeployments = 0` 7 days after launch. |
| Response | Direct outreach via `docs/PARTNERSHIPS.md` cold DM template. Consider seeding one or two deploys yourself to demonstrate the flow. |
| Pre empt | Pre seed 3 to 5 partner conversations 2 weeks before launch. Have at least one Day 1 deploy lined up. |

### 8.2 Regulatory action

| Field | Value |
|---|---|
| Description | A jurisdiction targets the Factory as an unregistered securities or money transmission vehicle. |
| Probability | Low for a permissionless smart contract. Higher if Factory is framed publicly as a yield bearing product. |
| Impact | Potentially catastrophic for personal liability. |
| Detection | Subpoena, takedown notice, public enforcement action. |
| Response | Lawyer up. Out of scope for this doc. |
| Pre empt | Public communication framed as infrastructure (anyone can deploy), not yield. Treasury accumulation is operator controlled via the upgrade authority gated `claim_treasury` ix, not staked. No KYC, no fee distribution to users. |

---

## Pre launch readiness checklist

Tied to the Runbook. Each Yes is a precondition for the deploy command.

- [ ] Pre Launch 1/4 done: `claim_treasury` success path test green
- [ ] Pre Launch 2/4 done: this document read by the operator the morning of launch
- [ ] Pre Launch 3/4 done: verified build hash recorded
- [ ] Pre Launch 4/4 done: operator devnet drill (initialize + admin path) succeeded
- [ ] Backup RPC URL pre staged in the deploy shell
- [ ] Deployer wallet at >= 3 SOL on mainnet
- [ ] $WBULL mint pubkey confirmed against `bank.token_mint`
- [ ] `target/deploy/wrappedfactory.so` SHA256 matches what was tested
- [ ] Cold backup of upgrade authority keypair exists offline, verified readable
- [ ] No one else has shell access to the VPS during the deploy window
- [ ] X account ready to post launch announcement immediately on success
- [ ] X account ready to post pause notice immediately on failure
- [ ] Phantom email contact ready (for 6.2)

---

## Out of scope for this document

- The decision to ship without an external audit. That risk is accepted separately and tracked in the to do list.
- Bug bounty design. Tracked separately as a post launch item.
- Comms / launch announcement timing. Lives in `docs/PARTNERSHIPS.md`.

---

*This is a living document. Edit when a new failure mode becomes visible.*
