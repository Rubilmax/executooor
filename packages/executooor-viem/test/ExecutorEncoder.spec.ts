import { SnapshotRestorer, takeSnapshot } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { viem } from "hardhat";
import { deal } from "hardhat-deal";

import { PublicClient, WalletClient } from "@nomicfoundation/hardhat-viem/types";
import {
  Address,
  encodeAbiParameters,
  encodePacked,
  erc20Abi,
  getCreate2Address,
  keccak256,
  maxUint256,
  parseUnits,
} from "viem";
import { ExecutorEncoder } from "../src/ExecutorEncoder";
import executorAbi from "../src/abi";
import {
  aaveV2PoolAddress,
  aaveV3PoolAddress,
  balancerVaultAddress,
  dai,
  makerVaultAddress,
  oneInchAddress,
  sDai,
  uniV2FactoryAddress,
  uniV3FactoryAddress,
  uniV3RouterAddress,
  usdc,
  weth,
} from "./helpers";

// V2

export const computeV2PoolAddress = (tokenA: Address, tokenB: Address, aIs0?: boolean) => {
  if (aIs0 == null) aIs0 = tokenA.toLowerCase() < tokenB.toLowerCase();

  const [token0Address, token1Address] = aIs0 ? [tokenA, tokenB] : [tokenB, tokenA];

  return getCreate2Address({
    from: uniV2FactoryAddress,
    salt: keccak256(encodePacked(["address", "address"], [token0Address, token1Address])),
    bytecodeHash: "0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f",
  });
};

// V3

export const INIT_CODE_V3_HASH = "0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54";

export const computeV3PoolAddress = (tokenA: Address, tokenB: Address, fee: number) => {
  const [token0, token1] = tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];

  return getCreate2Address({
    from: uniV3FactoryAddress,
    salt: keccak256(
      encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint24" }], [token0, token1, fee]),
    ),
    bytecodeHash: INIT_CODE_V3_HASH,
  });
};

