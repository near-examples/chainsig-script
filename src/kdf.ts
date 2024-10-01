import { base_decode, base_encode } from 'near-api-js/lib/utils/serialize';
import { ec as EC } from 'elliptic';
import BN from 'bn.js';
import keccak from 'keccak';
import hash from 'hash.js';
import bs58check from 'bs58check';
import * as xrpl from 'xrpl';
import { bech32 } from 'bech32';
import { sha3_256 } from 'js-sha3';
import { createHash } from 'crypto';
const { deriveAddress } = xrpl;

import { ORAI } from '@oraichain/common';
import { ethers } from 'ethers';
import { generateSeedPhrase } from 'near-seed-phrase';

function najPublicKeyStrToUncompressedHexPoint(najPublicKeyStr) {
    return (
        '04' +
        Buffer.from(base_decode(najPublicKeyStr.split(':')[1])).toString('hex')
    );
}

export async function deriveChildPublicKey(
    parentUncompressedPublicKeyHex,
    signerId,
    path = '',
) {
    const ec = new EC('secp256k1');
    const scalarHex = sha3_256(
        `near-mpc-recovery v0.1.0 epsilon derivation:${signerId},${path}`,
    );

    const x = parentUncompressedPublicKeyHex.substring(2, 66);
    const y = parentUncompressedPublicKeyHex.substring(66);

    // Create a point object from X and Y coordinates
    const oldPublicKeyPoint = ec.curve.point(x, y);

    // Multiply the scalar by the generator point G
    const scalarTimesG = ec.g.mul(scalarHex);

    // Add the result to the old public key point
    const newPublicKeyPoint = oldPublicKeyPoint.add(scalarTimesG);
    const newX = newPublicKeyPoint.getX().toString('hex').padStart(64, '0');
    const newY = newPublicKeyPoint.getY().toString('hex').padStart(64, '0');
    return '04' + newX + newY;
}

// Function to compress an uncompressed public key
export function compressPublicKey(uncompressedKey: string) {
    // Remove '0x' prefix if present
    if (uncompressedKey.startsWith('0x')) {
        uncompressedKey = uncompressedKey.slice(2);
    }

    // Load the public key
    const ec = new EC('secp256k1');
    const key = ec.keyFromPublic(uncompressedKey, 'hex');

    // Compress the public key
    const compressedKey = key.getPublic(true, 'hex');

    return Buffer.from(compressedKey, 'hex').toString('base64');
}

function uncompressedHexPointToEvmAddress(uncompressedHexPoint) {
    const address = keccak('keccak256')
        .update(Buffer.from(uncompressedHexPoint.substring(2), 'hex'))
        .digest('hex');

    // Ethereum address is last 20 bytes of hash (40 characters), prefixed with 0x
    return '0x' + address.substring(address.length - 40);
}

async function uncompressedHexPointToBtcAddress(publicKeyHex, networkByte) {
    // Step 1: SHA-256 hashing of the public key
    const publicKeyBytes = Uint8Array.from(Buffer.from(publicKeyHex, 'hex'));

    const sha256HashOutput = await crypto.subtle.digest(
        'SHA-256',
        publicKeyBytes,
    );

    // Step 2: RIPEMD-160 hashing on the result of SHA-256
    const ripemd160 = hash
        .ripemd160()
        .update(Buffer.from(sha256HashOutput))
        .digest();

    // Step 3: Adding network byte (0x00 for Bitcoin Mainnet)
    const networkByteAndRipemd160 = Buffer.concat([
        networkByte,
        Buffer.from(ripemd160),
    ]);

    // Step 4: Base58Check encoding
    const address = bs58check.encode(networkByteAndRipemd160);

    return address;
}

