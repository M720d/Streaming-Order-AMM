# Slither results: order side

Scope: `OrderBook.sol`, `PriceGuard.sol`, `libraries/PriceMath.sol` (mocks and `node_modules` excluded).
Tool: Slither 0.11.4, solc 0.8.30 (the version Hardhat compiles with), 100 detectors, run 2026-11-01 on the final code.

```
cd packages/hardhat && source ../../.venv/bin/activate
slither contracts/OrderBook.sol  --solc-remaps "@openzeppelin=node_modules/@openzeppelin @chainlink=node_modules/@chainlink" --filter-paths "node_modules|mocks"
slither contracts/PriceGuard.sol --solc-remaps "@openzeppelin=node_modules/@openzeppelin @chainlink=node_modules/@chainlink" --filter-paths "node_modules|mocks"
```

Result: OrderBook 4 findings, PriceGuard 3 findings. No high or medium finding that is a real vulnerability. One change made
because of the first run: the implementation contracts used the scaffold pragma `>=0.8.0 <0.9.0`; they now use `^0.8.20` as the
project rules require.

| # | Contract | Detector | Verdict | Explanation |
|---|----------|----------|---------|-------------|
| 1 | OrderBook.executeSlice | reentrancy-no-eth (`order.proceeds` written after `pool.swapExactIn`) | Explained, not changed | The output amount only exists after the swap, so `proceeds` cannot be written first. The function, `claim`, `cancel` and `createOrder` are all `nonReentrant`, so no state-changing function can run during the swap; `test/OrderBook.ts` shows executeSlice, claim and cancel each fail with `ReentrancyGuardReentrantCall` when called from inside the pool. Everything else that must change (`remainingIn`, `slicesLeft`, `nextExecution`) is written before the call, and the pool is an immutable, trusted address. Slither's cross-function note is about the view `getOrder`, which during the swap would show `proceeds` one slice behind. That is a read-only view of a half-finished call and moves no funds. |
| 2 | OrderBook.executeSlice | timestamp (`block.timestamp < nextExecution`) | Accepted | Slicing on a schedule is the feature. A validator can shift a timestamp by seconds; the interval is minutes or longer, and the swap is protected by an oracle-derived minimum output, so a few seconds change nothing material. |
| 3 | OrderBook, PriceGuard, interfaces | solc-version ("constraint too complex") | Accepted | Remaining hits are the frozen interface files (`>=0.8.0 <0.9.0`), including Dev's `IPool.sol`. Implementations use `^0.8.20` and Hardhat compiles everything with exactly 0.8.30. Changing frozen interfaces only for this message was not worth it. |
| 4 | IPool (via OrderBook) | naming-convention (`FEE_BPS()` not mixedCase) | Not ours | In Dev's `IPool.sol`. `FEE_BPS` is a constant-style name on purpose; left alone. |
| 5 | PriceGuard.getOraclePrice | unused-return (`startedAt` ignored from `latestRoundData`) | Accepted | The guard checks `answer`, `updatedAt` and `answeredInRound`/`roundId`; `startedAt` carries no extra safety information. |
| 6 | PriceGuard.getOraclePrice | timestamp | Accepted | Staleness is measured in time by design; the limit is at least one second and defaults to an hour, so a few seconds of timestamp drift is irrelevant. A `updatedAt` in the future is rejected as stale. |

## Things the tool cannot see (reviewed by hand)

- **Trust in the pool.** OrderBook approves the pool for exactly `amountIn` per slice and takes the returned `amountOut` at face
  value. The pool is fixed at deployment and has no owner. A different pool address means a different OrderBook deployment.
- **No admin on OrderBook.** It has no owner. PriceGuard's owner can change only `maxStaleness` (1 s to 1 day) and
  `maxDeviationBps` (1 to 2,000), each with an event; it cannot change the feed or touch funds.
- **Fee-on-transfer and rebasing tokens** are unsupported (documented in NatSpec); the project uses its own mock WBTC and USDC.
- **A sustained pool/oracle gap** causes skipped slices, not losses; a stale or non-positive feed reverts instead of trading.
- **Slippage reverts.** If the pool output falls below the oracle-derived minimum (tolerance too tight for the price drift),
  the slice reverts and retries later. The seller can always `cancel`.
