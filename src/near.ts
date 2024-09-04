import * as nearAPI from 'near-api-js';
import BN from 'bn.js';
const { Near, Account, keyStores, KeyPair } = nearAPI;
const {
    MPC_CONTRACT_ID,
    NEAR_ACCOUNT_ID,
    NEAR_PRIVATE_KEY,
    NEAR_PROXY_ACCOUNT,
    NEAR_PROXY_CONTRACT,
    NEAR_PROXY_ACCOUNT_ID,
    NEAR_PROXY_PRIVATE_KEY,
} = process.env;

const accountId =
    NEAR_PROXY_ACCOUNT === 'true' ? NEAR_PROXY_ACCOUNT_ID : NEAR_ACCOUNT_ID;
const contractId =
    NEAR_PROXY_CONTRACT === 'true' ? NEAR_PROXY_ACCOUNT_ID : MPC_CONTRACT_ID;
const privateKey =
    NEAR_PROXY_ACCOUNT === 'true' ? NEAR_PROXY_PRIVATE_KEY : NEAR_PRIVATE_KEY;
const keyStore = new keyStores.InMemoryKeyStore();
keyStore.setKey('testnet', accountId, KeyPair.fromString(privateKey));

console.log('Near Chain Signature (NCS) call details:');
console.log('Near accountId', accountId);
console.log('NCS contractId', contractId);

const config = {
    networkId: 'testnet',
    keyStore: keyStore,
    nodeUrl: 'https://rpc.testnet.near.org',
    walletUrl: 'https://testnet.mynearwallet.com/',
    helperUrl: 'https://helper.testnet.near.org',
    explorerUrl: 'https://testnet.nearblocks.io',
};
export const near = new Near(config);
export const account = new Account(near.connection, accountId);

export async function sign(payload, path) {
    let args = {
        payload,
        path,
        key_version: 0,
        rlp_payload: undefined,
        request: undefined,
    };
    let attachedDeposit = '1';

    if (process.env.NEAR_PROXY_CONTRACT === 'true') {
        delete args.payload;
        args.rlp_payload = payload.substring(2);
        attachedDeposit = nearAPI.utils.format.parseNearAmount('1');
    } else {
        args = {
            request: args,
        } as any;
    }

    console.log(
        'sign payload',
        payload.length > 200 ? payload.length : payload.toString(),
    );
    console.log('with path', path);
    console.log('this may take approx. 30 seconds to complete');

    let res;
    try {
        res = await account.functionCall({
            contractId,
            methodName: 'sign',
            args,
            gas: new BN('300000000000000'),
            attachedDeposit,
        });
    } catch (e) {
        return console.log('error signing', JSON.stringify(e));
    }

    // parse result into signature values we need r, s but we don't need first 2 bytes of r (y-parity)
    if ('SuccessValue' in (res.status as any)) {
        const successValue = (res.status as any).SuccessValue;
        const decodedValue = Buffer.from(successValue, 'base64').toString(
            'utf-8',
        );
        const { big_r, s, recovery_id } = JSON.parse(decodedValue);

        return {
            r: big_r.affine_point.slice(2),
            s: s.scalar,
        };
    } else {
        return console.log('error signing', JSON.stringify(res));
    }
}
