import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { deal } from "hardhat-deal";

import { AbiCoder, BigNumberish, MaxUint256, getCreate2Address, keccak256, solidityPacked } from "ethers";
import { AaveV2LendingPool__factory, AaveV3Pool__factory, BalancerVault__factory, ERC20__factory } from "ethers-types";

import { ExecutorEncoder } from "../src/ExecutorEncoder";

export const dai = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
export const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

export const uniV2FactoryAddress = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
export const uniV3FactoryAddress = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
export const uniV2RouterAddress = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
export const uniV3RouterAddress = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
export const aaveV2PoolAddress = "0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9";
export const aaveV3PoolAddress = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";
export const balancerVaultAddress = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
export const makerVaultAddress = "0x60744434d6339a6B27d73d9Eda62b6F66a0a04FA";
export const oneInchAddress = "0x111111125421ca6dc452d289314280a0f8842a65";

// V2

export const computeV2PoolAddress = (tokenA: string, tokenB: string, aIs0?: boolean) => {
  if (aIs0 == null) aIs0 = tokenA.toLowerCase() < tokenB.toLowerCase();

  const [token0Address, token1Address] = aIs0 ? [tokenA, tokenB] : [tokenB, tokenA];

  return getCreate2Address(
    uniV2FactoryAddress,
    keccak256(solidityPacked(["address", "address"], [token0Address, token1Address])),
    "0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f",
  );
};

// V3

export const INIT_CODE_V3_HASH = "0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54";

export const computeV3PoolAddress = (tokenA: string, tokenB: string, fee: BigNumberish) => {
  const [token0, token1] = tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];

  return getCreate2Address(
    uniV3FactoryAddress,
    keccak256(AbiCoder.defaultAbiCoder().encode(["address", "address", "uint24"], [token0, token1, fee])),
    INIT_CODE_V3_HASH,
  );
};

