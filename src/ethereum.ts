import { readFileSync } from 'fs';
import { ethers } from 'ethers';
import BN from 'bn.js';
import { fetchJson } from './utils';
import prompts from 'prompts';
import { sign } from './near';
const { MPC_PATH, NEAR_PROXY_CONTRACT } = process.env;

const ethereum = {
    name: 'Sepolia',
    chainId: 11155111,
    currency: 'ETH',
    explorer: 'https://sepolia.etherscan.io',
    gasLimit: 21000,

    getGasPrice: async () => {
        // get current gas prices on Sepolia
        const {
            data: { rapid, fast, standard },
        } = await fetchJson(
            `https://sepolia.beaconcha.in/api/v1/execution/gasnow`,
        );
        let gasPrice = Math.max(rapid, fast, standard);
        if (!gasPrice) {
            console.log(
                'Unable to get gas price. Please refresh and try again.',
            );
        }
        return Math.max(rapid, fast, standard);
    },

    getBalance: ({ address }) => getSepoliaProvider().getBalance(address),

    send: async ({
        from: address,
        to = '0x525521d79134822a342d330bd91DA67976569aF1',
        amount = '0.001',
    }) => {
        if (!address) return console.log('must provide a sending address');
        const {
            getGasPrice,
            gasLimit,
            chainId,
            getBalance,
            completeEthereumTx,
            currency,
        } = ethereum;

        const balance = await getBalance({ address });
        console.log('balance', ethers.utils.formatUnits(balance), currency);

        const provider = getSepoliaProvider();
        // get the nonce for the sender
        const nonce = await provider.getTransactionCount(address);
        const gasPrice = await getGasPrice();

        // check sending value
        const value = ethers.utils.hexlify(ethers.utils.parseUnits(amount));
        if (value === '0x00') {
            console.log('Amount is zero. Please try a non-zero amount.');
        }

        // check account has enough balance to cover value + gas spend
        const overrideBalanceCheck = false;
        if (
            !overrideBalanceCheck &&
            (!balance ||
                new BN(balance.toString()).lt(
                    new BN(ethers.utils.parseUnits(amount).toString()).add(
                        new BN(gasPrice).mul(new BN(gasLimit.toString())),
                    ),
                ))
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

        await completeEthereumTx({ address, baseTx });
    },

    deployContract: async ({ from: address, path = './contracts/nft.bin' }) => {
        const { explorer, getGasPrice, completeEthereumTx, chainId } = ethereum;

        const bytes = readFileSync(path, 'utf8');

        const provider = getSepoliaProvider();
        const nonce = await provider.getTransactionCount(address);

        const contractAddress = ethers.utils.getContractAddress({
            from: address,
            nonce,
        });

        console.log(
            'deploying bytes',
            bytes.length,
            'to address',
            contractAddress,
        );

        const cont = await prompts({
            type: 'confirm',
            name: 'value',
            message: 'Confirm? (y or n)',
            initial: true,
        });
        if (!cont.value) return;

        const gasPrice = await getGasPrice();

        const baseTx = {
            nonce,
            data: bytes,
            value: 0,
            gasLimit: 6000000, // 6m gas
            gasPrice,
            chainId,
        };

        await completeEthereumTx({ address, baseTx });

        console.log('contract deployed successfully to address:');
        console.log(contractAddress);
        console.log('explorer link', `${explorer}/address/${contractAddress}`);
    },

    view: async ({
        to = '0x09a1a4e1cfca73c2e4f6599a7e6b98708fda2664',
        method = 'balanceOf',
        args = { address: '0x525521d79134822a342d330bd91da67976569af1' },
        ret = ['uint256'],
    }) => {
        const provider = getSepoliaProvider();
        console.log('view contract', to);
        const { data, iface } = encodeData({ method, args, ret });
        const res = await provider.call({
            to,
            data,
        });
        const decoded = iface.decodeFunctionResult(method, res);
        console.log('view result', decoded.toString());
    },

    call: async ({
        from: address,
        to = '0x09a1a4e1cfca73c2e4f6599a7e6b98708fda2664',
        method = 'mint',
        args = { address: '0x525521d79134822a342d330bd91da67976569af1' },
        ret = [],
    }) => {
        const { getGasPrice, completeEthereumTx, chainId } = ethereum;

        const provider = getSepoliaProvider();
        console.log('call contract', to);
        const { data } = encodeData({ method, args, ret });

        const cont = await prompts({
            type: 'confirm',
            name: 'value',
            message: 'Confirm? (y or n)',
            initial: true,
        });
        if (!cont.value) return;

        const gasPrice = await getGasPrice();
        const nonce = await provider.getTransactionCount(address);
        const baseTx = {
            to,
            nonce,
            data,
            value: 0,
            gasLimit: 1000000, // 1m
            gasPrice,
            chainId,
        };

        await completeEthereumTx({ address, baseTx });
    },

    completeEthereumTx: async ({ address, baseTx }) => {
        const { chainId, getBalance, explorer, currency } = ethereum;

        // create hash of unsigned TX to sign -> payload
        const unsignedTx = ethers.utils.serializeTransaction(baseTx);
        const txHash = ethers.utils.keccak256(unsignedTx);
        const payload = Object.values(ethers.utils.arrayify(txHash));

        // get signature from MPC contract
        let sig;
        if (NEAR_PROXY_CONTRACT === 'true') {
            sig = await sign(unsignedTx, MPC_PATH);
        } else {
            sig = await sign(payload, MPC_PATH);
        }
        if (!sig) return;

        sig.r = '0x' + sig.r.toString('hex');
        sig.s = '0x' + sig.s.toString('hex');
        // console.log('sig', sig);

        // check 2 values for v (y-parity) and recover the same ethereum address from the generateAddress call (in app.ts)
        let addressRecovered = false;
        for (let v = 0; v < 2; v++) {
            sig.v = v + chainId * 2 + 35;
            const recoveredAddress = ethers.utils.recoverAddress(payload, sig);
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

        // broadcast TX - signature now has correct { r, s, v }
        try {
            const hash = await getSepoliaProvider().send(
                'eth_sendRawTransaction',
                [ethers.utils.serializeTransaction(baseTx, sig)],
            );
            console.log('tx hash', hash);
            console.log('explorer link', `${explorer}/tx/${hash}`);
            console.log('fetching updated balance in 60s...');
            setTimeout(async () => {
                const balance = await getBalance({ address });
                console.log(
                    'balance',
                    ethers.utils.formatUnits(balance),
                    currency,
                );
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

const encodeData = ({ method, args, ret }) => {
    const abi = [
        `function ${method}(${Object.keys(args).join(',')}) returns (${ret.join(
            ',',
        )})`,
    ];
    const iface = new ethers.utils.Interface(abi);
    const allArgs = [];
    const argValues = Object.values(args);
    for (let i = 0; i < argValues.length; i++) {
        allArgs.push(argValues[i]);
    }

    console.log(abi[0], 'with args', allArgs);

    return {
        iface,
        data: iface.encodeFunctionData(method, allArgs),
    };
};

const getSepoliaProvider = () => {
    return new ethers.providers.JsonRpcProvider(
        'https://ethereum-sepolia.publicnode.com',
    );
};

export default ethereum;
