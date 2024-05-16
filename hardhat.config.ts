import { HardhatUserConfig } from "hardhat/config";
import "hardhat-deal";
import "hardhat-tracer";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "evm-maths";
import "dotenv/config";

import "@typechain/hardhat";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-foundry";
import "@nomicfoundation/hardhat-chai-matchers";

export const rpcUrl = process.env.MAINNET_RPC_URL;
if (!rpcUrl) throw Error(`no RPC url provided`);

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      chainId: 1,
      forking: {
        url: rpcUrl,
        blockNumber: 19881284,
      },
      allowBlocksWithSameTimestamp: true,
      accounts: { count: 2 },
    },
    mainnet: {
      chainId: 1,
      url: rpcUrl,
    },
  },
  solidity: {
    compilers: [
      {
        version: "0.8.25",
        settings: {
          evmVersion: "cancun",
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
    ],
  },
  gasReporter: {
    currency: "EUR",
  },
  mocha: {
    timeout: 300000,
  },
  typechain: {
    outDir: "src/types/",
  },
  tracer: {
    defaultVerbosity: 1,
    gasCost: true,
  },
};

export default config;
