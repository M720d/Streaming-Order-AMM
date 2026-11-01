# Deployment

All commands run in `packages/hardhat` with `export PATH=$HOME/.local/node/bin:$PATH`.

## Order of deployment (scripts in `deploy/`, tag `StreamingAMM`)

| Script | Deploys | Constructor wiring |
|---|---|---|
| `01_deploy_tokens.ts` | MockWBTC, MockUSDC | `(deployer)`: deployer owns minting |
| `02_deploy_pool.ts` | Pool (also the LP token) | `(MockWBTC, MockUSDC)` |
| `03_deploy_price_guard.ts` | MockAggregator (local only), PriceGuard | `(feed, deployer, maxStaleness, maxDeviationBps)` |
| `04_deploy_order_book.ts` | OrderBook | `(Pool, PriceGuard)` |
| `05_seed_pool.ts` | nothing (mints test tokens, adds first liquidity at the oracle price) | local networks by default; elsewhere only with `SEED_POOL=true` |
| `98_write_deployments_json.ts` | nothing (writes the address file) | runs last |

Feed: `BTC_USD_FEED` if set; on Sepolia (chain 11155111) the real Chainlink BTC/USD feed
`0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43`; otherwise a MockAggregator at 60,000 USD.
Optional env: `PRICE_MAX_STALENESS` (seconds, default 3600), `PRICE_MAX_DEVIATION_BPS` (default 500), `SEED_WBTC` (whole WBTC, default 500).

## Sepolia

1. `yarn generate` (or `yarn account:import`) for a testnet-only deployer; fund it from a Sepolia faucet. Never use a wallet with real funds.
2. Put your own `ALCHEMY_API_KEY` and `ETHERSCAN_API_KEY` in `.env` (see `.env.example`).
3. `SEED_POOL=true yarn deploy --network sepolia --tags StreamingAMM`. Without `--tags`, the scaffold's sample `YourContract` is deployed too.
4. `yarn verify --network sepolia` verifies **every** deployment saved under `deployments/sepolia/`, which includes MockWBTC and MockUSDC (they go through the same deploy script).
5. Addresses end up in `packages/hardhat/deployments.json` (committed, keyed by network name). Local runs go to `deployments.local.json` (gitignored).

The Sepolia feed can be stale for long stretches. If `executeSlice` reverts with `StalePrice`, the owner can raise `maxStaleness` on PriceGuard up to 1 day.

## What was tested (2026-11-01)

- `hardhat deploy --tags StreamingAMM` on the in-process network and on a local `hardhat node`: all six contracts deploy in order, the pool is seeded at 60,000 USDC/WBTC, `deployments.local.json` is written with address, tx hash, block and encoded constructor args per contract, and the scaffold's ABI generation runs.
- **Not tested:** any live-network deploy and Etherscan verification (no deployer key, funds, RPC key or Etherscan key were available).
- The scaffold's ABI generator throws "At least one other deployment script should exist" on `--network hardhat` (in-process, nothing is saved to disk). Use a local node (`yarn chain`, then `yarn deploy`) for that case.
