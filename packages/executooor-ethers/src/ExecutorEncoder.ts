import "evm-maths";

import {
  AbiCoder,
  BigNumberish,
  BytesLike,
  ContractRunner,
  ZeroAddress,
  keccak256,
  toBigInt,
  toUtf8Bytes,
} from "ethers";
import {
  AaveV2LendingPool__factory,
  AaveV3Pool__factory,
  BalancerVault__factory,
  CErc20__factory,
  ERC20Wrapper__factory,
  ERC20__factory,
  ERC4626__factory,
  IERC3156FlashLender__factory,
  MorphoAaveV2__factory,
  MorphoAaveV3__factory,
  MorphoBlue__factory,
  MorphoCompound__factory,
  UniswapV2Router__factory,
  UniswapV3Pool__factory,
  UniswapV3Router__factory,
  WETH__factory,
} from "ethers-types";
import { PayableOverrides } from "ethers-types/dist/common";
import { MarketParamsStruct } from "ethers-types/dist/protocols/morpho/blue/MorphoBlue";

import { Executor, Executor__factory } from "./types";
import { PlaceholderStruct } from "./types/Executor";

export type PromiseOrValue<T> = T | Promise<T>;

export interface AssetRequest {
  asset: string;
  amount: BigNumberish;
}

export interface CallbackContext {
  sender: string;
  dataIndex: BigNumberish;
}