export async function generateAddress({
    publicKey,
    accountId,
    path,
    chain,
    bech32Prefix,
}) {
    let childPublicKey = await deriveChildPublicKey(
        najPublicKeyStrToUncompressedHexPoint(publicKey),
        accountId,
        path,
    );
    if (!chain) chain = 'ethereum';
    let address: string;
    switch (chain) {
        case 'ethereum':
            address = uncompressedHexPointToEvmAddress(childPublicKey);
            break;
        case 'btc':
            address = await uncompressedHexPointToBtcAddress(
                childPublicKey,
                Buffer.from([0x00]),
            );
            break;
        case 'bitcoin':
            address = await uncompressedHexPointToBtcAddress(
                childPublicKey,
                Buffer.from([0x6f]),
            );
            break;
        case 'dogecoin':
            address = await uncompressedHexPointToBtcAddress(
                childPublicKey,
                Buffer.from([0x71]),
            );
            break;
        case 'xrpLedger':
            const ec = new EC('secp256k1');
            const x = childPublicKey.substring(2, 66);
            const y = childPublicKey.substring(66);
            const point = ec.curve.point(x, y);
            childPublicKey = point.encode('hex', true);
            address = deriveAddress(childPublicKey);
        case 'cosmos-ethermint':
            const evmAddress = uncompressedHexPointToEvmAddress(childPublicKey);
            console.log('evm address: ', evmAddress);
            address = evmToBech32(evmAddress);
            break;
        case 'cosmos':
            const compressedPublicKey = Buffer.from(
                compressPublicKey(childPublicKey),
                'base64',
            );
            // Step 2: RIPEMD-160 hashing on the result of SHA-256
            const words = bech32.toWords(hash160(compressedPublicKey));
            address = bech32.encode(bech32Prefix, words);
            break;
    }
    return {
        address,
        publicKey: childPublicKey,
    };
}

// Function to convert EVM address to Bech32
function evmToBech32(evmAddress: string, prefix = ORAI) {
    // Remove '0x' prefix if present
    if (evmAddress.startsWith('0x')) {
        evmAddress = evmAddress.slice(2);
    }

    // Convert hex address to binary data (Buffer)
    const hexBuffer = Buffer.from(evmAddress, 'hex');
    // Convert binary data to 5-bit words
    const words = bech32.toWords(hexBuffer);
    // Encode to Bech32 with the desired prefix
    const bech32Address = bech32.encode(prefix, words);
    return bech32Address;
}

// Function to convert Bech32 address back to EVM hex address
export function bech32ToEvm(bech32Address) {
    // Decode the Bech32 address to get the 5-bit words
    const { words } = bech32.decode(bech32Address);

    // Convert the 5-bit words back to binary data (Buffer)
    const hexBuffer = Buffer.from(bech32.fromWords(words));

    // Convert binary data to hex string and prepend '0x'
    const evmAddress = '0x' + hexBuffer.toString('hex');

    return ethers.utils.getAddress(evmAddress);
}

export const hash160 = (buffer: Buffer) => {
    const sha256Hash = createHash('sha256').update(buffer).digest();
    try {
        return createHash('rmd160').update(sha256Hash).digest();
    } catch (err) {
        return createHash('ripemd160').update(sha256Hash).digest();
    }
};

// WARNING WIP DO NOT USE
async function uncompressedHexPointToNearImplicit(uncompressedHexPoint) {
    console.log('uncompressedHexPoint', uncompressedHexPoint);

    const implicitSecpPublicKey =
        'secp256k1:' +
        base_encode(Buffer.from(uncompressedHexPoint.substring(2), 'hex'));
    // get an implicit accountId from an ed25519 keyPair using the sha256 of the secp256k1 point as entropy
    const sha256HashOutput = await crypto.subtle.digest(
        'SHA-256',
        Buffer.from(uncompressedHexPoint, 'hex'),
    );
    const { publicKey, secretKey } = generateSeedPhrase(
        Buffer.from(sha256HashOutput),
    );

    // DEBUG
    // console.log(secretKey);

    const implicitAccountId = Buffer.from(
        base_decode(publicKey.split(':')[1]),
    ).toString('hex');

    // DEBUG adding key
    // await addKey({
    //     accountId: implicitAccountId,
    //     secretKey,
    //     publicKey: implicitSecpPublicKey,
    // });

    return { implicitAccountId, implicitSecpPublicKey };
}
