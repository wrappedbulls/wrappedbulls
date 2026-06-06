# $WBULL yield staking — V1 design

This document fixes the tokenomics and architecture decisions for the `wrappedstaking` program before any code is written. The program ships a single staking pool for $WBULL holders, distributing a percentage of `wrappedfactory` revenue as continuous rewards.

## Goal

Turn $WBULL from a speculative-only token into a productive asset. Stakers lock $WBULL into a pool, the Factory's `claim_treasury` revenue is partly routed back to that pool, and stakers earn pro-rata yield in $WBULL. The flywheel:

```
more Factory deploys → more revenue swept → more rewards deposited →
higher staking APY → higher $WBULL demand → higher dollar value of
the 1M $WBULL deploy fee → fewer spam deploys + higher dollar
revenue per deploy → higher rewards → repeat
```

## Non goals (V1)

- Multiple staking pools (single $WBULL pool only).
- Locked / boosted tiers (no 30/60/90 day options for V1).
- Vote escrow ($WBULL → veWBULL). Out of scope.
- Auto compounding (V2; reward auto restake).
- Liquid staking derivative ($sWBULL tradable token). V2.

## Revenue split

Each Factory deploy contributes **1,000,000 $WBULL** to the bull treasury after the 7 day lock. When the operator calls `claim_treasury` on the Factory program and sweeps the claimable balance, the operator MUST then atomically (within the same human session, not the same tx) call `deposit_rewards` on `wrappedstaking` with a configured percentage of the swept amount.

| Slice | Recipient | Mechanism | Notes |
|---|---|---|---|
| 50% | Staking reward vault | `wrappedstaking.deposit_rewards(amount)` | Earns yield for $WBULL stakers |
| 50% | Operator treasury | Stays in the destination wallet the operator passes to `claim_treasury` | Funds development, audits, art, ongoing ops |

The split is enforced operationally, not on chain. V1.1 may add an on chain split ix that takes a single sweep tx and atomically routes the two halves. For now the split is documented in `INCIDENT_RESPONSE.md` and `FACTORY_LAUNCH_RUNBOOK.md` as a required operator step.

Picking 50% over 30/70 or 70/30:

- 50% is the canonical "operator and community share equally" split. Easy to communicate, easy to audit.
- A higher staking share signals more value going to holders but starves dev funding.
- A lower staking share keeps more ops runway but caps the flywheel speed.

## Reward distribution mechanism

MasterChef style continuous rewards.

The pool tracks a single accumulator: `acc_reward_per_share`. When `deposit_rewards(amount)` is called:

```
acc_reward_per_share += (amount * REWARD_PRECISION) / total_staked
```

Where `REWARD_PRECISION = 1_000_000_000_000` (10^12; standard for u64 math without overflow). If `total_staked == 0`, deposit_rewards still credits the vault but the accumulator is not advanced; the operator's deposit is held in the vault and effectively distributed pro-rata to whoever stakes next (no funds lost, just no instant claim until someone stakes).

Each user's `StakerPosition` records:

- `amount`: how many base units they have staked
- `reward_debt`: `amount * acc_reward_per_share_at_last_interaction`

Pending rewards at any moment:

```
pending = (position.amount * acc_reward_per_share / REWARD_PRECISION) - position.reward_debt
```

When the user stakes / unstakes / claims, the program pays out `pending` first, then updates `reward_debt = position.amount * acc_reward_per_share`.

This pattern is battle tested (SushiSwap MasterChef, dozens of forks). The math is overflow safe for u64 stake sizes up to ~10^18 base units, which is way more than the 10^15 total $WBULL supply scaled to 6 decimals.

## Lock period rules

V1 ships **no lock**. Stake any time, unstake any time, claim any time. No cooldown.

The reasoning:

- Simplest UX. No "your funds are locked until X" copy.
- No griefing surface from cooldown manipulation.
- Most yield staking primitives (Aave, Compound supply, classic MasterChef) ship without a lock; users vote with their feet.

If we observe that opportunistic flash-staking around large `deposit_rewards` calls dilutes long term stakers, V1.1 adds a 7 day cooldown on unstake. We do NOT pre build the cooldown until we have evidence we need it.

## Reward emission rate

Rewards do not emit continuously. They are deposited in chunks each time the operator sweeps the Factory treasury and routes 50% to the pool. Between deposits, no new rewards accrue.

This means stakers earn yield only when Factory deploys happen. At zero deploys, APY is 0%. At high deploy rates, APY climbs.

Estimate at concrete deploy rates (assuming 50% routed, 1M $WBULL per deploy, no lock):

| Deploys per year | Rewards per year | If 10M $WBULL staked | If 100M $WBULL staked |
|---|---|---|---|
| 12 (1/month) | 6M $WBULL | 60% APY | 6% APY |
| 52 (1/week) | 26M $WBULL | 260% APY | 26% APY |
| 365 (1/day) | 182.5M $WBULL | 1825% APY | 182.5% APY |

These estimates do not factor in the 7 day lock cliff between deploy and claim, but at scale that smooths out.

