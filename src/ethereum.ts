import { readFileSync } from "fs";
import { ethers } from "ethers";
import BN from "bn.js";
import { fetchJson } from "./utils";
import prompts from "prompts";
import { sign } from "./near";
import {
  FeeMarketEIP1559Transaction,
  FeeMarketEIP1559TxData,
} from "@ethereumjs/tx";
import { Common } from "@ethereumjs/common";
import { bytesToHex } from "@ethereumjs/util";
import { Web3 } from "web3";
const { MPC_PATH } = process.env;

const ethereum = {
  name: "Sepolia",
  chainId: 11155111,
  currency: "ETH",
  explorer: "https://sepolia.etherscan.io",
  gasLimit: 50000,
  w3: new Web3("https://rpc2.sepolia.org"),

  queryGasPrice: async () => {
    const maxFeePerGas = await ethereum.w3.eth.getGasPrice();
    const maxPriorityFeePerGas =
      await ethereum.w3.eth.getMaxPriorityFeePerGas();
    return { maxFeePerGas, maxPriorityFeePerGas };
  },

  getGasPrice: async () => {
    // get current gas prices on Sepolia
    const {
      data: { rapid, fast, standard },
    } = await fetchJson(`https://sepolia.beaconcha.in/api/v1/execution/gasnow`);
    let gasPrice = Math.max(rapid, fast, standard);
    if (!gasPrice) {
      console.log("Unable to get gas price. Please refresh and try again.");
    }
    return Math.max(rapid, fast, standard);
  },

  getBalance: ({ address }) => getSepoliaProvider().getBalance(address),

  send: async ({ from: address, to = address, amount = "0.001" }) => {
    if (!address) return console.log("must provide a sending address");
    const {
      queryGasPrice,
      getGasPrice,
      gasLimit,
      chainId,
      getBalance,
      completeEthereumTx,
      currency,
    } = ethereum;

    const balance = await getBalance({ address });
    console.log("balance", ethers.utils.formatUnits(balance), currency);

    const provider = getSepoliaProvider();
    // get the nonce for the sender
    const nonce = await provider.getTransactionCount(address);
    const { maxFeePerGas, maxPriorityFeePerGas } = await queryGasPrice();
    const gasPrice = await getGasPrice();

    // check sending value
    const value = ethers.utils.hexlify(ethers.utils.parseUnits(amount));
    if (value === "0x00") {
      console.log("Amount is zero. Please try a non-zero amount.");
    }

    // check account has enough balance to cover value + gas spend
    if (
      !balance ||
      new BN(balance.toString()).lt(
        new BN(ethers.utils.parseUnits(amount).toString()).add(
          new BN(gasPrice).mul(new BN(gasLimit.toString()))
        )
      )
    ) {
      return console.log("insufficient funds");
    }

    console.log("sending", amount, currency, "from", address, "to", to);
    const common = new Common({ chain: chainId });

    const transactionData: FeeMarketEIP1559TxData = {
      chainId: chainId,
      nonce: BigInt(nonce),
      gasLimit,
      to,
      maxFeePerGas,
      maxPriorityFeePerGas,
      value: BigInt(value),
    };
    console.log("transaction data: ", transactionData);
    const transaction = FeeMarketEIP1559Transaction.fromTxData(
      transactionData,
      { common }
    );
    const cont = await prompts({
      type: "confirm",
      name: "value",
      message: "Confirm? (y or n)",
      initial: true,
    });
    if (!cont.value) return;

    await completeEthereumTx({ address, baseTx: transaction });
  },

  deployContract: async ({ from: address, path = "./contracts/nft.bin" }) => {},

  view: async ({
    to = "0x09a1a4e1cfca73c2e4f6599a7e6b98708fda2664",
    method = "balanceOf",
    args = { address: "0x525521d79134822a342d330bd91da67976569af1" },
    ret = ["uint256"],
  }) => {
    const provider = getSepoliaProvider();
    console.log("view contract", to);
    const { data, iface } = encodeData({ method, args, ret });
    const res = await provider.call({
      to,
      data,
    });
    const decoded = iface.decodeFunctionResult(method, res);
    console.log("view result", decoded.toString());
  },

  completeEthereumTx: async ({
    address,
    baseTx,
  }: {
    address: string;
    baseTx: FeeMarketEIP1559Transaction;
  }) => {
    const { chainId, getBalance, explorer, currency } = ethereum;

    const txHash = baseTx.getHashedMessageToSign();
    console.log("tx hash: ", Buffer.from(txHash).toString("hex"));
    const payload = Array.from(txHash);

    // get signature from MPC contract
    let sig = await sign(payload, MPC_PATH);
    if (!sig) return;

    let signature = baseTx.addSignature(sig.v, sig.r, sig.s);
    if (signature.getValidationErrors().length > 0)
      throw new Error(
        `Transaction validation errors: ${signature.getValidationErrors()}`
      );
    let valid = signature.verifySignature();

    if (!valid) {
      throw new Error(
        `signature failed to recover correct sending address. Wanted ${address}`
      );
    }

    // broadcast TX - signature now has correct { r, s, v }
    try {
      const serializedTx = bytesToHex(signature.serialize());
      const relayed = await ethereum.w3.eth.sendSignedTransaction(serializedTx);
      console.log("tx hash", relayed.transactionHash);
      console.log("explorer link", `${explorer}/tx/${relayed.transactionHash}`);
      console.log("fetching updated balance in 60s...");
      setTimeout(async () => {
        const balance = await getBalance({ address });
        console.log("balance", ethers.utils.formatUnits(balance), currency);
      }, 60000);
    } catch (e) {
      if (/nonce too low/gi.test(JSON.stringify(e))) {
        return console.log("tx has been tried");
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
    `function ${method}(${Object.keys(args).join(",")}) returns (${ret.join(
      ","
    )})`,
  ];
  const iface = new ethers.utils.Interface(abi);
  const allArgs = [];
  const argValues = Object.values(args);
  for (let i = 0; i < argValues.length; i++) {
    allArgs.push(argValues[i]);
  }

  console.log(abi[0], "with args", allArgs);

  return {
    iface,
    data: iface.encodeFunctionData(method, allArgs),
  };
};

const getSepoliaProvider = () => {
  return new ethers.providers.JsonRpcProvider(
    "https://ethereum-sepolia.publicnode.com"
  );
};

export default ethereum;
