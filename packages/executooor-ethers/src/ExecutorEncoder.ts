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
  UniswapV2Pair__factory,
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

/** Token and amount pair used by multi-asset flash-loan helpers. */
export interface AssetRequest {
  /** ERC20 token requested from the lending protocol. */
  asset: string;
  /** Raw token amount in the token's native decimals. */
  amount: BigNumberish;
}

/** Callback authorization installed while one Executor call is active. */
export interface CallbackContext {
  /** Contract address expected to call the Executor fallback. Use ZeroAddress for no callback. */
  sender: string;
  /** Zero-based ABI argument index containing encoded callback continuation data. */
  dataIndex: BigNumberish;
}

/**
 * Builder for owner-submitted Executor batches.
 *
 * Consumption flow:
 * 1. Create one encoder for an already deployed Executor address.
 * 2. Chain helper methods to queue Executor self-calls.
 * 3. Use `flush()` when a queued sequence must become callback continuation data.
 * 4. Use `exec()` to submit the owner transaction or `populateExec()` to hand the transaction to a relayer/bundler.
 *
 * Security model:
 * - The connected runner must be the Executor owner for `exec()`.
 * - Every helper only encodes calldata; it does not simulate profitability, slippage, token behavior, or repayment safety.
 * - Helpers that end in `All` patch calldata onchain with a balance read and depend on the token returning a standard
 *   32-byte `balanceOf` value.
 */
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
  public static readonly UNI_V2_PAIR_IFC = UniswapV2Pair__factory.createInterface();
  public static readonly UNI_V3_POOL_IFC = UniswapV3Pool__factory.createInterface();
  public static readonly SWAP_ROUTER_V2_IFC = UniswapV2Router__factory.createInterface();
  public static readonly SWAP_ROUTER_V3_IFC = UniswapV3Router__factory.createInterface();
  public static readonly MORPHO_COMPOUND_IFC = MorphoCompound__factory.createInterface();
  public static readonly MORPHO_AAVE_V2_IFC = MorphoAaveV2__factory.createInterface();
  public static readonly MORPHO_AAVE_V3_IFC = MorphoAaveV3__factory.createInterface();
  public static readonly MORPHO_BLUE_IFC = MorphoBlue__factory.createInterface();

  /**
   * Encodes one Executor self-call that will call `target`.
   *
   * Place this payload in `exec_606BaXt(bytes[])` or in callback continuation data. `context` is only needed when the
   * target is expected to call back into the Executor fallback during this call.
   *
   * Danger: `dataIndex` must match the callback function's ABI argument that carries `(bytes[],bytes)` continuation
   * data. A wrong index reverts or decodes attacker-controlled-looking garbage as a batch.
   */
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

  /**
   * Encodes an ERC20 approval as an Executor call payload.
   *
   * Use inside callback continuations or custom batches when a later protocol call needs allowance from the Executor.
   * Prefer exact allowances unless the strategy explicitly needs an unlimited approval.
   */
  static buildErc20Approve(asset: string, recipient: string, amount: BigNumberish) {
    return ExecutorEncoder.buildCall(
      asset,
      0,
      ExecutorEncoder.ERC20_IFC.encodeFunctionData("approve", [recipient, amount]),
    );
  }

  /**
   * Encodes an ERC20 transfer as an Executor call payload.
   *
   * Commonly used as a flash-loan repayment or final profit sweep inside callback continuation data.
   */
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

  /**
   * Creates a queue builder for a deployed Executor.
   *
   * @param address Deployed Executor contract address.
   * @param runner Optional ethers runner. `exec()` requires a signer authorized as the Executor owner; read-only
   * runners can still build and populate transactions.
   */
  constructor(
    public readonly address: string,
    runner?: ContractRunner | null,
  ) {
    this.executor = Executor__factory.connect(address, runner);
  }

  /**
   * Returns the connected ethers runner or throws when this encoder was created without one.
   *
   * This is a convenience guard for code paths that need direct ethers access in the same consumption flow.
   */
  get runner() {
    const { runner } = this.executor;

    if (!runner) throw Error("runner not available");

    return runner;
  }

  /**
   * Queues one arbitrary target call.
   *
   * This is the lowest-level JS helper. All protocol helpers eventually call `pushCall`, which wraps the target call
   * in Executor calldata and accumulates ETH value for `exec()`.
   *
   * Danger: The encoder does not validate the target, calldata, or value. The owner transaction authorizes exactly
   * what is queued here.
   */
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

  /**
   * Returns queued Executor call payloads and clears the local queue.
   *
   * Use this to turn a sequence into callback continuation data, for example the calls that should run inside a
   * Balancer flash-loan callback. Calling `flush()` is destructive for the local builder state.
   */
  flush() {
    const calls = [...this.calls];

    this.totalValue = 0n;
    this.calls = [];

    return calls;
  }

  /**
   * Submits the queued batch through `exec_606BaXt`.
   *
   * The transaction value is `sum(pushCall values) + overrides.value`. The queue is flushed before the transaction is
   * sent, so reuse requires building a new queue.
   */
  async exec(overrides: PayableOverrides & { from?: PromiseOrValue<string> } = {}) {
    const { totalValue } = this;
    const { value } = overrides;

    return await this.executor.exec_606BaXt(this.flush(), {
      ...overrides,
      value: totalValue + toBigInt(value ?? 0n),
    });
  }

  /**
   * Populates, but does not send, the queued `exec_606BaXt` transaction.
   *
   * Use this when a bundler, relayer, multisig, or custom signer will submit the owner transaction. Like `exec()`, this
   * flushes the local queue.
   */
  async populateExec(overrides: PayableOverrides & { from?: PromiseOrValue<string> } = {}) {
    const { totalValue } = this;
    const { value } = overrides;

    return await this.executor.exec_606BaXt.populateTransaction(this.flush(), {
      ...overrides,
      value: totalValue + toBigInt(value ?? 0n),
    });
  }

  /* BASE */

  /**
   * Queues an ETH transfer from the Executor to `recipient`.
   *
   * Use near the end of a batch to sweep ETH profit or return funds. The Solidity helper caps the transfer to the
   * Executor's current ETH balance, so underfunding does not revert unless the recipient reverts.
   */
  transfer(recipient: string, amount: BigNumberish) {
    if (recipient === ZeroAddress) throw Error("recipient should not be zero: use tip() instead");

    return this.pushCall(
      this.address,
      0n,
      ExecutorEncoder.EXECUTOR_IFC.encodeFunctionData("transfer", [recipient, amount]),
    );
  }

  /**
   * Queues an ETH transfer to `block.coinbase`.
   *
   * Use as the last batch step when paying a builder/validator. The actual recipient is chain and block-production
   * dependent, so do not use this as a normal user transfer.
   */
  tip(amount: BigNumberish) {
    return this.pushCall(
      this.address,
      0n,
      ExecutorEncoder.EXECUTOR_IFC.encodeFunctionData("transfer", [ZeroAddress, amount]),
    );
  }

  /* FLASHLOANS */

  /**
   * Queues a Balancer Vault flash loan.
   *
   * `callbackCalls` are flushed Executor payloads that run inside `receiveFlashLoan`; repayment transfers are appended
   * automatically for the borrowed principal. Balancer flash loans are assumed to have no fee for this helper.
   */
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

  /**
   * Queues an ERC-3156/Maker-style flash loan.
   *
   * `callbackCalls` run inside `onFlashLoan`; an approval for the borrowed principal is appended so the lender can pull
   * repayment. If the lender charges a fee, include extra approval or repayment logic yourself.
   */
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

  /**
   * Queues an Aave V2/V3 multi-asset flash loan.
   *
   * `premium` must be fetched from the selected pool and is used to approve `amount + percentMul(amount, premium)` for
   * every asset after `callbackCalls`. This helper opens no debt positions because all modes are zero.
   */
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

  /**
   * Queues a Uniswap V2 pair flash swap.
   *
   * `callbackCalls` run inside `uniswapV2Call`; same-token repayment transfers are appended with the standard
   * `ceil(amount * 1000 / 997)` repayment amount for each borrowed side.
   *
   * Danger: This helper assumes each borrowed token is repaid in the same token. For cross-token repayment, custom
   * callback calls must handle the pair invariant and repayment manually.
   */
  uniV2FlashSwap(
    pool: string,
    [asset0, asset1]: readonly [string, string],
    [amount0, amount1]: readonly [BigNumberish, BigNumberish],
    callbackCalls?: BytesLike[],
  ) {
    callbackCalls ??= [];

    amount0 = toBigInt(amount0);
    amount1 = toBigInt(amount1);

    const repayment0 = amount0 === 0n ? 0n : amount0.mulDivUp(1000n, 997n);
    const repayment1 = amount1 === 0n ? 0n : amount1.mulDivUp(1000n, 997n);

    return this.pushCall(
      pool,
      0n,
      ExecutorEncoder.UNI_V2_PAIR_IFC.encodeFunctionData("swap", [
        amount0,
        amount1,
        this.address,
        AbiCoder.defaultAbiCoder().encode(
          ["bytes[]", "bytes"],
          [
            callbackCalls.concat([
              ...(repayment0 > 0n ? [ExecutorEncoder.buildErc20Transfer(asset0, pool, repayment0)] : []),
              ...(repayment1 > 0n ? [ExecutorEncoder.buildErc20Transfer(asset1, pool, repayment1)] : []),
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

  /**
   * Queues a Uniswap V3 pool flash loan.
   *
   * `callbackCalls` run inside `uniswapV3FlashCallback`; repayment transfers for both pool tokens are appended using
   * `fee` in hundredths of a bip, matching Uniswap V3 fee tiers such as 500, 3000, or 10000.
   */
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

  /**
   * Queues a Morpho Blue flash loan.
   *
   * `callbackCalls` run inside `onMorphoFlashLoan`; an approval for the borrowed amount is appended for repayment.
   */
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

  /**
   * Builds a placeholder that reads `balanceOf(owner)` and copies the returned balance into a later call.
   *
   * `offset` is the byte position of the uint256 argument inside the target function calldata, including the 4-byte
   * selector. This is the primitive behind `erc20ApproveAll`, `erc20Skim`, and other all-balance helpers.
   */
  erc20BalanceOf(asset: string, owner: string, offset: BigNumberish) {
    return {
      to: asset,
      data: ExecutorEncoder.ERC20_IFC.encodeFunctionData("balanceOf", [owner]),
      offset,
      length: 32,
      resOffset: 0,
    };
  }

  /** Queues `ERC20.approve(spender, allowance)` from the Executor. Use before protocols that pull tokens. */
  erc20Approve(asset: string, spender: string, allowance: BigNumberish) {
    return this.pushCall(asset, 0n, ExecutorEncoder.ERC20_IFC.encodeFunctionData("approve", [spender, allowance]));
  }

  /**
   * Queues an ERC20 approval for the Executor's full token balance at execution time.
   *
   * Uses a placeholder to patch the allowance argument from `balanceOf(this.address)`. Tokens with non-standard
   * approval rules, rebasing behavior, or fee mechanics can make this unsafe.
   */
  erc20ApproveAll(asset: string, spender: string) {
    return this.pushCall(asset, 0n, ExecutorEncoder.ERC20_IFC.encodeFunctionData("approve", [spender, 0n]), undefined, [
      this.erc20BalanceOf(asset, this.address, 4 + 32),
    ]);
  }

  /** Queues `ERC20.transfer(recipient, amount)` from the Executor, usually for repayment or profit sweeping. */
  erc20Transfer(asset: string, recipient: string, amount: BigNumberish) {
    return this.pushCall(asset, 0n, ExecutorEncoder.ERC20_IFC.encodeFunctionData("transfer", [recipient, amount]));
  }

  /**
   * Queues `ERC20.transferFrom(owner, recipient, amount)` from the Executor.
   *
   * The `owner` must have approved the Executor before the owner batch reaches this step.
   */
  erc20TransferFrom(asset: string, owner: string, recipient: string, amount: BigNumberish) {
    return this.pushCall(
      asset,
      0n,
      ExecutorEncoder.ERC20_IFC.encodeFunctionData("transferFrom", [owner, recipient, amount]),
    );
  }

  /**
   * Queues an ERC20 transfer of the Executor's full token balance at execution time.
   *
   * Uses a placeholder to patch the transfer amount from `balanceOf(this.address)`. Fee-on-transfer or rebasing tokens
   * can make the observed amount differ from the amount finally received.
   */
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

  /** Queues `WETH.deposit{value: amount}()` and adds `amount` to the owner transaction value. */
  wrapETH(weth: string, amount: BigNumberish) {
    return this.pushCall(weth, toBigInt(amount), ExecutorEncoder.WETH_IFC.encodeFunctionData("deposit"));
  }

  /** Queues `WETH.withdraw(amount)`, leaving raw ETH in the Executor for later transfer, wrap, or protocol calls. */
  unwrapETH(weth: string, amount: BigNumberish) {
    return this.pushCall(weth, 0n, ExecutorEncoder.WETH_IFC.encodeFunctionData("withdraw", [amount]));
  }

  /* ERC20 Wrappers */

  /** Queues `ERC20Wrapper.depositFor(onBehalf, amount)` after the Executor has underlying tokens and approval. */
  erc20WrapperDepositFor(asset: string, onBehalf: string, amount: BigNumberish) {
    return this.pushCall(
      asset,
      0n,
      ExecutorEncoder.ERC20_WRAPPER_IFC.encodeFunctionData("depositFor", [onBehalf, amount]),
    );
  }

  /**
   * Queues `ERC20Wrapper.depositFor(onBehalf, full underlying balance)`.
   *
   * The amount is patched from the Executor's `underlying` balance at execution time.
   */
  erc20WrapperDepositAllFor(asset: string, underlying: string, onBehalf: string) {
    return this.pushCall(
      asset,
      0n,
      ExecutorEncoder.ERC20_WRAPPER_IFC.encodeFunctionData("depositFor", [onBehalf, 0n]),
      undefined,
      [this.erc20BalanceOf(underlying, this.address, 4 + 32)],
    );
  }

  /** Queues `ERC20Wrapper.withdrawTo(receiver, amount)` to unwrap wrapper shares/tokens held by the Executor. */
  erc20WrapperWithdrawTo(asset: string, receiver: string, amount: BigNumberish) {
    return this.pushCall(
      asset,
      0n,
      ExecutorEncoder.ERC20_WRAPPER_IFC.encodeFunctionData("withdrawTo", [receiver, amount]),
    );
  }

  /**
   * Queues `ERC20Wrapper.withdrawTo(receiver, full wrapper balance)`.
   *
   * The amount is patched from the Executor's wrapper-token balance at execution time.
   */
  erc20WrapperWithdrawAllTo(asset: string, receiver: string) {
    return this.pushCall(
      asset,
      0n,
      ExecutorEncoder.ERC20_WRAPPER_IFC.encodeFunctionData("withdrawTo", [receiver, 0n]),
      undefined,
      [this.erc20BalanceOf(asset, this.address, 4 + 32)],
    );
  }

  /* ERC4626 */

  /** Queues `ERC4626.deposit(assets, owner)` after the Executor holds assets and has approved the vault if required. */
  erc4626Deposit(vault: string, assets: BigNumberish, owner: string) {
    return this.pushCall(vault, 0n, ExecutorEncoder.ERC4626_IFC.encodeFunctionData("deposit", [assets, owner]));
  }

  /**
   * Queues `ERC4626.deposit(full asset balance, owner)`.
   *
   * The asset amount is patched from `balanceOf(this.address)` on the underlying asset. Slippage/share-rate changes are
   * governed by the vault implementation, not by the Executor.
   */
  erc4626DepositAll(vault: string, asset: string, owner: string) {
    return this.pushCall(vault, 0n, ExecutorEncoder.ERC4626_IFC.encodeFunctionData("deposit", [0n, owner]), undefined, [
      this.erc20BalanceOf(asset, this.address, 4),
    ]);
  }

  /** Queues `ERC4626.mint(shares, owner)`, letting the vault determine required assets. */
  erc4626Mint(vault: string, shares: BigNumberish, owner: string) {
    return this.pushCall(vault, 0n, ExecutorEncoder.ERC4626_IFC.encodeFunctionData("mint", [shares, owner]));
  }

  /** Queues `ERC4626.withdraw(assets, receiver, owner)`. The Executor must be `owner` or have share allowance. */
  erc4626Withdraw(vault: string, assets: BigNumberish, receiver: string, owner: string) {
    return this.pushCall(
      vault,
      0n,
      ExecutorEncoder.ERC4626_IFC.encodeFunctionData("withdraw", [assets, receiver, owner]),
    );
  }

  /** Queues `ERC4626.redeem(shares, receiver, owner)`. The Executor must be `owner` or have share allowance. */
  erc4626Redeem(vault: string, shares: BigNumberish, receiver: string, owner: string) {
    return this.pushCall(
      vault,
      0n,
      ExecutorEncoder.ERC4626_IFC.encodeFunctionData("redeem", [shares, receiver, owner]),
    );
  }

  /**
   * Queues `ERC4626.redeem(full share balance, receiver, owner)`.
   *
   * The share amount is patched from the Executor's vault-share balance at execution time.
   */
  erc4626RedeemAll(vault: string, receiver: string, owner: string) {
    return this.pushCall(
      vault,
      0n,
      ExecutorEncoder.ERC4626_IFC.encodeFunctionData("redeem", [0n, receiver, owner]),
      undefined,
      [this.erc20BalanceOf(vault, this.address, 4)],
    );
  }

  /* COMPOUND */

  /** Queues Compound/Compound-like `cToken.mint(amount)` to supply underlying from the Executor. */
  compoundSupply(cToken: string, amount: BigNumberish) {
    return this.pushCall(cToken, 0n, ExecutorEncoder.C_TOKEN_IFC.encodeFunctionData("mint", [amount]));
  }

  /** Queues `cToken.borrow(amount)`. The Executor must already have sufficient collateral/account liquidity. */
  compoundBorrow(cToken: string, amount: BigNumberish) {
    return this.pushCall(cToken, 0n, ExecutorEncoder.C_TOKEN_IFC.encodeFunctionData("borrow", [amount]));
  }

  /**
   * Queues Compound repayment.
   *
   * Calls `repayBorrow(amount)` for the Executor's own debt or `repayBorrowBehalf(onBehalfOf, amount)` when
   * `onBehalfOf` is provided. The Executor must hold and approve the underlying token as required by the cToken.
   */
  compoundRepay(cToken: string, amount: BigNumberish, onBehalfOf?: string) {
    if (onBehalfOf)
      return this.pushCall(
        cToken,
        0n,
        ExecutorEncoder.C_TOKEN_IFC.encodeFunctionData("repayBorrowBehalf", [onBehalfOf, amount]),
      );

    return this.pushCall(cToken, 0n, ExecutorEncoder.C_TOKEN_IFC.encodeFunctionData("repayBorrow", [amount]));
  }

  /** Queues `cToken.redeemUnderlying(amount)` to withdraw supplied underlying to the Executor. */
  compoundWithdraw(cToken: string, amount: BigNumberish) {
    return this.pushCall(cToken, 0n, ExecutorEncoder.C_TOKEN_IFC.encodeFunctionData("redeemUnderlying", [amount]));
  }

  /* AAVE V2 */

  /** Queues Aave V2-compatible `deposit(asset, amount, onBehalfOf, 0)`. Defaults `onBehalfOf` to the Executor. */
  aaveSupply(aavePoolAddress: string, asset: string, amount: BigNumberish, onBehalfOf?: string) {
    onBehalfOf ||= this.address;

    return this.pushCall(
      aavePoolAddress,
      0n,
      ExecutorEncoder.POOL_V2_IFC.encodeFunctionData("deposit", [asset, amount, onBehalfOf, 0]),
    );
  }

  /**
   * Queues Aave V2-compatible `borrow`.
   *
   * `interestRateMode` is protocol-specific, commonly `1` for stable where supported and `2` for variable. Defaults
   * `onBehalfOf` to the Executor.
   */
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

  /**
   * Queues Aave V2-compatible `repay`.
   *
   * The Executor must hold the debt asset and approve the pool. Defaults `onBehalfOf` to the Executor.
   */
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

  /** Queues Aave V2-compatible `withdraw(asset, amount, to)`. Defaults `to` to the Executor. */
  aaveWithdraw(aavePoolAddress: string, asset: string, amount: BigNumberish, to?: string) {
    to ||= this.address;

    return this.pushCall(
      aavePoolAddress,
      0n,
      ExecutorEncoder.POOL_V2_IFC.encodeFunctionData("withdraw", [asset, amount, to]),
    );
  }

  /**
   * Queues Aave V2-compatible `liquidationCall` with `receiveAToken = false`.
   *
   * The Executor must hold and approve the debt asset; liquidation profitability and close-factor rules are external
   * protocol concerns.
   */
  aaveLiquidate(aavePoolAddress: string, collateral: string, debt: string, user: string, amount: BigNumberish) {
    return this.pushCall(
      aavePoolAddress,
      0n,
      ExecutorEncoder.POOL_V2_IFC.encodeFunctionData("liquidationCall", [collateral, debt, user, amount, false]),
    );
  }

  /* UNISWAP V3 */

  /**
   * Queues Uniswap V3 router `exactInput`.
   *
   * `path` is the packed V3 path. The helper sets a short deadline at encoding time, so build and submit promptly.
   * Always provide a meaningful `amountOutMinimum` outside tests.
   */
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

  /**
   * Queues Uniswap V3 `exactInput` using the Executor's full balance of the first token in `path`.
   *
   * The first 20 bytes of `path` are treated as the input token address and used for the balance placeholder.
   */
  uniV3ExactInputAll(uniV3RouterAddress: string, path: string, amountOutMinimum: BigNumberish, recipient?: string) {
    recipient ||= this.address;

    return this.pushCall(
      uniV3RouterAddress,
      0n,
      ExecutorEncoder.SWAP_ROUTER_V3_IFC.encodeFunctionData("exactInput", [
        {
          path,
          recipient,
          deadline: Math.ceil(Date.now() / 1000) + 90,
          amountIn: 0n,
          amountOutMinimum,
        },
      ]),
      undefined,
      [this.erc20BalanceOf(path.substring(0, 42), this.address, 4 + 32 * 4)],
    );
  }

  /**
   * Queues Uniswap V3 router `exactOutput`.
   *
   * `path` is the packed reverse path required by Uniswap V3 exact-output swaps. The helper sets a short deadline at
   * encoding time. Set `amountInMaximum` tightly and clean up leftover allowance if needed.
   */
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

  /** Queues Morpho-Compound `liquidate` using pool-token addresses. */
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

  /** Queues Morpho-Aave V2 `liquidate` using pool-token addresses. */
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

  /** Queues Morpho-Aave V3 `liquidate` using underlying token addresses. */
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

  /**
   * Queues Morpho Blue `supplyCollateral`.
   *
   * `callbackCalls` run inside Morpho's supply-collateral callback. The Executor must hold the collateral or obtain it
   * in the callback, and `onBehalf` receives the position.
   */
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

  /** Queues Morpho Blue `withdrawCollateral` to `receiver`. The caller must respect Morpho health-factor checks. */
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

  /**
   * Queues Morpho Blue `supply`.
   *
   * Pass either assets or shares according to Morpho Blue semantics. `callbackCalls` can source the loan token before
   * Morpho finalizes the supply.
   */
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

  /** Queues Morpho Blue `withdraw`. Pass either assets or shares and ensure the position remains healthy. */
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

  /**
   * Queues Morpho Blue `repay`.
   *
   * Pass either assets or shares according to Morpho Blue semantics. `callbackCalls` can source or approve repayment
   * tokens before the callback returns.
   */
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

  /** Queues Morpho Blue `borrow` to `receiver`. Ensure collateral and oracle assumptions are valid before execution. */
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

  /**
   * Queues Morpho Blue `liquidate`.
   *
   * `callbackCalls` run inside Morpho's liquidation callback and must provide whatever repayment asset or approvals the
   * liquidation path requires. Profitability depends on market state at execution.
   */
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
