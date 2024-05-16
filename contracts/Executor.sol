// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IExecutor, ExecContext} from "./interfaces/IExecutor.sol";

uint96 constant UNSET_DATA_INDEX = type(uint96).max;

contract Executor is IExecutor {
    ExecContext internal _context;

    constructor(address _owner) {
        _context = ExecContext({owner: _owner, fallbackDataIndex: UNSET_DATA_INDEX});
    }

    /* EXTERNAL */

    /// @notice Returns the owner of the contract.
    function owner() external view returns (address) {
        return _context.owner;
    }

    /// @notice Transfers ownership of the contract.
    function transferOwnership(address newOwner) external payable {
        require(msg.sender == _context.owner);

        _context.owner = newOwner;
    }

    function exec_606BaXt(bytes[] memory data) external payable {
        require(msg.sender == _context.owner);

        _multicall(data);
    }

    /// @notice Executes a normal call, requiring its success.
    function call_m08sKaj(bytes32 config, uint256 value, bytes memory callData) external payable {
        require(msg.sender == address(this));

        address target = address(uint160(uint256(config)));
        uint96 prevFallbackDataIndex = _context.fallbackDataIndex;

        _context.fallbackDataIndex = uint96(uint256(config >> 160));

        (bool success, bytes memory returnData) = target.call{value: value}(callData);
        if (!success) _revert(returnData);

        _context.fallbackDataIndex = prevFallbackDataIndex;
    }

    function transfer(address recipient, uint256 amount) external payable {
        require(msg.sender == address(this));

        if (recipient == address(0)) recipient = block.coinbase;

        amount = _min(amount, address(this).balance);

        (bool success, bytes memory returnData) = recipient.call{value: amount}("");
        if (!success) _revert(returnData);
    }

    receive() external payable {}

    fallback(bytes calldata) external payable returns (bytes memory) {
        uint96 dataIndex = _context.fallbackDataIndex;
        require(dataIndex != UNSET_DATA_INDEX);

        bytes memory fallbackData;
        assembly ("memory-safe") {
            let offset := add(4, calldataload(add(4, mul(32, dataIndex))))
            let length := calldataload(offset)

            fallbackData := mload(0x40)

            calldatacopy(fallbackData, offset, add(32, length))

            mstore(0x40, add(fallbackData, add(32, length)))
        }

        (bytes[] memory multicallData, bytes memory returnData) = abi.decode(fallbackData, (bytes[], bytes));

        _multicall(multicallData);

        return returnData;
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

    function _min(uint256 x, uint256 y) internal pure returns (uint256 z) {
        assembly {
            z := xor(x, mul(xor(x, y), lt(y, x)))
        }
    }
}
