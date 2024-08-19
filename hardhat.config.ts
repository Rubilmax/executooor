import { HardhatUserConfig } from "hardhat/config";
import "dotenv/config";

export const rpcUrl = process.env.MAINNET_RPC_URL;
if (!rpcUrl) throw Error(`no RPC url provided`);

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      chainId: 1,
      forking: {
        url: rpcUrl,
        blockNumber: 19_909_475,
      },
      gasPrice: 0,
      initialBaseFeePerGas: 0,
      allowBlocksWithSameTimestamp: true,
      accounts: { count: 2 },
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
};

export default config;
