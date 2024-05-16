import {
  AbiCoder,
  BigNumberish,
  BytesLike,
  ContractRunner,
  Numeric,
  ZeroAddress,
  keccak256,
  toBigInt,
  toUtf8Bytes,
} from "ethers";

import {
  CErc20__factory,
  AaveV2LendingPool__factory,
  AaveV3Pool__factory,
  WETH__factory,
  MorphoBlue__factory,
  MorphoAaveV3__factory,
  MorphoAaveV2__factory,
  MorphoCompound__factory,
  UniswapV2Router__factory,
  UniswapV3Router__factory,
  UniswapV3Pool__factory,
  IERC3156FlashLender__factory,
  ERC20__factory,
  BalancerVault__factory,
} from "ethers-types";
import { MarketParamsStruct } from "ethers-types/dist/protocols/morpho/blue/MorphoBlue";
import { Executor, Executor__factory } from "./types";
import { PayableOverrides } from "ethers-types/dist/common";

export type PromiseOrValue<T> = T | Promise<T>;

export interface AssetRequest {
  asset: string;
  amount: BigNumberish;
}

export class ExecutorEncoder {
  public static readonly EXECUTOR_IFC = Executor__factory.createInterface();
  public static readonly WETH_IFC = WETH__factory.createInterface();
  public static readonly ERC20_IFC = ERC20__factory.createInterface();
  public static readonly ERC3156_LENDER_IFC = IERC3156FlashLender__factory.createInterface();
  public static readonly BALANCER_VAULT_IFC = BalancerVault__factory.createInterface();
  public static readonly C_TOKEN_IFC = CErc20__factory.createInterface();
  public static readonly POOL_V2_IFC = AaveV2LendingPool__factory.createInterface();
  public static readonly POOL_V3_IFC = AaveV3Pool__factory.createInterface();
  public static readonly UNI_V3_POOL_IFC = UniswapV3Pool__factory.createInterface();
  public static readonly SWAP_ROUTER_V2_IFC = UniswapV2Router__factory.createInterface();
  public static readonly SWAP_ROUTER_V3_IFC = UniswapV3Router__factory.createInterface();
  public static readonly MORPHO_COMPOUND_IFC = MorphoCompound__factory.createInterface();
  public static readonly MORPHO_AAVE_V2_IFC = MorphoAaveV2__factory.createInterface();
  public static readonly MORPHO_AAVE_V3_IFC = MorphoAaveV3__factory.createInterface();
  public static readonly MORPHO_BLUE_IFC = MorphoBlue__factory.createInterface();

  static buildCall(
    target: string,
    value: BigNumberish,
    callData: BytesLike,
    fallbackDataIndex: Numeric = 2n ** 96n - 1n,
  ) {
    return ExecutorEncoder.EXECUTOR_IFC.encodeFunctionData("call_m08sKaj", [
      "0x" + fallbackDataIndex.toString(16).padStart(24, "0") + target.substring(2),
      value,
      callData,
    ]);
  }

  static buildErc20Approve(asset: string, recipient: string, amount: BigNumberish) {
    return ExecutorEncoder.buildCall(
      asset,
      0,
      ExecutorEncoder.ERC20_IFC.encodeFunctionData("approve", [recipient, amount]),
    );
  }

  static buildErc20Transfer(asset: string, recipient: string, amount: BigNumberish) {
    return ExecutorEncoder.buildCall(
      asset,
      0,
      ExecutorEncoder.ERC20_IFC.encodeFunctionData("transfer", [recipient, amount]),
    );
  }

  protected calls: string[] = [];

  public readonly executor: Executor;

  constructor(
    public readonly address: string,
    public readonly runner?: ContractRunner | null,
  ) {
    this.executor = Executor__factory.connect(address, runner);
  }

  pushCall(target: string, value: BigNumberish, callData: BytesLike, fallbackDataIndex: Numeric = 2n ** 96n - 1n) {
    this.calls.push(ExecutorEncoder.buildCall(target, value, callData, fallbackDataIndex));

    return this;
  }