describe("ExecutorEncoder", () => {
  let snapshot: SnapshotRestorer;

  let encoder: ExecutorEncoder;

  let client: PublicClient;
  let owner: WalletClient;
  let hacker: WalletClient;

  before(async () => {
    client = await viem.getPublicClient();

    const signers = await viem.getWalletClients();
    owner = signers[0]!;
    hacker = signers[1]!;

    const executor = await viem.deployContract("Executor", [owner.account.address]);

    encoder = new ExecutorEncoder(executor.address, owner);

    snapshot = await takeSnapshot();
  });

  afterEach(async () => {
    await snapshot.restore();
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

    const premium = await client.readContract({
      address: aaveV2PoolAddress,
      abi: [
        {
          inputs: [],
          name: "FLASHLOAN_PREMIUM_TOTAL",
          outputs: [{ name: "", type: "uint256" }],
          stateMutability: "view",
          type: "function",
        },
      ],
      functionName: "FLASHLOAN_PREMIUM_TOTAL",
    });

    for (const { asset, amount } of requests) await deal(asset, encoder.address, amount.percentMul(premium));

    await encoder.aaveFlashLoan(aaveV2PoolAddress, requests, premium).exec();
  });

  it("should execute aaveV3 flashloan", async () => {
    const requests = [
      { asset: dai, amount: BigInt.WAD * 1_000_000n },
      { asset: weth, amount: BigInt.WAD * 1_000n },
      { asset: usdc, amount: BigInt.pow10(6) * 1_000_000n },
    ];

    const premium = await client.readContract({
      address: aaveV3PoolAddress,
      abi: [
        {
          inputs: [],
          name: "FLASHLOAN_PREMIUM_TOTAL",
          outputs: [{ name: "", type: "uint256" }],
          stateMutability: "view",
          type: "function",
        },
      ],
      functionName: "FLASHLOAN_PREMIUM_TOTAL",
    });

    for (const { asset, amount } of requests) await deal(asset, encoder.address, amount.percentMul(premium));

    await encoder.aaveV3FlashLoan(aaveV3PoolAddress, requests, premium).exec();
  });

  it("should execute uniV3 flashloan", async () => {
    const assets = [usdc, weth] as const;
    const amounts = [BigInt.pow10(6) * 1_000_000n, BigInt.WAD * 1_000n] as const;

    await deal(assets[0], encoder.address, amounts[0].mulDivUp(500n, 100_0000n));
    await deal(assets[1], encoder.address, amounts[1].mulDivUp(500n, 100_0000n));

    await encoder.uniV3FlashLoan(computeV3PoolAddress(usdc, weth, 500), assets, amounts, 500n).exec();
  });

  it("should execute all flashloans", async () => {
    const assets = [usdc, weth] as const;
    const amounts = [BigInt.pow10(6) * 1_000_000n, BigInt.WAD * 1_000n] as const;

    const aaveV2Premium = await client.readContract({
      address: aaveV2PoolAddress,
      abi: [
        {
          inputs: [],
          name: "FLASHLOAN_PREMIUM_TOTAL",
          outputs: [{ name: "", type: "uint256" }],
          stateMutability: "view",
          type: "function",
        },
      ],
      functionName: "FLASHLOAN_PREMIUM_TOTAL",
    });
    const aaveV3Premium = await client.readContract({
      address: aaveV3PoolAddress,
      abi: [
        {
          inputs: [],
          name: "FLASHLOAN_PREMIUM_TOTAL",
          outputs: [{ name: "", type: "uint256" }],
          stateMutability: "view",
          type: "function",
        },
      ],
      functionName: "FLASHLOAN_PREMIUM_TOTAL",
    });

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
      .aaveFlashLoan(aaveV2PoolAddress, requests, aaveV2Premium)
      .aaveFlashLoan(aaveV3PoolAddress, requests, aaveV3Premium)
      .uniV3FlashLoan(computeV3PoolAddress(usdc, weth, 500), assets, amounts, 500n)
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
          .aaveSupply(aaveV2PoolAddress, dai, collateralAmount)
          .aaveBorrow(aaveV2PoolAddress, weth, borrowedAmount, 2n)
          .unwrapETH(weth, borrowedAmount)
          .wrapETH(weth, borrowedAmount)
          .erc20Approve(weth, aaveV2PoolAddress, borrowedAmount)
          .aaveRepay(aaveV2PoolAddress, weth, borrowedAmount, 2n)
          .aaveWithdraw(aaveV2PoolAddress, dai, maxUint256)
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
        encodePacked(["address", "uint24", "address"], [usdc, 500, weth]),
        amountIn,
        0n,
      )
      .exec();

    const wethBalance = await client.readContract({
      address: weth,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [encoder.address],
    });
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
        `0x07ed2379000000000000000000000000e37e799d5077682fa0a244d46e5649f71457bd09000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee000000000000000000000000e37e799d5077682fa0a244d46e5649f71457bd09${encodeAbiParameters([{ type: "address" }], [encoder.address]).substring(2)}000000000000000000000000000000000000000000000000000000003b9aca00000000000000000000000000000000000000000000000000046d2bdd1d47d45800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000120000000000000000000000000000000000000000000000000000000000000017a00000000000000000000000000000000000000015c00014200012c0000f05132831bf48183b999fde45294b14b55199072f0801ba0b86991c6218b36c1d19d4a2e9eb0ce3606eb48004475d39ecb000000000000000000000000e37e799d5077682fa0a244d46e5649f71457bd090000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000276a4000000000000000000000000000000000000000000000000046d2bdd1d47d45800000000000000000000000000000000000000000000000000000000665191334101c02aaa39b223fe8d0a0e5c4f27ead9083c756cc200042e1a7d4d0000000000000000000000000000000000000000000000000000000000000000c061111111125421ca6dc452d289314280a0f8842a6500206b4be0b9111111125421ca6dc452d289314280a0f8842a65000000000000e70d93f7`,
      )
      .exec();

    const ethBalance = await client.getBalance(encoder);
    expect(ethBalance.toWadFloat()).to.be.greaterThan(0.32);
  });

  it("should not trigger fallback via Balancer from unknown account", async () => {
    await expect(
      hacker.writeContract({
        address: balancerVaultAddress,
        abi: [
          {
            inputs: [
              { name: "recipient", type: "address" },
              { name: "tokens", type: "address[]" },
              { name: "amounts", type: "uint256[]" },
              { name: "userData", type: "bytes" },
            ],
            name: "flashLoan",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "flashLoan",
        args: [encoder.address, [dai], [BigInt.WAD * 1_000_000n], "0x"],
      }),
    ).to.be.rejected;
  });

  it("should not trigger fallback from unknown account", async () => {
    await expect(
      hacker.sendTransaction({
        to: encoder.address,
        data: ExecutorEncoder.buildErc20Transfer(dai, hacker.account.address, 1n),
      }),
    ).to.be.rejected;
  });

  it("should not transfer without exec", async () => {
    await expect(
      hacker.writeContract({
        address: encoder.address,
        abi: executorAbi,
        functionName: "transfer",
        args: [hacker.account.address, 1n],
      }),
    ).to.be.rejected;
  });

  it("should interact with sDAI as an ERC4626", async () => {
    const assets = parseUnits("1000", 18);

    await deal(dai, encoder.address, assets);

    await encoder
      .erc20Approve(dai, sDai, assets)
      .erc4626Deposit(sDai, assets / 2n, encoder.address)
      .erc4626Mint(sDai, assets / 4n, encoder.address)
      .erc4626Withdraw(sDai, assets / 4n, owner.account.address, encoder.address)
      .erc4626Redeem(sDai, assets / 8n, owner.account.address, encoder.address)
      .exec();

    const daiBalance = await client.readContract({
      address: dai,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner.account.address],
    });

    expect(daiBalance / BigInt.WAD).to.equal(385n);
  });
});
