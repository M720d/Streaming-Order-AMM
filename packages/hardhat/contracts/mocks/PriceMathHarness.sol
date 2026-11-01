//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { PriceMath } from "../libraries/PriceMath.sol";

/// @notice Test-only wrapper that exposes the internal PriceMath functions.
contract PriceMathHarness {
    function feedToE18(int256 answer, uint8 feedDecimals) external pure returns (uint256) {
        return PriceMath.feedToE18(answer, feedDecimals);
    }

    function quoteRaw(
        uint256 amountIn,
        uint256 priceE18,
        uint8 decimalsIn,
        uint8 decimalsOut
    ) external pure returns (uint256) {
        return PriceMath.quoteRaw(amountIn, priceE18, decimalsIn, decimalsOut);
    }
}
