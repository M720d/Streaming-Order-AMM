//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

/// @title IPool
/// @notice Interface the OrderBook and PriceGuard build against.
/// @dev DRAFT: not yet agreed with Aditya. Do not build on it until Dev confirms.
///      token0 = WBTC (8 decimals), token1 = USDC (6 decimals).
///      Prices are token1 raw units per token0 raw unit, scaled by 1e18.
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

    /// @notice Spot price, token1 per token0, scaled by 1e18.
    function spotPrice() external view returns (uint256);

    /// @notice Time-weighted average price over the last `window` seconds, scaled by 1e18.
    /// @dev Reverts with InsufficientHistory if the pool is younger than `window`.
    function consultTwap(uint32 window) external view returns (uint256 price);
}
