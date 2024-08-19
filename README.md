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
2. Chain calls / delegatecalls as needed to execute whatever you want to execute atomically onchain (using `viem` and/or `ethers-v6`!)
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

---

## Usage

### Deployment

Deploy your very own `Executor` contract with the owner address you want, once and for all, using the [custom deployment interface](https://rubilmax.github.io/executooor/) (that you can also build locally).

The exact deployment bytecode is given below for convenience. You can deploy the Executor by broadcasting a transaction with this exact bytecode, appended with the owner address you want (typically your bot address).

A merely cost of [0.003 ETH @ 10 gwei](https://etherscan.io/tx/0x77831c7dd4062a158efa527fc43938e0bafedac8c1de86703addc36e9b8ef077)!

```typescript
0x60a034606657601f61065538819003918201601f19168301916001600160401b03831184841017606a57808492602094604052833981010312606657516001600160a01b03811681036066576080526040516105d6908161007f8239608051816103500152f35b5f80fd5b634e487b7160e01b5f52604160045260245ffdfe604060808152600480361015610117575b3615610115575f5c6001600160a01b03811633036100ec576c1fffffffffffffffffffffffe090609b1c1681013501803590825190602092839181830190843782010183528051810183828483019203126100ec57828201519067ffffffffffffffff918281116100ec5783019481603f870112156100ec57848601519561009f61009a8861049a565b610408565b96828789838152019160051b830101918483116100ec57838101915b8383106100f057505050508301519182116100ec57836100e0926100e694010161051a565b92610564565b81519101f35b5f80fd5b82518781116100ec57899161010a8888859487010161051a565b8152019201916100bb565b005b5f3560e01c80156103ad57806001146102e9578060021461019b5763a9059cbb0361001057503660031901126100ec5761014f6103f2565b806024353033036100ec575f918291829182916001600160a01b03871615610193575b478181109082180218905af16101866104b2565b901561018e57005b610556565b419150610172565b5060a03660031901126100ec576101b06103f2565b60249267ffffffffffffffff926064604481358681116100ec576101d7903690850161045e565b95608494608435948286116100ec57366023870112156100ec5785013598828a116100ec576005993660248260051b890101116100ec57953681900360c21901905f5b888110610231576101158c6044356024358e6104d7565b83818e1b83010135838112156100ec578201848101356001600160a01b03811681036100ec5788820135604219833603018112156100ec5782019086820135918983116100ec578a019082360382136100ec57825f939284938b519283928337810184815203915afa906102a36104b2565b91156102e357908d60a48d846102c86102c08f6001999801610505565b928201610505565b946102d7602094859301610505565b01019201015e0161021a565b50610556565b506020806003193601126100ec57813567ffffffffffffffff928382116100ec57366023830112156100ec5781013560249061032761009a8261049a565b946024602087848152019260051b850101933685116100ec5760248101925b85841061038757877f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633036100ec5761011590610564565b83358381116100ec5787916103a2839288369187010161045e565b815201930192610346565b5060803660031901126100ec576103c26103f2565b60643567ffffffffffffffff81116100ec57610115926103e49136910161045e565b9060443590602435906104d7565b600435906001600160a01b03821682036100ec57565b6040519190601f01601f1916820167ffffffffffffffff81118382101761042e57604052565b634e487b7160e01b5f52604160045260245ffd5b67ffffffffffffffff811161042e57601f01601f191660200190565b81601f820112156100ec5780359061047861009a83610442565b92828452602083830101116100ec57815f926020809301838601378301015290565b67ffffffffffffffff811161042e5760051b60200190565b3d156104d2573d906104c661009a83610442565b9182523d5f602084013e565b606090565b91923033036100ec575f928392835c95845d602083519301915af16104fa6104b2565b901561018e57505f5d565b3567ffffffffffffffff811681036100ec5790565b81601f820112156100ec5780519061053461009a83610442565b92828452602083830101116100ec57815f9260208093018386015e8301015290565b80519081156100ec57602001fd5b5f5b815181101561059c575f806020808460051b86010151908151910182305af161058d6104b2565b901561018e5750600101610566565b505056fea26469706673582212209ea2df6837d18ef0e252f0c0b3546a4743466c58b81fdc2d35d38348e99a319364736f6c63430008190033000000000000000000000000{YOUR_20_BYTES_OWNER_ADDRESS}
```

### Execution

Create an `ExecutorEncoder` instance and chain any calls wanted. Then, submit the transaction using `exec` (or populate the transaction using `populateExec`!).

#### Using viem

```typescript
import { ExecutorEncoder } from "executooor";

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

#### Using ethers-v6

```typescript
import { ExecutorEncoder } from "executooor";

const encoder = new ExecutorEncoder(executorAddress, walletClient);

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
