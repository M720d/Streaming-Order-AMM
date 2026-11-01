# Off-chain bots: keeper and arbitrage

Code: `packages/hardhat/scripts/keeper.ts`, `scripts/arb.ts`, shared logic in `scripts/offchain/`. Tests: `test/EndToEnd.ts`.
Run from `packages/hardhat` with `export PATH=$HOME/.local/node/bin:$PATH`. Config comes from `.env` (see `.env.example`); keys are
read from env only. Use testnet-only accounts.

```
yarn keeper            # loop; add  -- --once  for a single pass
yarn arb               # loop; add  -- --once  for a single look
```

Required env: `RPC_URL`, `ORDER_BOOK`, `KEEPER_PRIVATE_KEY` (keeper); `RPC_URL`, `POOL`, `BTC_USD_FEED`, `ARB_PRIVATE_KEY` (bot).
The bot account needs ETH for gas plus WBTC and USDC. Every log line is one JSON object.

## Keeper
- Finds orders from `OrderCreated` events (set `START_BLOCK` to the OrderBook deploy block; lower `MAX_LOG_RANGE` if the RPC limits `eth_getLogs`). Drops orders that are finished or cancelled.
- Per due order: simulates `executeSlice` first. Results logged: `filled` (tx hash, amounts), `skipped` (PriceGuard band; not sent unless `SEND_SKIPS=true`, then with tx hash), `reverted` (simulated, nothing sent, or mined-reverted with tx hash), `pending`, `error`.
- No double send: one tx at a time; a tx without a receipt is parked and never re-sent; simulation before each send; the contract itself rejects a second slice inside the interval (`TooEarly`).
- Schedule checks use chain time. On an idle local `hardhat node` chain time does not move without blocks; advance it with `evm_increaseTime` + `evm_mine`.

## Arbitrage bot
- Reads the Chainlink feed directly and the pool's `spotPriceE18`. Refuses a stale (`ARB_ORACLE_MAX_AGE_SEC`), non-positive or carried-over oracle round.
- If the gap is at least `ARB_GAP_THRESHOLD_BPS` it sizes the profit-maximising trade (same rule as the slicing notebook), caps it at `ARB_MAX_TRADE_WBTC` / `ARB_MAX_TRADE_USDC` and by wallet balance, takes the pool's own `getAmountOut` quote (30 bps fee included) and trades only if expected profit at the oracle price is at least `ARB_MIN_PROFIT_USDC`. Minimum output = quote minus `ARB_SLIPPAGE_BPS`. Approves only the amount needed.
- A capped trade closes the gap in steps over several polls (default cap 300,000 USDC per trade).