  flush() {
    const calls = [...this.calls];

    this.calls = [];

    return calls;
  }

  async exec(overrides: PayableOverrides & { from?: PromiseOrValue<string> } = {}) {
    return this.executor.exec_606BaXt(this.flush(), overrides);
  }

  async populateExec(overrides: PayableOverrides & { from?: PromiseOrValue<string> } = {}) {
    return this.executor.exec_606BaXt.populateTransaction(this.flush(), overrides);
  }

  /* BASE */

  transfer(recipient: string, amount: BigNumberish) {
    if (recipient == ZeroAddress) throw Error("recipient should not be zero: use tip() instead");

    return this.pushCall(
      this.address,
      0,
      ExecutorEncoder.EXECUTOR_IFC.encodeFunctionData("transfer", [recipient, amount]),
    );
  }

  transferOwnership(newOwner: string) {
    return this.pushCall(
      this.address,
      0,
      ExecutorEncoder.EXECUTOR_IFC.encodeFunctionData("transferOwnership", [newOwner]),
    );
  }

  tip(amount: BigNumberish) {
    return this.pushCall(
      this.address,
      0,
      ExecutorEncoder.EXECUTOR_IFC.encodeFunctionData("transfer", [ZeroAddress, amount]),
    );
  }

  /* FLASHLOANS */

  balancerFlashLoan(balancerVaultAddress: string, requests: AssetRequest[], callbackCalls?: BytesLike[]) {
    callbackCalls ??= [];

    return this.pushCall(
      balancerVaultAddress,
      0,
      ExecutorEncoder.BALANCER_VAULT_IFC.encodeFunctionData("flashLoan", [
        this.address,
        requests.map(({ asset }) => asset),
        requests.map(({ amount }) => amount),
        AbiCoder.defaultAbiCoder().encode(
          ["bytes[]", "bytes"],
          [
            callbackCalls.concat(
              requests.map(({ asset, amount }) =>
                ExecutorEncoder.buildErc20Transfer(asset, balancerVaultAddress, amount),
              ),
            ),
            "0x",
          ],
        ),
      ]),
      3n, // receiveFlashLoan(address[],uint256[],uint256[],bytes)
    );
  }

  makerFlashLoan(makerVaultAddress: string, asset: string, amount: BigNumberish, callbackCalls?: BytesLike[]) {
    callbackCalls ??= [];

    return this.pushCall(
      makerVaultAddress,
      0,
      ExecutorEncoder.ERC3156_LENDER_IFC.encodeFunctionData("flashLoan", [
        this.address,
        asset,
        amount,
        AbiCoder.defaultAbiCoder().encode(
          ["bytes[]", "bytes"],
          [
            callbackCalls.concat([ExecutorEncoder.buildErc20Approve(asset, makerVaultAddress, amount)]),
            keccak256(toUtf8Bytes("ERC3156FlashBorrower.onFlashLoan")),
          ],
        ),
      ]),
      4n, // onFlashLoan(address,address,uint256,uint256,bytes)
    );
  }

  aaveV2FlashLoan(
    aaveV2PoolAddress: string,
    requests: AssetRequest[],
    premium: BigNumberish,
    callbackCalls?: BytesLike[],
  ) {
    callbackCalls ??= [];

    return this.pushCall(
      aaveV2PoolAddress,
      0,
      ExecutorEncoder.POOL_V2_IFC.encodeFunctionData("flashLoan", [
        this.address,
        requests.map(({ asset }) => asset),
        requests.map(({ amount }) => amount),
        requests.map(() => 0),
        this.address,
        AbiCoder.defaultAbiCoder().encode(
          ["bytes[]", "bytes"],
          [
            callbackCalls.concat(
              requests.map(({ asset, amount }) => {
                amount = toBigInt(amount);

                return ExecutorEncoder.buildErc20Approve(
                  asset,
                  aaveV2PoolAddress,
                  amount + amount.percentMul(toBigInt(premium)),
                );
              }),
            ),
            "0x0000000000000000000000000000000000000000000000000000000000000001",
          ],
        ),
        0,
      ]),
      4n, // executeOperation(address[],uint256[],uint256[],address,bytes)
    );
  }

