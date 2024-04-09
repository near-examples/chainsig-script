import { ethers } from 'ethers';
import { sign } from './near';
import prompts from 'prompts';
import BN from 'bn.js';
import * as xrpl from 'xrpl';
const { validate, verifySignature, encode, encodeForSigning } = xrpl;
import * as Signature from 'elliptic/lib/elliptic/ec/signature';

const xrpTestnet = 'wss://s.altnet.rippletest.net:51233';
const DROPS = 1000000;

const xrpLedger = {
  name: 'XRPL Testnet',
  currency: 'XRP',
  explorer: 'https://test.bithomp.com/explorer',
  getBalance: async ({ address, client }) => {
    if (!client) {
      client = new xrpl.Client(xrpTestnet);
      await client.connect();
    }

    const {
      result: {
        account_data: { Balance },
      },
    } = await client.request({
      command: 'account_info',
      account: address,
      strict: true,
    });

    return Balance;
  },
  send: async ({
    from: address = 'rPbcwLLhUdYTJLnkepbpxmnkn5xCnkKRBJ',
    publicKey,
    to = 'rPbcwLLhUdYTJLnkepbpxmnkn5xCnkKRBJ',
    amount = '1',
  }) => {
    const { getBalance, currency, explorer } = xrpLedger;

    const client = new xrpl.Client(xrpTestnet);
    await client.connect();

    const balance = await getBalance({ address, client });
    console.log('XRP Balance:', parseInt(balance) / DROPS);
    if (parseInt(amount) * DROPS > parseInt(balance)) {
      console.log('Not enough balance to send amount:', amount);
      return;
    }

    console.log('sending', amount, currency, 'from', address, 'to', to);
    const cont = await prompts({
      type: 'confirm',
      name: 'value',
      message: 'Confirm? (y or n)',
      initial: true,
    });
    if (!cont.value) return;

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
      console.log('Success');
      console.log('Explorer link:', `${explorer}/${res.result.hash}`);
    } catch (e) {
      console.log('Transaction failed broadcasting to network');
      console.log(e);
    }

    return;
  },
};

export default xrpLedger;
