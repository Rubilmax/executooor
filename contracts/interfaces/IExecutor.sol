// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0;

struct Placeholder {
    /// @notice Contract queried with a static call before the main call is executed.
    address to;
    /// @notice Calldata used for the static call.
    bytes data;
    /// @notice Byte offset in the main call's calldata where the returned bytes are copied.
    uint64 offset;
    /// @notice Number of bytes copied from the static-call return data.
    uint64 length;
    /// @notice Byte offset inside the static-call return data to copy from.
    uint64 resOffset;
}

/// @notice Minimal interface for the reusable Executor contract.
/// @dev The Executor is intentionally owner-gated at the batch entry point and self-gated
/// at individual call helpers. Consumers normally do not call `call_g0oyU7o`,
/// `callWithPlaceholders4845164670`, or `transfer` directly from an EOA; SDKs encode
/// those calls into `exec_606BaXt(bytes[])`.
interface IExecutor {
    /// @notice Executes a batch of Executor-encoded calls.
    /// @dev Must be called by the immutable owner configured at deployment.
    /// Reverts the full batch if any inner call reverts.
    function exec_606BaXt(bytes[] memory data) external payable;

    /// @notice Executes one target call from inside an Executor batch.
    /// @dev Must be called by the Executor itself. `context` authorizes at most one
    /// expected callback sender and one callback calldata index while this call is active.
    function call_g0oyU7o(address target, uint256 value, bytes32 context, bytes memory callData) external payable;

    /// @notice Executes one target call after patching its calldata with live onchain values.
    /// @dev Must be entered through `exec_606BaXt`. Every placeholder is a static call;
    /// invalid offsets or unexpectedly short return data cause memory/calldata decoding
    /// failures and revert the batch.
    function callWithPlaceholders4845164670(
        address target,
        uint256 value,
        bytes32 context,
        bytes memory callData,
        Placeholder[] calldata placeholders
    ) external payable;

    /// @notice Transfers ETH held by the Executor during a batch.
    /// @dev Must be called by the Executor itself. A zero recipient means `block.coinbase`,
    /// which is useful for builder/validator tips but chain-dependent.
    function transfer(address recipient, uint256 amount) external payable;
}
