import { ethers } from 'ethers';
import BN from 'bn.js';
import { fetchJson } from './utils';
import { sign } from './near';
import * as bitcoinJs from 'bitcoinjs-lib';
import coininfo from 'coininfo';
import prompts from 'prompts';

export const ethereum = {
  name: 'Sepolia',
  chainId: 11155111,
  currency: 'ETH',
  explorer: 'https://sepolia.etherscan.io',
  gasLimit: 21000,
  getBalance: ({ address }) => getSepoliaProvider().getBalance(address),
  send: async ({
    from: address,
    to = '0x525521d79134822a342d330bd91DA67976569aF1',
    amount = '0.001',
  }) => {
    if (!address) return console.log('must provide a sending address');
    const { gasLimit, chainId, getBalance, explorer, currency } = ethereum;

    const balance = await getBalance({ address });
    console.log('balance', ethers.utils.formatUnits(balance), currency);

    // get the nonce for the sender
    const nonce = await getSepoliaProvider().getTransactionCount(address);
    // get current gas prices on Sepolia
    const {
      data: { rapid, fast, standard },
    } = await fetchJson(`https://sepolia.beaconcha.in/api/v1/execution/gasnow`);
    let gasPrice = Math.max(rapid, fast, standard);
    if (!gasPrice) {
      console.log('Unable to get gas price. Please refresh and try again.');
    }

    // check sending value
    const value = ethers.utils.hexlify(ethers.utils.parseUnits(amount));
    if (value === '0x00') {
      console.log('Amount is zero. Please try a non-zero amount.');
    }

    // check account has enough balance to cover value + gas spend
    if (
      !balance ||
      new BN(balance.toString()).lt(
        new BN(ethers.utils.parseUnits(amount).toString()).add(
          new BN(gasPrice).mul(new BN(gasLimit.toString())),
        ),
      )
    ) {
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

    // construct the base tx (UNSIGNED)
    const baseTx = {
      to,
      nonce,
      data: [],
      value,
      gasLimit,
      gasPrice,
      chainId,
    };

    // create hash of unsigned TX to sign -> payload
    const unsignedTx = ethers.utils.serializeTransaction(baseTx);
    const txHash = ethers.utils.keccak256(unsignedTx);
    const payload = Object.values(ethers.utils.arrayify(txHash));
    // get signature from MPC contract
    const sig: any = await sign(payload, process.env.MPC_PATH);
    if (!sig) return;
    // payload was reversed in sign(...) call for MPC contract, reverse it back to recover eth address
    payload.reverse();
    sig.r = '0x' + sig.r;
    sig.s = '0x' + sig.s;

    // check 2 values for v (y-parity) and recover the same ethereum address from the generateAddress call (in app.ts)
    let addressRecovered = false;
    for (let v = 0; v < 2; v++) {
      sig.v = v + chainId * 2 + 35;
      const recoveredAddress = ethers.utils.recoverAddress(payload, sig);
      console.log('recoveredAddress', recoveredAddress);
      if (recoveredAddress.toLowerCase() === address.toLowerCase()) {
        addressRecovered = true;
        break;
      }
    }
    if (!addressRecovered) {
      return console.log('signature failed to recover correct sending address');
    }

    // signature now has correct { r, s, v }
    // broadcast TX
    try {
      const hash = await getSepoliaProvider().send('eth_sendRawTransaction', [
        ethers.utils.serializeTransaction(baseTx, sig),
      ]);
      console.log('tx hash', hash);
      console.log('explorer link', `${explorer}/tx/${hash}`);
      console.log('fetching updated balance in 60s...');
      setTimeout(async () => {
        const balance = await getBalance({ address });
        console.log('balance', ethers.utils.formatUnits(balance), currency);
      }, 60000);
    } catch (e) {
      if (/nonce too low/gi.test(JSON.stringify(e))) {
        return console.log('tx has been tried');
      }
      if (/gas too low|underpriced/gi.test(JSON.stringify(e))) {
        return console.log(e);
      }
      console.log(e);
    }
  },
};

export const bitcoin = {
  name: 'Bitcoin Testnet',
  currency: 'sats',
  explorer: 'https://blockstream.info/testnet',
  getBalance: async ({ address, getUtxos = false }) => {
    const res = await fetchJson(
      `https://blockstream.info/testnet/api/address/${address}/utxo`,
    );

    let utxos = res.map((utxo) => ({
      txid: utxo.txid,
      vout: utxo.vout,
      value: utxo.value,
    }));
    // ONLY RETURNING AND SIGNING LARGEST UTXO
    // WHY?
    // For convenience in client side, this will only require 1 Near signature for 1 Bitcoin TX.
    // Solutions for signing multiple UTXOs using MPC with a single Near TX are being worked on.
    let maxValue = 0;
    utxos.forEach((utxo) => {
      if (utxo.value > maxValue) maxValue = utxo.value;
    });
    utxos = utxos.filter((utxo) => utxo.value === maxValue);

    if (!utxos || !utxos.length) {
      console.log(
        'no utxos for address',
        address,
        'please fund address and try again',
      );
    }

    return getUtxos ? utxos : maxValue;
  },
  send: async ({
    from: address,
    publicKey,
    to = 'n47ZTPR31eyi5SZNMbZQngJ4wiZMxXw1bS',
    amount = '1',
  }) => {
    if (!address) return console.log('must provide a sending address');
    const { getBalance, explorer, currency } = bitcoin;
    const sats = parseInt(amount);

    // get utxos
    const utxos = await getBalance({ address, getUtxos: true });

    // check balance (TODO include fee in check)
    console.log('balance', utxos[0].value, currency);
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

    const psbt = new bitcoinJs.Psbt({ network: bitcoinJs.networks.testnet });

    let totalInput = 0;
    await Promise.all(
      utxos.map(async (utxo) => {
        totalInput += utxo.value;

        const transaction = await fetchTransaction(utxo.txid);
        let inputOptions;
        if (transaction.outs[utxo.vout].script.includes('0014')) {
          inputOptions = {
            hash: utxo.txid,
            index: utxo.vout,
            witnessUtxo: {
              script: transaction.outs[utxo.vout].script,
              value: utxo.value,
            },
          };
        } else {
          inputOptions = {
            hash: utxo.txid,
            index: utxo.vout,
            nonWitnessUtxo: Buffer.from(transaction.toHex(), 'hex'),
          };
        }
        psbt.addInput(inputOptions);
      }),
    );

    psbt.addOutput({
      address: to,
      value: sats,
    });

    // calculate fee
    const feeRate = await fetchJson(`${bitcoinRpc}/fee-estimates`);
    const estimatedSize = utxos.length * 148 + 2 * 34 + 10;
    const fee = estimatedSize * (feeRate[6] + 3);
    console.log('btc fee', fee);
    const change = totalInput - sats - fee;
    console.log('change leftover', change);
    if (change > 0) {
      psbt.addOutput({
        address: address,
        value: change,
      });
    }

    // keyPair object required by psbt.signInputAsync(index, keyPair)
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

    // broadcast tx
    try {
      const res = await fetch(`https://corsproxy.io/?${bitcoinRpc}/tx`, {
        method: 'POST',
        body: psbt.extractTransaction().toHex(),
      });
      if (res.status === 200) {
        const hash = await res.text();
        console.log('tx hash', hash);
        console.log('explorer link', `${explorer}/tx/${hash}`);
        console.log(
          'NOTE: it might take a minute for transaction to be included in mempool',
        );
      }
    } catch (e) {
      console.log('error broadcasting bitcoin tx', JSON.stringify(e));
    }
  },
};

export const dogecoin = {
  name: 'Dogecoin Testnet',
  currency: 'DOGE',
  explorer: 'https://blockexplorer.one/dogecoin/testnet',
  getBalance: async ({ address, getUtxos }) => {
    const res = await dogeGet(`/addresses/${address}/unspent-outputs`);

    let utxos = res.data.items.map((utxo) => ({
      ...utxo,
      value: Math.floor(utxo.amount * SATS),
      txid: utxo.transactionId,
      vout: utxo.index,
    }));

    // ONLY SIGNING 1 UTXO PER TX
    let maxValue = 0;
    utxos.forEach((utxo) => {
      // ONLY SIGNING THE MAX VALUE UTXO
      if (utxo.value > maxValue) maxValue = utxo.value;
    });
    utxos = utxos.filter((utxo) => utxo.value === maxValue);

    if (!utxos || !utxos.length) {
      console.log(
        'no utxos for address',
        address,
        'please fund address and try again',
      );
    }

    return getUtxos ? utxos : maxValue;
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

    const sats = parseInt(amount) * SATS;

    console.log('balance', utxos[0].value, currency);
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

    await Promise.all(
      utxos.map(async (utxo) => {
        totalInput += utxo.value;
        const res = await dogeGet(`/transactions/${utxo.txid}/raw-data`);
        const { transactionHex } = res.data.item;
        const inputOptions = {
          hash: utxo.txid,
          index: utxo.vout,
          nonWitnessUtxo: Buffer.from(transactionHex, 'hex'),
        };

        psbt.addInput(inputOptions);
      }),
    );

    psbt.addOutput({
      address: to,
      value: sats,
    });

    const feeRes = await dogeGet(`/mempool/fees`);
    const { fast, standard } = feeRes.data.item;
    const feeRate = Math.max(parseFloat(fast), parseFloat(standard)) * SATS;
    const estimatedSize = utxos.length * 148 + 2 * 34 + 10;
    const fee = estimatedSize * (feeRate * 5); // fee rate is 100 sats on dogecoin testnet so increase to get moving?
    console.log('doge fee', fee);
    const change = totalInput - sats - fee;
    console.log('change leftover', change);

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
      const res = await dogePost(
        `https://api.tatum.io/v3/dogecoin/broadcast`,
        body,
      );
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

// ethereum helpers

const getSepoliaProvider = () => {
  return new ethers.providers.JsonRpcProvider(
    'https://ethereum-sepolia.publicnode.com',
  );
};

// bitcoin helpers

const SATS = 100000000;
const bitcoinRpc = `https://blockstream.info/testnet/api`;
async function fetchTransaction(transactionId): Promise<bitcoinJs.Transaction> {
  const data = await fetchJson(`${bitcoinRpc}/tx/${transactionId}`);
  const tx = new bitcoinJs.Transaction();

  tx.version = data.version;
  tx.locktime = data.locktime;

  data.vin.forEach((vin) => {
    const txHash = Buffer.from(vin.txid, 'hex').reverse();
    const vout = vin.vout;
    const sequence = vin.sequence;
    const scriptSig = vin.scriptsig
      ? Buffer.from(vin.scriptsig, 'hex')
      : undefined;
    tx.addInput(txHash, vout, sequence, scriptSig);
  });

  data.vout.forEach((vout) => {
    const value = vout.value;
    const scriptPubKey = Buffer.from(vout.scriptpubkey, 'hex');
    tx.addOutput(scriptPubKey, value);
  });

  data.vin.forEach((vin, index) => {
    if (vin.witness && vin.witness.length > 0) {
      const witness = vin.witness.map((w) => Buffer.from(w, 'hex'));
      tx.setWitness(index, witness);
    }
  });

  return tx;
}

// doge helpers

const dogeRpc = `https://rest.cryptoapis.io/blockchain-data/dogecoin/testnet`;
const dogeFetchParams = {
  headers: {
    'X-Api-Key': process.env.CRYPTO_APIS_KEY,
  },
};
const dogeGet = (path) => fetchJson(`${dogeRpc}${path}`, dogeFetchParams);
const dogePost = (url, body) =>
  fetchJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.TATUM_API_KEY,
    },
    body: JSON.stringify(body),
  });