Public-facing APY display: show *trailing 30 day yield rate*, computed from on chain `deposit_rewards` events in the last 30 days projected to a year. This is honest and matches what a holder actually earned.

## Account architecture

Three on chain accounts:

1. **`StakingPool`** singleton PDA, seeds `[b"staking_pool"]`.
   - `stake_mint: Pubkey` ($WBULL mint)
   - `stake_vault: Pubkey` (ATA owned by pool authority, holds staked tokens)
   - `reward_vault: Pubkey` (ATA owned by pool authority, holds deposited rewards waiting to be claimed)
   - `total_staked: u64`
   - `acc_reward_per_share: u128`
   - `lifetime_rewards_deposited: u64`
   - `lifetime_rewards_claimed: u64`
   - `bump: u8`
   - `reserved: [u8; 96]` (V2 fields)

2. **`StakerPosition`** per user PDA, seeds `[b"position", user_pubkey]`.
   - `owner: Pubkey`
   - `amount: u64`
   - `reward_debt: u128`
   - `bump: u8`
   - `reserved: [u8; 48]` (V2 fields)

3. **Pool authority** PDA, seeds `[b"pool_authority"]`. CHECK account. Signs CPI transfers out of `stake_vault` and `reward_vault`.

The pool authority PDA design separates accounting (`StakingPool`) from signing authority. The same pattern the Factory uses for `bull_treasury_state` (state) plus `bull_treasury_vault` (ATA whose authority is the state PDA).

## Instructions

| ix | Caller | Description |
|---|---|---|
| `initialize_pool` | Program upgrade authority | One time setup. Writes `StakingPool` + creates `stake_vault` and `reward_vault` ATAs |
| `deposit_rewards(amount: u64)` | Anyone (in practice: operator) | Transfers `amount` $WBULL from caller to `reward_vault`, advances `acc_reward_per_share` |
| `stake(amount: u64)` | Any holder | Transfers `amount` $WBULL from caller to `stake_vault`, updates `StakerPosition` |
| `unstake(amount: u64)` | Position owner | Returns `amount` $WBULL from `stake_vault` to owner, pays pending rewards first |
| `claim_rewards` | Position owner | Pays pending rewards without touching staked balance |

`initialize_pool` is gated to the program upgrade authority (same pattern as `wrappedfactory.initialize`). `deposit_rewards` is intentionally permissionless: anyone can pour $WBULL into the pool, but the operator is the only entity with revenue to give. The accounting math is safe regardless of who calls deposit_rewards.

## Upgrade authority posture

Same as `wrappedfactory`: single hot keypair (`9ZDrkF`), upgrade authority on the program data account, soak period of 30 to 60 days, then either Squads multisig handoff or revoke entirely. Documented in `AUTHORITY.md` (which will gain a section for `wrappedstaking` once shipped).

`wrappedstaking` is operationally independent of `wrappedfactory`. A bug in one program does not affect the other. The two programs share the $WBULL mint but no PDAs.

## Audit posture

V1 ships with internal audit only (same posture as `wrappedfactory`). No external audit. The risk envelope:

- Worst case bug: `unstake` allows a user to withdraw more than `position.amount` (drains the stake vault for other users). Mitigated by always reading `position.amount` from on chain state before any transfer; tests cover the obvious off by one cases.
- Reward inflation: a bug in `acc_reward_per_share` advancement could let a stake placed RIGHT after a `deposit_rewards` call claim a share of those rewards. The MasterChef pattern guards against this with `reward_debt` snapshots; the test suite proves the boundary.
- Locked tokens: `claim_treasury` deposits cannot reverse. If the pool is paused mid life cycle, stakers must still be able to withdraw their `amount` + pending rewards. No pause guard on `unstake` and `claim_rewards` (analogous to the Factory's unguarded `unwrap`).

## File layout

```
programs/
  wrappedstaking/
    Cargo.toml
    Xargo.toml
    src/
      lib.rs
      state.rs
      errors.rs
      instructions/
        mod.rs
        initialize_pool.rs
        deposit_rewards.rs
        stake.rs
        unstake.rs
        claim_rewards.rs
tests/
  wrappedstaking.ts             # main suite, anchor test runner
  wrappedstaking_bankrun.ts     # clock warping for time based scenarios
```

## Implementation order

1. `state.rs` + `errors.rs` (account structures, error variants).
2. `initialize_pool` + bankrun test asserting singleton creation.
3. `deposit_rewards` + test asserting `acc_reward_per_share` math.
4. `stake` + test asserting stake math + first reward debt = 0.
5. `claim_rewards` + test asserting pending payout matches expected.
6. `unstake` + test asserting partial / full unstake leaves correct state.
7. Boundary cases: stake on zero pool, unstake exact balance, claim with zero pending.
8. End to end bankrun: stake → deposit_rewards → claim → verify token math.
9. Devnet deploy + drill.
10. Mainnet deploy + initialize.

## Open questions deferred

- Liquid staking derivative ($sWBULL ERC4626 style). V2.
- Booster multipliers for long term lockers. V2.
- Cross-program revenue routing (auto deposit from `claim_treasury`). V2.
- Public dashboard for top stakers / leaderboard. V2.