describe("ExecutorEncoder", () => {
  let encoder: ExecutorEncoder;

  let owner: SignerWithAddress;
  let hacker: SignerWithAddress;

  beforeEach(async () => {
    const signers = await ethers.getSigners();
    owner = signers[0]!;
    hacker = signers[1]!;

    const Executor = await ethers.getContractFactory("Executor");

    const executor = await Executor.deploy(owner.address);

    encoder = new ExecutorEncoder(await executor.getAddress(), owner);
  });

  it("should execute nothing", async () => {
    await encoder.exec();
  });

  it("should execute balancer flashloans", async () => {
    await encoder
      .balancerFlashLoan(balancerVaultAddress, [
        { asset: dai, amount: BigInt.WAD * 1_000_000n },
        { asset: weth, amount: BigInt.WAD * 1_000n },
      ])
      .exec();
  });

  it("should execute maker flashloan", async () => {
    await encoder.makerFlashLoan(makerVaultAddress, dai, BigInt.WAD * 1_000_000n).exec();
  });

  it("should execute aaveV2 flashloan", async () => {
    const requests = [
      { asset: dai, amount: BigInt.WAD * 1_000_000n },
      { asset: weth, amount: BigInt.WAD * 1_000n },
      { asset: usdc, amount: BigInt.pow10(6) * 1_000_000n },
    ];

    const premium = await AaveV2LendingPool__factory.connect(
      aaveV2PoolAddress,
      ethers.provider,
    ).FLASHLOAN_PREMIUM_TOTAL();

    for (const { asset, amount } of requests) await deal(asset, encoder.address, amount.percentMul(premium));

    await encoder.aaveV2FlashLoan(aaveV2PoolAddress, requests, premium).exec();
  });

  it("should execute aaveV3 flashloan", async () => {
    const requests = [
      { asset: dai, amount: BigInt.WAD * 1_000_000n },
      { asset: weth, amount: BigInt.WAD * 1_000n },
      { asset: usdc, amount: BigInt.pow10(6) * 1_000_000n },
    ];

    const premium = await AaveV3Pool__factory.connect(aaveV3PoolAddress, ethers.provider).FLASHLOAN_PREMIUM_TOTAL();

    for (const { asset, amount } of requests) await deal(asset, encoder.address, amount.percentMul(premium));

    await encoder.aaveV3FlashLoan(aaveV3PoolAddress, requests, premium).exec();
  });

  it("should execute uniV3 flashloan", async () => {
    const assets = [usdc, weth] as const;
    const amounts = [BigInt.pow10(6) * 1_000_000n, BigInt.WAD * 1_000n] as const;

    await deal(assets[0], encoder.address, amounts[0].mulDivUp(500n, 100_0000n));
    await deal(assets[1], encoder.address, amounts[1].mulDivUp(500n, 100_0000n));

    await encoder.uniV3FlashLoan(computeV3PoolAddress(usdc, weth, 500n), assets, amounts, 500n).exec();
  });

  it("should execute all flashloans", async () => {
    const assets = [usdc, weth] as const;
    const amounts = [BigInt.pow10(6) * 1_000_000n, BigInt.WAD * 1_000n] as const;

    const aaveV2Premium = await AaveV2LendingPool__factory.connect(
      aaveV2PoolAddress,
      ethers.provider,
    ).FLASHLOAN_PREMIUM_TOTAL();
    const aaveV3Premium = await AaveV3Pool__factory.connect(
      aaveV3PoolAddress,
      ethers.provider,
    ).FLASHLOAN_PREMIUM_TOTAL();

    await deal(
      assets[0],
      encoder.address,
      amounts[0].percentMul(aaveV2Premium) +
        amounts[0].percentMul(aaveV3Premium) +
        amounts[0].mulDivUp(500n, 100_0000n),
    );
    await deal(
      assets[1],
      encoder.address,
      amounts[1].percentMul(aaveV2Premium) +
        amounts[1].percentMul(aaveV3Premium) +
        amounts[1].mulDivUp(500n, 100_0000n),
    );

    const requests = [
      { asset: assets[0], amount: amounts[0] },
      { asset: assets[1], amount: amounts[1] },
    ];

    await encoder
      .balancerFlashLoan(balancerVaultAddress, requests)
      .makerFlashLoan(makerVaultAddress, dai, BigInt.WAD * 1_000_000n)
      .aaveV2FlashLoan(aaveV2PoolAddress, requests, aaveV2Premium)
      .aaveV3FlashLoan(aaveV3PoolAddress, requests, aaveV3Premium)
      .uniV3FlashLoan(computeV3PoolAddress(usdc, weth, 500n), assets, amounts, 500n)
      .exec();
  });

  it("should execute flashloan, unwrap & wrap", async () => {
    const amount = BigInt.WAD * 1_000n;

    await encoder
      .balancerFlashLoan(
        balancerVaultAddress,
        [{ asset: weth, amount }],
        encoder.unwrapETH(weth, amount).wrapETH(weth, amount).flush(),
      )
      .exec();
  });

  it("should execute flashloan, supply, borrow, unwrap, wrap, repay, withdraw", async () => {
    const collateralAmount = BigInt.WAD * 1_000_000n;
    const borrowedAmount = BigInt.WAD * 200n;

    await encoder
      .balancerFlashLoan(
        balancerVaultAddress,
        [{ asset: dai, amount: collateralAmount }],
        encoder
          .erc20Approve(dai, aaveV2PoolAddress, collateralAmount)
          .aaveV2Supply(aaveV2PoolAddress, dai, collateralAmount)
          .aaveV2Borrow(aaveV2PoolAddress, weth, borrowedAmount, 2)
          .unwrapETH(weth, borrowedAmount)
          .wrapETH(weth, borrowedAmount)
          .erc20Approve(weth, aaveV2PoolAddress, borrowedAmount)
          .aaveV2Repay(aaveV2PoolAddress, weth, borrowedAmount, 2)
          .aaveV2Withdraw(aaveV2PoolAddress, dai, MaxUint256)
          .flush(),
      )
      .exec();
  });

  it("should swap USDC for WETH via UniswapV3", async () => {
    const amountIn = 1000_000000n;

    await deal(usdc, encoder.address, amountIn);

    await encoder
      .erc20Approve(usdc, uniV3RouterAddress, amountIn)
      .uniV3ExactInput(
        uniV3RouterAddress,
        solidityPacked(["address", "uint24", "address"], [usdc, 500n, weth]),
        amountIn,
        0,
      )
      .exec();

    const wethBalance = await ERC20__factory.connect(weth, owner).balanceOf(encoder.executor);
    expect(wethBalance.toWadFloat()).to.be.greaterThan(0.025);
  });

  it("should swap sDAI for ETH via 1inch", async () => {
    const amountIn = 1000_000000n;

    await deal(usdc, encoder.address, amountIn);

    await encoder
      .erc20Approve(usdc, oneInchAddress, amountIn)
      .pushCall(
        oneInchAddress,
        0n,
        `0x07ed2379000000000000000000000000e37e799d5077682fa0a244d46e5649f71457bd09000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee000000000000000000000000e37e799d5077682fa0a244d46e5649f71457bd09${AbiCoder.defaultAbiCoder().encode(["address"], [encoder.address]).substring(2)}000000000000000000000000000000000000000000000000000000003b9aca00000000000000000000000000000000000000000000000000046d2bdd1d47d45800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000120000000000000000000000000000000000000000000000000000000000000017a00000000000000000000000000000000000000015c00014200012c0000f05132831bf48183b999fde45294b14b55199072f0801ba0b86991c6218b36c1d19d4a2e9eb0ce3606eb48004475d39ecb000000000000000000000000e37e799d5077682fa0a244d46e5649f71457bd090000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000276a4000000000000000000000000000000000000000000000000046d2bdd1d47d45800000000000000000000000000000000000000000000000000000000665191334101c02aaa39b223fe8d0a0e5c4f27ead9083c756cc200042e1a7d4d0000000000000000000000000000000000000000000000000000000000000000c061111111125421ca6dc452d289314280a0f8842a6500206b4be0b9111111125421ca6dc452d289314280a0f8842a65000000000000e70d93f7`,
      )
      .exec();

    const ethBalance = await ethers.provider.getBalance(encoder.address);
    expect(ethBalance.toWadFloat()).to.be.greaterThan(0.32);
  });

  it("should not trigger fallback via Balancer from unknown account", async () => {
    const balancerVault = BalancerVault__factory.connect(balancerVaultAddress, hacker);

    await expect(
      balancerVault.flashLoan(encoder.address, [dai], [BigInt.WAD * 1_000_000n], "0x"),
    ).to.be.revertedWithoutReason();
  });

  it("should not trigger fallback from unknown account", async () => {
    await expect(
      encoder.executor.connect(hacker).fallback!({
        data: ExecutorEncoder.buildErc20Transfer(dai, hacker.address, 1),
      }),
    ).to.be.revertedWithoutReason();
  });

  it("should not transfer without exec", async () => {
    await expect(encoder.executor.transfer(hacker.address, 1)).to.be.revertedWithoutReason();
  });
});
