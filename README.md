# multidelegatecall

[![npm package][npm-img]][npm-url]
[![Build Status][build-img]][build-url]
[![Downloads][downloads-img]][downloads-url]
[![Issues][issues-img]][issues-url]
[![Commitizen Friendly][commitizen-img]][commitizen-url]
[![Semantic Release][semantic-release-img]][semantic-release-url]

> 🛣️ Batch calls and/or delegatecalls to any onchain smart contract, handling any callback, without writing and deploying any contract!

Ethereum's environment evolves fast. So fast that you can't keep up writing and deploying a new contract everytime you want to do something atomically onchain (not mentioning you also have to approve this freshly deployed contract to spend your favorite ERC20/ERC721!).

Welcome `multidelegatecall`'s `Executor` contract:

1. Calculate whatever you need to submit your execution
2. Chain calls / delegatecalls as needed to execute whatever you want to execute atomically onchain (using `ethers-v6`)
3. Optionally prepend any ERC20/ERC721 approval via a third-party bundling service (such as Flashbots)
4. Submit your execution transaction (or bundle)
5. For MEV out there: tip the bundler

---

## Installation

```bash
npm install multidelegatecall
```

```bash
yarn add multidelegatecall
```

---

## Usage

### Deployment

Deploy your very own `Executor` contract with the owner address you want, once and for all.
The owner can always be changed by calling `transferOwnership`.

### Using ethers-v6

Create an `ExecutorEncoder` instance and chain any calls wanted. Then, submit the transaction using `exec` (or populate the transaction using `populateExec`!).

```typescript
import { ExecutorEncoder } from "multidelegatecall";

const encoder = new ExecutorEncoder(executorAddress, signer);

await encoder
  // Flash loan some tokens on Balancer (0% fee).
  .balancerFlashLoan(
    balancerVaultAddress,
    [{ asset: dai, amount: collateralAmount }],
    // Chain calls executed inside Balancer's flash loan callback then flush it.
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
  // Execute the transaction.
  .exec();
```

[build-img]: https://github.com/rubilmax/multidelegatecall/actions/workflows/release.yml/badge.svg
[build-url]: https://github.com/rubilmax/multidelegatecall/actions/workflows/release.yml
[downloads-img]: https://img.shields.io/npm/dt/multidelegatecall
[downloads-url]: https://www.npmtrends.com/multidelegatecall
[npm-img]: https://img.shields.io/npm/v/multidelegatecall
[npm-url]: https://www.npmjs.com/package/multidelegatecall
[issues-img]: https://img.shields.io/github/issues/rubilmax/multidelegatecall
[issues-url]: https://github.com/rubilmax/multidelegatecall/issues
[codecov-img]: https://codecov.io/gh/rubilmax/multidelegatecall/branch/main/graph/badge.svg
[codecov-url]: https://codecov.io/gh/rubilmax/multidelegatecall
[semantic-release-img]: https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg
[semantic-release-url]: https://github.com/semantic-release/semantic-release
[commitizen-img]: https://img.shields.io/badge/commitizen-friendly-brightgreen.svg
[commitizen-url]: http://commitizen.github.io/cz-cli/
