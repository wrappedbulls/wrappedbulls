// Instruction modules for the wrappedstaking program. C2 ships
// the module skeleton + Accounts struct shape so the workspace
// compiles. C3 fills in the handler bodies + signing logic.
//
// Same glob re-export pattern as the wrappedfactory program for
// audit parity. The ambiguous "handler" glob warning is benign and
// matches the sibling program.

pub mod initialize_pool;
pub mod deposit_rewards;
pub mod stake;
pub mod unstake;
pub mod claim_rewards;

pub use initialize_pool::*;
pub use deposit_rewards::*;
pub use stake::*;
pub use unstake::*;
pub use claim_rewards::*;
