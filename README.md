# executooor

[![npm package][npm-img]][npm-url]
[![Build Status][build-img]][build-url]
[![Downloads][downloads-img]][downloads-url]
[![Issues][issues-img]][issues-url]
[![Commitizen Friendly][commitizen-img]][commitizen-url]
[![Semantic Release][semantic-release-img]][semantic-release-url]

> 🛣️ Batch multiple calls to any onchain smart contract in a single transaction, handling any callback, without writing and deploying any contract!

Ethereum's environment evolves fast. So fast that you can't keep up writing and deploying a new contract everytime you want to do something atomically onchain (not mentioning you also have to approve this freshly deployed contract to spend your favorite ERC20/ERC721!).

Welcome the `Executor` contract:

1. Calculate whatever you need to submit your execution
2. Chain calls as needed to execute whatever you want to execute atomically onchain (using `viem` and/or `ethers-v6`!)
3. Optionally prepend any ERC20/ERC721 approval via a third-party bundling service (such as Flashbots)
4. Submit your execution transaction (or bundle)
5. For MEV out there: tip the bundler

You can even atomically populate your chain of calls if it depends on some state change!
For example, you can skim ERC20 tokens after an execution by simply requesting the balance left onchain and replacing it in the onchain call.

---

## Installation

### viem

```bash
npm install executooor-viem
```

```bash
yarn add executooor-viem
```

### ethers-v6

```bash
npm install executooor-ethers
```

```bash
yarn add executooor-ethers
```

Both packages expect `evm-maths` as a peer dependency because a few helpers use bigint math helpers such as `percentMul` and `mulDivUp`.

---

## Usage

### Deployment

