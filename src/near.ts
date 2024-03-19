import * as nearAPI from 'near-api-js';
import BN from 'bn.js';
const { Near, Account, keyStores, KeyPair } = nearAPI;
const keyStore = new keyStores.InMemoryKeyStore();
keyStore.setKey(
  'testnet',
  process.env.NEAR_ACCOUNT_ID,
  KeyPair.fromString(process.env.NEAR_PRIVATE_KEY),
);
const config = {
  networkId: 'testnet',
  keyStore: keyStore,
  nodeUrl: 'https://rpc.testnet.near.org',
  walletUrl: 'https://testnet.mynearwallet.com/',
  helperUrl: 'https://helper.testnet.near.org',
  explorerUrl: 'https://testnet.nearblocks.io',
};
export const near = new Near(config);
export const account = new Account(
  near.connection,
  process.env.NEAR_ACCOUNT_ID,
);
export async function sign(payload, path) {
  payload.reverse();
  console.log('signing payload', payload.toString());
  console.log('with path', path);
  console.log('this may take approx. 30 seconds to complete');

  let res;
  try {
    res = await account.functionCall({
      contractId: process.env.MPC_CONTRACT_ID,
      methodName: 'sign',
      args: {
        payload,
        path,
      },
      gas: new BN('300000000000000'),
      attachedDeposit: new BN('0'),
    });
  } catch (e) {
    return console.log('error signing', JSON.stringify(e));
  }

  if ('SuccessValue' in (res.status as any)) {
    const successValue = (res.status as any).SuccessValue;
    const decodedValue = Buffer.from(successValue, 'base64').toString('utf-8');
    const parsedJSON = JSON.parse(decodedValue) as [string, string];

    return {
      r: parsedJSON[0].slice(2),
      s: parsedJSON[1],
    };
  } else {
    return console.log('error signing', JSON.stringify(res));
  }
}
