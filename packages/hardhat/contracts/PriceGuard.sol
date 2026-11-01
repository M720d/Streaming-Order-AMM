//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import { IPriceGuard } from "./interfaces/IPriceGuard.sol";
import { PriceMath } from "./libraries/PriceMath.sol";

/// @title PriceGuard
/// @notice Reads a Chainlink BTC/USD feed and tells the OrderBook whether the pool price is close enough to it.
/// @dev The owner can change exactly two things, each with a hard cap and an event: `maxStaleness` (1 second up to
///      MAX_STALENESS_CAP) and `maxDeviationBps` (1 bp up to MAX_DEVIATION_BPS_CAP). The owner cannot change the
///      feed, pause the guard or move funds; the guard holds no funds.
contract PriceGuard is IPriceGuard, Ownable {
    /// @notice Hard upper limit for `maxStaleness`: one day.
    uint256 public constant MAX_STALENESS_CAP = 1 days;
    /// @notice Hard upper limit for `maxDeviationBps`: 20%.
    uint256 public constant MAX_DEVIATION_BPS_CAP = 2_000;
    uint256 internal constant BPS = 10_000;

    AggregatorV3Interface public immutable feed;
    uint8 public immutable feedDecimals;

    uint256 public override maxStaleness;
    uint256 public override maxDeviationBps;

    error ZeroAddress();
    error ZeroValue();

    constructor(
        AggregatorV3Interface feed_,
        address initialOwner,
        uint256 maxStaleness_,
        uint256 maxDeviationBps_
    ) Ownable(initialOwner) {
        if (address(feed_) == address(0)) revert ZeroAddress();
        feed = feed_;
        feedDecimals = feed_.decimals();
        _setMaxStaleness(maxStaleness_);
        _setMaxDeviationBps(maxDeviationBps_);
    }

    /// @inheritdoc IPriceGuard
    /// @dev Reverts InvalidPrice on answer <= 0, StalePrice when the round is older than `maxStaleness` (or has no
    ///      timestamp, or is dated in the future), and StaleRound when answeredInRound < roundId.
    function getOraclePrice() public view override returns (uint256 priceE18) {
        (uint80 roundId, int256 answer, , uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
        if (answer <= 0) revert InvalidPrice(answer);
        if (updatedAt == 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > maxStaleness) {
            revert StalePrice(updatedAt, maxStaleness);
        }
        if (answeredInRound < roundId) revert StaleRound(roundId, answeredInRound);
        return PriceMath.feedToE18(answer, feedDecimals);
    }

    /// @inheritdoc IPriceGuard
    /// @dev |pool - oracle| * 10_000 <= oracle * maxDeviationBps, so exactly at the limit still counts as within.
    function poolWithinBounds(uint256 poolPriceE18) external view override returns (bool) {
        uint256 oracle = getOraclePrice();
        uint256 diff = poolPriceE18 > oracle ? poolPriceE18 - oracle : oracle - poolPriceE18;
        return diff * BPS <= oracle * maxDeviationBps;
    }

    /// @inheritdoc IPriceGuard
    /// @dev Owner only. Range 1 to MAX_STALENESS_CAP seconds.
    function setMaxStaleness(uint256 newMaxStaleness) external override onlyOwner {
        _setMaxStaleness(newMaxStaleness);
    }

    /// @inheritdoc IPriceGuard
    /// @dev Owner only. Range 1 to MAX_DEVIATION_BPS_CAP.
    function setMaxDeviationBps(uint256 newMaxDeviationBps) external override onlyOwner {
        _setMaxDeviationBps(newMaxDeviationBps);
    }

    function _setMaxStaleness(uint256 value) internal {
        if (value == 0) revert ZeroValue();
        if (value > MAX_STALENESS_CAP) revert StalenessAboveCap(value, MAX_STALENESS_CAP);
        maxStaleness = value;
        emit MaxStalenessSet(value);
    }

    function _setMaxDeviationBps(uint256 value) internal {
        if (value == 0) revert ZeroValue();
        if (value > MAX_DEVIATION_BPS_CAP) revert DeviationAboveCap(value, MAX_DEVIATION_BPS_CAP);
        maxDeviationBps = value;
        emit MaxDeviationBpsSet(value);
    }
}
