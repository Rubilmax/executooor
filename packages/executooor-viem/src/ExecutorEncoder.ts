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
  sliceHex,
  stringToBytes,
  zeroAddress,
} from "viem";
import { writeContract } from "viem/actions";
import { erc20WrapperAbi } from "./abis";
import { executorAbi } from "./contracts/Executor";

/** Token and amount pair used by multi-asset flash-loan helpers. */
export interface AssetRequest {
  /** ERC20 token requested from the lending protocol. */
  asset: Address;
  /** Raw token amount in the token's native decimals. */
  amount: bigint;
}

/** Callback authorization installed while one Executor call is active. */
export interface CallbackContext {
  /** Contract address expected to call the Executor fallback. Use `zeroAddress` for no callback. */
  sender: Address;
  /** Zero-based ABI argument index containing encoded callback continuation data. */
  dataIndex: bigint;
}

/** Onchain read result copied into a queued call by `callWithPlaceholders4845164670`. */
export interface Placeholder {
  /** Contract queried with a static call before the main call is executed. */
  to: Address;
  /** Calldata used for the static call. */
  data: Hex;
  /** Byte offset in the main call calldata where returned bytes are copied. */
  offset: bigint;
  /** Number of bytes copied from the static-call return data. */
  length: bigint;
  /** Byte offset inside the static-call return data to copy from. */
  resOffset: bigint;
}

/** Morpho Blue market tuple, ordered to match the Morpho Blue ABI. */
export interface MarketParams {
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
}

/**
 * Builder for owner-submitted Executor batches using viem clients.
 *
 * Consumption flow:
 * 1. Create one encoder for an already deployed Executor address and a wallet client.
 * 2. Chain helper methods to queue Executor self-calls.
 * 3. Use `flush()` when a queued sequence must become callback continuation data.
 * 4. Use `exec()` to send the owner transaction or `encodeExec()` to hand `{to,data,value}` to another sender.
 *
 * Security model:
 * - The wallet client's account must be the Executor owner for `exec()`.
 * - Every helper only encodes calldata; it does not simulate profitability, slippage, token behavior, or repayment safety.
 * - Helpers that end in `All` patch calldata onchain with a balance read and depend on the token returning a standard
 *   32-byte `balanceOf` value.
 */
export class ExecutorEncoder<client extends Client<Transport, Chain, Account> = Client<Transport, Chain, Account>> {
  /**
   * Encodes one Executor self-call that will call `target`.
   *
   * Place this payload in `exec_606BaXt(bytes[])` or in callback continuation data. `context` is only needed when the
   * target is expected to call back into the Executor fallback during this call.
   *
   * Danger: `dataIndex` must match the callback function's ABI argument that carries `(bytes[],bytes)` continuation
   * data. A wrong index reverts or decodes invalid continuation data.
   */
  static buildCall(
    target: Address,
    value: bigint,
    callData: Hex,
    context: CallbackContext = { sender: zeroAddress, dataIndex: 0n },
    placeholders: Placeholder[] = [],
  ) {
    const encodedContext =
      `0x${context.dataIndex.toString(16).padStart(24, "0") + context.sender.substring(2)}` as const;

    if (placeholders.length)
      return encodeFunctionData({
        abi: executorAbi,
        functionName: "callWithPlaceholders4845164670",
        args: [target, value, encodedContext, callData, placeholders],
      });

    return encodeFunctionData({
      abi: executorAbi,
      functionName: "call_g0oyU7o",
      args: [target, value, encodedContext, callData],
    });
  }

