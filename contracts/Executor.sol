// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {IExecutor, Placeholder} from "./interfaces/IExecutor.sol";

// Transient storage slot used to authorize the callback currently expected.
// Slot contents are restored after each normal call, which lets nested callback flows
// run without permanently widening callback permissions.
uint256 constant FALLBACK_CONTEXT_TLOC = 0;

/// @title Executor
/// @notice Owner-controlled batching contract that can call arbitrary contracts and handle callback-based protocols.
/// @dev The normal consumption flow is:
/// 1. Deploy one Executor with an immutable owner.
/// 2. Use a JS encoder to build `call_g0oyU7o`/`callWithPlaceholders4845164670`/`transfer` payloads.
/// 3. Submit those payloads through `exec_606BaXt`.
///
/// Security model:
/// - Only `OWNER` can start a batch.
/// - Individual call helpers can only be reached by `address(this)`, so external accounts cannot bypass the batch gate.
/// - The fallback only accepts the exact callback sender encoded in the active call context.
/// - The contract performs arbitrary external calls; the owner is responsible for every target, calldata, approval,
///   slippage bound, and repayment amount encoded into a batch.
contract Executor is IExecutor {
    /// @notice Address allowed to start executions.
    /// @dev Immutable by design. Deploy a new Executor if ownership needs to change.
    address internal immutable OWNER;

    /// @notice Stores the immutable owner used by `exec_606BaXt`.
    /// @param _owner Account or bot contract authorized to submit batches.
    /// @dev Passing the zero address permanently disables owner-entered execution.
    constructor(address _owner) {
        OWNER = _owner;
    }

    /* EXTERNAL */

    /// @notice Executes a batch of Executor-encoded calls.
    /// @param data Array of calldata items, normally produced by the JS `ExecutorEncoder`.
    /// @dev This is the only intended EOA/bot entry point. Each item is called on `address(this)`,
    /// so items should encode Executor helper calls such as `call_g0oyU7o`, `callWithPlaceholders4845164670`,
    /// or `transfer`. Reverts atomically if any item reverts. ETH sent here funds queued payable calls,
    /// WETH deposits, direct ETH transfers, and tips.
    function exec_606BaXt(bytes[] memory data) external payable {
        require(msg.sender == OWNER);

        _multicall(data);
    }

    /// @notice Executes a normal target call from inside an Executor batch, requiring success.
    /// @param target The target address to call.
    /// @param value ETH forwarded to `target`.
    /// @param context The 32-bytes concatenation of:
    /// - the address expected to call back. Set to address(0) to prevent any callback.
    /// - the expected callback data index.
    /// @param callData Calldata sent to `target`.
    /// @dev Must be called by `address(this)`, which means consumers enter it by placing this
    /// function's calldata inside `exec_606BaXt`. While the external call is active, `context`
    /// authorizes the fallback to accept a callback from one expected sender and decode callback
    /// continuation data from one calldata argument.
    ///
    /// Dangers:
    /// - The target call is arbitrary and can move assets approved to or held by this contract.
    /// - A wrong callback sender or data index makes legitimate callbacks revert.
    /// - Return data is ignored on success; encode explicit follow-up calls if the flow needs checks.
    function call_g0oyU7o(address target, uint256 value, bytes32 context, bytes memory callData) public payable {
        require(msg.sender == address(this));

        bytes32 prevContext = _tload(FALLBACK_CONTEXT_TLOC);

        _tstore(FALLBACK_CONTEXT_TLOC, context);

        (bool success, bytes memory returnData) = target.call{value: value}(callData);
        if (!success) _revert(returnData);

        _tstore(FALLBACK_CONTEXT_TLOC, prevContext);
    }

    /// @notice Patches calldata with live values, then executes a normal target call.
    /// @param target The target address to call.
    /// @param value ETH forwarded to `target`.
    /// @param context The 32-bytes concatenation of:
    /// - the address expected to call back. Set to address(0) to prevent any callback.
    /// - the expected callback data index.
    /// @param callData Calldata sent to `target` after placeholders are copied into it.
    /// @param placeholders Static-call reads whose return bytes are copied into `callData`.
    /// @dev This powers "use all current balance" helpers in the JS SDKs. For each placeholder,
    /// the contract calls `placeholder.to.staticcall(placeholder.data)` and copies `length` bytes
    /// from `resOffset` in that return data into `offset` in the call data.
    ///
    /// Dangers:
    /// - Placeholder offsets are raw byte offsets into ABI-encoded calldata; an incorrect offset
    ///   silently changes another argument or creates invalid calldata.
    /// - The static-call target can return stale or manipulated values if the selected source is unsafe.
    /// - The function does not validate token semantics; fee-on-transfer/rebasing assets can make
    ///   "all balance" assumptions inaccurate by the time the patched call executes.
    function callWithPlaceholders4845164670(
        address target,
        uint256 value,
        bytes32 context,
        bytes memory callData,
        Placeholder[] calldata placeholders
    ) external payable {
        for (uint256 i; i < placeholders.length; ++i) {
            Placeholder calldata placeholder = placeholders[i];

            (bool success, bytes memory resData) = placeholder.to.staticcall(placeholder.data);
            if (!success) _revert(resData);

            uint64 offset = placeholder.offset;
            uint64 length = placeholder.length;
            uint64 resOffset = placeholder.resOffset;

            assembly ("memory-safe") {
                mcopy(add(callData, add(32, offset)), add(resData, add(32, resOffset)), length)
            }
        }

        call_g0oyU7o(target, value, context, callData);
    }

    /// @notice Transfers ETH to the recipient.
    /// @param recipient The recipient of the transfer. Set to address(0) to transfer to `block.coinbase`.
    /// @param amount Amount to transfer, capped to the Executor's current ETH balance.
    /// @dev Must be called by `address(this)`, normally through the JS `transfer` or `tip`
    /// helpers inside an `exec_606BaXt` batch. Capping to balance avoids accidental insufficient
    /// balance reverts but can hide underfunding if the caller expected the full amount to move.
    ///
    /// Dangers:
    /// - `recipient == address(0)` pays `block.coinbase`, which can differ across chains and builders.
    /// - The recipient receives all gas forwarded by `call`; a reverting recipient reverts the batch.
    function transfer(address recipient, uint256 amount) external payable {
        require(msg.sender == address(this));

        if (recipient == address(0)) recipient = block.coinbase;

        amount = _min(amount, address(this).balance);

        (bool success, bytes memory returnData) = recipient.call{value: amount}("");
        if (!success) _revert(returnData);
    }

    /// @notice Accepts ETH from WETH withdrawals, swaps, flash-loan callbacks, and direct transfers.
    /// @dev Receiving ETH alone does not execute anything. Funds remain in the Executor until an
    /// owner batch moves them.
    receive() external payable {}

    /// @notice Generic callback entry point for protocols that call back without a known interface.
    /// @return returnData Bytes returned to the callback caller, decoded from the callback payload.
    /// @dev The raw callback calldata is parsed manually to extract continuation data.
    /// During `call_g0oyU7o`, the active context sets:
    /// - low 160 bits: expected `msg.sender`;
    /// - high 96 bits: ABI calldata argument index containing `(bytes[] multicallData, bytes returnData)`.
    ///
    /// The selected callback argument is decoded as `(bytes[], bytes)`. The first element is executed
    /// as a nested Executor batch and the second element is returned to the protocol. This is how the
    /// SDK implements Balancer, ERC-3156/Maker, Aave, Uniswap, and Morpho callbacks without dedicated
    /// callback functions in Solidity.
    ///
    /// Dangers:
    /// - The callback sender must match exactly; proxied or wrapper protocols need the actual caller.
    /// - `dataIndex` is protocol-function-specific and zero-based across ABI arguments after the selector.
    /// - The nested calls execute with assets temporarily held by the Executor, so repayment calls and
    ///   profit transfers must be encoded in the right order.
    fallback(bytes calldata) external payable returns (bytes memory returnData) {
        bytes32 context = _tload(FALLBACK_CONTEXT_TLOC);
        require(msg.sender == address(uint160(uint256(context))));

        uint256 dataIndex = uint256(context >> 160);

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

    /// @notice Executes a series of self-calls.
    /// @param data Executor helper calldata produced by the SDK or manually encoded by advanced users.
    /// @dev Used by both the owner entry point and callback continuations. Every call is made to
    /// `address(this)` so helper-level access checks stay consistent.
    function _multicall(bytes[] memory data) internal {
        for (uint256 i; i < data.length; ++i) {
            (bool success, bytes memory returnData) = address(this).call(data[i]);
            if (!success) _revert(returnData);
        }
    }

    /// @dev Bubbles up the revert reason / custom error encoded in `returnData`.
    /// @dev Assumes `returnData` is the return data of any kind of failing CALL to a contract.
    /// Empty return data causes a no-reason revert through the `require(length > 0)` guard.
    function _revert(bytes memory returnData) internal pure {
        uint256 length = returnData.length;
        require(length > 0);

        assembly ("memory-safe") {
            revert(add(32, returnData), length)
        }
    }

    /// @notice Reads a transient-storage word.
    /// @param tloc Transient storage slot.
    /// @return value Word currently stored at `tloc` for this transaction.
    /// @dev Requires Cancun/EIP-1153 support. The project config targets `evm-version = "cancun"`.
    function _tload(uint256 tloc) internal view returns (bytes32 value) {
        assembly ("memory-safe") {
            value := tload(tloc)
        }
    }

    /// @notice Writes a transient-storage word.
    /// @param tloc Transient storage slot.
    /// @param value Word to store for the current transaction.
    /// @dev Transient storage is cleared after the transaction, making it appropriate for callback context.
    function _tstore(uint256 tloc, bytes32 value) internal {
        assembly ("memory-safe") {
            tstore(tloc, value)
        }
    }

    /// @notice Returns the smaller of two unsigned integers.
    /// @dev Used to cap ETH transfers to available balance.
    function _min(uint256 x, uint256 y) internal pure returns (uint256 z) {
        assembly {
            z := xor(x, mul(xor(x, y), lt(y, x)))
        }
    }
}
