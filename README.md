# Overview

### ⚠️⚠️⚠️ Caution! This is beta / testnet technology ⚠️⚠️⚠️

[Official Documentation](https://docs.near.org/build/chain-abstraction/chain-signatures)

# Workshop Video

[![Workshop Video](https://img.youtube.com/vi/QTeNALBH3kw/0.jpg)](https://youtu.be/QTeNALBH3kw)

# Introduction

NEAR's MPC allows a NEAR account to create derivative accounts (public keys) and signatures of transactions for other blockchains.

Several MPC nodes maintain a single public key. This key is combined with your NEAR accountId (unique) and a "path" offset (chosen by client). This produces a new and unique public key. The generation of signatures via the MPC nodes can only be authorized by same NEAR account by calling the `sign` method of the MPC contract. This NEAR account can be a smart contract.

The creation of secp256k1 public keys and addresses for Bitcoin (like) and EVM chains is currently supported.

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
MPC_CONTRACT_ID="v1.signer-dev.testnet"
MPC_PUBLIC_KEY="secp256k1:54hU5wcCmVUPFWLDALXMh1fFToZsVXrx9BbTbHzSfQq1Kd1rJZi52iPa4QQxo6s5TgjWqgpY8HamYuUDzG6fAaUq"
```

### For dogecoin testnet (link below)

```
TATUM_API_KEY=""
```

### For MPC_PATH please refer to:

[Path naming conventions](https://docs.near.org/concepts/abstraction/chain-signatures#one-account-multiple-chains)

# How to Use

1. Read the `Installation` steps and set up all environment variables first with `.env` file.
2. Use the commands to generate some Chain Signature addresses first.
3. Fund these addresses with the Testnet Faucets provided in the links below.
4. Use the commands to send funds and transactions from your generated addresses.

# Prebuilt Commands

`yarn start [commands]`

### Command List

-   -ea - ethereum addressm (EVM)
-   -ba - bitcoin testnet address
-   -da - dogecoin testnet address
-   -ra - ripple testnet address
-   -s - sign sample payload using NEAR account
-   -etx - send ETH
-   -btx - send BTC
-   -dtx - send DOGE (requires API KEY)
-   -rtx - send XRP

### Sending Options

-   --amount - amount to send (ETH or sats)
-   --to - destination address

# EVM Contract Deployment and Interactions (advanced)

Usage: `yarn start [commands]`

### Command List

-   -d, -edc - deploy contract
-   --to - the contract address to view/call
-   -v, -view - view contract state (readonly call)
-   -c, -call - call contract method
-   --path - path to EVM bytecode file from root of this project
-   --method - name of method view/call
-   --args - arguments e.g. '{"address":"0x525521d79134822a342d330bd91da67976569af1"}' in single quotes
-   --ret - list of return parameter types (if any) e.g. ['uint256']

# Ethereum EVM Contract NFT Example

After setting up all your environment variables and ensuring your calling EVM address has ETH for gas.

Start by deploying a new NFT contract:

1. `yarn start -d`

Check explorer link and make sure contract is deployed successfully.

Take your contract address from console result and call:

2. `yarn start -c --to 0x[CONTRACT ADDRESS FROM STEP 1]`

This will mint a token to default address `0x525521d79134822a342d330bd91da67976569af1`.

To mint a token to a different address use `--args '{"address":"0x[SOME_OTHER_ADDRESS]"}'` with your args in single quotes and properly formatted JSON paths and values in double quotes.

View the balance of the **default address** using:

3. `yarn start -v --to 0x[CONTRACT ADDRESS FROM STEP 1]`

Which should output `1` the NFT balance of default address `0x525521d79134822a342d330bd91da67976569af1`

To view the balance of a different address use `--args '{"address":"0x[SOME_OTHER_ADDRESS]"}'` with your args in single quotes and properly formatted JSON paths and values in double quotes.

# Call a NEAR contract to sign a call for an EVM Account (advanced)

This example uses a NEAR contract to call the NEAR MPC Contract and produce a valid signature for a derived EVM account that is based on the NEAR contract address.

Simply put, it is exchanging a payable NEAR transaction for a valid signature to execute an EVM transaction.

1. Client -> call `sign` method -> [NEAR CONTRACT]
2. [NEAR CONTRACT] -> [MPC Contract]
3. [MPC Contract] -> return signature -> [NEAR CONTRACT]
4. [NEAR CONTRACT] -> return signature -> Client
5. Client -> broadcast EVM transaction (as the derived EVM account)

### Access Control and Protocol Application Logic

The only way to obtain a valid ecdsa signature for the derived EVM account is by calling the NEAR contract's sign method.

If the derived EVM account is, for example, the owner of an NFT contract (like in the example above), then the only way to mint the NFT is by calling the NEAR contract first to obtain a valid signature for the owner.

The NEAR contract acts as a gatekeeper for the derived EVM account (or accounts). Expanding on this, complex applications can be built with their logic happening on NEAR and the execution happening on EVM or other chains!

### NEAR contract features:

1. `sign` method accepts a payload that is the unhashed RLP encoded EVM transaction data e.g. `6a627842000000000000000000000000525521d79134822a342d330bd91DA67976569aF1` calls the method `mint` with an address argument of `525521d79134822a342d330bd91DA67976569aF1`
2. `PUBLIC_RLP_ENCODED_METHOD_NAMES` is a constant that stores EVM method name hashes that can be called by any NEAR account; e.g. the method name `mint` hashes `6a627842000000000000000000000000`
3. The `COST` of a public call is 1 NEAR token
4. `path` and `key_version` arguments are passed through to MPC `sign` call, but in the future could be used as additional features by this contract for new applications or security

### Deploy the NEAR contract using `cargo-near`.

Install `cargo-near` and `near-cli`

-   [cargo-near](https://github.com/near/cargo-near) - NEAR smart contract development toolkit for Rust
-   [near CLI-rs](https://near.cli.rs) - Iteract with NEAR blockchain from command line

```
cargo build

cargo near create-dev-account

cargo near deploy [ACCOUNT_ID]
```

### Set the following `.env` vars accordingly:

```
NEAR_PROXY_ACCOUNT="true"
NEAR_PROXY_CONTRACT="true"
NEAR_PROXY_ACCOUNT_ID="futuristic-anger.testnet"
NEAR_PROXY_PRIVATE_KEY="ed25519:..."
```

With `NEAR_PROXY_CONTRACT="true"` the script will call `sign` method of the proxy contract you deployed using `cargo near deploy`.

With `NEAR_PROXY_ACCOUNT="false"` you will be calling the NEAR contract from your own NEAR account specified in the `.env`. You will only be able to call sign for an EVM transaction that contains the rlp encoded method name `mint`. Why? Because otherwise, any NEAR account could get a valid signature for any EVM transaction for the derived EVM account of the proxy contract. This is an example of the [Access Control and Protocol Application Logic](#Access-Control-and-Protocol-Application-Logic) section above.

### Protect against signing arbitrary EVM transactions:

```
let owner = env::predecessor_account_id() == env::current_account_id();

// check if rlp encoded eth transaction is calling a public method name
let mut public = false;
for n in PUBLIC_RLP_ENCODED_METHOD_NAMES {
	if rlp_payload.find(n).is_some() {
		public = true
	}
}

// only the NEAR contract owner can call sign of arbitrary payloads for chain signature accounts based on env::current_account_id()
if !public {
	require!(
		owner,
		"only contract owner can sign arbitrary EVM transactions"
	);
}
```

### Testing the NEAR contract and minting the NFT on the EVM contract

1. Your contract should be deployed and you should have the following env vars:

```
NEAR_PROXY_ACCOUNT="true"
NEAR_PROXY_CONTRACT="true"
NEAR_PROXY_ACCOUNT_ID="..."
NEAR_PROXY_PRIVATE_KEY="ed25519:..."
```

2. Call `yarn start -etx` you are now deriving an Ethereum address using the NEAR account ID of the NEAR Proxy Contract, not your NEAR account ID

_NOTE: This Ethereum address is different and unfunded. So, this transaction will not work._

3. Fund the address from step 2.

You can do this by sending ETH using this script.

Change env vars:

```
NEAR_PROXY_ACCOUNT="false"
NEAR_PROXY_CONTRACT="false"
```

Send ETH to your new derived Ethereum address:

`yarn start -etx --to 0x[ADDRESS FROM STEP 2] --amount [AMOUNT IN ETH e.g. 0.1]`

4. Now you can repeat the steps from the [**Ethereum EVM Contract NFT Example**](#Ethereum-EVM-Contract-NFT-Example) above.

You will deploy the NFT contract to an EVM account derived from the EVM account derived (not a typo) from the NEAR contract address.

-   [NEAR CONTRACT] -> [Derived EVM account] -> [EVM contract]

Once you get the signature from calling the NEAR contract, to broadcast your transaction, you will call the `mint` method as the owner of the deployed NFT contract.

-   [Derived EVM account] -> [EVM contract]

5. Once the NFT contract is deployed you can call the NEAR contract from any NEAR account. Try it by changing the `.env` vars:

```
NEAR_PROXY_ACCOUNT="false"
NEAR_PROXY_CONTRACT="true"
```

# References & Useful Links

[Official Documentation](https://docs.near.org/build/chain-abstraction/chain-signatures)

### Examples

TBD

### Docs

[Official Documentation](https://docs.near.org/build/chain-abstraction/chain-signatures)

### MPC Repositories

[MPC Repo](https://github.com/near/mpc)

### Faucets and API Keys

[Sepolia Faucet](https://sepolia-faucet.pk910.de/)

[Sepolia Faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)

[Bitcoin Testnet Faucet](https://faucet.triangleplatform.com/bitcoin/testnet)

#### For Dogecoin, you will need to register for Tatum API (free plan):

[Dogecoin Tatum API](https://tatum.io/) and [docs](https://apidoc.tatum.io/tag/Dogecoin)

[Dogecoin Testnet Faucet](https://shibe.technology/)

#### XRP Ledger

[XRP Ledger Testnet Faucet](https://test.bithomp.com/faucet/)

[XRP Ledger Testnet Explorer](https://test.bithomp.com/explorer)