  /**
   * Encodes an ERC20 approval as an Executor call payload.
   *
   * Use inside callback continuations or custom batches when a later protocol call needs allowance from the Executor.
   */
  static buildErc20Approve(asset: Address, recipient: Address, amount: bigint) {
    return ExecutorEncoder.buildCall(
      asset,
      0n,
      encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [recipient, amount] }),
    );
  }

  /**
   * Encodes an ERC20 transfer as an Executor call payload.
   *
   * Commonly used as a flash-loan repayment or final profit sweep inside callback continuation data.
   */
  static buildErc20Transfer(asset: Address, recipient: Address, amount: bigint) {
    return ExecutorEncoder.buildCall(
      asset,
      0n,
      encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, amount] }),
    );
  }

  protected totalValue = 0n;
  protected calls: Hex[] = [];

  /**
   * Creates a queue builder for a deployed Executor.
   *
   * @param address Deployed Executor contract address.
   * @param client viem wallet client. `exec()` requires its account to be the Executor owner.
   */
  constructor(
    public readonly address: Address,
    public readonly client: client,
  ) {}

  /**
   * Queues one arbitrary target call.
   *
   * This is the lowest-level JS helper. All protocol helpers eventually call `pushCall`, which wraps the target call
   * in Executor calldata and accumulates ETH value for `exec()`/`encodeExec()`.
   */
  pushCall(target: Address, value: bigint, callData: Hex, context?: CallbackContext, placeholders?: Placeholder[]) {
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
   * Sends the queued batch through `exec_606BaXt`.
   *
   * The transaction value is `sum(pushCall values) + value`. The queue is flushed before the transaction is sent, so
   * reuse requires building a new queue.
   */
  async exec(value = 0n) {
    const { address, totalValue, client } = this;

    value += totalValue;

    return await writeContract(client, {
      address,
      abi: executorAbi,
      functionName: "exec_606BaXt",
      args: [this.flush()],
      value,
    });
  }

  /**
   * Encodes, but does not send, the queued `exec_606BaXt` transaction.
   *
   * Use this when a bundler, relayer, multisig, or custom wallet will submit the owner transaction. Like `exec()`, this
   * flushes the local queue.
   */
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

  /**
   * Queues an ETH transfer from the Executor to `recipient`.
   *
   * Use near the end of a batch to sweep ETH profit or return funds. The Solidity helper caps the transfer to the
   * Executor's current ETH balance, so underfunding does not revert unless the recipient reverts.
   */
  transfer(recipient: Address, amount: bigint) {
    if (recipient === zeroAddress) throw Error("recipient should not be zero: use tip() instead");

    return this.pushCall(
      this.address,
      0n,
      encodeFunctionData({ abi: executorAbi, functionName: "transfer", args: [recipient, amount] }),
    );
  }

  /**
   * Queues an ETH transfer to `block.coinbase`.
   *
   * Use as the last batch step when paying a builder/validator. The actual recipient is chain and block-production
   * dependent, so do not use this as a normal user transfer.
   */
  tip(amount: bigint) {
    return this.pushCall(
      this.address,
      0n,
      encodeFunctionData({ abi: executorAbi, functionName: "transfer", args: [zeroAddress, amount] }),
    );
  }

  /* FLASHLOANS */

  /**
   * Queues a Balancer Vault flash loan.
   *
   * `callbackCalls` are flushed Executor payloads that run inside `receiveFlashLoan`; repayment transfers are appended
   * automatically for the borrowed principal. Balancer flash loans are assumed to have no fee for this helper.
   */
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

  /**
   * Queues an ERC-3156/Maker-style flash loan.
   *
   * `callbackCalls` run inside `onFlashLoan`; an approval for the borrowed principal is appended so the lender can pull
   * repayment. If the lender charges a fee, include extra approval or repayment logic yourself.
   */
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

  /**
   * Queues an Aave V2/V3 multi-asset flash loan.
   *
   * `premium` must be fetched from the selected pool and is used to approve `amount + percentMul(amount, premium)` for
   * every asset after `callbackCalls`. This helper opens no debt positions because all modes are zero.
   */
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
    pool: Address,
    [asset0, asset1]: readonly [Address, Address],
    [amount0, amount1]: readonly [bigint, bigint],
    callbackCalls?: Hex[],
  ) {
    callbackCalls ??= [];

    const repayment0 = amount0 === 0n ? 0n : amount0.mulDivUp(1000n, 997n);
    const repayment1 = amount1 === 0n ? 0n : amount1.mulDivUp(1000n, 997n);

    return this.pushCall(
      pool,
      0n,
      encodeFunctionData({
        abi: [
          {
            inputs: [
              { name: "amount0Out", type: "uint256" },
              { name: "amount1Out", type: "uint256" },
              { name: "to", type: "address" },
              { name: "data", type: "bytes" },
            ],
            name: "swap",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ],
        functionName: "swap",
        args: [
          amount0,
          amount1,
          this.address,
          encodeAbiParameters(
            [{ type: "bytes[]" }, { type: "bytes" }],
            [
              callbackCalls.concat([
                ...(repayment0 > 0n ? [ExecutorEncoder.buildErc20Transfer(asset0, pool, repayment0)] : []),
                ...(repayment1 > 0n ? [ExecutorEncoder.buildErc20Transfer(asset1, pool, repayment1)] : []),
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

  /**
   * Queues a Uniswap V3 pool flash loan.
   *
   * `callbackCalls` run inside `uniswapV3FlashCallback`; repayment transfers for both pool tokens are appended using
   * `fee` in hundredths of a bip, matching Uniswap V3 fee tiers such as 500, 3000, or 10000.
   */
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

  /**
   * Queues a Morpho Blue flash loan.
   *
   * `callbackCalls` run inside `onMorphoFlashLoan`; an approval for the borrowed amount is appended for repayment.
   */
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

  /**
   * Builds a placeholder that reads `balanceOf(owner)` and copies the returned balance into a later call.
   *
   * `offset` is the byte position of the uint256 argument inside the target function calldata, including the 4-byte
   * selector. This is the primitive behind `erc20ApproveAll`, `erc20Skim`, and other all-balance helpers.
   */
  erc20BalanceOf(asset: Address, owner: Address, offset: bigint) {
    return {
      to: asset,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
      offset,
      length: 32n,
      resOffset: 0n,
    };
  }

  /** Queues `ERC20.approve(spender, allowance)` from the Executor. Use before protocols that pull tokens. */
  erc20Approve(asset: Address, spender: Address, allowance: bigint) {
    return this.pushCall(
      asset,
      0n,
      encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, allowance] }),
    );
  }

  /**
   * Queues an ERC20 approval for the Executor's full token balance at execution time.
   *
   * Uses a placeholder to patch the allowance argument from `balanceOf(this.address)`. Tokens with non-standard
   * approval rules, rebasing behavior, or fee mechanics can make this unsafe.
   */
  erc20ApproveAll(asset: Address, spender: Address) {
    return this.pushCall(
      asset,
      0n,
      encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, 0n] }),
      undefined,
      [this.erc20BalanceOf(asset, this.address, 4n + 32n)],
    );
  }

  /** Queues `ERC20.transfer(recipient, amount)` from the Executor, usually for repayment or profit sweeping. */
  erc20Transfer(asset: Address, recipient: Address, amount: bigint) {
    return this.pushCall(
      asset,
      0n,
      encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, amount] }),
    );
  }

  /**
   * Queues `ERC20.transferFrom(owner, recipient, amount)` from the Executor.
   *
   * The `owner` must have approved the Executor before the owner batch reaches this step.
   */
  erc20TransferFrom(asset: Address, owner: Address, recipient: Address, amount: bigint) {
    return this.pushCall(
      asset,
      0n,
      encodeFunctionData({ abi: erc20Abi, functionName: "transferFrom", args: [owner, recipient, amount] }),
    );
  }

  /**
   * Queues an ERC20 transfer of the Executor's full token balance at execution time.
   *
   * Uses a placeholder to patch the transfer amount from `balanceOf(this.address)`. Fee-on-transfer or rebasing tokens
   * can make the observed amount differ from the amount finally received.
   */
  erc20Skim(asset: Address, recipient: Address) {
    return this.pushCall(
      asset,
      0n,
      encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, 0n] }),
      undefined,
      [this.erc20BalanceOf(asset, this.address, 4n + 32n)],
    );
  }

  /* WETH */

  /** Queues `WETH.deposit{value: amount}()` and adds `amount` to the owner transaction value. */
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

  /** Queues `WETH.withdraw(amount)`, leaving raw ETH in the Executor for later transfer, wrap, or protocol calls. */
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

  /** Queues `ERC20Wrapper.depositFor(onBehalf, amount)` after the Executor has underlying tokens and approval. */
  erc20WrapperDepositFor(asset: Address, onBehalf: Address, amount: bigint) {
    return this.pushCall(
      asset,
      0n,
      encodeFunctionData({
        abi: erc20WrapperAbi,
        functionName: "depositFor",
        args: [onBehalf, amount],
      }),
    );
  }

  /**
   * Queues `ERC20Wrapper.depositFor(onBehalf, full underlying balance)`.
   *
   * The amount is patched from the Executor's `underlying` balance at execution time.
   */
  erc20WrapperDepositAllFor(asset: Address, underlying: Address, onBehalf: Address) {
    return this.pushCall(
      asset,
      0n,
      encodeFunctionData({
        abi: erc20WrapperAbi,
        functionName: "depositFor",
        args: [onBehalf, 0n],
      }),
      undefined,
      [this.erc20BalanceOf(underlying, this.address, 4n + 32n)],
    );
  }

  /** Queues `ERC20Wrapper.withdrawTo(receiver, amount)` to unwrap wrapper shares/tokens held by the Executor. */
  erc20WrapperWithdrawTo(asset: Address, receiver: Address, amount: bigint) {
    return this.pushCall(
      asset,
      0n,
      encodeFunctionData({
        abi: erc20WrapperAbi,
        functionName: "withdrawTo",
        args: [receiver, amount],
      }),
    );
  }

  /**
   * Queues `ERC20Wrapper.withdrawTo(receiver, full wrapper balance)`.
   *
   * The amount is patched from the Executor's wrapper-token balance at execution time.
   */
  erc20WrapperWithdrawAllTo(asset: Address, receiver: Address) {
    return this.pushCall(
      asset,
      0n,
      encodeFunctionData({
        abi: erc20WrapperAbi,
        functionName: "withdrawTo",
        args: [receiver, 0n],
      }),
      undefined,
      [this.erc20BalanceOf(asset, this.address, 4n + 32n)],
    );
  }

  /* ERC4626 */

  /** Queues `ERC4626.deposit(assets, owner)` after the Executor holds assets and has approved the vault if required. */
  erc4626Deposit(vault: Address, assets: bigint, owner: Address) {
    return this.pushCall(
      vault,
      0n,
      encodeFunctionData({ abi: erc4626Abi, functionName: "deposit", args: [assets, owner] }),
    );
  }

  /**
   * Queues `ERC4626.deposit(full asset balance, owner)`.
   *
   * The asset amount is patched from `balanceOf(this.address)` on the underlying asset. Slippage/share-rate changes are
   * governed by the vault implementation, not by the Executor.
   */
  erc4626DepositAll(vault: Address, asset: Address, owner: Address) {
    return this.pushCall(
      vault,
      0n,
      encodeFunctionData({ abi: erc4626Abi, functionName: "deposit", args: [0n, owner] }),
      undefined,
      [this.erc20BalanceOf(asset, this.address, 4n)],
    );
  }

  /** Queues `ERC4626.mint(shares, owner)`, letting the vault determine required assets. */
  erc4626Mint(vault: Address, shares: bigint, owner: Address) {
    return this.pushCall(
      vault,
      0n,
      encodeFunctionData({ abi: erc4626Abi, functionName: "mint", args: [shares, owner] }),
    );
  }

  /** Queues `ERC4626.withdraw(assets, receiver, owner)`. The Executor must be `owner` or have share allowance. */
  erc4626Withdraw(vault: Address, assets: bigint, receiver: Address, owner: Address) {
    return this.pushCall(
      vault,
      0n,
      encodeFunctionData({ abi: erc4626Abi, functionName: "withdraw", args: [assets, receiver, owner] }),
    );
  }

  /** Queues `ERC4626.redeem(shares, receiver, owner)`. The Executor must be `owner` or have share allowance. */
  erc4626Redeem(vault: Address, shares: bigint, receiver: Address, owner: Address) {
    return this.pushCall(
      vault,
      0n,
      encodeFunctionData({ abi: erc4626Abi, functionName: "redeem", args: [shares, receiver, owner] }),
    );
  }

  /**
   * Queues `ERC4626.redeem(full share balance, receiver, owner)`.
   *
   * The share amount is patched from the Executor's vault-share balance at execution time.
   */
  erc4626RedeemAll(vault: Address, receiver: Address, owner: Address) {
    return this.pushCall(
      vault,
      0n,
      encodeFunctionData({ abi: erc4626Abi, functionName: "redeem", args: [0n, receiver, owner] }),
      undefined,
      [this.erc20BalanceOf(vault, this.address, 4n)],
    );
  }

  /* COMPOUND */

  /** Queues Compound/Compound-like `cToken.mint(amount)` to supply underlying from the Executor. */
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

  /** Queues `cToken.borrow(amount)`. The Executor must already have sufficient collateral/account liquidity. */
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

  /**
   * Queues Compound repayment.
   *
   * Calls `repayBorrow(amount)` for the Executor's own debt or `repayBorrowBehalf(onBehalfOf, amount)` when
   * `onBehalfOf` is provided. The Executor must hold and approve the underlying token as required by the cToken.
   */
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

  /** Queues `cToken.redeemUnderlying(amount)` to withdraw supplied underlying to the Executor. */
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

  /** Queues Aave V2-compatible `deposit(asset, amount, onBehalfOf, 0)`. Defaults `onBehalfOf` to the Executor. */
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

  /**
   * Queues Aave V2-compatible `borrow`.
   *
   * `interestRateMode` is protocol-specific, commonly `1` for stable where supported and `2` for variable. Defaults
   * `onBehalfOf` to the Executor.
   */
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

  /**
   * Queues Aave V2-compatible `repay`.
   *
   * The Executor must hold the debt asset and approve the pool. Defaults `onBehalfOf` to the Executor.
   */
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

  /** Queues Aave V2-compatible `withdraw(asset, amount, to)`. Defaults `to` to the Executor. */
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

  /**
   * Queues Aave V2-compatible `liquidationCall` with `receiveAToken = false`.
   *
   * The Executor must hold and approve the debt asset; liquidation profitability and close-factor rules are external
   * protocol concerns.
   */
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

  /**
   * Queues Uniswap V3 router `exactInput`.
   *
   * `path` is the packed V3 path. The helper sets a short deadline at encoding time, so build and submit promptly.
   * Always provide a meaningful `amountOutMinimum` outside tests.
   */
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

  /**
   * Queues Uniswap V3 `exactInput` using the Executor's full balance of the first token in `path`.
   *
   * The first 20 bytes of `path` are treated as the input token address and used for the balance placeholder.
   */
  uniV3ExactInputAll(uniV3RouterAddress: Address, path: Hex, amountOutMinimum: bigint, recipient?: Address) {
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
            amountIn: 0n,
            amountOutMinimum,
          },
        ],
      }),
      undefined,
      [this.erc20BalanceOf(sliceHex(path, 0, 20), this.address, 4n + 32n * 4n)],
    );
  }

  /**
   * Queues Uniswap V3 router `exactOutput`.
   *
   * `path` is the packed reverse path required by Uniswap V3 exact-output swaps. The helper sets a short deadline at
   * encoding time. Set `amountInMaximum` tightly and clean up leftover allowance if needed.
   */
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

  /** Queues Morpho-Compound `liquidate` using pool-token addresses. */
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

  /** Queues Morpho-Aave V2 `liquidate` using pool-token addresses. */
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

  /** Queues Morpho-Aave V3 `liquidate` using underlying token addresses. */
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

  /**
   * Queues Morpho Blue `supplyCollateral`.
   *
   * `callbackCalls` run inside Morpho's supply-collateral callback. The Executor must hold the collateral or obtain it
   * in the callback, and `onBehalf` receives the position.
   */
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

  /** Queues Morpho Blue `withdrawCollateral` to `receiver`. The caller must respect Morpho health-factor checks. */
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

  /**
   * Queues Morpho Blue `supply`.
   *
   * Pass either assets or shares according to Morpho Blue semantics. `callbackCalls` can source the loan token before
   * Morpho finalizes the supply.
   */
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

  /** Queues Morpho Blue `withdraw`. Pass either assets or shares and ensure the position remains healthy. */
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

  /**
   * Queues Morpho Blue `repay`.
   *
   * Pass either assets or shares according to Morpho Blue semantics. `callbackCalls` can source or approve repayment
   * tokens before the callback returns.
   */
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

  /** Queues Morpho Blue `borrow` to `receiver`. Ensure collateral and oracle assumptions are valid before execution. */
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

  /**
   * Queues Morpho Blue `liquidate`.
   *
   * `callbackCalls` run inside Morpho's liquidation callback and must provide whatever repayment asset or approvals the
   * liquidation path requires. Profitability depends on market state at execution.
   */
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
