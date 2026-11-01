// Plain-language messages for everything that can go wrong. Keys are the Solidity custom error names from
// OrderBook, PriceGuard, Pool and OpenZeppelin, plus the wallet and network errors users actually hit.

const MESSAGES: Record<string, (args: string[]) => string> = {
  TooEarly: ([next]) => {
    const secs = next ? Number(next) - Math.floor(Date.now() / 1000) : 0;
    return secs > 0
      ? `This order's next slice is not due yet. It becomes available in about ${secs} seconds.`
      : "This order's next slice is not due yet. Try again in a moment.";
  },
  OrderFinished: () => "All slices of this order have already been sold. You can claim your USDC.",
  NothingToClaim: () => "There is no USDC to claim yet. Proceeds appear after the first slice is sold.",
  NotOrderOwner: () => "Only the current holder of this order can do that.",
  InvalidParams: () =>
    "These order settings are not allowed. Use 1 to 200 slices, at least 1 unit of WBTC per slice, a time between slices above 0 and a tolerance of at most 10%.",
  StalePrice: () =>
    "The Chainlink price feed has not updated recently, so orders are paused for your safety. Try again once the feed updates.",
  InvalidPrice: () => "The Chainlink price feed returned an invalid price, so orders are paused for your safety.",
  StaleRound: () => "The Chainlink price feed is returning old data, so orders are paused for your safety.",
  SlippageExceeded: () =>
    "The pool price moved too far for this trade. Increase the allowed shortfall or try a smaller amount.",
  InsufficientLiquidity: () => "The pool does not have enough liquidity for this trade.",
  ZeroAmount: () => "The amount must be greater than zero.",
  FaucetCapExceeded: ([, cap]) =>
    `You asked for more than the faucet allows per request (maximum ${cap ?? "lower"} units).`,
  ERC721NonexistentToken: () => "This order no longer exists. It may have been cancelled.",
  ERC20InsufficientBalance: () => "You do not have enough tokens for this. Use the test-token faucet first.",
  ERC20InsufficientAllowance: () =>
    "The contract is not yet allowed to take your tokens. Approve first, then create the order.",
  ReentrancyGuardReentrantCall: () => "The contract refused a nested call. Please try again.",
};

const BY_TEXT: [RegExp, string][] = [
  [/user rejected|user denied|rejected the request/i, "You cancelled the request in your wallet. Nothing was sent."],
  [
    /insufficient funds for gas|exceeds the balance of the account/i,
    "Your wallet does not have enough ETH to pay the network fee.",
  ],
  [
    /chain mismatch|wrong network|does not match the target chain/i,
    "Your wallet is on a different network. Switch to the network shown at the top of the page.",
  ],
  [
    /nonce/i,
    "Your wallet and the network disagree about your transaction count. Reset the account in your wallet and retry.",
  ],
  [
    /timeout|timed out|network request failed|failed to fetch/i,
    "Could not reach the network. Check your connection and try again.",
  ],
];

/** Returns a plain-language message for a known failure, or undefined so the caller can fall back. */
export const friendlyErrorMessage = (error: any): string | undefined => {
  const root = error?.walk ? error.walk() : error;
  const name: string | undefined = root?.data?.errorName ?? root?.errorName;
  if (name && MESSAGES[name]) return MESSAGES[name]((root?.data?.args ?? []).map(String));
  const text = [error, root].map(e => `${e?.shortMessage ?? ""} ${e?.details ?? ""} ${e?.message ?? ""}`).join(" ");
  // Some nodes (Hardhat among them) only return the revert as text: "reverted with custom error 'StalePrice(1, 2)'".
  for (const key of Object.keys(MESSAGES)) {
    const m = text.match(new RegExp(`\\b${key}\\(([^)]*)\\)`));
    if (m) return MESSAGES[key](m[1] ? m[1].split(",").map(a => a.trim()) : []);
  }
  for (const [re, msg] of BY_TEXT) if (re.test(text)) return msg;
  return undefined;
};
