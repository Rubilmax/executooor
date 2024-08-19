// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0;

struct Placeholder {
    address to;
    bytes data;
    uint64 offset;
    uint64 length;
    uint64 resOffset;
}

interface IExecutor {
    function exec_606BaXt(bytes[] memory data) external payable;

    function call_g0oyU7o(address target, uint256 value, bytes32 context, bytes memory callData) external payable;

    function callWithPlaceholders4845164670(
        address target,
        uint256 value,
        bytes32 context,
        bytes memory callData,
        Placeholder[] calldata placeholders
    ) external payable;

    function transfer(address recipient, uint256 amount) external payable;
}
