// Instruction modules for the WrappedFactory program. Each file pairs an
// Accounts struct with a handler, following the same shape as the sibling
// wrappedbulls program for audit parity.
//
// We use glob re-exports here (NOT named) because Anchor's #[program]
// macro relies on each module's auto-generated `__client_accounts_*` and
// `__cpi_client_accounts_*` helpers being reachable from the crate root.
// Switching to named exports compiles in isolation but breaks the
// #[program] macro with E0432 ("unresolved import `crate`"). The
// "ambiguous glob re-exports of `handler`" compiler warning that this
// pattern produces is benign and is also emitted by wrappedbulls.

pub mod initialize;
pub mod deploy_collection;
pub mod wrap;
pub mod unwrap;
pub mod claim_treasury;
pub mod set_verified;

pub use initialize::*;
pub use deploy_collection::*;
pub use wrap::*;
pub use unwrap::*;
pub use claim_treasury::*;
pub use set_verified::*;
