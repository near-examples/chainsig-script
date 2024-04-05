import { program } from 'commander';
import { generateAddress } from './kdf';
import { sign } from './near';
import dogecoin from './dogecoin';
import ethereum from './ethereum';
import bitcoin from './bitcoin';
import ripple from './ripple';

program
  .option('-ea')
  .option('-ba')
  .option('-da')
  .option('-ra')
  .option('-s')
  .option('-etx')
  .option('-btx')
  .option('-dtx')
  .option('-rtx')
  .option('-a, --amount <char>')
  .option('-to, --to <char>');

program.parse();

// options
const options = Object.entries(program.opts())
  .map(([k, v]) => ({
    [k.toLowerCase()]: v,
  }))
  .reduce((a, c) => ({ ...a, ...c }), {});

async function main() {
  const { MPC_PUBLIC_KEY, NEAR_ACCOUNT_ID, MPC_PATH } = process.env;
  const { ea, ba, da, ra, s, etx, btx, dtx, rtx, to, amount } = options;

  const genAddress = (chain) =>
    generateAddress({
      publicKey: MPC_PUBLIC_KEY,
      accountId: NEAR_ACCOUNT_ID,
      path: MPC_PATH,
      chain,
    });

  if (ea) {
    const { address } = await genAddress('ethereum');
    console.log(address);
  }
  if (ba) {
    const { address } = await genAddress('bitcoin');
    console.log(address);
  }
  if (da) {
    const { address } = await genAddress('dogecoin');
    console.log(address);
  }
  if (ra) {
    const { address } = await genAddress('ripple');
    console.log(address);
  }
  if (s) {
    const samplePayload = new Array(32);
    for (let i = 0; i < samplePayload.length; i++) {
      samplePayload[i] = Math.floor(Math.random() * 255);
    }
    const res = await sign(samplePayload, MPC_PATH);
    console.log('signature', res);
  }
  if (etx) {
    const { address } = await genAddress('ethereum');
    ethereum.send({ from: address, to, amount });
  }
  if (btx) {
    const { address, publicKey } = await genAddress('bitcoin');
    bitcoin.send({ from: address, publicKey, to, amount });
  }
  if (dtx) {
    const { address, publicKey } = await genAddress('dogecoin');
    dogecoin.send({ from: address, publicKey, to, amount });
  }
  // UNFINISHED
  if (rtx) {
    const { address, publicKey } = await genAddress('ripple');
    ripple.send({ from: address, publicKey, to, amount });
  }
}

main();
