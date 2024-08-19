import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import "@typechain/hardhat";
import "evm-maths";
import "hardhat-deal";
import "hardhat-gas-reporter";
import "hardhat-tracer";
import "solidity-coverage";

import config from "../../hardhat.config";

config.typechain = {
  outDir: "src/types/",
};

export default config;
