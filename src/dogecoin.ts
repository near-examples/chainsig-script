import { ethers } from 'ethers';
import { sign } from './near';
import * as bitcoinJs from 'bitcoinjs-lib';
import coininfo from 'coininfo';
import { fetchJson } from './utils';
import prompts from 'prompts';

const SATS = 100000000;

const dogecoin = {
  name: 'Dogecoin Testnet',
  currency: 'DOGE',
  explorer: 'https://blockexplorer.one/dogecoin/testnet',
  getBalance: async ({ address, getUtxos }) => {
    const query = new URLSearchParams({
      pageSize: '50',
      txType: 'incoming',
    }).toString();

    const res = await dogeGet(`/transaction/address/${address}?${query}`);
    let maxUtxos = [];
    res.forEach((tx) => {
      let maxValue = 0;
      let index = 0;
      tx.outputs.forEach((o, i) => {
        if (o.address !== address) return;
        const value = parseFloat(o.value);
        if (value > maxValue) {
          maxValue = value;
          index = i;
        }
      });
      maxUtxos.push({
        hash: tx.hash,
        index,
      });
    });

    // find utxos
    let utxos = await Promise.all(
      maxUtxos.map(async ({ hash, index }) => {
        const res = await dogeGet(`/utxo/${hash}/${index}`, true);
        if (!res) {
          // console.log('no utxo found: ', hash);
          return;
        }
        // console.log('utxo found:', hash);
        const res2 = await dogeRpcCall('getrawtransaction', [hash, true]);
        return {
          value: res.value,
          hash,
          index,
          nonWitnessUtxo: Buffer.from(res2.result.hex, 'hex'),
        };
      }),
    );

    // filter undefined (bad responses)
    utxos = utxos.filter((utxo) => utxo !== undefined);

    // ONLY SIGNING 1 UTXO PER TX
    let maxValue = 0;
    utxos.forEach((utxo) => {
      if (utxo.value > maxValue) maxValue = utxo.value;
    });
    utxos = utxos.filter((utxo) => utxo.value === maxValue);

    return utxos;
  },
  send: async ({
    from: address,
    publicKey,
    to = 'nrnmRc1cS1uTiJqYQSE3kvqeCj5FQpbDTd',
    amount = '1',
  }) => {
    const { getBalance, explorer, currency } = dogecoin;

    const utxos = await getBalance({
      address,
      getUtxos: true,
    });
    // display balance as doge then multiply everything by sats
    console.log('balance', utxos[0].value, currency);
    utxos[0].value *= SATS;
    const sats = parseInt(amount) * SATS;
    if (utxos[0].value < sats) {
      return console.log('insufficient funds');
    }
    console.log('sending', amount, currency, 'from', address, 'to', to);
    const cont = await prompts({
      type: 'confirm',
      name: 'value',
      message: 'Confirm? (y or n)',
      initial: true,
    });
    if (!cont.value) return;

    const network = coininfo.dogecoin.test.toBitcoinJS();
    const psbt = new bitcoinJs.Psbt({ network });
    let totalInput = 0;

    // ONLY SIGNING 1 UTXO PER TX
    utxos.forEach((utxo) => {
      totalInput += utxo.value;
      const inputOptions = {
        hash: utxo.hash,
        index: utxo.index,
        nonWitnessUtxo: utxo.nonWitnessUtxo,
      };
      psbt.addInput(inputOptions);
    }),
      psbt.addOutput({
        address: to,
        value: sats,
      });

    const estimatedSize = utxos.length * 148 + 2 * 34 + 10;
    const fee = estimatedSize * 500; // fee rate is usually 100 sats on dogecoin testnet so add more to get it moving
    console.log('doge fee', fee, 'sats');
    const change = totalInput - sats - fee;
    console.log('change leftover', change / SATS);

    if (change > 0) {
      psbt.addOutput({
        address: address,
        value: change,
      });
    }

    const keyPair = {
      publicKey: Buffer.from(publicKey, 'hex'),
      sign: async (transactionHash) => {
        const payload = Object.values(ethers.utils.arrayify(transactionHash));

        const sig: any = await sign(payload, process.env.MPC_PATH);

        if (!sig) return;
        return Buffer.from(sig.r + sig.s, 'hex');
      },
    };

    await Promise.all(
      utxos.map(async (_, index) => {
        try {
          await psbt.signInputAsync(index, keyPair);
        } catch (e) {
          console.warn('not signed');
        }
      }),
    );

    psbt.finalizeAllInputs();

    try {
      const body = { txData: psbt.extractTransaction().toHex() };
      const res = await dogePost(`/broadcast`, body);
      const hash = res.txId;
      console.log('tx hash', hash);
      console.log('explorer link', `${explorer}/tx/${hash}`);
      console.log(
        'NOTE: it might take a minute for transaction to be included in mempool',
      );
    } catch (e) {
      console.log('error broadcasting dogecoin tx', JSON.stringify(e));
    }
  },
};

// doge helpers

const dogeRpc = `https://api.tatum.io/v3/dogecoin`;
const dogeGet = (path, noWarnings = false) =>
  fetchJson(
    `${dogeRpc}${path}`,
    {
      method: 'GET',
      headers: {
        'x-api-key': process.env.TATUM_API_KEY,
      },
    },
    noWarnings,
  );

const dogePost = (path, body) =>
  fetchJson(`${dogeRpc}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.TATUM_API_KEY,
    },
    body: JSON.stringify(body),
  });

const dogeRpcCall = (method, params) =>
  fetchJson(
    `https://api.tatum.io/v3/blockchain/node/doge-testnet/${process.env.TATUM_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.TATUM_API_KEY,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
        id: 1,
      }),
    },
  );

export default dogecoin;
