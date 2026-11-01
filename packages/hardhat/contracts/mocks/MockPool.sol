//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPool } from "../interfaces/IPool.sol";

/// @notice Test pool that swaps at a settable spot price with no price impact and no fee, and can call back into
///         a target contract in the middle of a swap to test reentrancy protection. Liquidity functions are not
///         supported. Never deploy outside tests.
contract MockPool is IPool {
    address public immutable override token0;
    address public immutable override token1;
    uint256 public override spotPriceE18;

    address public attackTarget;
    bytes public attackData;
    bool public attackSucceeded;
    bytes public attackRevertData;

    error Unsupported();

    constructor(address token0_, address token1_, uint256 spotPriceE18_) {
        token0 = token0_;
        token1 = token1_;
        spotPriceE18 = spotPriceE18_;
    }

    function setSpotPriceE18(uint256 price) external {
        spotPriceE18 = price;
    }

    /// @notice On the next swap, call `target` with `data` after pulling the input and before paying the output.
    function setAttack(address target, bytes calldata data) external {
        attackTarget = target;
        attackData = data;
    }

    function swapExactIn(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address to
    ) external override returns (uint256 amountOut) {
        if (tokenIn != token0) revert Unsupported();
        IERC20(token0).transferFrom(msg.sender, address(this), amountIn);

        if (attackTarget != address(0)) {
            (bool ok, bytes memory ret) = attackTarget.call(attackData);
            attackSucceeded = ok;
            attackRevertData = ret;
        }

        amountOut = getAmountOut(tokenIn, amountIn);
        if (amountOut < minAmountOut) revert SlippageExceeded(amountOut, minAmountOut);
        IERC20(token1).transfer(to, amountOut);
        emit Swap(msg.sender, tokenIn, amountIn, amountOut, to);
    }

    /// @dev amountOut = amountIn * price / 1e18 * 10^6 / 10^8, the WBTC (8) to USDC (6) conversion, no fee.
    function getAmountOut(address tokenIn, uint256 amountIn) public view override returns (uint256) {
        if (tokenIn != token0) revert Unsupported();
        return (amountIn * spotPriceE18) / 1e20;
    }

    function FEE_BPS() external pure override returns (uint256) {
        return 0;
    }

    function getReserves() external pure override returns (uint112, uint112, uint32) {
        revert Unsupported();
    }

    function addLiquidity(
        uint256,
        uint256,
        uint256,
        uint256,
        address
    ) external pure override returns (uint256, uint256, uint256) {
        revert Unsupported();
    }

    function removeLiquidity(uint256, uint256, uint256, address) external pure override returns (uint256, uint256) {
        revert Unsupported();
    }

    function consultTwapE18(uint32) external pure override returns (uint256) {
        revert Unsupported();
    }
}