  aaveV3FlashLoan(
    aaveV3PoolAddress: string,
    requests: AssetRequest[],
    premium: BigNumberish,
    callbackCalls?: BytesLike[],
  ) {
    callbackCalls ??= [];

    premium = toBigInt(premium);

    return this.pushCall(
      aaveV3PoolAddress,
      0,
      ExecutorEncoder.POOL_V3_IFC.encodeFunctionData("flashLoan", [
        this.address,
        requests.map(({ asset }) => asset),
        requests.map(({ amount }) => amount),
        requests.map(() => 0),
        this.address,
        AbiCoder.defaultAbiCoder().encode(
          ["bytes[]", "bytes"],
          [
            callbackCalls.concat(
              requests.map(({ asset, amount }) => {
                amount = toBigInt(amount);

                return ExecutorEncoder.buildErc20Approve(
                  asset,
                  aaveV3PoolAddress,
                  amount + amount.percentMul(toBigInt(premium)),
                );
              }),
            ),
            "0x0000000000000000000000000000000000000000000000000000000000000001",
          ],
        ),
        0,
      ]),
      4n, // executeOperation(address[],uint256[],uint256[],address,bytes)
    );
  }

  uniV2FlashSwap(
    pool: string,
    [asset0, asset1]: readonly [string, string],
    [amount0, amount1]: readonly [BigNumberish, BigNumberish],
    callbackCalls?: BytesLike[],
  ) {
    callbackCalls ??= [];

    amount0 = toBigInt(amount0);
    amount1 = toBigInt(amount1);

    // TODO: calculate fee and transfer it
    const fee0 = 0n;
    const fee1 = 0n;

    return this.pushCall(
      pool,
      0,
      ExecutorEncoder.UNI_V3_POOL_IFC.encodeFunctionData("flash", [
        this.address,
        amount0,
        amount1,
        AbiCoder.defaultAbiCoder().encode(
          ["bytes[]", "bytes"],
          [
            callbackCalls.concat([
              ExecutorEncoder.buildErc20Approve(asset0, pool, amount0 + fee0),
              ExecutorEncoder.buildErc20Approve(asset1, pool, amount1 + fee1),
            ]),
            "0x",
          ],
        ),
      ]),
      3n, // uniswapV2Call(address,uint256,uint256,bytes)
    );
  }

  uniV3FlashLoan(
    pool: string,
    [asset0, asset1]: readonly [string, string],
    [amount0, amount1]: readonly [BigNumberish, BigNumberish],
    fee: BigNumberish,
    callbackCalls?: BytesLike[],
  ) {
    callbackCalls ??= [];

    amount0 = toBigInt(amount0);
    amount1 = toBigInt(amount1);

    const fee0 = amount0.mulDivUp(toBigInt(fee), 100_0000n);
    const fee1 = amount1.mulDivUp(toBigInt(fee), 100_0000n);

    return this.pushCall(
      pool,
      0,
      ExecutorEncoder.UNI_V3_POOL_IFC.encodeFunctionData("flash", [
        this.address,
        amount0,
        amount1,
        AbiCoder.defaultAbiCoder().encode(
          ["bytes[]", "bytes"],
          [
            callbackCalls.concat([
              ExecutorEncoder.buildErc20Transfer(asset0, pool, amount0 + fee0),
              ExecutorEncoder.buildErc20Transfer(asset1, pool, amount1 + fee1),
            ]),
            "0x",
          ],
        ),
      ]),
      2n, // uniswapV3FlashCallback(uint256,uint256,bytes)
    );
  }

