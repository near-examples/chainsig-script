import { ethers } from 'ethers';
import BN from 'bn.js';
import { fetchJson } from './utils';
import { sign } from './near';
import * as bitcoin from 'bitcoinjs-lib';
import prompts from 'prompts';

export const chains = {
  ethereum: {
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
      const { gasLimit, chainId, getBalance, explorer, currency } =
        chains.ethereum;

      const balance = await getBalance({ address });
      console.log('balance', ethers.utils.formatUnits(balance), currency);

      const nonce = await getSepoliaProvider().getTransactionCount(address);
      const {
        data: { rapid, fast, standard },
      } = await fetchJson(
        `https://sepolia.beaconcha.in/api/v1/execution/gasnow`,
      );
      let gasPrice = Math.max(rapid, fast, standard);
      if (!gasPrice) {
        console.log('Unable to get gas price. Please refresh and try again.');
      }

      const value = ethers.utils.hexlify(ethers.utils.parseUnits(amount));
      if (value === '0x00') {
        console.log('Amount is zero. Please try a non-zero amount.');
      }

      // check balance
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

      const baseTx = {
        to,
        nonce,
        data: [],
        value,
        gasLimit,
        gasPrice,
        chainId,
      };

      const unsignedTx = ethers.utils.serializeTransaction(baseTx);
      const txHash = ethers.utils.keccak256(unsignedTx);
      const payload = Object.values(ethers.utils.arrayify(txHash));
      const sig: any = await sign(payload, process.env.MPC_PATH);
      if (!sig) return;
      // payload was reverse in sign(...) call for MPC contract, reverse back to recover eth address
      payload.reverse();
      sig.r = '0x' + sig.r;
      sig.s = '0x' + sig.s;

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
        return console.log(
          'signature failed to recover correct sending address',
        );
      }

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
  },
  bitcoin: {
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
      // ONLY SIGNING 1 UTXO PER TX
      let maxValue = 0;
      utxos.forEach((utxo) => {
        // ONLY SIGNING THE MAX VALUE UTXO
        if (utxo.value > maxValue) maxValue = utxo.value;
      });
      utxos = utxos.filter((utxo) => utxo.value === maxValue);

      return getUtxos ? utxos : maxValue;
    },
    send: async ({
      from: address,
      publicKey,
      to = 'n47ZTPR31eyi5SZNMbZQngJ4wiZMxXw1bS',
      amount = '1',
    }) => {
      if (!address) return console.log('must provide a sending address');
      const { getBalance, explorer, currency } = chains.bitcoin;
      const sats = parseInt(amount);

      const utxos = await getBalance({ address, getUtxos: true });
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

      const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet });
      let totalInput = 0;

      // ONLY SIGNING 1 UTXO PER TX

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

      const feeRate = await fetchJson(`${btcrpc}/fee-estimates`);
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
        const res = await fetch(`https://corsproxy.io/?${btcrpc}/tx`, {
          method: 'POST',
          body: psbt.extractTransaction().toHex(),
        });
        console.log(res);
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
  },
};

// helpers

const btcrpc = `https://blockstream.info/testnet/api`;
async function fetchTransaction(transactionId): Promise<bitcoin.Transaction> {
  const data = await fetchJson(`${btcrpc}/tx/${transactionId}`);
  const tx = new bitcoin.Transaction();

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

const getSepoliaProvider = () => {
  return new ethers.providers.JsonRpcProvider(
    'https://ethereum-sepolia.publicnode.com',
  );
};