Deploy your very own `Executor` contract with the owner address you want, once and for all, using the [custom deployment interface](https://rubilmax.github.io/executooor/) (that you can also build locally).

A mere deployment cost of [~0.003 ETH @ 10 gwei](https://etherscan.io/tx/0x77831c7dd4062a158efa527fc43938e0bafedac8c1de86703addc36e9b8ef077)!

<details>
<summary>Raw deployment bytecode shape</summary>

If you broadcast a raw creation transaction, append the ABI-encoded owner address to the creation bytecode: 12 zero bytes, then your 20-byte owner address.

```text
60a034606657601f61065538819003918201601f19168301916001600160401b03831184841017606a57808492602094604052833981010312606657516001600160a01b03811681036066576080526040516105d6908161007f8239608051816103500152f35b5f80fd5b634e487b7160e01b5f52604160045260245ffdfe604060808152600480361015610117575b3615610115575f5c6001600160a01b03811633036100ec576c1fffffffffffffffffffffffe090609b1c1681013501803590825190602092839181830190843782010183528051810183828483019203126100ec57828201519067ffffffffffffffff918281116100ec5783019481603f870112156100ec57848601519561009f61009a8861049a565b610408565b96828789838152019160051b830101918483116100ec57838101915b8383106100f057505050508301519182116100ec57836100e0926100e694010161051a565b92610564565b81519101f35b5f80fd5b82518781116100ec57899161010a8888859487010161051a565b8152019201916100bb565b005b5f3560e01c80156103ad57806001146102e9578060021461019b5763a9059cbb0361001057503660031901126100ec5761014f6103f2565b806024353033036100ec575f918291829182916001600160a01b03871615610193575b478181109082180218905af16101866104b2565b901561018e57005b610556565b419150610172565b5060a03660031901126100ec576101b06103f2565b60249267ffffffffffffffff926064604481358681116100ec576101d7903690850161045e565b95608494608435948286116100ec57366023870112156100ec5785013598828a116100ec576005993660248260051b890101116100ec57953681900360c21901905f5b888110610231576101158c6044356024358e6104d7565b83818e1b83010135838112156100ec578201848101356001600160a01b03811681036100ec5788820135604219833603018112156100ec5782019086820135918983116100ec578a019082360382136100ec57825f939284938b519283928337810184815203915afa906102a36104b2565b91156102e357908d60a48d846102c86102c08f6001999801610505565b928201610505565b946102d7602094859301610505565b01019201015e0161021a565b50610556565b506020806003193601126100ec57813567ffffffffffffffff928382116100ec57366023830112156100ec5781013560249061032761009a8261049a565b946024602087848152019260051b850101933685116100ec5760248101925b85841061038757877f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633036100ec5761011590610564565b83358381116100ec5787916103a2839288369187010161045e565b815201930192610346565b5060803660031901126100ec576103c26103f2565b60643567ffffffffffffffff81116100ec57610115926103e49136910161045e565b9060443590602435906104d7565b600435906001600160a01b03821682036100ec57565b6040519190601f01601f1916820167ffffffffffffffff81118382101761042e57604052565b634e487b7160e01b5f52604160045260245ffd5b67ffffffffffffffff811161042e57601f01601f191660200190565b81601f820112156100ec5780359061047861009a83610442565b92828452602083830101116100ec57815f926020809301838601378301015290565b67ffffffffffffffff811161042e5760051b60200190565b3d156104d2573d906104c661009a83610442565b9182523d5f602084013e565b606090565b91923033036100ec575f928392835c95845d602083519301915af16104fa6104b2565b901561018e57505f5d565b3567ffffffffffffffff811681036100ec5790565b81601f820112156100ec5780519061053461009a83610442565b92828452602083830101116100ec57815f9260208093018386015e8301015290565b80519081156100ec57602001fd5b5f5b815181101561059c575f806020808460051b86010151908151910182305af161058d6104b2565b901561018e5750600101610566565b505056fea26469706673582212208edf93e4e14b1673e3048e9c96a6f23aa0d7741ea86ee9ce576e223b1a7cc83864736f6c63430008190033000000000000000000000000{YOUR_20_BYTES_OWNER_ADDRESS_WITHOUT_0X}
```

</details>

You can also deploy from code. The bytecode is exported by `executooor-viem`, and the ethers package exposes the TypeChain factory.

```typescript
import { bytecode, executorAbi } from "executooor-viem";

await walletClient.deployContract({
  abi: executorAbi,
  bytecode,
  args: [ownerAddress],
});
```

The owner is immutable and is the only address allowed to call `exec_606BaXt`. Use your bot EOA, multisig, or account abstraction wallet. If you need to rotate the owner, deploy a new `Executor`.

### Execution

Create an `ExecutorEncoder` instance and chain any calls wanted. Then, submit the transaction using `exec` (or populate the transaction using `populateExec` / `encodeExec`!).

#### Using viem

```typescript
import { maxUint256 } from "viem";
import { ExecutorEncoder } from "executooor-viem";

const encoder = new ExecutorEncoder(executorAddress, walletClient);

await encoder
  // Flash loan some tokens on Balancer.
  .balancerFlashLoan(
    balancerVaultAddress,
    [{ asset: dai, amount: collateralAmount }],
    // Chain calls executed inside Balancer's flash loan callback then flush it.
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
  // Execute the transaction.
  .exec();
```

#### Using ethers-v6

```typescript
import { MaxUint256 } from "ethers";
import { ExecutorEncoder } from "executooor-ethers";

const encoder = new ExecutorEncoder(executorAddress, ownerSigner);

await encoder
  // Flash loan some tokens on Balancer.
  .balancerFlashLoan(
    balancerVaultAddress,
    [{ asset: dai, amount: collateralAmount }],
    // Chain calls executed inside Balancer's flash loan callback then flush it.
    encoder
      .erc20Approve(dai, aaveV2PoolAddress, collateralAmount)
      .aaveSupply(aaveV2PoolAddress, dai, collateralAmount)
      .aaveBorrow(aaveV2PoolAddress, weth, borrowedAmount, 2)
      .unwrapETH(weth, borrowedAmount)
      .wrapETH(weth, borrowedAmount)
      .erc20Approve(weth, aaveV2PoolAddress, borrowedAmount)
      .aaveRepay(aaveV2PoolAddress, weth, borrowedAmount, 2)
      .aaveWithdraw(aaveV2PoolAddress, dai, MaxUint256)
      .flush(),
  )
  // Execute the transaction.
  .exec();
```

### How the pieces fit together

The normal consumption flow is:

1. The owner calls `exec_606BaXt(bytes[])`.
2. Every item in `bytes[]` is a self-call to the `Executor` contract.
3. Most items are encoded `call_g0oyU7o(target, value, context, callData)` calls.
4. Helpers ending in `All` or `Skim` use `callWithPlaceholders4845164670` to read a live balance and patch it into calldata.
5. Callback helpers set a temporary callback context, then the protocol calls the Executor fallback.
6. The fallback decodes `(bytes[] callbackCalls, bytes returnData)` from the protocol callback data, executes `callbackCalls`, and returns `returnData` to the protocol.

`flush()` is important: it returns the queued calls and clears the local encoder. Use it when you want a sequence to run inside a callback instead of directly in the outer batch.

### Contract functions

| Function | Where it sits in the flow | What to watch |
| --- | --- | --- |
| `constructor(address _owner)` | Deploy once before using the SDK. | The owner is immutable. `address(0)` permanently disables normal execution. |
| `exec_606BaXt(bytes[] data)` | The only intended owner entry point. | Reverts atomically if any inner call reverts. ETH sent here funds payable queued calls. |
| `call_g0oyU7o(address target, uint256 value, bytes32 context, bytes callData)` | Encoded by `buildCall` / `pushCall`; called by the Executor itself. | Arbitrary target calls can move Executor assets. Wrong callback context makes callbacks revert. |
| `callWithPlaceholders4845164670(...)` | Encoded automatically when placeholders are provided. | Placeholder offsets are raw byte offsets into ABI calldata. Non-standard token balances can break assumptions. |
| `transfer(address recipient, uint256 amount)` | Encoded by `transfer` and `tip`. | `recipient == address(0)` means `block.coinbase`; amount is capped to the Executor's current ETH balance. |
| `receive()` | Accepts ETH from WETH withdrawals, swaps, and direct transfers. | Receiving ETH does not execute anything. |
| `fallback(bytes)` | Handles protocol callbacks while an active call has authorized the callback sender. | Callback sender and data index must match the protocol exactly. |

The contract uses transient storage (`TLOAD`/`TSTORE`) for callback context, so it targets Cancun/EIP-1153-compatible chains.

### Encoder primitives

Use these when the dedicated helpers do not cover your strategy:

```typescript
// Queue an arbitrary call.
encoder.pushCall(oneInchRouter, 0n, oneInchSwapCalldata);

// Build payloads without mutating an encoder, useful for callback arrays.
const repay = ExecutorEncoder.buildErc20Transfer(dai, balancerVaultAddress, amount);
const custom = ExecutorEncoder.buildCall(target, 0n, callData, {
  sender: callbackCaller,
  dataIndex: 1n,
});

// Populate instead of sending.
const viemTx = await encoder.erc20Skim(dai, owner).encodeExec(); // viem
const ethersTx = await encoder.erc20Skim(dai, owner).populateExec(); // ethers-v6
```

### Existing helpers

#### ETH and WETH

```typescript
await encoder
  .wrapETH(weth, amount)
  .unwrapETH(weth, amount)
  .transfer(owner, amount)
  .tip(builderTip)
  .exec();
```

`wrapETH` adds `amount` to the transaction value automatically. `transfer` and `tip` move raw ETH already held by the Executor.

#### ERC20

```typescript
await encoder
  .erc20TransferFrom(usdc, owner, executorAddress, amount)
  .erc20Approve(usdc, spender, amount)
  .erc20Transfer(usdc, recipient, amount)
  .exec();

await encoder.erc20ApproveAll(usdc, spender).exec();
await encoder.erc20Skim(usdc, owner).exec();
```

`erc20ApproveAll` and `erc20Skim` patch the amount from `balanceOf(executor)` during execution.

#### ERC20 wrappers

```typescript
await encoder
  .erc20Approve(underlying, wrapper, amount)
  .erc20WrapperDepositFor(wrapper, owner, amount)
  .erc20WrapperWithdrawTo(wrapper, owner, amount)
  .exec();

await encoder.erc20WrapperDepositAllFor(wrapper, underlying, owner).exec();
await encoder.erc20WrapperWithdrawAllTo(wrapper, owner).exec();
```

#### ERC4626

```typescript
await encoder
  .erc20Approve(asset, vault, assets)
  .erc4626Deposit(vault, assets, executorAddress)
  .erc4626Mint(vault, shares, executorAddress)
  .erc4626Withdraw(vault, assets / 2n, owner, executorAddress)
  .erc4626Redeem(vault, shares / 2n, owner, executorAddress)
  .exec();

await encoder.erc4626DepositAll(vault, asset, executorAddress).exec();
await encoder.erc4626RedeemAll(vault, owner, executorAddress).exec();
```

Vault exchange rates can move between encoding and execution. The Executor does not add min-share or max-asset checks.

#### Flash loans and flash swaps

```typescript
await encoder.balancerFlashLoan(balancerVault, [{ asset: dai, amount }], callbackCalls).exec();
await encoder.makerFlashLoan(makerLender, dai, amount, callbackCalls).exec();
await encoder.aaveFlashLoan(aavePool, [{ asset: usdc, amount }], flashloanPremium, callbackCalls).exec();
await encoder.uniV2FlashSwap(pair, [token0, token1], [amount0, 0n], callbackCalls).exec();
await encoder.uniV3FlashLoan(pool, [token0, token1], [amount0, amount1], 500n, callbackCalls).exec();
await encoder.blueFlashLoan(morphoBlue, loanToken, amount, callbackCalls).exec();
```

These helpers encode the protocol-specific callback context and append the repayment action they can infer. You remain responsible for fees, approvals, balances, slippage, profitability, and callback ordering.

#### Compound-style markets

```typescript
await encoder
  .erc20Approve(underlying, cToken, amount)
  .compoundSupply(cToken, amount)
  .compoundBorrow(cBorrowToken, borrowAmount)
  .compoundRepay(cBorrowToken, borrowAmount)
  .compoundWithdraw(cToken, amount)
  .exec();

await encoder.compoundRepay(cBorrowToken, amount, borrower).exec();
```

The helpers do not enter markets, check collateral factors, or check account liquidity.

#### Aave V2-compatible pools

```typescript
await encoder
  .erc20Approve(dai, aavePool, collateralAmount)
  .aaveSupply(aavePool, dai, collateralAmount)
  .aaveBorrow(aavePool, weth, borrowAmount, 2n)
  .erc20Approve(weth, aavePool, borrowAmount)
  .aaveRepay(aavePool, weth, borrowAmount, 2n)
  .aaveWithdraw(aavePool, dai, maxUint256, owner)
  .exec();

await encoder.aaveLiquidate(aavePool, collateralAsset, debtAsset, unhealthyUser, debtToCover).exec();
```

`interestRateMode`, liquidation close factor, and health factor are protocol concerns. The Executor only encodes the calls.

#### Uniswap V3

```typescript
await encoder
  .erc20Approve(usdc, uniV3Router, amountIn)
  .uniV3ExactInput(uniV3Router, path, amountIn, minAmountOut, owner)
  .exec();

await encoder.erc20ApproveAll(usdc, uniV3Router).uniV3ExactInputAll(uniV3Router, path, minAmountOut).exec();
await encoder.erc20Approve(usdc, uniV3Router, maxIn).uniV3ExactOutput(uniV3Router, reversePath, amountOut, maxIn).exec();
```

The swap helpers set a short deadline when calldata is encoded. Use real slippage bounds; `0` is only suitable for tests or controlled simulations.

#### Morpho

```typescript
await encoder.morphoCompoundLiquidate(morphoCompound, borrowedPoolToken, collateralPoolToken, borrower, amount).exec();
await encoder.morphoAaveV2Liquidate(morphoAaveV2, borrowedPoolToken, collateralPoolToken, borrower, amount).exec();
await encoder.morphoAaveV3Liquidate(morphoAaveV3, debtAsset, collateralAsset, borrower, amount).exec();
```

Morpho Blue helpers use the Morpho Blue market tuple:

```typescript
const market = {
  loanToken,
  collateralToken,
  oracle,
  irm,
  lltv,
};

await encoder
  .morphoBlueSupplyCollateral(morphoBlue, market, collateralAmount, executorAddress)
  .morphoBlueBorrow(morphoBlue, market, borrowAssets, 0n, executorAddress, owner)
  .morphoBlueRepay(morphoBlue, market, repayAssets, 0n, executorAddress)
  .morphoBlueWithdrawCollateral(morphoBlue, market, collateralAmount, executorAddress, owner)
  .exec();

await encoder.morphoBlueSupply(morphoBlue, market, supplyAssets, 0n, owner, callbackCalls).exec();
await encoder.morphoBlueWithdraw(morphoBlue, market, withdrawAssets, 0n, owner, owner).exec();
await encoder.morphoBlueLiquidate(morphoBlue, market, borrower, seizedAssets, repaidShares, callbackCalls).exec();
```

Morpho functions often accept either assets or shares. Passing both non-zero values when Morpho expects one side to be zero will revert.

### Placeholders

Placeholders make a call depend on state observed during the same transaction. For example, `erc20Skim(token, recipient)` queues `transfer(recipient, 0)` and replaces the `0` with `token.balanceOf(executor)` immediately before the transfer.

Manual placeholder example:

```typescript
const callData = encodeFunctionData({
  abi: erc20Abi,
  functionName: "transfer",
  args: [recipient, 0n],
});

encoder.pushCall(token, 0n, callData, undefined, [encoder.erc20BalanceOf(token, executorAddress, 4n + 32n)]);
```

Offsets include the 4-byte selector. In the ERC20 transfer ABI, the `amount` argument starts at `4 + 32`.

---

## Security assumptions and edge cases

- The Executor is not a policy engine. It executes whatever the owner batch encodes.
- Keep idle balances and unlimited approvals on the Executor intentionally small. A compromised owner can move them.
- `exec()` is atomic, but public mempools can expose strategy calldata. Use private orderflow when that matters.
- Callback contexts check `msg.sender` and one ABI data index. You must know the exact protocol callback sender and argument index.
- Placeholder offsets are raw byte offsets and easy to get wrong in custom calls.
- `All` helpers use `balanceOf` at execution time; rebasing, fee-on-transfer, ERC777-style hooks, blacklists, and non-standard return values can break assumptions.
- Flash-loan helpers append common repayment actions, but fees and repayment mechanics can differ by market.
- Swap helpers do not quote routes or protect you from bad prices. Set slippage limits and deadlines intentionally.
- `tip()` sends to `block.coinbase`; on some chains or builder paths that may not be the party you intended to pay.
- The contract requires Cancun transient storage support.

---

## Development

Set a mainnet RPC URL for forked Hardhat tests:

```bash
export MAINNET_RPC_URL="https://..."
yarn --cwd packages/executooor-viem test
yarn --cwd packages/executooor-ethers test
```

Useful checks:

```bash
yarn lint
yarn --cwd packages/executooor-viem typecheck
yarn --cwd packages/executooor-ethers typecheck
forge fmt --check
```

[build-img]: https://github.com/rubilmax/executooor/actions/workflows/release.yml/badge.svg
[build-url]: https://github.com/rubilmax/executooor/actions/workflows/release.yml
[downloads-img]: https://img.shields.io/npm/dt/executooor
[downloads-url]: https://www.npmtrends.com/executooor
[npm-img]: https://img.shields.io/npm/v/executooor
[npm-url]: https://www.npmjs.com/package/executooor
[issues-img]: https://img.shields.io/github/issues/rubilmax/executooor
[issues-url]: https://github.com/rubilmax/executooor/issues
[codecov-img]: https://codecov.io/gh/rubilmax/executooor/branch/main/graph/badge.svg
[codecov-url]: https://codecov.io/gh/rubilmax/executooor
[semantic-release-img]: https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg
[semantic-release-url]: https://github.com/semantic-release/semantic-release
[commitizen-img]: https://img.shields.io/badge/commitizen-friendly-brightgreen.svg
[commitizen-url]: http://commitizen.github.io/cz-cli/
