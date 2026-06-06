use anchor_lang::prelude::*;

// =====================================================================
// StakingPool
//
// Singleton PDA: seed = ["staking_pool"].
//
// Records the canonical $WBULL mint, the stake and reward vault
// ATAs, the total staked, the MasterChef reward accumulator, and
// lifetime counters. Written once by initialize_pool, gated to the
// program upgrade authority. Read on every user instruction.
//
// acc_reward_per_share is u128. The accumulator advances by
//   (amount * REWARD_PRECISION) / total_staked
// each deposit_rewards call. u128 has headroom for amount values up
// to 10^18 base units and REWARD_PRECISION = 10^12, leaving 38
// orders of magnitude of overflow protection.
// =====================================================================
#[account]
pub struct StakingPool {
    /// $WBULL mint. Immutable post-init. Same value as the Factory's
    /// FactoryConfig.wbull_mint and the wrappedbulls bank.token_mint.
    /// Recorded here so this program does not require a cross-program
    /// account read to verify the staked mint at every interaction.
    pub stake_mint: Pubkey,

    /// ATA owned by the pool_authority PDA. Holds the cumulative
    /// staked balance across every position. Drained when users
    /// unstake; topped up when users stake.
    pub stake_vault: Pubkey,

    /// ATA owned by the pool_authority PDA. Holds rewards deposited
    /// via deposit_rewards waiting to be claimed by stakers. Drained
    /// when users claim_rewards / unstake / stake (which pays
    /// pending first).
    pub reward_vault: Pubkey,

    /// Sum of position.amount across all StakerPosition PDAs. Used
    /// as the denominator in the acc_reward_per_share advancement
    /// math. When zero, deposit_rewards does NOT advance the
    /// accumulator (the deposit is held in reward_vault and
    /// effectively distributed to whoever stakes next).
    pub total_staked: u64,

    /// MasterChef accumulator. Scaled by REWARD_PRECISION (10^12).
    /// A position's pending rewards at any moment are
    ///   (position.amount * acc_reward_per_share) / REWARD_PRECISION
    ///   - position.reward_debt
    pub acc_reward_per_share: u128,

    /// Strictly monotonic: total $WBULL ever deposited into
    /// reward_vault via deposit_rewards. Public telemetry; does NOT
    /// decrease when claims happen.
    pub lifetime_rewards_deposited: u64,

    /// Strictly monotonic: total $WBULL ever paid out to stakers via
    /// claim_rewards or as the "settle pending" side effect of
    /// stake / unstake.
    pub lifetime_rewards_claimed: u64,

    /// PDA bump. Also used as the signing bump for the stake_vault
    /// and reward_vault CPI transfers since this PDA doubles as the
    /// vault authority. Same pattern wrappedfactory uses for
    /// bull_treasury_state.
    pub bump: u8,

    /// Forward-compat slack. Carve future fields from here to keep
    /// SIZE stable across upgrades. 97 bytes leaves room for V2
    /// features like cooldown periods, boost multipliers, sister
    /// pools, etc.
    pub reserved: [u8; 97],
}

impl StakingPool {
    pub const SIZE: usize = 8        // anchor discriminator
        + 32                          // stake_mint
        + 32                          // stake_vault
        + 32                          // reward_vault
        + 8                           // total_staked
        + 16                          // acc_reward_per_share (u128)
        + 8                           // lifetime_rewards_deposited
        + 8                           // lifetime_rewards_claimed
        + 1                           // bump
        + 97;                         // reserved (was 96 + authority_bump; merged)
}

// =====================================================================
// StakerPosition
//
// Per user PDA: seed = ["position", owner].
//
// Records how much a single user has staked and the MasterChef
// reward_debt snapshot. Created lazily by the first stake call
// from that user; closed by an unstake that drains to zero (account
// rent returned to owner).
// =====================================================================
#[account]
pub struct StakerPosition {
    /// Wallet that owns this position. Recorded as a constraint
    /// target for unstake / claim_rewards so a malicious caller
    /// cannot pass someone else's PDA.
    pub owner: Pubkey,

    /// Base units of $WBULL staked. Decrements on unstake, increments
    /// on stake. Always equals the contribution of this position to
    /// pool.total_staked.
    pub amount: u64,

    /// MasterChef reward_debt snapshot. Updated on every stake /
    /// unstake / claim to
    ///   reward_debt = amount * pool.acc_reward_per_share / REWARD_PRECISION
    /// at the moment of the last interaction. Pending rewards are
    /// always
    ///   (amount * pool.acc_reward_per_share / REWARD_PRECISION) - reward_debt
    pub reward_debt: u128,

    /// PDA bump.
    pub bump: u8,

    /// Forward-compat slack.
    pub reserved: [u8; 48],
}

impl StakerPosition {
    pub const SIZE: usize = 8         // anchor discriminator
        + 32                           // owner
        + 8                            // amount
        + 16                           // reward_debt (u128)
        + 1                            // bump
        + 48;                          // reserved
}
