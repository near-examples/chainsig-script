# Installation

`yarn`

## CREATE .env FILE in root of project

```
NEAR_ACCOUNT_ID="[YOUR_NEAR_TESTNET_ACCOUNT]"
NEAR_PRIVATE_KEY="[YOUR_NEAR_ACCOUNT_PRIVATE_KEY]"
MPC_PATH="[MPC_PATH]"
MPC_CHAIN="[ethereum|bitcoin]"
MPC_CONTRACT_ID="multichain-testnet-2.testnet"
MPC_PUBLIC_KEY="secp256k1:4HFcTSodRLVCGNVcGc4Mf2fwBBBxv9jxkGdiW2S2CA1y6UpVVRWKj6RX7d7TDt65k2Bj3w9FU4BGtt43ZvuhCnNt"
```

[MPC_PATH naming conventions](https://github.com/near/near-fastauth-wallet/blob/dmd/chain_sig_docs/docs/chain_signature_api.org)

# Commands

`yarn start [commands]`

### Command List

- -ea - ethereum address
- -ba - bitcoin testnet address
- -da - dogecoin testnet address
- -s - sign sample payload using Near account
- -etx - send ETH
- -btx - send BTC

### Sending Options

- -a, --amount - amount to send (ETH or sats)
- -to, --to - destination address

# References

[Path naming conventions](https://github.com/near/near-fastauth-wallet/blob/dmd/chain_sig_docs/docs/chain_signature_api.org)

[Sepolia Faucet](https://sepolia-faucet.pk910.de/)

[Bitcoin Testnet Faucet](https://faucet.triangleplatform.com/bitcoin/testnet)

[Dogecoin Crypto APIs API Key](https://my.cryptoapis.io/)
[Dogecoin Blockdaemon API Key](https://app.blockdaemon.com/ubiquity/connect)
[Dogecoin Testnet Faucet](https://shibe.technology/)
