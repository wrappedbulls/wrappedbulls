use anchor_lang::prelude::*;

/// All on-chain error cases the Factory program can surface. Codes are
/// stable across upgrades (Anchor assigns them by declaration order, so we
/// only append to the end — never reorder or delete).
#[error_code]
pub enum WrappedFactoryError {
    // -------- initialize --------

    #[msg("Factory has already been initialized")]
    FactoryAlreadyInitialized,

    #[msg("Caller is not the configured Factory admin (program upgrade authority)")]
    NotFactoryAdmin,

    // -------- deploy_collection --------

    #[msg("Provided $WBULL mint does not match Factory config")]
    WrongWbullMint,

    #[msg("Caller's $WBULL balance is below the 1,000,000 deploy fee threshold")]
    InsufficientWbullForBurn,

    #[msg("Max supply must be between 100 and 2,000 inclusive")]
    InvalidSupplyRange,

    #[msg("Tokens-per-wrap must be greater than zero")]
    InvalidTokensPerWrap,

    #[msg("Wrap layer name must be 1..=25 ASCII characters")]
    InvalidName,

    #[msg("Wrap layer ticker must be 1..=10 ASCII characters")]
    InvalidTicker,

    #[msg("Art source URI must be 1..=195 ASCII characters and end with a non-whitespace char")]
    InvalidArtUri,

    #[msg("A wrap layer for this token mint already exists (PDA collision)")]
    CollectionAlreadyDeployed,

    // -------- wrap --------

    #[msg("Token account is not for this collection's configured token mint")]
    WrongTokenMint,

    #[msg("Caller's balance is below the wrap threshold for this collection")]
    InsufficientBalance,

    #[msg("Maximum supply already wrapped for this collection")]
    MaxSupplyReached,

    #[msg("Tier index out of bounds (must be 1..=max_supply)")]
    TierOutOfBounds,

    #[msg("Bull asset PDA does not match expected tier index")]
    TierMismatch,

    // -------- unwrap --------

    #[msg("Caller does not hold the bull NFT being unwrapped")]
    NotNftHolder,

    #[msg("Provided NFT mint does not match the BullAsset record")]
    NftMintMismatch,

    #[msg("Vault balance is below the expected tokens-per-wrap amount")]
    VaultBalanceMismatch,

    #[msg("Provided collection mint does not match this WrappedCollection")]
    WrongCollection,

    // -------- bull treasury --------

    #[msg("Bull treasury pending queue is at capacity (256). Multisig must claim_treasury to free room.")]
    TreasuryPendingFull,

    #[msg("Nothing currently claimable in bull treasury after sweeping expired deposits")]
    NothingClaimable,

    #[msg("Provided bull treasury state PDA does not match the expected derivation")]
    WrongTreasuryState,

    #[msg("Provided bull treasury vault does not match the expected ATA derivation")]
    WrongTreasuryVault,
}