export class ExecutorEncoder {
  public static readonly EXECUTOR_IFC = Executor__factory.createInterface();
  public static readonly WETH_IFC = WETH__factory.createInterface();
  public static readonly ERC20_IFC = ERC20__factory.createInterface();
  public static readonly ERC20_WRAPPER_IFC = ERC20Wrapper__factory.createInterface();
  public static readonly ERC4626_IFC = ERC4626__factory.createInterface();
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
    context: CallbackContext = { sender: ZeroAddress, dataIndex: 0n },
    placeholders: PlaceholderStruct[] = [],
  ) {
    const encodedContext = "0x" + context.dataIndex.toString(16).padStart(24, "0") + context.sender.substring(2);

    if (placeholders.length > 0)
      return ExecutorEncoder.EXECUTOR_IFC.encodeFunctionData("callWithPlaceholders4845164670", [
        target,
        value,
        encodedContext,
        callData,
        placeholders,
      ]);

    return ExecutorEncoder.EXECUTOR_IFC.encodeFunctionData("call_g0oyU7o", [target, value, encodedContext, callData]);
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

  protected totalValue = 0n;
  protected calls: string[] = [];

  public readonly executor: Executor;

  constructor(
    public readonly address: string,
    runner?: ContractRunner | null,
  ) {
    this.executor = Executor__factory.connect(address, runner);
  }

  get runner() {
    const { runner } = this.executor;

    if (!runner) throw Error("runner not available");

    return runner;
  }

  pushCall(
    target: string,
    value: bigint,
    callData: BytesLike,
    context?: CallbackContext,
    placeholders?: PlaceholderStruct[],
  ) {
    this.totalValue += value;
    this.calls.push(ExecutorEncoder.buildCall(target, value, callData, context, placeholders));

    return this;
  }

  flush() {
    const calls = [...this.calls];

    this.totalValue = 0n;
    this.calls = [];

    return calls;
  }

  async exec(overrides: PayableOverrides & { from?: PromiseOrValue<string> } = {}) {
    const { totalValue } = this;
    const { value } = overrides;

    return await this.executor.exec_606BaXt(this.flush(), {
      ...overrides,
      value: totalValue + toBigInt(value ?? 0n),
    });
  }

  async populateExec(overrides: PayableOverrides & { from?: PromiseOrValue<string> } = {}) {
    const { totalValue } = this;
    const { value } = overrides;

    return await this.executor.exec_606BaXt.populateTransaction(this.flush(), {
      ...overrides,
      value: totalValue + toBigInt(value ?? 0n),
    });
  }

  /* BASE */

  transfer(recipient: string, amount: BigNumberish) {
    if (recipient === ZeroAddress) throw Error("recipient should not be zero: use tip() instead");

    return this.pushCall(
      this.address,
      0n,
      ExecutorEncoder.EXECUTOR_IFC.encodeFunctionData("transfer", [recipient, amount]),
    );
  }

  tip(amount: BigNumberish) {
    return this.pushCall(
      this.address,
      0n,
      ExecutorEncoder.EXECUTOR_IFC.encodeFunctionData("transfer", [ZeroAddress, amount]),
    );
  }

  /* FLASHLOANS */

  balancerFlashLoan(balancerVaultAddress: string, requests: AssetRequest[], callbackCalls?: BytesLike[]) {
    callbackCalls ??= [];

    return this.pushCall(
      balancerVaultAddress,
      0n,
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
      {
        sender: balancerVaultAddress,
        dataIndex: 3n, // receiveFlashLoan(address[],uint256[],uint256[],bytes)
      },
    );
  }

  makerFlashLoan(makerVaultAddress: string, asset: string, amount: BigNumberish, callbackCalls?: BytesLike[]) {
    callbackCalls ??= [];

    return this.pushCall(
      makerVaultAddress,
      0n,
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
      {
        sender: makerVaultAddress,
        dataIndex: 4n, // onFlashLoan(address,address,uint256,uint256,bytes)
      },
    );
  }

  aaveFlashLoan(aavePoolAddress: string, requests: AssetRequest[], premium: BigNumberish, callbackCalls?: BytesLike[]) {
    callbackCalls ??= [];

    return this.pushCall(
      aavePoolAddress,
      0n,
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
                  aavePoolAddress,
                  amount + amount.percentMul(toBigInt(premium)),
                );
              }),
            ),
            "0x0000000000000000000000000000000000000000000000000000000000000001",
          ],
        ),
        0,
      ]),
      {
        sender: aavePoolAddress,
        dataIndex: 4n, // executeOperation(address[],uint256[],uint256[],address,bytes)
      },
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
      0n,
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
      {
        sender: pool,
        dataIndex: 3n, // uniswapV2Call(address,uint256,uint256,bytes)
      },
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
      0n,
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
      {
        sender: pool,
        dataIndex: 2n, // uniswapV3FlashCallback(uint256,uint256,bytes)
      },
    );
  }

  blueFlashLoan(morphoBlueAddress: string, asset: string, amount: BigNumberish, callbackCalls?: BytesLike[]) {
    callbackCalls ??= [];

    return this.pushCall(
      morphoBlueAddress,
      0n,
      ExecutorEncoder.MORPHO_BLUE_IFC.encodeFunctionData("flashLoan", [
        asset,
        amount,
        AbiCoder.defaultAbiCoder().encode(
          ["bytes[]", "bytes"],
          [callbackCalls.concat([ExecutorEncoder.buildErc20Approve(asset, morphoBlueAddress, amount)]), "0x"],
        ),
      ]),
      {
        sender: morphoBlueAddress,
        dataIndex: 1n, // onMorphoFlashLoan(uint256,bytes)
      },
    );
  }

  /* ERC20 */

  erc20BalanceOf(asset: string, owner: string, offset: BigNumberish) {
    return {
      to: asset,
      data: ExecutorEncoder.ERC20_IFC.encodeFunctionData("balanceOf", [owner]),
      offset,
      length: 32,
      resOffset: 0,
    };
  }

  erc20Approve(asset: string, spender: string, allowance: BigNumberish) {
    return this.pushCall(asset, 0n, ExecutorEncoder.ERC20_IFC.encodeFunctionData("approve", [spender, allowance]));
  }

  erc20Transfer(asset: string, recipient: string, amount: BigNumberish) {
    return this.pushCall(asset, 0n, ExecutorEncoder.ERC20_IFC.encodeFunctionData("transfer", [recipient, amount]));
  }

  erc20TransferFrom(asset: string, owner: string, recipient: string, amount: BigNumberish) {
    return this.pushCall(
      asset,
      0n,
      ExecutorEncoder.ERC20_IFC.encodeFunctionData("transferFrom", [owner, recipient, amount]),
    );
  }

  erc20Skim(asset: string, recipient: string) {
    return this.pushCall(
      asset,
      0n,
      ExecutorEncoder.ERC20_IFC.encodeFunctionData("transfer", [recipient, 0n]),
      undefined,
      [this.erc20BalanceOf(asset, this.address, 4 + 32)],
    );
  }

  /* WETH */

  wrapETH(weth: string, amount: BigNumberish) {
    return this.pushCall(weth, toBigInt(amount), ExecutorEncoder.WETH_IFC.encodeFunctionData("deposit"));
  }

  unwrapETH(weth: string, amount: BigNumberish) {
    return this.pushCall(weth, 0n, ExecutorEncoder.WETH_IFC.encodeFunctionData("withdraw", [amount]));
  }

  /* ERC20 Wrappers */

  erc20WrapperDepositFor(asset: string, onBehalf: string, amount: BigNumberish) {
    return this.pushCall(
      asset,
      0n,
      ExecutorEncoder.ERC20_WRAPPER_IFC.encodeFunctionData("depositFor", [onBehalf, amount]),
    );
  }

  erc20WrapperWithdrawTo(asset: string, receiver: string, amount: BigNumberish) {
    return this.pushCall(
      asset,
      0n,
      ExecutorEncoder.ERC20_WRAPPER_IFC.encodeFunctionData("withdrawTo", [receiver, amount]),
    );
  }

  /* ERC4626 */

  erc4626Deposit(vault: string, assets: BigNumberish, owner: string) {
    return this.pushCall(vault, 0n, ExecutorEncoder.ERC4626_IFC.encodeFunctionData("deposit", [assets, owner]));
  }

  erc4626Mint(vault: string, shares: BigNumberish, owner: string) {
    return this.pushCall(vault, 0n, ExecutorEncoder.ERC4626_IFC.encodeFunctionData("mint", [shares, owner]));
  }

  erc4626Withdraw(vault: string, assets: BigNumberish, receiver: string, owner: string) {
    return this.pushCall(
      vault,
      0n,
      ExecutorEncoder.ERC4626_IFC.encodeFunctionData("withdraw", [assets, receiver, owner]),
    );
  }

  erc4626Redeem(vault: string, shares: BigNumberish, receiver: string, owner: string) {
    return this.pushCall(
      vault,
      0n,
      ExecutorEncoder.ERC4626_IFC.encodeFunctionData("redeem", [shares, receiver, owner]),
    );
  }

  /* COMPOUND */

  compoundSupply(cToken: string, amount: BigNumberish) {
    return this.pushCall(cToken, 0n, ExecutorEncoder.C_TOKEN_IFC.encodeFunctionData("mint", [amount]));
  }

  compoundBorrow(cToken: string, amount: BigNumberish) {
    return this.pushCall(cToken, 0n, ExecutorEncoder.C_TOKEN_IFC.encodeFunctionData("borrow", [amount]));
  }

  compoundRepay(cToken: string, amount: BigNumberish, onBehalfOf?: string) {
    if (onBehalfOf)
      return this.pushCall(
        cToken,
        0n,
        ExecutorEncoder.C_TOKEN_IFC.encodeFunctionData("repayBorrowBehalf", [onBehalfOf, amount]),
      );

    return this.pushCall(cToken, 0n, ExecutorEncoder.C_TOKEN_IFC.encodeFunctionData("repayBorrow", [amount]));
  }

  compoundWithdraw(cToken: string, amount: BigNumberish) {
    return this.pushCall(cToken, 0n, ExecutorEncoder.C_TOKEN_IFC.encodeFunctionData("redeemUnderlying", [amount]));
  }

  /* AAVE V2 */

  aaveSupply(aavePoolAddress: string, asset: string, amount: BigNumberish, onBehalfOf?: string) {
    onBehalfOf ||= this.address;

    return this.pushCall(
      aavePoolAddress,
      0n,
      ExecutorEncoder.POOL_V2_IFC.encodeFunctionData("deposit", [asset, amount, onBehalfOf, 0]),
    );
  }

  aaveBorrow(
    aavePoolAddress: string,
    asset: string,
    amount: BigNumberish,
    interestRateMode: BigNumberish,
    onBehalfOf?: string,
  ) {
    onBehalfOf ||= this.address;

    return this.pushCall(
      aavePoolAddress,
      0n,
      ExecutorEncoder.POOL_V2_IFC.encodeFunctionData("borrow", [asset, amount, interestRateMode, 0, onBehalfOf]),
    );
  }

  aaveRepay(
    aavePoolAddress: string,
    asset: string,
    amount: BigNumberish,
    interestRateMode: BigNumberish,
    onBehalfOf?: string,
  ) {
    onBehalfOf ||= this.address;

    return this.pushCall(
      aavePoolAddress,
      0n,
      ExecutorEncoder.POOL_V2_IFC.encodeFunctionData("repay", [asset, amount, interestRateMode, onBehalfOf]),
    );
  }

  aaveWithdraw(aavePoolAddress: string, asset: string, amount: BigNumberish, to?: string) {
    to ||= this.address;

    return this.pushCall(
      aavePoolAddress,
      0n,
      ExecutorEncoder.POOL_V2_IFC.encodeFunctionData("withdraw", [asset, amount, to]),
    );
  }

  aaveLiquidate(aavePoolAddress: string, collateral: string, debt: string, user: string, amount: BigNumberish) {
    return this.pushCall(
      aavePoolAddress,
      0n,
      ExecutorEncoder.POOL_V2_IFC.encodeFunctionData("liquidationCall", [collateral, debt, user, amount, false]),
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
      0n,
      ExecutorEncoder.SWAP_ROUTER_V3_IFC.encodeFunctionData("exactInput", [
        {
          path,
          recipient,
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
      0n,
      ExecutorEncoder.SWAP_ROUTER_V3_IFC.encodeFunctionData("exactOutput", [
        {
          path,
          recipient,
          deadline: Math.ceil(Date.now() / 1000) + 90,
          amountOut,
          amountInMaximum,
        },
      ]),
    );
  }

  /* MORPHO */

  morphoCompoundLiquidate(
    morphoCompoundAddress: string,
    borrowedPoolToken: string,
    collateralPoolToken: string,
    borrower: string,
    amount: BigNumberish,
  ) {
    return this.pushCall(
      morphoCompoundAddress,
      0n,
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
      0n,
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
      0n,
      ExecutorEncoder.MORPHO_AAVE_V3_IFC.encodeFunctionData("liquidate", [
        underlyingBorrowed,
        underlyingCollateral,
        borrower,
        amount,
      ]),
    );
  }

  morphoBlueSupplyCollateral(
    morphoBlueAddress: string,
    market: MarketParamsStruct,
    collateral: BigNumberish,
    onBehalf: string,
    callbackCalls?: string[],
  ) {
    callbackCalls ??= [];

    return this.pushCall(
      morphoBlueAddress,
      0n,
      ExecutorEncoder.MORPHO_BLUE_IFC.encodeFunctionData("supplyCollateral", [
        market,
        collateral,
        onBehalf,
        AbiCoder.defaultAbiCoder().encode(["bytes[]", "bytes"], [callbackCalls, "0x"]),
      ]),
      {
        sender: morphoBlueAddress,
        dataIndex: 1n, // onMorphoSupplyCollateral(uint256,bytes)
      },
    );
  }

  morphoBlueWithdrawCollateral(
    morphoBlueAddress: string,
    market: MarketParamsStruct,
    collateral: BigNumberish,
    onBehalf: string,
    receiver: string,
  ) {
    return this.pushCall(
      morphoBlueAddress,
      0n,
      ExecutorEncoder.MORPHO_BLUE_IFC.encodeFunctionData("withdrawCollateral", [
        market,
        collateral,
        onBehalf,
        receiver,
      ]),
    );
  }

  morphoBlueSupply(
    morphoBlueAddress: string,
    market: MarketParamsStruct,
    assets: BigNumberish,
    shares: BigNumberish,
    onBehalf: string,
    callbackCalls?: string[],
  ) {
    callbackCalls ??= [];

    return this.pushCall(
      morphoBlueAddress,
      0n,
      ExecutorEncoder.MORPHO_BLUE_IFC.encodeFunctionData("supply", [
        market,
        assets,
        shares,
        onBehalf,
        AbiCoder.defaultAbiCoder().encode(["bytes[]", "bytes"], [callbackCalls, "0x"]),
      ]),
      {
        sender: morphoBlueAddress,
        dataIndex: 1n, // onMorphoSupply(uint256,bytes)
      },
    );
  }

  morphoBlueWithdraw(
    morphoBlueAddress: string,
    market: MarketParamsStruct,
    assets: BigNumberish,
    shares: BigNumberish,
    onBehalf: string,
    receiver: string,
  ) {
    return this.pushCall(
      morphoBlueAddress,
      0n,
      ExecutorEncoder.MORPHO_BLUE_IFC.encodeFunctionData("withdraw", [market, assets, shares, onBehalf, receiver]),
    );
  }

  morphoBlueRepay(
    morphoBlueAddress: string,
    market: MarketParamsStruct,
    assets: BigNumberish,
    shares: BigNumberish,
    onBehalf: string,
    callbackCalls?: string[],
  ) {
    callbackCalls ??= [];

    return this.pushCall(
      morphoBlueAddress,
      0n,
      ExecutorEncoder.MORPHO_BLUE_IFC.encodeFunctionData("repay", [
        market,
        assets,
        shares,
        onBehalf,
        AbiCoder.defaultAbiCoder().encode(["bytes[]", "bytes"], [callbackCalls, "0x"]),
      ]),
      {
        sender: morphoBlueAddress,
        dataIndex: 1n, // onMorphoRepay(uint256,bytes)
      },
    );
  }

  morphoBlueBorrow(
    morphoBlueAddress: string,
    market: MarketParamsStruct,
    assets: BigNumberish,
    shares: BigNumberish,
    onBehalf: string,
    receiver: string,
  ) {
    return this.pushCall(
      morphoBlueAddress,
      0n,
      ExecutorEncoder.MORPHO_BLUE_IFC.encodeFunctionData("borrow", [market, assets, shares, onBehalf, receiver]),
    );
  }

  morphoBlueLiquidate(
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
      0n,
      ExecutorEncoder.MORPHO_BLUE_IFC.encodeFunctionData("liquidate", [
        market,
        borrower,
        seizedAssets,
        repaidShares,
        AbiCoder.defaultAbiCoder().encode(["bytes[]", "bytes"], [callbackCalls, "0x"]),
      ]),
      {
        sender: morphoBlueAddress,
        dataIndex: 1n, // onMorphoLiquidate(uint256,bytes)
      },
    );
  }
}