  blueFlashLoan(morphoBlueAddress: string, asset: string, amount: BigNumberish, callbackCalls?: BytesLike[]) {
    callbackCalls ??= [];

    return this.pushCall(
      morphoBlueAddress,
      0,
      ExecutorEncoder.MORPHO_BLUE_IFC.encodeFunctionData("flashLoan", [
        asset,
        amount,
        AbiCoder.defaultAbiCoder().encode(
          ["bytes[]", "bytes"],
          [callbackCalls.concat([ExecutorEncoder.buildErc20Approve(asset, morphoBlueAddress, amount)]), "0x"],
        ),
      ]),
      1n, // onMorphoFlashLoan(uint256,bytes)
    );
  }

  /* ERC20 */

  erc20Approve(asset: string, spender: string, allowance: BigNumberish) {
    return this.pushCall(asset, 0, ExecutorEncoder.ERC20_IFC.encodeFunctionData("approve", [spender, allowance]));
  }

  erc20Transfer(asset: string, recipient: string, amount: BigNumberish) {
    return this.pushCall(asset, 0, ExecutorEncoder.ERC20_IFC.encodeFunctionData("transfer", [recipient, amount]));
  }

  erc20TransferFrom(asset: string, owner: string, recipient: string, amount: BigNumberish) {
    return this.pushCall(
      asset,
      0,
      ExecutorEncoder.ERC20_IFC.encodeFunctionData("transferFrom", [owner, recipient, amount]),
    );
  }

  wrapETH(weth: string, amount: BigNumberish) {
    return this.pushCall(weth, amount, ExecutorEncoder.WETH_IFC.encodeFunctionData("deposit"));
  }

  unwrapETH(weth: string, amount: BigNumberish) {
    return this.pushCall(weth, 0, ExecutorEncoder.WETH_IFC.encodeFunctionData("withdraw", [amount]));
  }

  /* COMPOUND */

  compoundSupply(cToken: string, amount: BigNumberish) {
    return this.pushCall(cToken, 0, ExecutorEncoder.C_TOKEN_IFC.encodeFunctionData("mint", [amount]));
  }

  compoundBorrow(cToken: string, amount: BigNumberish) {
    return this.pushCall(cToken, 0, ExecutorEncoder.C_TOKEN_IFC.encodeFunctionData("borrow", [amount]));
  }

  compoundRepay(cToken: string, amount: BigNumberish, onBehalfOf?: string) {
    if (onBehalfOf)
      return this.pushCall(
        cToken,
        0,
        ExecutorEncoder.C_TOKEN_IFC.encodeFunctionData("repayBorrowBehalf", [onBehalfOf, amount]),
      );

    return this.pushCall(cToken, 0, ExecutorEncoder.C_TOKEN_IFC.encodeFunctionData("repayBorrow", [amount]));
  }

  compoundWithdraw(cToken: string, amount: BigNumberish) {
    return this.pushCall(cToken, 0, ExecutorEncoder.C_TOKEN_IFC.encodeFunctionData("redeemUnderlying", [amount]));
  }

  /* AAVE V2 */

  aaveV2Supply(aaveV2PoolAddress: string, asset: string, amount: BigNumberish, onBehalfOf?: string) {
    onBehalfOf ||= this.address;

    return this.pushCall(
      aaveV2PoolAddress,
      0,
      ExecutorEncoder.POOL_V2_IFC.encodeFunctionData("deposit", [asset, amount, onBehalfOf!, 0]),
    );
  }

  aaveV2Borrow(
    aaveV2PoolAddress: string,
    asset: string,
    amount: BigNumberish,
    interestRateMode: BigNumberish,
    onBehalfOf?: string,
  ) {
    onBehalfOf ||= this.address;

    return this.pushCall(
      aaveV2PoolAddress,
      0,
      ExecutorEncoder.POOL_V2_IFC.encodeFunctionData("borrow", [asset, amount, interestRateMode, 0, onBehalfOf!]),
    );
  }

  aaveV2Repay(
    aaveV2PoolAddress: string,
    asset: string,
    amount: BigNumberish,
    interestRateMode: BigNumberish,
    onBehalfOf?: string,
  ) {
    onBehalfOf ||= this.address;

    return this.pushCall(
      aaveV2PoolAddress,
      0,
      ExecutorEncoder.POOL_V2_IFC.encodeFunctionData("repay", [asset, amount, interestRateMode, onBehalfOf!]),
    );
  }

