// Minimal human-readable ABIs so the keeper and the arbitrage bot run against any deployment without needing the
// Hardhat artifacts. They mirror contracts/interfaces/ (frozen) plus the errors the contracts can bubble up.

export const ORDER_BOOK_ABI = [
  "function getOrder(uint256 orderId) view returns (tuple(uint128 remainingIn, uint128 proceeds, uint128 sliceSize, uint32 slicesLeft, uint32 interval, uint64 nextExecution, uint16 toleranceBps))",
  "function executeSlice(uint256 orderId) returns (bool executed)",
  "event OrderCreated(uint256 indexed orderId, address indexed owner, uint256 totalIn, uint32 slices, uint32 interval, uint16 toleranceBps)",
  "event SliceExecuted(uint256 indexed orderId, uint256 amountIn, uint256 amountOut, uint32 slicesLeft)",
  "event SliceSkipped(uint256 indexed orderId, uint256 poolPriceE18, uint256 oraclePriceE18)",
  "event Cancelled(uint256 indexed orderId, address indexed to, uint256 refundedIn, uint256 proceedsPaid)",
  // OrderBook
  "error InvalidParams()",
  "error NotOrderOwner()",
  "error TooEarly(uint256 nextExecution)",
  "error OrderFinished()",
  "error NothingToClaim()",
  // PriceGuard, Pool and OpenZeppelin errors that surface through executeSlice
  "error InvalidPrice(int256 answer)",
  "error StalePrice(uint256 updatedAt, uint256 maxStaleness)",
  "error StaleRound(uint80 roundId, uint80 answeredInRound)",
  "error SlippageExceeded(uint256 amountOut, uint256 minAmountOut)",
  "error InsufficientLiquidity()",
  "error ZeroAmount()",
  "error ERC721NonexistentToken(uint256 tokenId)",
  "error ReentrancyGuardReentrantCall()",
];

export const POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function getAmountOut(address tokenIn, uint256 amountIn) view returns (uint256 amountOut)",
  "function swapExactIn(address tokenIn, uint256 amountIn, uint256 minAmountOut, address to) returns (uint256 amountOut)",
  "function FEE_BPS() view returns (uint256)",
  "function spotPriceE18() view returns (uint256 priceE18)",
  "event Swap(address indexed sender, address indexed tokenIn, uint256 amountIn, uint256 amountOut, address indexed to)",
  "error SlippageExceeded(uint256 amountOut, uint256 minAmountOut)",
  "error InsufficientLiquidity()",
  "error ZeroAmount()",
  "error InvalidToken()",
];

export const FEED_ABI = [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
];

export const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];
