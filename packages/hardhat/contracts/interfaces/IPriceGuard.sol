//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

/// @title IPriceGuard
/// @notice Chainlink BTC/USD reader and pool-vs-oracle deviation check used by the OrderBook.
/// @dev STATUS: approved by Dev with the unit change below; waiting for Aditya's ack before the day-two freeze.
///      Both prices use the single project unit: USDC per whole WBTC, scaled by 1e18.
interface IPriceGuard {
    event MaxStalenessSet(uint256 maxStaleness);
    event MaxDeviationBpsSet(uint256 maxDeviationBps);

    error InvalidPrice(int256 answer);
    error StalePrice(uint256 updatedAt, uint256 maxStaleness);
    error StaleRound(uint80 roundId, uint80 answeredInRound);
    error StalenessAboveCap(uint256 value, uint256 cap);
    error DeviationAboveCap(uint256 value, uint256 cap);

    /// @notice Oracle price as USDC per WBTC in whole units, scaled by 1e18 (60_000 USDC/BTC = 60_000e18).
    /// @dev Reverts on answer <= 0, on stale updatedAt, and when answeredInRound < roundId.
    function getOraclePrice() external view returns (uint256 priceE18);

    /// @notice True if `poolPrice` is within the configured deviation of the oracle.
    /// @param poolPriceE18 Pool price from IPool.spotPriceE18(), same unit as getOraclePrice().
    /// @dev Reverts like getOraclePrice() when the feed is bad; returns false (never reverts) on deviation.
    function poolWithinBounds(uint256 poolPriceE18) external view returns (bool);

    function maxStaleness() external view returns (uint256);

    function maxDeviationBps() external view returns (uint256);

    /// @dev Owner only, reverts above a hard cap.
    function setMaxStaleness(uint256 newMaxStaleness) external;

    /// @dev Owner only, reverts above a hard cap.
    function setMaxDeviationBps(uint256 newMaxDeviationBps) external;
}
