//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

/// @title IPool
/// @notice Interface the OrderBook and PriceGuard build against.
/// @dev STATUS: approved by Dev; waiting for Aditya's ack in the group chat before the day-two freeze.
///      token0 = WBTC (8 decimals), token1 = USDC (6 decimals); the pool reads both decimals at construction.
///      PRICE UNIT (one unit across Pool, PriceGuard and OrderBook): USDC per ONE WHOLE WBTC, scaled by 1e18,
///      so 60_000 USDC/BTC is 60_000e18. Raw-unit ratios never leave the Pool.
interface IPool {
    event LiquidityAdded(address indexed provider, uint256 amount0, uint256 amount1, uint256 shares, address indexed to);
    event LiquidityRemoved(address indexed provider, uint256 amount0, uint256 amount1, uint256 shares, address indexed to);
    event Swap(address indexed sender, address indexed tokenIn, uint256 amountIn, uint256 amountOut, address indexed to);

    error ZeroAmount();
    error InvalidToken();
    error InsufficientLiquidity();
    error InsufficientLiquidityMinted();
    error SlippageExceeded(uint256 amountOut, uint256 minAmountOut);
    error InsufficientHistory();

    function token0() external view returns (address);

    function token1() external view returns (address);

    /// @return reserve0 token0 reserve
    /// @return reserve1 token1 reserve
    /// @return blockTimestampLast timestamp of the last reserve update
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);

    /// @notice Pulls tokens from msg.sender (needs prior approval) and mints LP shares to `to`.
    /// @dev Amounts actually taken may be below the desired amounts, never below the minimums.
    function addLiquidity(
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        address to
    ) external returns (uint256 amount0, uint256 amount1, uint256 shares);

    /// @notice Burns msg.sender's LP shares and sends the underlying tokens to `to`.
    function removeLiquidity(
        uint256 shares,
        uint256 amount0Min,
        uint256 amount1Min,
        address to
    ) external returns (uint256 amount0, uint256 amount1);

    /// @notice Pulls `amountIn` of `tokenIn` from msg.sender and sends the other token to `to`.
    /// @dev Reverts with SlippageExceeded if the output is below `minAmountOut`.
    function swapExactIn(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address to
    ) external returns (uint256 amountOut);

    /// @notice Quote for swapExactIn with the 30 bps fee applied.
    function getAmountOut(address tokenIn, uint256 amountIn) external view returns (uint256 amountOut);

    /// @notice Swap fee in basis points (immutable, 30).
    function FEE_BPS() external view returns (uint256);

    /// @notice Spot price in USDC per whole WBTC, scaled by 1e18, derived from the current reserves.
    function spotPriceE18() external view returns (uint256 priceE18);

    /// @notice Time-weighted average price over the last `window` seconds, in the same unit as spotPriceE18.
    /// @dev Reverts with InsufficientHistory if the pool is younger than `window`.
    function consultTwapE18(uint32 window) external view returns (uint256 priceE18);
}
