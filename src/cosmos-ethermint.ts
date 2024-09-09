import { ethers } from 'ethers';
import { sign } from './near';
import dotenv from 'dotenv';
import {
    encodeSecp256k1Signature,
    serializeSignDoc,
    StdSignDoc,
} from '@cosmjs/amino';
import { toAmount } from '@oraichain/common';
import { bech32ToEvm, compressPublicKey } from './kdf';
import { CosmosUtils } from './cosmos-utils';
import prompts from 'prompts';

dotenv.config();

const { MPC_PATH } = process.env;

const oraichain = {
    cosmosUtils: new CosmosUtils(
        undefined,
        '/ethermint.crypto.v1.ethsecp256k1.PubKey',
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

    completeCosmosTx: async ({
        address,
        signDoc,
    }: {
        address: string;
        signDoc: StdSignDoc;
    }) => {
        const hexAddress = bech32ToEvm(address);
        // create hash of unsigned TX to sign -> payload
        const rawMsg = serializeSignDoc(signDoc);
        const { payload, msgHash } =
            oraichain.cosmosUtils.buildCosmosPayload(rawMsg);

        // get signature from MPC contract
        let sig = await sign(payload, MPC_PATH);
        if (!sig) return;

        let sigCopy = JSON.parse(JSON.stringify(sig));
        sigCopy.r = '0x' + sig.r.toString('hex');
        sigCopy.s = '0x' + sig.s.toString('hex');

        const recoverAddress = ethers.utils.recoverAddress(msgHash, sigCopy);
        const recoverPublicKey = ethers.utils.recoverPublicKey(
            msgHash,
            sigCopy,
        );
        console.log('recover address: ', recoverAddress);
        if (recoverAddress !== hexAddress)
            throw new Error(
                `signature failed to recover correct sending address. Wanted ${hexAddress}, got ${recoverAddress}`,
            );

        const signatureBuffer = Buffer.concat([sig.r, sig.s]);
        const concatSignature: string = signatureBuffer.toString('hex');
        // strip leading 0x and trailing recovery id
        console.log('concat signature hex: ', concatSignature);
        console.log('uncompressed pubkey: ', recoverPublicKey);
        const compressedRecoverPubkey = compressPublicKey(recoverPublicKey);
        console.log('compressed pubkey: ', compressedRecoverPubkey);
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
};

export default oraichain;
