# Simple Pay to Sign

This smart contract takes payment in Near and then calls MPC sign.

## How to Build Locally?

Use Rust 1.97.1 (pinned in `rust-toolchain.toml`). Install [`cargo-near`](https://github.com/near/cargo-near) and run:

```bash
cargo near build non-reproducible-wasm
```

## How to Test Locally?

```bash
cargo test
```

## How to Deploy?

To deploy manually, install [`near-cli-rs`](https://github.com/near/near-cli-rs) and [`cargo-near`](https://github.com/near/cargo-near) and run:

```bash
# Create a new account
near account create-account sponsor-by-faucet-service <account-id>

# Deploy the contract on it
cargo near deploy build-non-reproducible-wasm <account-id>
```

The account and deploy commands prompt for the remaining testnet credential and initialization options. The contract initializes itself with an empty state; choose no initialization call.

## Useful Links

-   [cargo-near](https://github.com/near/cargo-near) - NEAR smart contract development toolkit for Rust
-   [near CLI-rs](https://near.cli.rs) - Iteract with NEAR blockchain from command line
-   [NEAR Rust SDK Documentation](https://docs.near.org/sdk/rust/introduction)
-   [NEAR Documentation](https://docs.near.org)
-   [NEAR StackOverflow](https://stackoverflow.com/questions/tagged/nearprotocol)
-   [NEAR Discord](https://near.chat)
-   [NEAR Telegram Developers Community Group](https://t.me/neardev)
-   NEAR DevHub: [Telegram](https://t.me/neardevhub), [Twitter](https://twitter.com/neardevhub)
