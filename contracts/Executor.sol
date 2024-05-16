// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IExecutor} from "./interfaces/IExecutor.sol";

uint256 constant ENABLE_FALLBACK_TLOC = 0;
uint256 constant FALLBACK_DATA_INDEX_TLOC = 1;

contract Executor is IExecutor {
    address public owner;

    constructor(address _owner) {
        owner = _owner;
    }

    /* EXTERNAL */

    /// @notice Transfers ownership of the contract.
    function transferOwnership(address newOwner) external payable {
        require(msg.sender == owner);

        owner = newOwner;
    }

    /// @notice Executes a batch of calls.
    function exec_606BaXt(bytes[] memory data) external payable {
        require(msg.sender == owner);

        _tstore(ENABLE_FALLBACK_TLOC, 1);

        _multicall(data);

        _tstore(ENABLE_FALLBACK_TLOC, 0);
    }

    /// @notice Executes a normal call, requiring its success.
    /// @param config The address to call concatenated to the corresponding fallback data index to use in a callback.
    /// Set the fallback data index to type(uint96).max to prevent any callback.
    /// @param value The value of the call.
    /// @param callData the calldata of the call.
    function call_m08sKaj(bytes32 config, uint256 value, bytes memory callData) external payable {
        require(msg.sender == address(this));

        address target = address(uint160(uint256(config)));
        uint256 prevFallbackDataIndex = _tload(FALLBACK_DATA_INDEX_TLOC);

        _tstore(FALLBACK_DATA_INDEX_TLOC, uint256(config >> 160));

        (bool success, bytes memory returnData) = target.call{value: value}(callData);
        if (!success) _revert(returnData);

        _tstore(FALLBACK_DATA_INDEX_TLOC, prevFallbackDataIndex);
    }

    /// @notice Transfers ETH to the recipient.
    /// @param recipient The recipient of the transfer. Set to address(0) to transfer to the coinbase.
    /// @param amount The amount to transfer. Automatically minimumed to the current ETH balance.
    function transfer(address recipient, uint256 amount) external payable {
        require(msg.sender == address(this));

        if (recipient == address(0)) recipient = block.coinbase;

        amount = _min(amount, address(this).balance);

        (bool success, bytes memory returnData) = recipient.call{value: amount}("");
        if (!success) _revert(returnData);
    }

    receive() external payable {}

    fallback(bytes calldata) external payable returns (bytes memory returnData) {
        require(_tload(ENABLE_FALLBACK_TLOC) == 1);

        uint256 dataIndex = _tload(FALLBACK_DATA_INDEX_TLOC);
        require(dataIndex != type(uint96).max);

        bytes memory fallbackData;
        assembly ("memory-safe") {
            let offset := add(4, calldataload(add(4, mul(32, dataIndex))))
            let length := calldataload(offset)

            fallbackData := mload(0x40)

            calldatacopy(fallbackData, offset, add(32, length))

            mstore(0x40, add(fallbackData, add(32, length)))
        }

        bytes[] memory multicallData;
        (multicallData, returnData) = abi.decode(fallbackData, (bytes[], bytes));

        _multicall(multicallData);
    }

    /* INTERNAL */

    /// @notice Executes a series of calls.
    function _multicall(bytes[] memory data) internal {
        for (uint256 i; i < data.length; ++i) {
            (bool success, bytes memory returnData) = address(this).call(data[i]);
            if (!success) _revert(returnData);
        }
    }

    /// @dev Bubbles up the revert reason / custom error encoded in `returnData`.
    /// @dev Assumes `returnData` is the return data of any kind of failing CALL to a contract.
    function _revert(bytes memory returnData) internal pure {
        uint256 length = returnData.length;
        require(length > 0);

        assembly ("memory-safe") {
            revert(add(32, returnData), length)
        }
    }

    function _tload(uint256 tloc) internal view returns (uint256 value) {
        assembly ("memory-safe") {
            value := tload(tloc)
        }
    }

    function _tstore(uint256 tloc, uint256 value) internal {
        assembly ("memory-safe") {
            tstore(tloc, value)
        }
    }

    function _min(uint256 x, uint256 y) internal pure returns (uint256 z) {
        assembly {
            z := xor(x, mul(xor(x, y), lt(y, x)))
        }
    }
}
