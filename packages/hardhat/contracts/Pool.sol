//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IPool } from "./interfaces/IPool.sol";

/// @title Pool
/// @notice Constant-product (x * y = k) pool for one token pair with a flat 30 bps fee, ERC-20 LP shares and a
///         TWAP accumulator. The pool contract is itself the LP share token.
/// @dev All maths is integer maths with floor division, so every number can be reproduced exactly in Python.
///      There is no owner and no admin function: nothing in this contract can be changed after deployment.
///      Fee-on-transfer and rebasing tokens are not supported.
contract Pool is IPool, ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Swap fee in basis points, taken from the input amount and left in the reserves.
    uint256 public constant override FEE_BPS = 30;
    uint256 internal constant BPS = 10_000;

    /// @notice Shares locked forever on the first deposit so the pool can never be fully drained.
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    address public immutable override token0;
    address public immutable override token1;

    /// @dev 10 ** (18 + decimals0) and 10 ** decimals1, so that
    ///      priceE18 = reserve1 * priceScaleNum / (reserve0 * priceScaleDen) is USDC per whole WBTC scaled by 1e18.
    uint256 internal immutable priceScaleNum;
    uint256 internal immutable priceScaleDen;

    /// @dev Both reserves and the last update time share ONE storage slot (112 + 112 + 32 bits), so each
    ///      state-changing call writes it once. Matches the layout `getReserves` returns.
    struct Reserves {
        uint112 reserve0;
        uint112 reserve1;
        uint32 timestamp;
    }

    Reserves internal _reserves;

    /// @notice Sum of (priceE18 * seconds) since the first deposit.
    uint256 public priceCumulative;

    struct Observation {
        uint32 timestamp;
        uint224 cumulative;
    }

    /// @dev One entry per distinct block timestamp in which reserves changed, plus an initial entry (t0, 0).
    ///      The price in effect between entries i and i+1 is (cum[i+1] - cum[i]) / (ts[i+1] - ts[i]), exactly.
    Observation[] internal observations;

    constructor(address token0_, address token1_) ERC20("Streaming AMM LP", "SALP") {
        if (token0_ == address(0) || token1_ == address(0) || token0_ == token1_) revert InvalidToken();
        token0 = token0_;
        token1 = token1_;
        priceScaleNum = 10 ** (18 + IERC20Metadata(token0_).decimals());
        priceScaleDen = 10 ** IERC20Metadata(token1_).decimals();
    }

    // ------------------------------------------------------------------ views

    /// @inheritdoc IPool
    function getReserves() external view override returns (uint112, uint112, uint32) {
        return (_reserves.reserve0, _reserves.reserve1, _reserves.timestamp);
    }

    /// @inheritdoc IPool
    function getAmountOut(address tokenIn, uint256 amountIn) public view override returns (uint256 amountOut) {
        if (amountIn == 0) revert ZeroAmount();
        if (tokenIn != token0 && tokenIn != token1) revert InvalidToken();
        (uint256 reserveIn, uint256 reserveOut) = tokenIn == token0 ? (_reserves.reserve0, _reserves.reserve1) : (_reserves.reserve1, _reserves.reserve0);
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        uint256 amountInWithFee = amountIn * (BPS - FEE_BPS);
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * BPS + amountInWithFee);
    }

    /// @inheritdoc IPool
    function spotPriceE18() public view override returns (uint256 priceE18) {
        return _priceE18(_reserves.reserve0, _reserves.reserve1);
    }

    /// @inheritdoc IPool
    /// @dev Average price over [now - window, now]. The accumulator is interpolated to the exact window start
    ///      using the price that was in effect at that moment, so the result is not biased by older history.
    function consultTwapE18(uint32 window) external view override returns (uint256 priceE18) {
        if (window == 0) revert ZeroAmount();
        uint256 n = observations.length;
        if (n == 0 || block.timestamp < window) revert InsufficientHistory();
        uint256 target = block.timestamp - window;
        if (observations[0].timestamp > target) revert InsufficientHistory();

        // Binary search for the last observation at or before `target`.
        uint256 lo = 0;
        uint256 hi = n - 1;
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            if (observations[mid].timestamp <= target) lo = mid;
            else hi = mid - 1;
        }

        Observation memory o = observations[lo];
        uint256 priceAfter;
        if (lo == n - 1) {
            priceAfter = _priceE18(_reserves.reserve0, _reserves.reserve1);
        } else {
            Observation memory next = observations[lo + 1];
            priceAfter = (uint256(next.cumulative) - o.cumulative) / (next.timestamp - o.timestamp);
        }
        uint256 cumulativeAtTarget = o.cumulative + priceAfter * (target - o.timestamp);
        uint256 cumulativeNow = priceCumulative + _priceE18(_reserves.reserve0, _reserves.reserve1) * (block.timestamp - _reserves.timestamp);
        return (cumulativeNow - cumulativeAtTarget) / window;
    }

    // ------------------------------------------------------------- liquidity

    /// @inheritdoc IPool
    function addLiquidity(
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        address to
    ) external override nonReentrant returns (uint256 amount0, uint256 amount1, uint256 shares) {
        if (amount0Desired == 0 || amount1Desired == 0) revert ZeroAmount();

        if (_reserves.reserve0 == 0 && _reserves.reserve1 == 0) {
            (amount0, amount1) = (amount0Desired, amount1Desired);
        } else {
            uint256 amount1Optimal = (amount0Desired * _reserves.reserve1) / _reserves.reserve0;
            if (amount1Optimal <= amount1Desired) {
                (amount0, amount1) = (amount0Desired, amount1Optimal);
            } else {
                (amount0, amount1) = ((amount1Desired * _reserves.reserve0) / _reserves.reserve1, amount1Desired);
            }
        }
        if (amount0 < amount0Min) revert SlippageExceeded(amount0, amount0Min);
        if (amount1 < amount1Min) revert SlippageExceeded(amount1, amount1Min);

        uint256 supply = totalSupply();
        if (supply == 0) {
            uint256 root = Math.sqrt(amount0 * amount1);
            if (root <= MINIMUM_LIQUIDITY) revert InsufficientLiquidityMinted();
            shares = root - MINIMUM_LIQUIDITY;
            _mint(DEAD, MINIMUM_LIQUIDITY);
        } else {
            shares = Math.min((amount0 * supply) / _reserves.reserve0, (amount1 * supply) / _reserves.reserve1);
        }
        if (shares == 0) revert InsufficientLiquidityMinted();

        _mint(to, shares);
        _update(_reserves.reserve0 + amount0, _reserves.reserve1 + amount1);

        IERC20(token0).safeTransferFrom(msg.sender, address(this), amount0);
        IERC20(token1).safeTransferFrom(msg.sender, address(this), amount1);
        emit LiquidityAdded(msg.sender, amount0, amount1, shares, to);
    }

    /// @inheritdoc IPool
    function removeLiquidity(
        uint256 shares,
        uint256 amount0Min,
        uint256 amount1Min,
        address to
    ) external override nonReentrant returns (uint256 amount0, uint256 amount1) {
        if (shares == 0) revert ZeroAmount();
        uint256 supply = totalSupply();
        amount0 = (shares * _reserves.reserve0) / supply;
        amount1 = (shares * _reserves.reserve1) / supply;
        if (amount0 == 0 || amount1 == 0) revert InsufficientLiquidity();
        if (amount0 < amount0Min) revert SlippageExceeded(amount0, amount0Min);
        if (amount1 < amount1Min) revert SlippageExceeded(amount1, amount1Min);

        _burn(msg.sender, shares);
        _update(_reserves.reserve0 - amount0, _reserves.reserve1 - amount1);

        IERC20(token0).safeTransfer(to, amount0);
        IERC20(token1).safeTransfer(to, amount1);
        emit LiquidityRemoved(msg.sender, amount0, amount1, shares, to);
    }

    // ------------------------------------------------------------------ swap

    /// @inheritdoc IPool
    function swapExactIn(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address to
    ) external override nonReentrant returns (uint256 amountOut) {
        amountOut = getAmountOut(tokenIn, amountIn);
        if (amountOut == 0) revert InsufficientLiquidity();
        if (amountOut < minAmountOut) revert SlippageExceeded(amountOut, minAmountOut);

        bool zeroForOne = tokenIn == token0;
        address tokenOut = zeroForOne ? token1 : token0;
        if (zeroForOne) _update(_reserves.reserve0 + amountIn, _reserves.reserve1 - amountOut);
        else _update(_reserves.reserve0 - amountOut, _reserves.reserve1 + amountIn);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(to, amountOut);
        emit Swap(msg.sender, tokenIn, amountIn, amountOut, to);
    }

    // -------------------------------------------------------------- internal

    /// @dev USDC per whole WBTC scaled by 1e18, floor division. Reverts if the pool is empty.
    function _priceE18(uint256 r0, uint256 r1) internal view returns (uint256) {
        if (r0 == 0 || r1 == 0) revert InsufficientLiquidity();
        return (r1 * priceScaleNum) / (r0 * priceScaleDen);
    }

    /// @dev Accumulates the price that was in effect since the last update, records an observation, then stores
    ///      the new reserves. Must be called before any token moves.
    function _update(uint256 newReserve0, uint256 newReserve1) internal {
        if (observations.length == 0) {
            observations.push(Observation(SafeCast.toUint32(block.timestamp), 0));
        } else {
            uint256 elapsed = block.timestamp - _reserves.timestamp;
            if (elapsed > 0) {
                priceCumulative += _priceE18(_reserves.reserve0, _reserves.reserve1) * elapsed;
                observations.push(
                    Observation(SafeCast.toUint32(block.timestamp), SafeCast.toUint224(priceCumulative))
                );
            }
        }
        _reserves = Reserves(
            SafeCast.toUint112(newReserve0),
            SafeCast.toUint112(newReserve1),
            SafeCast.toUint32(block.timestamp)
        );
    }
}
