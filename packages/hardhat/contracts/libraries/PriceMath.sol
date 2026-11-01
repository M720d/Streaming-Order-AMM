//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title PriceMath
/// @notice The only place where oracle decimals and token decimals are converted on the order side.
/// @dev Project price unit: USDC per ONE WHOLE WBTC, scaled by 1e18 (named `priceE18`). Integer maths with floor
///      division so the Python notebook can reproduce every result exactly. USDC is treated as exactly 1 USD,
///      which is how a BTC/USD feed is turned into a WBTC/USDC price.
library PriceMath {
    uint256 internal constant E18 = 1e18;

    /// @notice Converts a Chainlink answer with `feedDecimals` decimals into priceE18.
    /// @dev Caller must have checked `answer > 0`. Feed decimals above 18 round down.
    function feedToE18(int256 answer, uint8 feedDecimals) internal pure returns (uint256) {
        uint256 a = uint256(answer);
        if (feedDecimals <= 18) return a * 10 ** (18 - feedDecimals);
        return a / 10 ** (feedDecimals - 18);
    }

    /// @notice Raw amount of the quote token (USDC, `decimalsOut`) received for `amountIn` raw units of the base
    ///         token (WBTC, `decimalsIn`) at `priceE18`, before any fee or price impact.
    /// @dev amountOut = amountIn * priceE18 * 10^decimalsOut / (10^decimalsIn * 1e18), rounded down.
    function quoteRaw(
        uint256 amountIn,
        uint256 priceE18,
        uint8 decimalsIn,
        uint8 decimalsOut
    ) internal pure returns (uint256) {
        return Math.mulDiv(amountIn * priceE18, 10 ** decimalsOut, 10 ** decimalsIn * E18);
    }
}
