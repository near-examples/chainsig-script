import { base_decode } from 'near-api-js/lib/utils/serialize';
import { ec as EC } from 'elliptic';
import BN from 'bn.js';
import keccak from 'keccak';
import hash from 'hash.js';
import bs58check from 'bs58check';
import * as xrpl from 'xrpl';
const { deriveAddress } = xrpl;

function najPublicKeyStrToUncompressedHexPoint(najPublicKeyStr) {
  return (
    '04' +
    Buffer.from(base_decode(najPublicKeyStr.split(':')[1])).toString('hex')
  );
}

async function sha256Hash(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);

  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  const hashArray = [...new Uint8Array(hashBuffer)];
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sha256StringToScalarLittleEndian(hashString) {
  const littleEndianString = hashString.match(/../g).reverse().join('');

  const scalar = new BN(littleEndianString, 16);

  return scalar;
}

async function deriveChildPublicKey(
  parentUncompressedPublicKeyHex,
  signerId,
  path = '',
) {
  const ec = new EC('secp256k1');
  let scalar = await sha256Hash(
    `near-mpc-recovery v0.1.0 epsilon derivation:${signerId},${path}`,
  );
  scalar = sha256StringToScalarLittleEndian(scalar) as any;

  const x = parentUncompressedPublicKeyHex.substring(2, 66);
  const y = parentUncompressedPublicKeyHex.substring(66);

  // Create a point object from X and Y coordinates
  const oldPublicKeyPoint = ec.curve.point(x, y);

  // Multiply the scalar by the generator point G
  const scalarTimesG = ec.g.mul(scalar);

  // Add the result to the old public key point
  const newPublicKeyPoint = oldPublicKeyPoint.add(scalarTimesG);

  return (
    '04' +
    (newPublicKeyPoint.getX().toString('hex').padStart(64, '0') +
      newPublicKeyPoint.getY().toString('hex').padStart(64, '0'))
  );
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

export async function generateAddress({ publicKey, accountId, path, chain }) {
  let childPublicKey = await deriveChildPublicKey(
    najPublicKeyStrToUncompressedHexPoint(publicKey),
    accountId,
    path,
  );
  if (!chain) chain = 'ethereum';
  let address;
  switch (chain) {
    case 'ethereum':
      address = uncompressedHexPointToEvmAddress(childPublicKey);
      break;
    case 'btc':
      uncompressedHexPointToBtcAddress(childPublicKey, Buffer.from([0x00]));
      break;
    case 'bitcoin':
      uncompressedHexPointToBtcAddress(childPublicKey, Buffer.from([0x6f]));
      break;
    case 'dogecoin':
      address = uncompressedHexPointToBtcAddress(
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
  }
  return {
    address,
    publicKey: childPublicKey,
  };
}
