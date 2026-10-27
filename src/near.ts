import { Account, JsonRpcProvider, KeyPairSigner, nearToYocto, type KeyPairString } from 'near-api-js';
import dotenv from 'dotenv';
dotenv.config();

const {
    MPC_CONTRACT_ID,
    NEAR_ACCOUNT_ID,
    NEAR_PRIVATE_KEY,
    NEAR_PROXY_ACCOUNT,
    NEAR_PROXY_CONTRACT,
    NEAR_PROXY_ACCOUNT_ID,
    NEAR_PROXY_PRIVATE_KEY,
} = process.env;

const isProxyCall = NEAR_PROXY_CONTRACT === 'true';
const accountId = NEAR_PROXY_ACCOUNT === 'true' ? NEAR_PROXY_ACCOUNT_ID : NEAR_ACCOUNT_ID;
const contractId = isProxyCall ? NEAR_PROXY_ACCOUNT_ID : MPC_CONTRACT_ID;
const privateKey = NEAR_PROXY_ACCOUNT === 'true' ? NEAR_PROXY_PRIVATE_KEY : NEAR_PRIVATE_KEY;

export const provider = new JsonRpcProvider({
    url: process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com',
});

export async function sign(payload: any, path: string) {
    if (!accountId || !privateKey || !contractId) {
        throw new Error('Configure the selected NEAR account, private key and MPC/proxy contract in .env');
    }
    const account = new Account(accountId, provider, KeyPairSigner.fromSecretKey(privateKey as KeyPairString));
    const args = isProxyCall
        ? { rlp_payload: payload.substring(2), path, key_version: 0 }
        : { request: { payload, path, key_version: 0 } };

    // The proxy accepts the RLP bytes; direct requests pass the chain's signing payload.
    const signature = await account.callFunction<{
        big_r: { affine_point: string };
        s: { scalar: string };
        recovery_id: number;
    }>({
        contractId,
        methodName: 'sign',
        args,
        gas: 300_000_000_000_000n,
        deposit: nearToYocto('1'),
    });
    if (!signature?.big_r?.affine_point || !signature?.s?.scalar) {
        throw new Error('MPC contract returned no valid signature');
    }
    return {
        r: Buffer.from(signature.big_r.affine_point.substring(2), 'hex'),
        s: Buffer.from(signature.s.scalar, 'hex'),
        v: signature.recovery_id,
    };
}
