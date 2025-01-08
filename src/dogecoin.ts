import { ethers } from 'ethers';
import { sign } from './near';
import * as bitcoinJs from 'bitcoinjs-lib';
import coininfo from 'coininfo';
import { fetchJson } from './utils';
import prompts from 'prompts';
import { ec as EC } from 'elliptic';

// faucet: https://dogecointf.salmen.website/

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
                const res2 = await dogeRpcCall('getrawtransaction', [
                    hash,
                    true,
                ]);

                // console.log(JSON.stringify(res2));

                return {
                    value: res.value,
                    hash,
                    index,
                    nonWitnessUtxo: Buffer.from(res2.result.hex, 'hex'),
                    scriptPubKey: Buffer.from(
                        res2.result.vout[0].scriptPubKey.hex,
                        'hex',
                    ),
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

        if (utxos.length > 1) utxos.length = 1;

        return utxos;
    },
    send: async ({
        from: address,
        publicKey,
        to = 'nkMesrm1adEvqDMzPBf1cko3hYstpFr4BM',
        amount = '1',
    }) => {
        const { getBalance, explorer, currency } = dogecoin;

        console.log('publicKey', publicKey);

        const utxos = await getBalance({
            address,
            getUtxos: true,
        });

        console.log('num utxos', utxos.length);

        if (utxos.length === 0) {
            return console.log('insufficient funds:', address);
        }

        // display balance as doge then multiply everything by sats
        console.log('balance', utxos[0].value, currency);
        utxos[0].value *= SATS;
        const sats = parseInt(amount) * SATS;
        if (utxos[0].value < sats) {
            return console.log('insufficient funds:', address);
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
        });

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

        // DEBUGGING

        const { tx: unsignedTx } = psbt.data.globalMap.unsignedTx as any;
        const vin = unsignedTx.ins[0];
        const { outs } = unsignedTx;

        const txForOmni = {
            version: 2,
            lock_time: 0,
            input: [
                {
                    previous_output: {
                        txid: Buffer.from(vin.hash).toString('hex'),
                        vout: 0,
                    },
                    script_sig: [],
                    sequence: vin.sequence,
                    witness: [],
                },
            ],
            output: outs.map((out) => ({
                value: out.value,
                script_pubkey: Buffer.from(out.script).toString('hex'),
            })),
        };

        console.log(
            'transaction json for omni library',
            JSON.stringify(txForOmni),
        );

        // build a legacy p2pkh tx

        const tx = new bitcoinJs.Transaction();
        tx.version = 1;

        tx.addInput(Buffer.from(utxos[0].hash, 'hex').reverse(), 0);
        tx.addOutput(
            Buffer.from(txForOmni.output[0].script_pubkey, 'hex'),
            txForOmni.output[0].value,
        );
        tx.addOutput(
            Buffer.from(txForOmni.output[1].script_pubkey, 'hex'),
            txForOmni.output[1].value,
        );
        const scriptPubKeyBuffer = utxos[0].scriptPubKey;

        const sighash = tx.hashForSignature(
            0,
            bitcoinJs.script.compile(scriptPubKeyBuffer),
            bitcoinJs.Transaction.SIGHASH_ALL,
        );

        const payload = Object.values(ethers.utils.arrayify(sighash));

        const sig: any = await sign(payload, process.env.MPC_PATH);

        console.log(sig);

        let { r, s } = sig;

        function ensurePositive(buffer: Buffer) {
            if (buffer[0] & 0x80) {
                return Buffer.concat([
                    new Uint8Array(Buffer.from('00', 'hex')),
                    new Uint8Array(buffer),
                ]);
            }
            return buffer;
        }
        r = ensurePositive(r);
        s = ensurePositive(s);

        const derSignature = Buffer.concat([
            new Uint8Array(Buffer.from('30', 'hex')),
            new Uint8Array(
                Buffer.from((r.length + s.length + 4).toString(16), 'hex'),
            ),
            new Uint8Array(Buffer.from('02', 'hex')),
            new Uint8Array(Buffer.from(r.length.toString(16), 'hex')),
            r,
            new Uint8Array(Buffer.from('0220', 'hex')),
            s,
        ]);

        console.log('derSignature', derSignature.toString('hex'));

        const signatureWithHashType = Buffer.concat([
            new Uint8Array(derSignature),
            new Uint8Array(Buffer.from([bitcoinJs.Transaction.SIGHASH_ALL])),
        ]);

        const scriptSig = bitcoinJs.script.compile([
            signatureWithHashType,
            Buffer.from(publicKey, 'hex'),
        ]);

        tx.setInputScript(0, scriptSig);
        const txData = tx.toHex();

        console.log(txData);

        try {
            const body = { txData };

            console.log('broadcast body', body);

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

        return;

        // END DEBUGGING

        const keyPair = {
            publicKey: Buffer.from(publicKey, 'hex'),
            sign: async (transactionHash) => {
                const payload = Object.values(
                    ethers.utils.arrayify(transactionHash),
                );
                const sig: any = await sign(payload, process.env.MPC_PATH);

                console.log('sig', sig);

                // debugging verification
                var ec = new EC('secp256k1');
                var key = ec.keyFromPublic(Buffer.from(publicKey, 'hex'));
                var sig2 = { r: sig.r, s: sig.s };
                console.log(
                    'signature verification',
                    key.verify(Buffer.from(transactionHash, 'hex'), sig2),
                );

                if (!sig) return;

                return Buffer.from(
                    sig.r.toString('hex') + sig.s.toString('hex'),
                    'hex',
                );
            },
        };

        await Promise.all(
            utxos.map(async (_, index) => {
                try {
                    await psbt.signInputAsync(index, keyPair);
                } catch (e) {
                    console.warn('not signed');
                    console.log(e);
                }
            }),
        );

        psbt.finalizeAllInputs();

        try {
            const body = { txData: psbt.extractTransaction().toHex() };

            console.log('broadcast body', body);

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
