import "evm-maths";
import {
  Account,
  Address,
  Chain,
  Client,
  Hex,
  Transport,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  erc4626Abi,
  keccak256,
  stringToBytes,
  zeroAddress,
} from "viem";
import { writeContract } from "viem/actions";
import executorAbi from "./abi";

export type PromiseOrValue<T> = T | Promise<T>;

export interface AssetRequest {
  asset: Address;
  amount: bigint;
}

export interface CallbackContext {
  sender: Address;
  dataIndex: bigint;
}

export interface MarketParams {
  collateralToken: Address;
  loanToken: Address;
  irm: Address;
  oracle: Address;
  lltv: bigint;
}

export class ExecutorEncoder {
  static buildCall(
    target: Address,
    value: bigint,
    callData: Hex,
    context: CallbackContext = { sender: zeroAddress, dataIndex: 0n },
  ) {
    return encodeFunctionData({
      abi: executorAbi,
      functionName: "call_g0oyU7o",
      args: [
        target,
        value,
        `0x${context.dataIndex.toString(16).padStart(24, "0") + context.sender.substring(2)}`,
        callData,
      ],
    });
  }

  static buildErc20Approve(asset: Address, recipient: Address, amount: bigint) {
    return ExecutorEncoder.buildCall(
      asset,
      0n,
      encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [recipient, amount] }),
    );
  }

  static buildErc20Transfer(asset: Address, recipient: Address, amount: bigint) {
    return ExecutorEncoder.buildCall(
      asset,
      0n,
      encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, amount] }),
    );
  }

  protected totalValue = 0n;
  protected calls: Hex[] = [];

  constructor(
    public readonly address: Address,
    public readonly client: Client<Transport, Chain | undefined, Account>,
  ) {}

  pushCall(target: Address, value: bigint, callData: Hex, context?: CallbackContext) {
    this.totalValue += value;
    this.calls.push(ExecutorEncoder.buildCall(target, value, callData, context));

    return this;
  }

  flush() {
    const calls = [...this.calls];

    this.totalValue = 0n;
    this.calls = [];

    return calls;
  }

  async exec(value = 0n) {
    const { address, totalValue, client } = this;

    value += totalValue;

    return await writeContract(client, {
      chain: client.chain,
      account: client.account,
      address,
      abi: executorAbi,
      functionName: "exec_606BaXt",
      args: [this.flush()],
      value,
    });
  }

  async encodeExec(value = 0n) {
    const { address, totalValue } = this;

    value += totalValue;

    return {
      to: address,
      data: encodeFunctionData({ abi: executorAbi, functionName: "exec_606BaXt", args: [this.flush()] }),
      value,
    };
  }

  /* BASE */

  transfer(recipient: Address, amount: bigint) {
    if (recipient === zeroAddress) throw Error("recipient should not be zero: use tip() instead");

    return this.pushCall(
      this.address,
      0n,
      encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, amount] }),
    );
  }

  tip(amount: bigint) {
    return this.pushCall(
      this.address,
      0n,
      encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [zeroAddress, amount] }),
    );
  }

  /* FLASHLOANS */

  balancerFlashLoan(balancerVaultAddress: Address, requests: AssetRequest[], callbackCalls?: Hex[]) {
    callbackCalls ??= [];

    return this.pushCall(
      balancerVaultAddress,
      0n,
      encodeFunctionData({
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
        args: [
          this.address,
          requests.map(({ asset }) => asset),
          requests.map(({ amount }) => amount),
          encodeAbiParameters(
            [{ type: "bytes[]" }, { type: "bytes" }],
            [
              callbackCalls.concat(
                requests.map(({ asset, amount }) =>
                  ExecutorEncoder.buildErc20Transfer(asset, balancerVaultAddress, amount),
                ),
              ),
              "0x",
            ],
          ),
        ],
      }),
      {
        sender: balancerVaultAddress,
        dataIndex: 3n, // receiveFlashLoan(address[],uint256[],uint256[],bytes)
      },
    );
  }

  makerFlashLoan(makerVaultAddress: Address, asset: Address, amount: bigint, callbackCalls?: Hex[]) {
    callbackCalls ??= [];

    return this.pushCall(
      makerVaultAddress,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              { name: "receiver", type: "address" },
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" },
              { name: "data", type: "bytes" },
            ],
            name: "flashLoan",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "flashLoan",
        args: [
          this.address,
          asset,
          amount,
          encodeAbiParameters(
            [{ type: "bytes[]" }, { type: "bytes" }],
            [
              callbackCalls.concat([ExecutorEncoder.buildErc20Approve(asset, makerVaultAddress, amount)]),
              keccak256(stringToBytes("ERC3156FlashBorrower.onFlashLoan")),
            ],
          ),
        ],
      }),
      {
        sender: makerVaultAddress,
        dataIndex: 4n, // onFlashLoan(address,address,uint256,uint256,bytes)
      },
    );
  }

  aaveFlashLoan(aavePoolAddress: Address, requests: AssetRequest[], premium: bigint, callbackCalls?: Hex[]) {
    callbackCalls ??= [];

    return this.pushCall(
      aavePoolAddress,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              { name: "receiverAddress", type: "address" },
              { name: "assets", type: "address[]" },
              { name: "amounts", type: "uint256[]" },
              { name: "modes", type: "uint256[]" },
              { name: "onBehalfOf", type: "address" },
              { name: "params", type: "bytes" },
              { name: "referralCode", type: "uint16" },
            ],
            name: "flashLoan",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "flashLoan",
        args: [
          this.address,
          requests.map(({ asset }) => asset),
          requests.map(({ amount }) => amount),
          requests.map(() => 0n),
          this.address,
          encodeAbiParameters(
            [{ type: "bytes[]" }, { type: "bytes" }],
            [
              callbackCalls.concat(
                requests.map(({ asset, amount }) => {
                  return ExecutorEncoder.buildErc20Approve(asset, aavePoolAddress, amount + amount.percentMul(premium));
                }),
              ),
              "0x0000000000000000000000000000000000000000000000000000000000000001",
            ],
          ),
          0,
        ],
      }),
      {
        sender: aavePoolAddress,
        dataIndex: 4n, // executeOperation(address[],uint256[],uint256[],address,bytes)
      },
    );
  }

  aaveV3FlashLoan(aaveV3PoolAddress: Address, requests: AssetRequest[], premium: bigint, callbackCalls?: Hex[]) {
    callbackCalls ??= [];

    return this.pushCall(
      aaveV3PoolAddress,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              { name: "receiverAddress", type: "address" },
              { name: "assets", type: "address[]" },
              { name: "amounts", type: "uint256[]" },
              { name: "interestRateModes", type: "uint256[]" },
              { name: "onBehalfOf", type: "address" },
              { name: "params", type: "bytes" },
              { name: "referralCode", type: "uint16" },
            ],
            name: "flashLoan",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "flashLoan",
        args: [
          this.address,
          requests.map(({ asset }) => asset),
          requests.map(({ amount }) => amount),
          requests.map(() => 0n),
          this.address,
          encodeAbiParameters(
            [{ type: "bytes[]" }, { type: "bytes" }],
            [
              callbackCalls.concat(
                requests.map(({ asset, amount }) => {
                  return ExecutorEncoder.buildErc20Approve(
                    asset,
                    aaveV3PoolAddress,
                    amount + amount.percentMul(premium),
                  );
                }),
              ),
              "0x0000000000000000000000000000000000000000000000000000000000000001",
            ],
          ),
          0,
        ],
      }),
      {
        sender: aaveV3PoolAddress,
        dataIndex: 4n, // executeOperation(address[],uint256[],uint256[],address,bytes)
      },
    );
  }

  uniV2FlashSwap(
    pool: Address,
    [asset0, asset1]: readonly [Address, Address],
    [amount0, amount1]: readonly [bigint, bigint],
    callbackCalls?: Hex[],
  ) {
    callbackCalls ??= [];

    // TODO: calculate fee and transfer it
    const fee0 = 0n;
    const fee1 = 0n;

    return this.pushCall(
      pool,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              { name: "receiver", type: "address" },
              { name: "amount0", type: "uint256" },
              { name: "amount1", type: "uint256" },
              { name: "data", type: "bytes" },
            ],
            name: "flash",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "flash",
        args: [
          this.address,
          amount0,
          amount1,
          encodeAbiParameters(
            [{ type: "bytes[]" }, { type: "bytes" }],
            [
              callbackCalls.concat([
                ExecutorEncoder.buildErc20Approve(asset0, pool, amount0 + fee0),
                ExecutorEncoder.buildErc20Approve(asset1, pool, amount1 + fee1),
              ]),
              "0x",
            ],
          ),
        ],
      }),
      {
        sender: pool,
        dataIndex: 3n, // uniswapV2Call(address,uint256,uint256,bytes)
      },
    );
  }

  uniV3FlashLoan(
    pool: Address,
    [asset0, asset1]: readonly [Address, Address],
    [amount0, amount1]: readonly [bigint, bigint],
    fee: bigint,
    callbackCalls?: Hex[],
  ) {
    callbackCalls ??= [];

    const fee0 = amount0.mulDivUp(fee, 100_0000n);
    const fee1 = amount1.mulDivUp(fee, 100_0000n);

    return this.pushCall(
      pool,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              { name: "receiver", type: "address" },
              { name: "amount0", type: "uint256" },
              { name: "amount1", type: "uint256" },
              { name: "data", type: "bytes" },
            ],
            name: "flash",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "flash",
        args: [
          this.address,
          amount0,
          amount1,
          encodeAbiParameters(
            [{ type: "bytes[]" }, { type: "bytes" }],
            [
              callbackCalls.concat([
                ExecutorEncoder.buildErc20Transfer(asset0, pool, amount0 + fee0),
                ExecutorEncoder.buildErc20Transfer(asset1, pool, amount1 + fee1),
              ]),
              "0x",
            ],
          ),
        ],
      }),
      {
        sender: pool,
        dataIndex: 2n, // uniswapV3FlashCallback(uint256,uint256,bytes)
      },
    );
  }

  blueFlashLoan(morphoBlueAddress: Address, asset: Address, amount: bigint, callbackCalls?: Hex[]) {
    callbackCalls ??= [];

    return this.pushCall(
      morphoBlueAddress,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              { name: "asset", type: "address" },
              { name: "amount", type: "uint256" },
              { name: "data", type: "bytes" },
            ],
            name: "flashLoan",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "flashLoan",
        args: [
          asset,
          amount,
          encodeAbiParameters(
            [{ type: "bytes[]" }, { type: "bytes" }],
            [callbackCalls.concat([ExecutorEncoder.buildErc20Approve(asset, morphoBlueAddress, amount)]), "0x"],
          ),
        ],
      }),
      {
        sender: morphoBlueAddress,
        dataIndex: 1n, // onMorphoFlashLoan(uint256,bytes)
      },
    );
  }

  /* ERC20 */

  erc20Approve(asset: Address, spender: Address, allowance: bigint) {
    return this.pushCall(
      asset,
      0n,
      encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, allowance] }),
    );
  }

  erc20Transfer(asset: Address, recipient: Address, amount: bigint) {
    return this.pushCall(
      asset,
      0n,
      encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, amount] }),
    );
  }

  erc20TransferFrom(asset: Address, owner: Address, recipient: Address, amount: bigint) {
    return this.pushCall(
      asset,
      0n,
      encodeFunctionData({ abi: erc20Abi, functionName: "transferFrom", args: [owner, recipient, amount] }),
    );
  }

  /* WETH */

  wrapETH(weth: Address, amount: bigint) {
    return this.pushCall(
      weth,
      amount,
      encodeFunctionData({
        abi: [
          {
            inputs: [],
            name: "deposit",
            outputs: [],
            stateMutability: "payable",
            type: "function",
          },
        ],
        functionName: "deposit",
      }),
    );
  }

  unwrapETH(weth: Address, amount: bigint) {
    return this.pushCall(
      weth,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [{ name: "wad", type: "uint256" }],
            name: "withdraw",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "withdraw",
        args: [amount],
      }),
    );
  }

  /* ERC20 Wrappers */

  erc20WrapperDepositFor(asset: Address, onBehalf: Address, amount: bigint) {
    return this.pushCall(
      asset,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              { name: "owner", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            name: "depositFor",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "depositFor",
        args: [onBehalf, amount],
      }),
    );
  }

  erc20WrapperWithdrawTo(asset: Address, receiver: Address, amount: bigint) {
    return this.pushCall(
      asset,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              { name: "receiver", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            name: "withdrawTo",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "withdrawTo",
        args: [receiver, amount],
      }),
    );
  }

  /* ERC4626 */

  erc4626Deposit(vault: Address, assets: bigint, owner: Address) {
    return this.pushCall(
      vault,
      0n,
      encodeFunctionData({ abi: erc4626Abi, functionName: "deposit", args: [assets, owner] }),
    );
  }

  erc4626Mint(vault: Address, shares: bigint, owner: Address) {
    return this.pushCall(
      vault,
      0n,
      encodeFunctionData({ abi: erc4626Abi, functionName: "mint", args: [shares, owner] }),
    );
  }

  erc4626Withdraw(vault: Address, assets: bigint, receiver: Address, owner: Address) {
    return this.pushCall(
      vault,
      0n,
      encodeFunctionData({ abi: erc4626Abi, functionName: "withdraw", args: [assets, receiver, owner] }),
    );
  }

  erc4626Redeem(vault: Address, shares: bigint, receiver: Address, owner: Address) {
    return this.pushCall(
      vault,
      0n,
      encodeFunctionData({ abi: erc4626Abi, functionName: "redeem", args: [shares, receiver, owner] }),
    );
  }

  /* COMPOUND */

  compoundSupply(cToken: Address, amount: bigint) {
    return this.pushCall(
      cToken,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [{ name: "amount", type: "uint256" }],
            name: "mint",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "mint",
        args: [amount],
      }),
    );
  }

  compoundBorrow(cToken: Address, amount: bigint) {
    return this.pushCall(
      cToken,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [{ name: "amount", type: "uint256" }],
            name: "borrow",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "borrow",
        args: [amount],
      }),
    );
  }

  compoundRepay(cToken: Address, amount: bigint, onBehalfOf?: Address) {
    if (onBehalfOf)
      return this.pushCall(
        cToken,
        0n,
        encodeFunctionData({
          abi: [
            {
              inputs: [
                { name: "onBehalfOf", type: "address" },
                { name: "amount", type: "uint256" },
              ],
              name: "repayBorrowBehalf",
              outputs: [],
              stateMutability: "nonpayable",
              type: "function",
            },
          ],
          functionName: "repayBorrowBehalf",
          args: [onBehalfOf, amount],
        }),
      );

    return this.pushCall(
      cToken,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [{ name: "amount", type: "uint256" }],
            name: "repayBorrow",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "repayBorrow",
        args: [amount],
      }),
    );
  }

  compoundWithdraw(cToken: Address, amount: bigint) {
    return this.pushCall(
      cToken,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [{ name: "amount", type: "uint256" }],
            name: "redeemUnderlying",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "redeemUnderlying",
        args: [amount],
      }),
    );
  }

  /* AAVE */

  aaveSupply(aavePoolAddress: Address, asset: Address, amount: bigint, onBehalfOf?: Address) {
    onBehalfOf ||= this.address;

    return this.pushCall(
      aavePoolAddress,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              { name: "asset", type: "address" },
              { name: "amount", type: "uint256" },
              { name: "onBehalfOf", type: "address" },
              { name: "referralCode", type: "uint16" },
            ],
            name: "deposit",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "deposit",
        args: [asset, amount, onBehalfOf, 0],
      }),
    );
  }

  aaveBorrow(aavePoolAddress: Address, asset: Address, amount: bigint, interestRateMode: bigint, onBehalfOf?: Address) {
    onBehalfOf ||= this.address;

    return this.pushCall(
      aavePoolAddress,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              { name: "asset", type: "address" },
              { name: "amount", type: "uint256" },
              { name: "interestRateMode", type: "uint256" },
              { name: "referralCode", type: "uint16" },
              { name: "onBehalfOf", type: "address" },
            ],
            name: "borrow",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "borrow",
        args: [asset, amount, interestRateMode, 0, onBehalfOf],
      }),
    );
  }

  aaveRepay(aavePoolAddress: Address, asset: Address, amount: bigint, interestRateMode: bigint, onBehalfOf?: Address) {
    onBehalfOf ||= this.address;

    return this.pushCall(
      aavePoolAddress,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              { name: "asset", type: "address" },
              { name: "amount", type: "uint256" },
              { name: "interestRateMode", type: "uint256" },
              { name: "onBehalfOf", type: "address" },
            ],
            name: "repay",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "repay",
        args: [asset, amount, interestRateMode, onBehalfOf],
      }),
    );
  }

  aaveWithdraw(aavePoolAddress: Address, asset: Address, amount: bigint, to?: Address) {
    to ||= this.address;

    return this.pushCall(
      aavePoolAddress,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              { name: "asset", type: "address" },
              { name: "amount", type: "uint256" },
              { name: "to", type: "address" },
            ],
            name: "withdraw",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "withdraw",
        args: [asset, amount, to],
      }),
    );
  }

  aaveLiquidate(aavePoolAddress: Address, collateral: Address, debt: Address, user: Address, amount: bigint) {
    return this.pushCall(
      aavePoolAddress,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              { name: "collateralAsset", type: "address" },
              { name: "debtAsset", type: "address" },
              { name: "user", type: "address" },
              { name: "debtToCover", type: "uint256" },
              { name: "receiveAToken", type: "bool" },
            ],
            name: "liquidationCall",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "liquidationCall",
        args: [collateral, debt, user, amount, false],
      }),
    );
  }

  /* UNISWAP V3 */

  uniV3ExactInput(
    uniV3RouterAddress: Address,
    path: Hex,
    amountIn: bigint,
    amountOutMinimum: bigint,
    recipient?: Address,
  ) {
    recipient ||= this.address;

    return this.pushCall(
      uniV3RouterAddress,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              {
                components: [
                  { name: "path", type: "bytes" },
                  { name: "recipient", type: "address" },
                  { name: "deadline", type: "uint256" },
                  { name: "amountIn", type: "uint256" },
                  { name: "amountOutMinimum", type: "uint256" },
                ],
                name: "params",
                type: "tuple",
              },
            ],
            name: "exactInput",
            outputs: [{ name: "amountOut", type: "uint256" }],
            stateMutability: "payable",
            type: "function",
          },
        ],
        functionName: "exactInput",
        args: [
          {
            path,
            recipient,
            deadline: BigInt(Math.ceil(Date.now() / 1000)) + 90n,
            amountIn,
            amountOutMinimum,
          },
        ],
      }),
    );
  }

  uniV3ExactOutput(
    uniV3RouterAddress: Address,
    path: Hex,
    amountOut: bigint,
    amountInMaximum: bigint,
    recipient?: Address,
  ) {
    recipient ||= this.address;

    return this.pushCall(
      uniV3RouterAddress,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              {
                components: [
                  { name: "path", type: "bytes" },
                  { name: "recipient", type: "address" },
                  { name: "deadline", type: "uint256" },
                  { name: "amountOut", type: "uint256" },
                  { name: "amountInMaximum", type: "uint256" },
                ],
                name: "params",
                type: "tuple",
              },
            ],
            name: "exactOutput",
            outputs: [{ name: "amountIn", type: "uint256" }],
            stateMutability: "payable",
            type: "function",
          },
        ],
        functionName: "exactOutput",
        args: [
          {
            path,
            recipient,
            deadline: BigInt(Math.ceil(Date.now() / 1000)) + 90n,
            amountOut,
            amountInMaximum,
          },
        ],
      }),
    );
  }

  /* MORPHO */

  morphoCompoundLiquidate(
    morphoCompoundAddress: Address,
    borrowedPoolToken: Address,
    collateralPoolToken: Address,
    borrower: Address,
    amount: bigint,
  ) {
    return this.pushCall(
      morphoCompoundAddress,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              { name: "_poolTokenBorrowedAddress", type: "address" },
              { name: "_poolTokenCollateralAddress", type: "address" },
              { name: "_borrower", type: "address" },
              { name: "_amount", type: "uint256" },
            ],
            name: "liquidate",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "liquidate",
        args: [borrowedPoolToken, collateralPoolToken, borrower, amount],
      }),
    );
  }

  morphoAaveV2Liquidate(
    morphoAaveV2Address: Address,
    borrowedPoolToken: Address,
    collateralPoolToken: Address,
    borrower: Address,
    amount: bigint,
  ) {
    return this.pushCall(
      morphoAaveV2Address,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              { name: "_poolTokenBorrowed", type: "address" },
              { name: "_poolTokenCollateral", type: "address" },
              { name: "_borrower", type: "address" },
              { name: "_amount", type: "uint256" },
            ],
            name: "liquidate",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "liquidate",
        args: [borrowedPoolToken, collateralPoolToken, borrower, amount],
      }),
    );
  }

  morphoAaveV3Liquidate(
    morphoAaveV3Address: Address,
    underlyingBorrowed: Address,
    underlyingCollateral: Address,
    borrower: Address,
    amount: bigint,
  ) {
    return this.pushCall(
      morphoAaveV3Address,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              { name: "underlyingBorrowed", type: "address" },
              { name: "underlyingCollateral", type: "address" },
              { name: "user", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            name: "liquidate",
            outputs: [
              { name: "", type: "uint256" },
              { name: "", type: "uint256" },
            ],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "liquidate",
        args: [underlyingBorrowed, underlyingCollateral, borrower, amount],
      }),
    );
  }

  morphoBlueSupplyCollateral(
    morphoBlueAddress: Address,
    market: MarketParams,
    collateral: bigint,
    onBehalf: Address,
    callbackCalls?: Hex[],
  ) {
    callbackCalls ??= [];

    return this.pushCall(
      morphoBlueAddress,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              {
                name: "marketParams",
                type: "tuple",
                components: [
                  { name: "loanToken", type: "address" },
                  { name: "collateralToken", type: "address" },
                  { name: "oracle", type: "address" },
                  { name: "irm", type: "address" },
                  { name: "lltv", type: "uint256" },
                ],
              },
              { name: "assets", type: "uint256" },
              { name: "onBehalf", type: "address" },
              { name: "data", type: "bytes" },
            ],
            name: "supplyCollateral",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "supplyCollateral",
        args: [
          market,
          collateral,
          onBehalf,
          encodeAbiParameters([{ type: "bytes[]" }, { type: "bytes" }], [callbackCalls, "0x"]),
        ],
      }),
      {
        sender: morphoBlueAddress,
        dataIndex: 1n, // onMorphoSupplyCollateral(uint256,bytes)
      },
    );
  }

  morphoBlueWithdrawCollateral(
    morphoBlueAddress: Address,
    market: MarketParams,
    collateral: bigint,
    onBehalf: Address,
    receiver: Address,
  ) {
    return this.pushCall(
      morphoBlueAddress,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              {
                name: "marketParams",
                type: "tuple",
                components: [
                  { name: "loanToken", type: "address" },
                  { name: "collateralToken", type: "address" },
                  { name: "oracle", type: "address" },
                  { name: "irm", type: "address" },
                  { name: "lltv", type: "uint256" },
                ],
              },
              { name: "assets", type: "uint256" },
              { name: "onBehalf", type: "address" },
              { name: "receiver", type: "address" },
            ],
            name: "withdrawCollateral",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "withdrawCollateral",
        args: [market, collateral, onBehalf, receiver],
      }),
    );
  }

  morphoBlueSupply(
    morphoBlueAddress: Address,
    market: MarketParams,
    assets: bigint,
    shares: bigint,
    onBehalf: Address,
    callbackCalls?: Hex[],
  ) {
    callbackCalls ??= [];

    return this.pushCall(
      morphoBlueAddress,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              {
                name: "marketParams",
                type: "tuple",
                components: [
                  { name: "loanToken", type: "address" },
                  { name: "collateralToken", type: "address" },
                  { name: "oracle", type: "address" },
                  { name: "irm", type: "address" },
                  { name: "lltv", type: "uint256" },
                ],
              },
              { name: "assets", type: "uint256" },
              { name: "shares", type: "uint256" },
              { name: "onBehalf", type: "address" },
              { name: "data", type: "bytes" },
            ],
            name: "supply",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "supply",
        args: [
          market,
          assets,
          shares,
          onBehalf,
          encodeAbiParameters([{ type: "bytes[]" }, { type: "bytes" }], [callbackCalls, "0x"]),
        ],
      }),
      {
        sender: morphoBlueAddress,
        dataIndex: 1n, // onMorphoSupply(uint256,bytes)
      },
    );
  }

  morphoBlueWithdraw(
    morphoBlueAddress: Address,
    market: MarketParams,
    assets: bigint,
    shares: bigint,
    onBehalf: Address,
    receiver: Address,
  ) {
    return this.pushCall(
      morphoBlueAddress,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              {
                name: "marketParams",
                type: "tuple",
                components: [
                  { name: "loanToken", type: "address" },
                  { name: "collateralToken", type: "address" },
                  { name: "oracle", type: "address" },
                  { name: "irm", type: "address" },
                  { name: "lltv", type: "uint256" },
                ],
              },
              { name: "assets", type: "uint256" },
              { name: "shares", type: "uint256" },
              { name: "onBehalf", type: "address" },
              { name: "receiver", type: "address" },
            ],
            name: "withdraw",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "withdraw",
        args: [market, assets, shares, onBehalf, receiver],
      }),
    );
  }

  morphoBlueRepay(
    morphoBlueAddress: Address,
    market: MarketParams,
    assets: bigint,
    shares: bigint,
    onBehalf: Address,
    callbackCalls?: Hex[],
  ) {
    callbackCalls ??= [];

    return this.pushCall(
      morphoBlueAddress,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              {
                name: "marketParams",
                type: "tuple",
                components: [
                  { name: "loanToken", type: "address" },
                  { name: "collateralToken", type: "address" },
                  { name: "oracle", type: "address" },
                  { name: "irm", type: "address" },
                  { name: "lltv", type: "uint256" },
                ],
              },
              { name: "assets", type: "uint256" },
              { name: "shares", type: "uint256" },
              { name: "onBehalf", type: "address" },
              { name: "data", type: "bytes" },
            ],
            name: "repay",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "repay",
        args: [
          market,
          assets,
          shares,
          onBehalf,
          encodeAbiParameters([{ type: "bytes[]" }, { type: "bytes" }], [callbackCalls, "0x"]),
        ],
      }),
      {
        sender: morphoBlueAddress,
        dataIndex: 1n, // onMorphoRepay(uint256,bytes)
      },
    );
  }

  morphoBlueBorrow(
    morphoBlueAddress: Address,
    market: MarketParams,
    assets: bigint,
    shares: bigint,
    onBehalf: Address,
    receiver: Address,
  ) {
    return this.pushCall(
      morphoBlueAddress,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              {
                name: "marketParams",
                type: "tuple",
                components: [
                  { name: "loanToken", type: "address" },
                  { name: "collateralToken", type: "address" },
                  { name: "oracle", type: "address" },
                  { name: "irm", type: "address" },
                  { name: "lltv", type: "uint256" },
                ],
              },
              { name: "assets", type: "uint256" },
              { name: "shares", type: "uint256" },
              { name: "onBehalf", type: "address" },
              { name: "receiver", type: "address" },
            ],
            name: "borrow",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "borrow",
        args: [market, assets, shares, onBehalf, receiver],
      }),
    );
  }

  morphoBlueLiquidate(
    morphoBlueAddress: Address,
    market: MarketParams,
    borrower: Address,
    seizedAssets: bigint,
    repaidShares: bigint,
    callbackCalls?: Hex[],
  ) {
    callbackCalls ??= [];

    return this.pushCall(
      morphoBlueAddress,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              {
                name: "marketParams",
                type: "tuple",
                components: [
                  { name: "loanToken", type: "address" },
                  { name: "collateralToken", type: "address" },
                  { name: "oracle", type: "address" },
                  { name: "irm", type: "address" },
                  { name: "lltv", type: "uint256" },
                ],
              },
              { name: "borrower", type: "address" },
              { name: "seizedAssets", type: "uint256" },
              { name: "repaidShares", type: "uint256" },
              { name: "data", type: "bytes" },
            ],
            name: "liquidate",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "liquidate",
        args: [
          market,
          borrower,
          seizedAssets,
          repaidShares,
          encodeAbiParameters([{ type: "bytes[]" }, { type: "bytes" }], [callbackCalls, "0x"]),
        ],
      }),
      {
        sender: morphoBlueAddress,
        dataIndex: 1n, // onMorphoLiquidate(uint256,bytes)
      },
    );
  }
}
