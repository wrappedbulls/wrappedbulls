use anchor_lang::prelude::*;

#[error_code]
pub enum WrappedbullsError {
    #[msg("Token account is not for the configured $TOKEN mint")]
    WrongMint,

    #[msg("Caller's balance is below the 1,000,000 token wrap threshold")]
    InsufficientBalance,

    #[msg("Caller does not hold the bull NFT being unwrapped")]
    NotNftHolder,

    #[msg("Vault account does not match the expected PDA for this NFT mint")]
    VaultMismatch,

    #[msg("Maximum bulls already wrapped (1,000 cap reached)")]
    MaxBullsReached,

    #[msg("Bull asset PDA does not match expected tier index")]
    TierMismatch,

    #[msg("Tier index out of bounds (must be 1..=1000)")]
    TierOutOfBounds,

    #[msg("Provided NFT mint does not match the BullAsset record")]
    NftMintMismatch,

    #[msg("Vault balance is not exactly 1,000,000 tokens")]
    VaultBalanceMismatch,

    #[msg("Metaplex Certified Collection not initialized — call initialize_collection first")]
    CollectionNotInitialized,

    #[msg("Provided collection mint does not match BullBank.collection_mint")]
    WrongCollection,

    #[msg("Collection NFT already initialized (idempotency guard)")]
    CollectionAlreadyInitialized,

    #[msg("Caller is not the program authority recorded in BullBank")]
    NotProgramAuthority,

    #[msg("Only the program's upgrade authority may call initialize")]
    UnauthorizedInitializer,

    #[msg("Vault token account already holds a balance — cannot wrap into a non-empty vault")]
    VaultNotEmpty,
}
