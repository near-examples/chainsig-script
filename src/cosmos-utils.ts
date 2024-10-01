import { ethers } from 'ethers';
import {
    AminoTypes,
    createDefaultAminoConverters,
    defaultRegistryTypes,
    StargateClient,
} from '@cosmjs/stargate';
import {
    EncodeObject,
    makeAuthInfoBytes,
    Registry,
    TxBodyEncodeObject,
    makeSignDoc as makeSignDocDirect,
} from '@cosmjs/proto-signing';
import { makeSignDoc, StdSignDoc, StdSignature } from '@cosmjs/amino';
import { COSMOS_CHAIN_IDS, ORAI, toAmount } from '@oraichain/common';
import { SignDoc, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { MsgSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx';
import { fromBase64, toHex } from '@cosmjs/encoding';
import { Int53 } from '@cosmjs/math';
import { SignMode } from 'cosmjs-types/cosmos/tx/signing/v1beta1/signing';
import { Any } from 'cosmjs-types/google/protobuf/any';
import { PubKey } from 'cosmjs-types/cosmos/crypto/secp256k1/keys';
import {
    createWasmAminoConverters,
    ExecuteInstruction,
    wasmTypes,
} from '@cosmjs/cosmwasm-stargate';
import { getEncodedExecuteContractMsgs } from '@oraichain/oraidex-common';

export type PubkeyType =
    | '/ethermint.crypto.v1.ethsecp256k1.PubKey' // for ethermint txs
    | '/cosmos.crypto.secp256k1.PubKey'; // for cosmos txs

export class CosmosUtils {
    constructor(
        private senderAddress: string = '',
        public readonly pubkeyType: PubkeyType = '/cosmos.crypto.secp256k1.PubKey',
        public readonly rpc: string = 'https://rpc.orai.io',
        public readonly lcd: string = 'https://lcd.orai.io',
        public readonly registry = new Registry([
            ...defaultRegistryTypes,
            ...wasmTypes,
        ]),
        public readonly aminoTypes = new AminoTypes({
            ...createDefaultAminoConverters(),
            ...createWasmAminoConverters(),
        }),
        public readonly chainId: string = COSMOS_CHAIN_IDS.ORAICHAIN,
        public readonly denom: string = ORAI,
    ) {}

    withSenderAddress(senderAddress: string) {
        this.senderAddress = senderAddress;
        return this;
    }

    async getAccount() {
        const { account } = await fetch(
            `${this.lcd}/cosmos/auth/v1beta1/accounts/${this.senderAddress}`,
        ).then((data) => data.json());
        if (!account)
            throw new Error(
                `Address ${this.senderAddress} does not exist on ${this.chainId} yet. Please deposit some ${this.denom} to activate it`,
            );
        return account;
    }

    buildCosmosPayload(signDocBytes: Uint8Array) {
        const msgToSign = '0x' + toHex(signDocBytes);
        const msgHash =
            this.pubkeyType === '/cosmos.crypto.secp256k1.PubKey'
                ? ethers.utils.sha256(msgToSign)
                : ethers.utils.keccak256(msgToSign);
        const payload = Object.values(ethers.utils.arrayify(msgHash));
        return { msgHash, payload };
    }

    async buildSimpleMsgSendStdSignDoc(
        toAddress: string,
        amount: string,
        denom = this.denom,
    ) {
        const msgSend = MsgSend.fromPartial({
            amount: [{ amount, denom }],
            fromAddress: this.senderAddress,
            toAddress,
        });
        const msgSendEncoded: EncodeObject = {
            typeUrl: '/cosmos.bank.v1beta1.MsgSend',
            value: msgSend,
        };

        const account = await this.getAccount();
        return this.buildSimpleStdSignDoc(
            {
                accountNumber: account.account_number,
                sequence: account.sequence,
            },
            [msgSendEncoded],
        );
    }

    async builMsgExecuteStdSignDoc(instructions: ExecuteInstruction[]) {
        const encodeObjects = getEncodedExecuteContractMsgs(
            this.senderAddress,
            instructions,
        );
        // FIXME: use a better way to query account. Can use RPC but need to patch because the account pubkey type does not match
        const account = await this.getAccount();
        return this.buildSimpleStdSignDoc(
            {
                accountNumber: account.account_number,
                sequence: account.sequence,
            },
            encodeObjects,
        );
    }

    private async buildSimpleStdSignDoc(
        {
            accountNumber,
            sequence,
        }: { accountNumber: number | string; sequence: number | string },
        encodeObjects: EncodeObject[],
    ) {
        const aminoMessages = encodeObjects.map((object) =>
            this.aminoTypes.toAmino(object),
        );
        const signDoc = makeSignDoc(
            aminoMessages,
            {
                amount: [
                    { amount: toAmount(0.001).toString(), denom: this.denom },
                ],
                gas: '200000',
            },
            this.chainId,
            undefined,
            accountNumber,
            sequence,
        );
        return signDoc;
    }

    async broadcastCosmosAmino(signedDoc: StdSignDoc, signature: StdSignature) {
        const signedTxBody = {
            messages: signedDoc.msgs.map((msg) =>
                this.aminoTypes.fromAmino(msg),
            ),
            memo: signedDoc.memo,
        };
        const signedTxBodyEncodeObject = {
            typeUrl: '/cosmos.tx.v1beta1.TxBody',
            value: signedTxBody,
        };
        const signedTxBodyBytes = this.registry.encode(
            signedTxBodyEncodeObject,
        );
        const signedGasLimit = Int53.fromString(signedDoc.fee.gas).toNumber();
        const signedSequence = Int53.fromString(signedDoc.sequence).toNumber();
        const pubkey = Any.fromPartial({
            typeUrl: this.pubkeyType,
            value: PubKey.encode({
                key: Buffer.from(signature.pub_key.value, 'base64'),
            }).finish(),
        });
        const signedAuthInfoBytes = makeAuthInfoBytes(
            [{ pubkey: pubkey, sequence: signedSequence }],
            signedDoc.fee.amount,
            signedGasLimit,
            signedDoc.fee.granter,
            signedDoc.fee.payer,
            SignMode.SIGN_MODE_LEGACY_AMINO_JSON,
        );
        const txRaw = TxRaw.fromPartial({
            bodyBytes: signedTxBodyBytes,
            authInfoBytes: signedAuthInfoBytes,
            signatures: [fromBase64(signature.signature)],
        });
        const client = await StargateClient.connect(this.rpc);
        const result = await client.broadcastTxSync(
            TxRaw.encode(txRaw).finish(),
        );
        return result;
    }

    // try sign direct
    async buildSimpleMsgSendSignDocDirect(
        toAddress: string,
        amount: string,
        publicKey: string,
        denom = this.denom,
    ) {
        const msgSend = MsgSend.fromPartial({
            amount: [{ amount, denom }],
            fromAddress: this.senderAddress,
            toAddress,
        });
        const msgSendEncoded: EncodeObject = {
            typeUrl: '/cosmos.bank.v1beta1.MsgSend',
            value: msgSend,
        };

        const account = await this.getAccount();
        return this.buildSimpleSignDocDirect(
            {
                accountNumber: account.account_number,
                sequence: account.sequence,
                publicKey,
            },
            [msgSendEncoded],
        );
    }

    private async buildSimpleSignDocDirect(
        {
            accountNumber,
            sequence,
            publicKey,
        }: { accountNumber: string; sequence: string; publicKey: string },
        encodeObjects: EncodeObject[],
    ) {
        const pubkey = Any.fromPartial({
            typeUrl: this.pubkeyType,
            value: PubKey.encode({
                key: Buffer.from(publicKey, 'base64'),
            }).finish(),
        });
        console.log('public key: ', publicKey);
        const txBody = {
            messages: encodeObjects,
            memo: '',
        };
        const txBodyEncodeObject: TxBodyEncodeObject = {
            typeUrl: '/cosmos.tx.v1beta1.TxBody',
            value: txBody,
        };
        const txBodyBytes = this.registry.encode(txBodyEncodeObject);
        const authInfoBytes = makeAuthInfoBytes(
            [{ pubkey: pubkey, sequence: +sequence }],
            [{ amount: toAmount(0.001).toString(), denom: this.denom }],
            200000,
            undefined,
            undefined,
            SignMode.SIGN_MODE_DIRECT,
        );
        const signDoc = makeSignDocDirect(
            txBodyBytes,
            authInfoBytes,
            this.chainId,
            +accountNumber,
        );
        return signDoc;
    }

    async broadcastCosmosDirect(signDoc: SignDoc, signature: Buffer) {
        const txRaw = TxRaw.fromPartial({
            bodyBytes: signDoc.bodyBytes,
            authInfoBytes: signDoc.authInfoBytes,
            signatures: [Uint8Array.from(signature)],
        });
        const client = await StargateClient.connect(this.rpc);
        const result = await client.broadcastTxSync(
            TxRaw.encode(txRaw).finish(),
        );
        return result;
    }
}
