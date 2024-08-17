import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";

import { ContractTransaction, TransactionResponse } from "ethers";

import { ExecutorEncoder } from "../src/ExecutorEncoder";

const ownerAddress = "0xBAaF2b6872Eda03Ab675f46b558E345DF3b70Df4";
const executorAddress = "0x333E321c7dD02Aeb80A5c7D22b481449B7bEaf02";

describe("populateExec", () => {
  let owner: SignerWithAddress;

  let tx: ContractTransaction;
  let receipt: TransactionResponse;

  beforeEach(async () => {
    owner = await ethers.getImpersonatedSigner(ownerAddress);
  });

  afterEach(async () => {
    if (!receipt) return;

    console.log("Simulated at:", receipt.blockNumber);

    console.log(tx);
  });

  it("should exec", async () => {
    const encoder = new ExecutorEncoder(executorAddress, ethers.provider);

    tx = await encoder.populateExec();

    receipt = await owner.sendTransaction(tx);

    // Write tests below:
  });
});
