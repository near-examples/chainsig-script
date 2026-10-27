const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Wallet } = require('ethers');
const { prepareLegacyTransaction, finalizeLegacyTransaction } = require('../dist/ethereum-transaction');

test('MPC-style signature produces the same EIP-155 transaction as an offline wallet', async () => {
  const wallet = new Wallet('0x' + '46'.repeat(32));
  const tx = { type: 0, chainId: 1, nonce: 9, gasPrice: 20000000000n, gasLimit: 21000, to: '0x3535353535353535353535353535353535353535', value: 1000000000000000000n, data: '0x' };
  const { hash, payload } = prepareLegacyTransaction(tx);
  const signature = wallet.signingKey.sign(hash);
  assert.equal(payload.length, 32);
  assert.equal(finalizeLegacyTransaction(tx, wallet.address, signature), await wallet.signTransaction(tx));
  assert.throws(() => finalizeLegacyTransaction(tx, '0x1111111111111111111111111111111111111111', signature), /sending address/);
});

test('Cosmos payload hashing preserves SHA-256 and Ethermint Keccak bytes', () => {
  const { CosmosUtils } = require('../dist/cosmos-utils');
  const { createHash } = require('node:crypto');
  const { keccak256 } = require('ethers');
  const bytes = Uint8Array.from([1, 2, 3]);
  const cosmos = new CosmosUtils();
  const ethermint = new CosmosUtils('', '/ethermint.crypto.v1.ethsecp256k1.PubKey');
  assert.deepEqual(cosmos.buildCosmosPayload(bytes).payload, [...createHash('sha256').update(bytes).digest()]);
  assert.equal(ethermint.buildCosmosPayload(bytes).msgHash, keccak256(bytes));
});

test('CosmWasm execution messages preserve sender, funds and payload without the old wrapper', async () => {
  const { CosmosUtils } = require('../dist/cosmos-utils');
  const { toAmount } = require('../dist/cosmos-config');
  const utils = new CosmosUtils('orai1sender');
  utils.getAccount = async () => ({ account_number: '1', sequence: '0' });
  const signDoc = await utils.builMsgExecuteStdSignDoc([{
    contractAddress: 'orai1contract', msg: { mint: {} }, funds: [{ denom: 'orai', amount: '10' }],
  }]);
  assert.equal(signDoc.msgs[0].type, 'wasm/MsgExecuteContract');
  assert.deepEqual(signDoc.msgs[0].value, { sender: 'orai1sender', contract: 'orai1contract', msg: { mint: {} }, funds: [{ denom: 'orai', amount: '10' }] });
  assert.equal(signDoc.fee.amount[0].amount, '1000');
  assert.equal(toAmount('0.000001'), 1n);
  assert.throws(() => toAmount('0.0000001'));
});
