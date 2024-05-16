// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.5.0;

struct ExecContext {
    address owner;
    uint96 fallbackDataIndex;
}

interface IExecutor {
    function owner() external view returns (address);

    function transferOwnership(address newOwner) external payable;

    function exec_606BaXt(bytes[] memory data) external payable;

    function call_m08sKaj(bytes32 config, uint256 value, bytes memory callData) external payable;

    function transfer(address recipient, uint256 amount) external payable;
}
