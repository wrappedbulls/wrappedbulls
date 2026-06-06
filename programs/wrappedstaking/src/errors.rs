use anchor_lang::prelude::*;

/// All on-chain error cases the wrappedstaking program can surface.
/// Codes are stable across upgrades (Anchor assigns by declaration
/// order, so append only, never reorder or delete).
#[error_code]
pub enum WrappedStakingError {
    // -------- initialize_pool --------

    #[msg("Staking pool has already been initialized")]
    PoolAlreadyInitialized,

    #[msg("Caller is not the configured staking pool admin (program upgrade authority)")]
    NotPoolAdmin,

    // -------- deposit_rewards --------

    #[msg("Deposit amount must be greater than zero")]
    InvalidDepositAmount,

    #[msg("Caller's $WBULL balance is below the deposit amount")]
    InsufficientDepositBalance,

    // -------- stake --------

    #[msg("Stake amount must be greater than zero")]
    InvalidStakeAmount,

    #[msg("Caller's $WBULL balance is below the stake amount")]
    InsufficientStakeBalance,

    // -------- unstake --------

    #[msg("Unstake amount must be greater than zero")]
    InvalidUnstakeAmount,

    #[msg("Unstake amount exceeds the position's staked balance")]
    UnstakeExceedsPosition,

    // -------- accounts --------

    #[msg("Provided $WBULL mint does not match the pool's configured stake mint")]
    WrongStakeMint,

    #[msg("Provided stake vault does not match the pool's recorded vault ATA")]
    WrongStakeVault,

    #[msg("Provided reward vault does not match the pool's recorded vault ATA")]
    WrongRewardVault,

    #[msg("Position owner does not match the signing caller")]
    PositionOwnerMismatch,

    // -------- math --------

    #[msg("Reward distribution overflowed; this should never happen at realistic stake sizes")]
    RewardMathOverflow,
}
