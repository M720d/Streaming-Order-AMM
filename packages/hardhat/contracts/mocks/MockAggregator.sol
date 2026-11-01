//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @notice Test Chainlink aggregator. Anyone can set any round, so tests can simulate a stale feed, a zero or
///         negative answer, or a stale round. Never deploy outside tests and local demos.
contract MockAggregator is AggregatorV3Interface {
    uint8 public immutable override decimals;
    string public constant override description = "Mock BTC / USD";
    uint256 public constant override version = 1;

    uint80 internal roundId;
    int256 internal answer;
    uint256 internal startedAt;
    uint256 internal updatedAt;
    uint80 internal answeredInRound;

    constructor(uint8 decimals_, int256 initialAnswer) {
        decimals = decimals_;
        setAnswer(initialAnswer);
    }

    /// @notice Starts a new, fresh round (updatedAt = now, answeredInRound = roundId) with `newAnswer`.
    function setAnswer(int256 newAnswer) public {
        roundId += 1;
        answer = newAnswer;
        startedAt = block.timestamp;
        updatedAt = block.timestamp;
        answeredInRound = roundId;
    }

    /// @notice Overwrites every field of the latest round, for stale or carried-over round scenarios.
    function setRoundData(
        uint80 roundId_,
        int256 answer_,
        uint256 startedAt_,
        uint256 updatedAt_,
        uint80 answeredInRound_
    ) external {
        roundId = roundId_;
        answer = answer_;
        startedAt = startedAt_;
        updatedAt = updatedAt_;
        answeredInRound = answeredInRound_;
    }

    function getRoundData(uint80) external view override returns (uint80, int256, uint256, uint256, uint80) {
        return latestRoundData();
    }

    function latestRoundData() public view override returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }
}
