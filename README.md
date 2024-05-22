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
2. Chain calls / delegatecalls as needed to execute whatever you want to execute atomically onchain (using `ethers-v6`)
3. Optionally prepend any ERC20/ERC721 approval via a third-party bundling service (such as Flashbots)
4. Submit your execution transaction (or bundle)
5. For MEV out there: tip the bundler

---

## Installation

```bash
npm install executooor
```

```bash
yarn add executooor
```

---

## Usage

### Deployment

Deploy your very own `Executor` contract with the owner address you want, once and for all.

The exact deployment bytecode is given below for convenience. You can deploy the Executor by broadcasting a transaction with this exact bytecode, appended with the owner address you want (typically your bot address).

```typescript
0x60a034606657601f6104de38819003918201601f19168301916001600160401b03831184841017606a57808492602094604052833981010312606657516001600160a01b038116810360665760805260405161045f908161007f8239608051816101fa0152f35b5f80fd5b634e487b7160e01b5f52604160045260245ffdfe604060808152600480361015610117575b3615610115575f5c6001600160a01b03811633036100ec576c1fffffffffffffffffffffffe090609b1c1681013501803590825190602092839181830190843782010183528051810183828483019203126100ec57828201519067ffffffffffffffff918281116100ec5783019481603f870112156100ec57848601519561009f61009a88610366565b6102d4565b96828789838152019160051b830101918483116100ec57838101915b8383106100f057505050508301519182116100ec57836100e0926100e69401016103a3565b926103ed565b81519101f35b5f80fd5b82518781116100ec57899161010a888885948701016103a3565b8152019201916100bb565b005b5f3560e01c801561025757806001146101935763a9059cbb0361001057503660031901126100ec576101476102be565b806024353033036100ec575f918291829182916001600160a01b0387161561018b575b478181109082180218905af161017e61037e565b901561018657005b6103df565b41915061016a565b506020806003193601126100ec57813567ffffffffffffffff928382116100ec57366023830112156100ec578101356024906101d161009a82610366565b946024602087848152019260051b850101933685116100ec5760248101925b85841061023157877f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633036100ec57610115906103ed565b83358381116100ec57879161024c839288369187010161032a565b8152019301926101f0565b5060803660031901126100ec5761026c6102be565b906064359067ffffffffffffffff82116100ec5761028c9136910161032a565b3033036100ec575f8091815c93604435835d60208251920190602435905af16102b361037e565b901561018657505f5d005b600435906001600160a01b03821682036100ec57565b6040519190601f01601f1916820167ffffffffffffffff8111838210176102fa57604052565b634e487b7160e01b5f52604160045260245ffd5b67ffffffffffffffff81116102fa57601f01601f191660200190565b81601f820112156100ec5780359061034461009a8361030e565b92828452602083830101116100ec57815f926020809301838601378301015290565b67ffffffffffffffff81116102fa5760051b60200190565b3d1561039e573d9061039261009a8361030e565b9182523d5f602084013e565b606090565b81601f820112156100ec578051906103bd61009a8361030e565b92828452602083830101116100ec57815f9260208093018386015e8301015290565b80519081156100ec57602001fd5b5f5b8151811015610425575f806020808460051b86010151908151910182305af161041661037e565b901561018657506001016103ef565b505056fea26469706673582212205b6c9a6d226fe7c94bfc3fbe57a8cb47882d1f8bea28f73ff14af40b3ad5d41e64736f6c63430008190033000000000000000000000000{YOUR_20_BYTES_OWNER_ADDRESS}
```

### Using ethers-v6

Create an `ExecutorEncoder` instance and chain any calls wanted. Then, submit the transaction using `exec` (or populate the transaction using `populateExec`!).

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
