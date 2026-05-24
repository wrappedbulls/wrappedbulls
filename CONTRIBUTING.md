# Contributing to WrappedBulls

This repository is open source. The Anchor program is the canonical implementation
of the hybrid token-NFT mechanic; the website + cranker are reference implementations.

To verify the on-chain mechanic from scratch:

```
cargo test --manifest-path programs/wrappedbulls/Cargo.toml --lib   # 10 unit tests
anchor test                                                     # 7 integration tests
```

For non-trivial changes, open an issue first to discuss the approach.