  aaveV2Withdraw(aaveV2PoolAddress: string, asset: string, amount: BigNumberish, to?: string) {
    to ||= this.address;

    return this.pushCall(
      aaveV2PoolAddress,
      0,
      ExecutorEncoder.POOL_V2_IFC.encodeFunctionData("withdraw", [asset, amount, to!]),
    );
  }

  /* AAVE V2 AMM */

  aaveV2AmmSupply(aaveV2AmmPoolAddress: string, asset: string, amount: BigNumberish, onBehalfOf?: string) {
    onBehalfOf ||= this.address;

    return this.pushCall(
      aaveV2AmmPoolAddress,
      0,
      ExecutorEncoder.POOL_V2_IFC.encodeFunctionData("deposit", [asset, amount, onBehalfOf!, 0]),
    );
  }

  aaveV2AmmBorrow(
    aaveV2AmmPoolAddress: string,
    asset: string,
    amount: BigNumberish,
    interestRateMode: BigNumberish,
    onBehalfOf?: string,
  ) {
    onBehalfOf ||= this.address;

    return this.pushCall(
      aaveV2AmmPoolAddress,
      0,
      ExecutorEncoder.POOL_V2_IFC.encodeFunctionData("borrow", [asset, amount, interestRateMode, 0, onBehalfOf!]),
    );
  }

  aaveV2AmmRepay(
    aaveV2AmmPoolAddress: string,
    asset: string,
    amount: BigNumberish,
    interestRateMode: BigNumberish,
    onBehalfOf?: string,
  ) {
    onBehalfOf ||= this.address;

    return this.pushCall(
      aaveV2AmmPoolAddress,
      0,
      ExecutorEncoder.POOL_V2_IFC.encodeFunctionData("repay", [asset, amount, interestRateMode, onBehalfOf!]),
    );
  }

  aaveV2AmmWithdraw(aaveV2AmmPoolAddress: string, asset: string, amount: BigNumberish, to?: string) {
    to ||= this.address;

    return this.pushCall(
      aaveV2AmmPoolAddress,
      0,
      ExecutorEncoder.POOL_V2_IFC.encodeFunctionData("withdraw", [asset, amount, to!]),
    );
  }

  aaveV2AmmLiquidate(
    aaveV2AmmPoolAddress: string,
    collateral: string,
    debt: string,
    user: string,
    amount: BigNumberish,
  ) {
    return this.pushCall(
      aaveV2AmmPoolAddress,
      0,
      ExecutorEncoder.POOL_V2_IFC.encodeFunctionData("liquidationCall", [collateral, debt, user, amount, false]),
    );
  }

  /* AAVE V3 */

  aaveV3Supply(aaveV3PoolAddress: string, asset: string, amount: BigNumberish, onBehalfOf?: string) {
    onBehalfOf ||= this.address;

    return this.pushCall(
      aaveV3PoolAddress,
      0,
      ExecutorEncoder.POOL_V3_IFC.encodeFunctionData("deposit", [asset, amount, onBehalfOf!, 0]),
    );
  }

  aaveV3Borrow(
    aaveV3PoolAddress: string,
    asset: string,
    amount: BigNumberish,
    interestRateMode: BigNumberish,
    onBehalfOf?: string,
  ) {
    onBehalfOf ||= this.address;

    return this.pushCall(
      aaveV3PoolAddress,
      0,
      ExecutorEncoder.POOL_V3_IFC.encodeFunctionData("borrow", [asset, amount, interestRateMode, 0, onBehalfOf!]),
    );
  }

  aaveV3Repay(
    aaveV3PoolAddress: string,
    asset: string,
    amount: BigNumberish,
    interestRateMode: BigNumberish,
    onBehalfOf?: string,
  ) {
    onBehalfOf ||= this.address;

    return this.pushCall(
      aaveV3PoolAddress,
      0,
      ExecutorEncoder.POOL_V3_IFC.encodeFunctionData("repay", [asset, amount, interestRateMode, onBehalfOf!]),
    );
  }

