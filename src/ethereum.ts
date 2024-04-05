import { ethers } from 'ethers';
import BN from 'bn.js';
import { fetchJson } from './utils';
import prompts from 'prompts';
import { sign } from './near';

const ethereum = {
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

const getSepoliaProvider = () => {
  return new ethers.providers.JsonRpcProvider(
    'https://ethereum-sepolia.publicnode.com',
  );
};

export default ethereum;
