# Overview

### ⚠️⚠️⚠️ Caution! This is beta / testnet technology ⚠️⚠️⚠️

Near's MPC allows a Near Account to create derivative accounts (public keys) and signatures of transactions for other blockchains.

Several MPC nodes maintain a single public key. This key is combined with your Near AccountId (unique) and a chosen "path" offset (chosen by client). This produces a new and unique public key. The generation of signatures via the MPC nodes can only be authorized by same Near Account by calling the `sign` method of the MPC contract.

The creation of secp256k1 public keys for Bitcoin and EVM chains is currently supported.

### Flow (how it works)

1. Obtain the MPC public key (near view [MPC_CONTRACT_ID] `public_key`) and hardcode into `.env` or code
2. Choose a path for the derived account (public key) see: [Path naming conventions](https://github.com/near/near-fastauth-wallet/blob/dmd/chain_sig_docs/docs/chain_signature_api.org)
3. Use `./src/kdf.ts -> generateAddress` to generate the derived account address and public key
4. Use the `sign` method of `./src/near.ts -> sign` which calls the MPC contract to sign payload (hash of TX)
5. Using a library (ethers/bitcoinjs-lib) combine the transaction and signature to create signed transaction
6. Broadcast the transaction e.g. `sendRawTransaction`

# Installation

`yarn`

### CREATE .env FILE in root of project

```
NEAR_ACCOUNT_ID="[NEAR_TESTNET_ACCOUNT]"
NEAR_PRIVATE_KEY="[NEAR_ACCOUNT_PRIVATE_KEY]"
MPC_PATH="[MPC_PATH]"
MPC_CHAIN="[ethereum|bitcoin]"
MPC_CONTRACT_ID="multichain-testnet-2.testnet"
MPC_PUBLIC_KEY="secp256k1:4HFcTSodRLVCGNVcGc4Mf2fwBBBxv9jxkGdiW2S2CA1y6UpVVRWKj6RX7d7TDt65k2Bj3w9FU4BGtt43ZvuhCnNt"
```

### For dogecoin testnet (link below)

```
TATUM_API_KEY=""
```

### For MPC_PATH please refer to:

[Path naming conventions](https://github.com/near/near-fastauth-wallet/blob/dmd/chain_sig_docs/docs/chain_signature_api.org)

# How to Use Commands

(as a user or dev to verify everything works)

1. Read the `Installation` steps and set up all environment variables first with `.env` file.
2. Use the commands to generate addresses first.
3. Fund these addresses with the Testnet Faucets provided in the links below.
4. Use the commands to send funds from your generated addresses.

# Prebuilt Commands

`yarn start [commands]`

### Command List

- -ea - ethereum addressm (EVM)
- -ba - bitcoin testnet address
- -da - dogecoin testnet address
- -ra - ripple testnet address
- -s - sign sample payload using Near account
- -etx - send ETH
- -btx - send BTC
- -dtx - send DOGE (requires API KEY)
- -rtx - send XRP

### Sending Options

- --amount - amount to send (ETH or sats)
- --to - destination address

# EVM Contract Deployment and Interactions (advanced)

Usage: `yarn start [commands]`

### Command List

- -d, -edc - deploy contract
- --to - the contract address to view/call
- -v, -view - view contract state (readonly call)
- -c, -call - call contract method
- --path - path to EVM bytecode file from root of this project
- --method - name of method view/call
- --args - arguments e.g. '{"address":"0x525521d79134822a342d330bd91da67976569af1"}' in single quotes
- --ret - list of return parameter types (if any) e.g. ['uint256']

## NFT Example

After setting up all your environment variables and ensuring your calling EVM address has ETH for gas.

Start by deploying a new NFT contract:

1. `yarn start -d`

Check explorer link and make sure contract is deployed successfully.

Take contract address from console result and call:

2. `yarn start -c --to 0x[CONTRACT ADDRESS FROM STEP 1]`

This will mint a token to default address `0x525521d79134822a342d330bd91da67976569af1`.

View the balanance of the default address using:

3. `yarn start -v --to 0x[CONTRACT ADDRESS FROM STEP 1]`

Which should output `1` the NFT balance of default address `0x525521d79134822a342d330bd91da67976569af1`

# Proxy call MPC sign from Near Contract (advanced)

To deploy the Near contract use `cargo-near`.

Install `cargo-near` and `near-cli`

- [cargo-near](https://github.com/near/cargo-near) - NEAR smart contract development toolkit for Rust
- [near CLI-rs](https://near.cli.rs) - Iteract with NEAR blockchain from command line

```
cargo build

cargo near create-dev-account

cargo near deploy [ACCOUNT_ID]
```

The Near contract has the following features:

1. `sign` method accepts a payload that is the unhashed RLP encoded EVM transaction data e.g. `6a627842000000000000000000000000525521d79134822a342d330bd91DA67976569aF1` calls the method `mint` with an address argument of `525521d79134822a342d330bd91DA67976569aF1`
2. `PUBLIC_RLP_ENCODED_METHOD_NAMES` stores public EVM method name hashes that can be called from this Near contract to the destination address e.g. the method name `mint` hashes `6a627842000000000000000000000000`
3. `COST` must be paid in Near
4. `path` and `key_version` arguments are passed through to MPC `sign` call, but in the future could be used as additional features for applications or security

To use, set the following `.env` vars accordingly:

```
NEAR_PROXY_ACCOUNT="true"
NEAR_PROXY_CONTRACT="true"
NEAR_PROXY_ACCOUNT_ID="futuristic-anger.testnet"
NEAR_PROXY_PRIVATE_KEY="ed25519:..."
```

With `NEAR_PROXY_CONTRACT="true"` the script will call `sign` method of the proxy contract you deployed using `cargo near deploy`.

To verify, send some ETH using `yarn start -etx`.

With `NEAR_PROXY_ACCOUNT="false"` you will not be able to send ETH using the `sign` method of the proxy contract. Why? Because this would mean any Near account can send ETH from the derived account of the proxy contract. Oh no! The proxy contract protects against arbitrary transactions using this check:

```
let owner = env::predecessor_account_id() == env::current_account_id();

// check if rlp encoded eth transaction is calling a public method name
let mut public = false;
for n in PUBLIC_RLP_ENCODED_METHOD_NAMES {
	if rlp_payload.find(n).is_some() {
		public = true
	}
}

// only the Near contract owner can call sign of arbitrary payloads for chain signature accounts based on env::current_account_id()
if !public {
	require!(
		owner,
		"only contract owner can sign arbitrary EVM transactions"
	);
}
```

Enjoy!

# References & Useful Links

### Examples

[Live Example - Near Testnet, Sepolia, Bitcoin Testnet](https://test.near.social/md1.testnet/widget/chainsig-sign-eth-tx)

[A frontend example you can run locally](https://github.com/gagdiez/near-multichain)

### Docs

[Path naming conventions](https://github.com/near/near-fastauth-wallet/blob/dmd/chain_sig_docs/docs/chain_signature_api.org)

[Chain Signatures Docs](https://docs.near.org/concepts/abstraction/chain-signatures)

[Chain Signatures Use Cases](https://docs.near.org/concepts/abstraction/signatures/use-cases)

### MPC Repositories

[MPC Repo](https://github.com/near/mpc-recovery/)

### Faucets and API Keys

[Sepolia Faucet](https://sepolia-faucet.pk910.de/)

[Bitcoin Testnet Faucet](https://faucet.triangleplatform.com/bitcoin/testnet)

#### For Dogecoin, you will need to register for Tatum API (free plan):

[Dogecoin Tatum API](https://tatum.io/) and [docs](https://apidoc.tatum.io/tag/Dogecoin)

[Dogecoin Testnet Faucet](https://shibe.technology/)

#### XRP Ledger

[XRP Ledger Testnet Faucet](https://test.bithomp.com/faucet/)

[XRP Ledger Testnet Explorer](https://test.bithomp.com/explorer)
