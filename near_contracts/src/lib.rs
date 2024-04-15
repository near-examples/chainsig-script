// Find all our documentation at https://docs.near.org
use hex::decode;
use near_sdk::{env, ext_contract, near, require, Gas, NearToken, Promise};

const PUBLIC_RLP_ENCODED_METHOD_NAMES: [&'static str; 1] = ["6a627842000000000000000000000000"];
const MPC_CONTRACT_ACCOUNT_ID: &str = "multichain-testnet-2.testnet";
const COST: NearToken = NearToken::from_near(1);

// interface for cross contract call to mpc contract
#[ext_contract(mpc)]
trait MPC {
    fn sign(&self, payload: [u8; 32], path: String, key_version: u32) -> Promise;
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

        // hash and reverse rlp encoded payload
        let payload: [u8; 32] = env::keccak256_array(&decode(rlp_payload).unwrap())
            .into_iter()
            .rev()
            .collect::<Vec<u8>>()
            .try_into()
            .unwrap();

        // check deposit requirement, contract owner doesn't pay
        let deposit = env::attached_deposit();
        if !owner {
            require!(deposit >= COST, "pay the piper");
        }

        // call mpc sign and return promise
        mpc::ext(MPC_CONTRACT_ACCOUNT_ID.parse().unwrap())
            .with_static_gas(Gas::from_tgas(100))
            .sign(payload, path, key_version)
    }
}
