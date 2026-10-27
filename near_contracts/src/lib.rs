// Find all our documentation at https://docs.near.org
use hex::decode;
use near_sdk::{env, ext_contract, near, require, Gas, NearToken, Promise};
use serde::Serialize;

const PUBLIC_RLP_ENCODED_METHOD_NAMES: [&'static str; 1] = ["6a627842000000000000000000000000"];
const COST: NearToken = NearToken::from_near(1);
const MPC_CONTRACT_ACCOUNT_ID: &str = "v1.signer-prod.testnet";
const GAS: Gas = Gas::from_tgas(250);
const ATTACHED_DEPOSIT: NearToken = NearToken::from_yoctonear(50000000000000000000000);

#[derive(Serialize)]
pub struct SignRequest {
    pub payload: [u8; 32],
    pub path: String,
    pub key_version: u32,
}
// interface for cross contract call to mpc contract
#[ext_contract(mpc)]
trait MPC {
    fn sign(&self, request: SignRequest) -> Promise;
}

// automatically init the contract
impl Default for Contract {
    fn default() -> Self {
        Self {}
    }
}

#[near(contract_state)]
pub struct Contract {}

#[near]
impl Contract {
    // proxy to call MPC_CONTRACT_ACCOUNT_ID method sign if COST is deposited
    #[payable]
    pub fn sign(&mut self, rlp_payload: String, path: String, key_version: u32) -> Promise {
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

        // hash rlp encoded payload
        let payload: [u8; 32] = env::keccak256_array(&decode(rlp_payload).unwrap())
            .try_into()
            .unwrap();

        // check deposit requirement, contract owner doesn't pay
        let deposit = env::attached_deposit();
        if !owner {
            require!(deposit >= COST, "pay the piper");
        }

        // call mpc sign and return promise
        mpc::ext(MPC_CONTRACT_ACCOUNT_ID.parse().unwrap())
            .with_static_gas(GAS)
            .with_attached_deposit(ATTACHED_DEPOSIT)
            .sign(SignRequest {
                payload,
                path,
                key_version,
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{test_utils::VMContextBuilder, testing_env};

    fn context(predecessor: &str, deposit: NearToken) {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id("proxy.testnet".parse().unwrap())
            .predecessor_account_id(predecessor.parse().unwrap())
            .attached_deposit(deposit);
        testing_env!(builder.build());
    }

    #[test]
    #[should_panic(expected = "only contract owner can sign arbitrary EVM transactions")]
    fn arbitrary_payload_requires_contract_owner() {
        context("caller.testnet", COST);
        let _ = Contract::default().sign("00".into(), "ethereum-1".into(), 0);
    }

    #[test]
    #[should_panic(expected = "pay the piper")]
    fn public_payload_requires_payment() {
        context("caller.testnet", NearToken::from_yoctonear(0));
        let _ = Contract::default().sign(
            PUBLIC_RLP_ENCODED_METHOD_NAMES[0].into(),
            "ethereum-1".into(),
            0,
        );
    }

    #[test]
    fn owner_can_request_signature_without_payment() {
        context("proxy.testnet", NearToken::from_yoctonear(0));
        let promise = Contract::default().sign("00".into(), "ethereum-1".into(), 0);
        drop(promise);
        assert_eq!(near_sdk::test_utils::get_created_receipts().len(), 1);
    }
}
