//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IOrderBook } from "./interfaces/IOrderBook.sol";
import { IPool } from "./interfaces/IPool.sol";
import { IPriceGuard } from "./interfaces/IPriceGuard.sol";
import { PriceMath } from "./libraries/PriceMath.sol";

/// @title OrderBook
/// @notice Streaming sell orders: a seller deposits WBTC and the order is swapped for USDC through one pool in a
///         fixed number of equal slices. Each order is an ERC-721; whoever holds the NFT owns the unsold WBTC and
///         the USDC proceeds, and can transfer, claim or cancel.
/// @dev There is no owner and no admin function: the pool and the price guard are fixed at deployment and nothing
///      else can be changed. Fee-on-transfer and rebasing tokens are not supported. The pool is trusted to pull
///      exactly `amountIn` and to return the real output amount.
contract OrderBook is IOrderBook, ERC721, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Upper limit on slices per order.
    uint256 public constant MAX_SLICES = 200;
    /// @notice Upper limit on the per-order tolerance below the oracle-implied output: 10%.
    uint256 public constant MAX_TOLERANCE_BPS = 1_000;
    uint256 internal constant BPS = 10_000;

    IPool public immutable pool;
    IPriceGuard public immutable priceGuard;
    IERC20 public immutable wbtc;
    IERC20 public immutable usdc;
    uint8 internal immutable wbtcDecimals;
    uint8 internal immutable usdcDecimals;

    /// @notice Id the next order will get. Ids start at 1.
    uint256 public nextOrderId = 1;

    /// @dev Storage layout of an order: two slots instead of the three that IOrderBook.Order would use.
    ///      slot 0: remainingIn | proceeds. slot 1: sliceSize (96 bits) | slicesLeft | interval | nextExecution |
    ///      toleranceBps. sliceSize is narrowed to 96 bits (about 7.9e28 raw units, 1e13 times the WBTC supply);
    ///      createOrder rejects anything larger.
    struct StoredOrder {
        uint128 remainingIn;
        uint128 proceeds;
        uint96 sliceSize;
        uint32 slicesLeft;
        uint32 interval;
        uint64 nextExecution;
        uint16 toleranceBps;
    }

    mapping(uint256 orderId => StoredOrder) internal _orders;

    constructor(IPool pool_, IPriceGuard priceGuard_) ERC721("Streaming Order", "SORDER") {
        pool = pool_;
        priceGuard = priceGuard_;
        IERC20 wbtc_ = IERC20(pool_.token0());
        IERC20 usdc_ = IERC20(pool_.token1());
        wbtc = wbtc_;
        usdc = usdc_;
        wbtcDecimals = IERC20Metadata(address(wbtc_)).decimals();
        usdcDecimals = IERC20Metadata(address(usdc_)).decimals();
    }

    /// @inheritdoc IOrderBook
    /// @dev Needs 1 to MAX_SLICES slices, at least 1 raw unit per slice, a non-zero interval and a tolerance of at
    ///      most MAX_TOLERANCE_BPS. The first slice can run `interval` seconds after creation. The tolerance must
    ///      leave room for the pool fee (30 bps) plus the expected price impact of one slice, or the slice reverts.
    function createOrder(
        uint256 totalIn,
        uint32 slices,
        uint32 interval,
        uint16 toleranceBps
    ) external override nonReentrant returns (uint256 orderId) {
        if (
            slices == 0 ||
            slices > MAX_SLICES ||
            totalIn < slices ||
            totalIn > type(uint128).max ||
            totalIn / slices > type(uint96).max ||
            interval == 0 ||
            toleranceBps > MAX_TOLERANCE_BPS
        ) revert InvalidParams();

        orderId = nextOrderId++;
        _orders[orderId] = StoredOrder({
            remainingIn: uint128(totalIn),
            proceeds: 0,
            sliceSize: uint96(totalIn / slices),
            slicesLeft: slices,
            interval: interval,
            nextExecution: SafeCast.toUint64(block.timestamp + interval),
            toleranceBps: toleranceBps
        });
        emit OrderCreated(orderId, msg.sender, totalIn, slices, interval, toleranceBps);

        wbtc.safeTransferFrom(msg.sender, address(this), totalIn);
        _safeMint(msg.sender, orderId);
    }

    /// @inheritdoc IOrderBook
    /// @dev Anyone may call (the keeper is permissionless). Reverts OrderFinished when no slices are left and
    ///      TooEarly before `nextExecution`. Reverts if the Chainlink feed is bad (see PriceGuard). If the pool
    ///      price is outside the guard bounds the slice is skipped: SliceSkipped is emitted, no tokens move and the
    ///      next attempt is `interval` seconds later. Otherwise slice size is totalIn / slices, except the last
    ///      slice, which sells everything left so rounding dust is never stranded. The pool call must return at
    ///      least the oracle-implied amount minus the tolerance, or the whole call reverts. After each attempt the
    ///      next slice is due `interval` seconds from now (not from the previous due time), so a late keeper never
    ///      causes a burst of back-to-back slices.
    function executeSlice(uint256 orderId) external override nonReentrant returns (bool executed) {
        _requireOwned(orderId);
        StoredOrder storage order = _orders[orderId];
        if (order.slicesLeft == 0) revert OrderFinished();
        if (block.timestamp < order.nextExecution) revert TooEarly(order.nextExecution);

        uint256 poolPriceE18 = pool.spotPriceE18();
        if (!priceGuard.poolWithinBounds(poolPriceE18)) {
            order.nextExecution = SafeCast.toUint64(block.timestamp + order.interval);
            emit SliceSkipped(orderId, poolPriceE18, priceGuard.getOraclePrice());
            return false;
        }

        uint256 oraclePriceE18 = priceGuard.getOraclePrice();
        uint256 amountIn = order.slicesLeft == 1 ? order.remainingIn : order.sliceSize;
        uint256 minAmountOut = (PriceMath.quoteRaw(amountIn, oraclePriceE18, wbtcDecimals, usdcDecimals) *
            (BPS - order.toleranceBps)) / BPS;

        order.remainingIn -= uint128(amountIn);
        order.slicesLeft -= 1;
        order.nextExecution = SafeCast.toUint64(block.timestamp + order.interval);

        wbtc.forceApprove(address(pool), amountIn);
        uint256 amountOut = pool.swapExactIn(address(wbtc), amountIn, minAmountOut, address(this));
        order.proceeds += SafeCast.toUint128(amountOut);

        emit SliceExecuted(orderId, amountIn, amountOut, order.slicesLeft);
        return true;
    }

    /// @inheritdoc IOrderBook
    /// @dev Anyone may call; the USDC always goes to the current `ownerOf(orderId)`, so a transferred order pays
    ///      its new holder. Reverts NothingToClaim when there are no proceeds.
    function claim(uint256 orderId) external override nonReentrant returns (uint256 amountOut) {
        address holder = ownerOf(orderId);
        amountOut = _orders[orderId].proceeds;
        if (amountOut == 0) revert NothingToClaim();
        _orders[orderId].proceeds = 0;
        usdc.safeTransfer(holder, amountOut);
        emit Claimed(orderId, holder, amountOut);
    }

    /// @inheritdoc IOrderBook
    /// @dev Only the NFT holder (not an approved operator) may cancel. Pays out the unsold WBTC and any unclaimed
    ///      USDC, deletes the order and burns the NFT. Works on a finished order too, as claim-and-burn.
    function cancel(uint256 orderId) external override nonReentrant {
        address holder = ownerOf(orderId);
        if (msg.sender != holder) revert NotOrderOwner();
        uint256 refundedIn = _orders[orderId].remainingIn;
        uint256 proceedsPaid = _orders[orderId].proceeds;
        delete _orders[orderId];
        _burn(orderId);

        if (refundedIn != 0) wbtc.safeTransfer(holder, refundedIn);
        if (proceedsPaid != 0) usdc.safeTransfer(holder, proceedsPaid);
        emit Cancelled(orderId, holder, refundedIn, proceedsPaid);
    }

    /// @inheritdoc IOrderBook
    function getOrder(uint256 orderId) external view override returns (Order memory) {
        _requireOwned(orderId);
        StoredOrder memory o = _orders[orderId];
        return
            Order({
                remainingIn: o.remainingIn,
                proceeds: o.proceeds,
                sliceSize: o.sliceSize,
                slicesLeft: o.slicesLeft,
                interval: o.interval,
                nextExecution: o.nextExecution,
                toleranceBps: o.toleranceBps
            });
    }
}
