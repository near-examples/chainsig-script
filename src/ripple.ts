import { ethers } from 'ethers';
import { sign } from './near';
import { fetchJson } from './utils';
import prompts from 'prompts';
import BN from 'bn.js';
import * as xrpl from 'xrpl';
const { validate, verifySignature, encode, encodeForSigning } = xrpl;
import * as Signature from 'elliptic/lib/elliptic/ec/signature';
import { hashSignedTx } from 'xrpl/dist/npm/utils/hashes';

// https://test.bithomp.com/explorer/rPbcwLLhUdYTJLnkepbpxmnkn5xCnkKRBJ

const ripple = {
  name: 'Ripple Testnet',
  currency: 'XRP',
  explorer: 'https://blockexplorer.one/dogecoin/testnet',
  getBalance: async ({ address, getUtxos }) => {
    // Connect to the testnet
    const client = new xrpl.Client('wss://s.altnet.rippletest.net:51233');
    await client.connect();

    // const accountInfoResponse = await client.request({
    //   command: 'account_info',
    //   account: address,
    //   strict: true,
    // });

    // debug if accountInfoResponse is unavailable
    // const account_data = {
    //   Account: 'rPbcwLLhUdYTJLnkepbpxmnkn5xCnkKRBJ',
    //   Balance: '1000000000',
    //   Flags: 0,
    //   LedgerEntryType: 'AccountRoot',
    //   OwnerCount: 0,
    //   PreviousTxnID:
    //     '3620B4F5470FEB1A116C3A92BED16F5D8FB9503C46E6017066CFC2F421A6B4B8',
    //   PreviousTxnLgrSeq: 46626023,
    //   Sequence: 46626023,
    //   index: '4F1B0A869668EFF19AAD8997FA1BB5DDA6286E3B6A886ED887D1DA38943F2234',
    // };
  },
  send: async ({
    from: address = 'rPbcwLLhUdYTJLnkepbpxmnkn5xCnkKRBJ',
    publicKey,
    to = 'rPbcwLLhUdYTJLnkepbpxmnkn5xCnkKRBJ',
    amount = '1',
  }) => {
    // Connect to the testnet
    const client = new xrpl.Client('wss://s.altnet.rippletest.net:51233');
    await client.connect();

    const getTx = () =>
      client.autofill({
        TransactionType: 'Payment',
        Account: address,
        Amount: xrpl.xrpToDrops('1'),
        Destination: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
        SigningPubKey: publicKey,
        NetworkID: undefined,
        TxnSignature: undefined,
        LastLedgerSequence: undefined,
      });
    const unsignedTx = await getTx();
    unsignedTx.LastLedgerSequence += 10; // get ahead of LastLedgerSequence (after MPC signing)

    // if bad tx (malformed) throws a nice JS error according to docs
    validate(unsignedTx as unknown as Record<string, unknown>);

    // encode for signing and take truncated sha512 hash as payload
    const encodedForSigning = encodeForSigning(unsignedTx);
    const hashUnsigned = await crypto.subtle.digest(
      'SHA-512',
      Buffer.from(encodedForSigning, 'hex'),
    );
    const hash = new Uint8Array(hashUnsigned.slice(0, 32));
    const payload = Object.values(ethers.utils.arrayify(hash));
    const sig: any = await sign(payload, process.env.MPC_PATH);
    const sigBuffer = {
      r: new BN(Buffer.from(sig.r, 'hex')),
      s: new BN(Buffer.from(sig.s, 'hex')),
    };
    const signature = (Signature.default as any).prototype.toDER.call(
      sigBuffer,
    );
    unsignedTx.TxnSignature = Buffer.from(signature).toString('hex');
    console.log('transaction:', unsignedTx);

    const serializedSignedTx = encode(unsignedTx);
    const verified = verifySignature(serializedSignedTx);
    console.log('sig verified: ', verified);

    try {
      const res = await client.submitAndWait(serializedSignedTx, {
        failHard: true,
      });
      console.log(res);
    } catch (e) {
      console.log(e);
    }

    return;
  },
};

export default ripple;
