import { ethers } from 'ethers';
import { sign } from './near';
import dotenv from 'dotenv';
import { makeSignBytes } from '@cosmjs/proto-signing';
import {
    encodeSecp256k1Signature,
    serializeSignDoc,
    StdSignDoc,
} from '@cosmjs/amino';
import { COSMOS_CHAIN_IDS, ORAI, toAmount } from '@oraichain/common';
import { SignDoc } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { compressPublicKey } from './kdf';
import { CosmosUtils } from './cosmos-utils';
import prompts from 'prompts';

dotenv.config();

const { MPC_PATH } = process.env;

const oraichain = {
    cosmosUtils: new CosmosUtils(
        undefined,
        '/cosmos.crypto.secp256k1.PubKey',
        'https://rpc.orai.io',
        undefined,
        undefined,
        undefined,
        COSMOS_CHAIN_IDS.ORAICHAIN, // 0x67266a7
        ORAI,
    ),

    send: async ({ from: address, to = address, amount }) => {
        if (!address) return console.log('must provide a sending address');
        console.log(
            'sending',
            amount,
            oraichain.cosmosUtils.denom.toUpperCase(),
            'from',
            address,
            'to',
            to,
        );
        const cont = await prompts({
            type: 'confirm',
            name: 'value',
            message: 'Confirm? (y or n)',
            initial: true,
        });
        if (!cont.value) return;
        const { completeCosmosTx, cosmosUtils } = oraichain;
        cosmosUtils.withSenderAddress(address);
        const signDoc = await cosmosUtils.buildSimpleMsgSendStdSignDoc(
            to,
            amount ? toAmount(amount).toString() : toAmount(0.00001).toString(),
        );
        try {
            await completeCosmosTx({ address, signDoc });
        } catch (e) {
            console.log('Transaction failed broadcasting to network');
            console.log(e);
        }
    },

    sendDirect: async ({ from: address, to = address, amount, publicKey }) => {
        if (!address) throw new Error('must provide a sending address');
        if (!publicKey) throw new Error('must provide public key');
        console.log(
            'sending',
            amount,
            oraichain.cosmosUtils.denom.toUpperCase(),
            'from',
            address,
            'to',
            to,
        );
        const cont = await prompts({
            type: 'confirm',
            name: 'value',
            message: 'Confirm? (y or n)',
            initial: true,
        });
        if (!cont.value) return;

        const compressedPublicKey = compressPublicKey(publicKey);
        const { completeCosmosTxDirect, cosmosUtils } = oraichain;
        cosmosUtils.withSenderAddress(address);
        const signDoc = await cosmosUtils.buildSimpleMsgSendSignDocDirect(
            to,
            amount ? toAmount(amount).toString() : toAmount(0.00001).toString(),
            compressedPublicKey,
        );
        try {
            await completeCosmosTxDirect({ signDoc });
        } catch (error) {
            console.log('Transaction failed broadcasting to network');
            console.log(error);
        }
    },

    completeCosmosTx: async ({
        signDoc,
    }: {
        address: string;
        signDoc: StdSignDoc;
    }) => {
        // create hash of unsigned TX to sign -> payload
        const rawMsg = serializeSignDoc(signDoc);
        const { msgHash, payload } =
            oraichain.cosmosUtils.buildCosmosPayload(rawMsg);

        // get signature from MPC contract
        let sig = await sign(payload, MPC_PATH);
        if (!sig) return;

        let sigCopy = JSON.parse(JSON.stringify(sig));
        sigCopy.r = '0x' + sig.r.toString('hex');
        sigCopy.s = '0x' + sig.s.toString('hex');

        const recoverPublicKey = ethers.utils.recoverPublicKey(
            msgHash,
            sigCopy,
        );
        const signatureBuffer = Buffer.concat([sig.r, sig.s]);
        // strip leading 0x and trailing recovery id
        const compressedRecoverPubkey = compressPublicKey(recoverPublicKey);
        const signature = encodeSecp256k1Signature(
            Buffer.from(compressedRecoverPubkey, 'base64'),
            signatureBuffer,
        );
        console.log('signature after encoded: ', signature);
        // broadcast TX - signature now has correct { r, s, v }
        try {
            const { cosmosUtils } = oraichain;
            const result = await cosmosUtils.broadcastCosmosAmino(
                signDoc,
                signature,
            );
            console.log('result', result);
        } catch (e) {
            if (/nonce too low/gi.test(JSON.stringify(e))) {
                return console.log('tx has been tried');
            }
            if (/gas too low|underpriced/gi.test(JSON.stringify(e))) {
                return console.log(e);
            }
            console.log('error completing cosmos tx: ', e);
        }
    },

    completeCosmosTxDirect: async ({ signDoc }: { signDoc: SignDoc }) => {
        const { cosmosUtils } = oraichain;
        // create hash of unsigned TX to sign -> payload
        const rawMsg = makeSignBytes(signDoc);
        const { payload } = cosmosUtils.buildCosmosPayload(rawMsg);

        // get signature from MPC contract
        let sig = await sign(payload, MPC_PATH);
        if (!sig) return;

        const signatureBuffer = Buffer.concat([sig.r, sig.s]);
        try {
            const result = await cosmosUtils.broadcastCosmosDirect(
                signDoc,
                signatureBuffer,
            );
            console.log('result', result);
        } catch (e) {
            if (/nonce too low/gi.test(JSON.stringify(e))) {
                return console.log('tx has been tried');
            }
            if (/gas too low|underpriced/gi.test(JSON.stringify(e))) {
                return console.log(e);
            }
            console.log('error completing cosmos tx: ', e);
        }
    },
};

export default oraichain;