  aaveV3Withdraw(aaveV3PoolAddress: string, asset: string, amount: BigNumberish, to?: string) {
    to ||= this.address;

    return this.pushCall(
      aaveV3PoolAddress,
      0,
      ExecutorEncoder.POOL_V3_IFC.encodeFunctionData("withdraw", [asset, amount, to!]),
    );
  }

  /* UNISWAP V3 */

  uniV3ExactInput(
    uniV3RouterAddress: string,
    path: string,
    amountIn: BigNumberish,
    amountOutMinimum: BigNumberish,
    recipient?: string,
  ) {
    recipient ||= this.address;

    return this.pushCall(
      uniV3RouterAddress,
      0,
      ExecutorEncoder.SWAP_ROUTER_V3_IFC.encodeFunctionData("exactInput", [
        {
          path,
          recipient: recipient!,
          deadline: Math.ceil(Date.now() / 1000) + 90,
          amountIn,
          amountOutMinimum,
        },
      ]),
    );
  }

  uniV3ExactOutput(
    uniV3RouterAddress: string,
    path: string,
    amountOut: BigNumberish,
    amountInMaximum: BigNumberish,
    recipient?: string,
  ) {
    recipient ||= this.address;

    return this.pushCall(
      uniV3RouterAddress,
      0,
      ExecutorEncoder.SWAP_ROUTER_V3_IFC.encodeFunctionData("exactOutput", [
        {
          path,
          recipient: recipient!,
          deadline: Math.ceil(Date.now() / 1000) + 90,
          amountOut,
          amountInMaximum,
        },
      ]),
    );
  }

  /* LIQUIDATION */

  morphoCompoundLiquidate(
    morphoCompoundAddress: string,
    borrowedPoolToken: string,
    collateralPoolToken: string,
    borrower: string,
    amount: BigNumberish,
  ) {
    return this.pushCall(
      morphoCompoundAddress,
      0,
      ExecutorEncoder.MORPHO_COMPOUND_IFC.encodeFunctionData("liquidate", [
        borrowedPoolToken,
        collateralPoolToken,
        borrower,
        amount,
      ]),
    );
  }

  morphoAaveV2Liquidate(
    morphoAaveV2Address: string,
    borrowedPoolToken: string,
    collateralPoolToken: string,
    borrower: string,
    amount: BigNumberish,
  ) {
    return this.pushCall(
      morphoAaveV2Address,
      0,
      ExecutorEncoder.MORPHO_AAVE_V2_IFC.encodeFunctionData("liquidate", [
        borrowedPoolToken,
        collateralPoolToken,
        borrower,
        amount,
      ]),
    );
  }

  morphoAaveV3Liquidate(
    morphoAaveV3Address: string,
    underlyingBorrowed: string,
    underlyingCollateral: string,
    borrower: string,
    amount: BigNumberish,
  ) {
    return this.pushCall(
      morphoAaveV3Address,
      0,
      ExecutorEncoder.MORPHO_AAVE_V3_IFC.encodeFunctionData("liquidate", [
        underlyingBorrowed,
        underlyingCollateral,
        borrower,
        amount,
      ]),
    );
  }

  blueLiquidate(
    morphoBlueAddress: string,
    market: MarketParamsStruct,
    borrower: string,
    seizedAssets: BigNumberish,
    repaidShares: BigNumberish,
    callbackCalls?: string[],
  ) {
    callbackCalls ??= [];

    return this.pushCall(
      morphoBlueAddress,
      0,
      ExecutorEncoder.MORPHO_BLUE_IFC.encodeFunctionData("liquidate", [
        market,
        borrower,
        seizedAssets,
        repaidShares,
        AbiCoder.defaultAbiCoder().encode(["bytes[]", "bytes"], [callbackCalls, "0x"]),
      ]),
      1n, // onMorphoLiquidate(uint256,bytes)
    );
  }
}
