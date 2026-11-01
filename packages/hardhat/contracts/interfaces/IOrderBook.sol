//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

/// @title IOrderBook
/// @notice Streaming sell orders, one ERC-721 per order. The NFT holder owns the unfilled balance and proceeds.
/// @dev STATUS: approved by Dev; waiting for Aditya's ack before the day-two freeze.
///      Orders sell WBTC for USDC through the single pool fixed at construction.
interface IOrderBook {
    struct Order {
        uint128 remainingIn; // WBTC not yet swapped
        uint128 proceeds; // USDC swapped but not yet claimed
        uint128 sliceSize; // totalIn / slices; the last slice also takes the rounding remainder
        uint32 slicesLeft;
        uint32 interval; // seconds between slices
        uint64 nextExecution; // earliest timestamp for the next slice
        uint16 toleranceBps; // allowed shortfall of amountOut versus the oracle-implied amount
    }

    event OrderCreated(
        uint256 indexed orderId,
        address indexed owner,
        uint256 totalIn,
        uint32 slices,
        uint32 interval,
        uint16 toleranceBps
    );
    event SliceExecuted(uint256 indexed orderId, uint256 amountIn, uint256 amountOut, uint32 slicesLeft);
    event SliceSkipped(uint256 indexed orderId, uint256 poolPriceE18, uint256 oraclePriceE18);
    event Claimed(uint256 indexed orderId, address indexed to, uint256 amountOut);
    event Cancelled(uint256 indexed orderId, address indexed to, uint256 refundedIn, uint256 proceedsPaid);

    error InvalidParams();
    error NotOrderOwner();
    error TooEarly(uint256 nextExecution);
    error OrderFinished();
    error NothingToClaim();

    /// @notice Pulls `totalIn` WBTC from msg.sender (needs approval) and mints the order NFT to them.
    function createOrder(
        uint256 totalIn,
        uint32 slices,
        uint32 interval,
        uint16 toleranceBps
    ) external returns (uint256 orderId);

    /// @notice Callable by anyone once `nextExecution` has passed. Swaps one slice through the pool, or
    ///         emits SliceSkipped and returns false if PriceGuard says the pool is out of bounds.
    function executeSlice(uint256 orderId) external returns (bool executed);

    /// @notice Pays accumulated USDC proceeds to the current ownerOf(orderId).
    function claim(uint256 orderId) external returns (uint256 amountOut);

    /// @notice Owner only. Returns the unfilled WBTC and any unclaimed USDC to the owner and burns the NFT.
    function cancel(uint256 orderId) external;

    /// @notice Returns the stored order state.
    function getOrder(uint256 orderId) external view returns (Order memory);
}
