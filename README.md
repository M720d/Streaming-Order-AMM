# Streaming-Order AMM

Sell a large amount of WBTC for USDC in equal slices over time instead of all at once, with every slice checked against
Chainlink. FRE-GY 6931 Blockchain & Cryptocurrency, Fall 2026. Team: Aditya Shah (as22008), Siddhant Yadav (sy4583),
Dev Salvi (ds8259).

**Testnet only.** Everything runs on a local chain or on Sepolia with mock tokens. Never use a wallet that holds real funds.

## What it does

- **Pool** (`packages/hardhat/contracts/Pool.sol`): constant-product pool for mock WBTC (8 decimals) and mock USDC
  (6 decimals), 30 bps fee, LP shares (the pool is the ERC-20 share token), time-weighted average price. No owner.
- **PriceGuard** (`PriceGuard.sol`): reads Chainlink BTC/USD; reverts on a stale, non-positive or carried-over price; tells the
  order book when the pool is too far from Chainlink. Its owner can change only the staleness limit (max 1 day) and the
  allowed deviation (max 20%).
- **OrderBook** (`OrderBook.sol`): a seller deposits the whole order and gets an ERC-721. Anyone can call `executeSlice` once
  per interval; each slice sells `total / slices` (the last one sells the remainder) and must return at least the
  Chainlink-implied amount minus the order's tolerance. A slice is skipped, not reverted, when the pool is off. The NFT holder
  can claim USDC or cancel at any time. No owner.
- **Keeper** (`scripts/keeper.ts`): finds orders from events and calls `executeSlice` when due; never sends twice.
- **Arbitrage bot** (`scripts/arb.ts`): trades the pool back toward Chainlink when that is profitable after the fee; this is
  what refills the pool between slices.
- **Web app** (`packages/nextjs`): pool and oracle view, create an order with a lump-sum vs sliced preview and a confirmation
  step, watch it stream in, claim and cancel; stale-feed warning; plain-language errors.

Price unit everywhere: **USDC per whole WBTC, scaled by 1e18** (60,000 USDC/BTC = `60_000e18`).

## Install

Requires Node 22 (>= 22.10) and Yarn, plus Python 3.9+ only for the notebooks and Slither.

```bash
git clone https://github.com/M720d/Streaming-Order-AMM.git
cd Streaming-Order-AMM
yarn install
cp packages/hardhat/.env.example packages/hardhat/.env      # fill only what you need; never commit it
```

## Run the tests

```bash
yarn test            # every contract and end-to-end test (94), with gas stats
```

Includes expected-revert tests, a seeded invariant test on the pool, reentrancy attacks, and end-to-end tests that run the
real keeper and arbitrage code against the contracts. Gas reports: `docs/gas-pool.md`, `docs/gas-orders.md`. Slither:
`docs/slither-full.md` (command inside).

## Run locally (contracts, app, keeper, bot)

```bash
yarn chain                              # terminal 1: local chain
yarn deploy --tags StreamingAMM         # terminal 2: deploys, seeds the pool at the mock oracle price
yarn start                              # terminal 3: http://localhost:3000 (burner wallet connects automatically)
```

Use the app's faucet for test WBTC and create an order. A local chain's clock moves only when blocks are mined, so to let a
slice come due quickly, run any transaction or mine a block.

Keeper and bot, against the local chain (the keys below are Hardhat's public test accounts, local use only):

```bash
# in packages/hardhat/.env (addresses are printed by yarn deploy and saved in packages/hardhat/deployments.local.json)
RPC_URL=http://127.0.0.1:8545
ORDER_BOOK=0x...      POOL=0x...      BTC_USD_FEED=0x...   # the MockAggregator on a local chain
KEEPER_PRIVATE_KEY=0x...    ARB_PRIVATE_KEY=0x...

yarn keeper           # loop; `yarn keeper --once` for one pass
yarn arb              # loop; `yarn arb --once` for one look
```

Each prints one JSON line per event (`filled`, `skipped`, `reverted` with the tx hash). All options (threshold, max trade
size, minimum profit, retry delays) are in `packages/hardhat/.env.example` and `docs/offchain.md`.

## Sepolia

Deployment and verification: `docs/deployment.md`. Then run the keeper and bot with a Sepolia `RPC_URL`, testnet-only keys
and the deployed addresses (`START_BLOCK` = the OrderBook deploy block), and start the app with
`NEXT_PUBLIC_TARGET_NETWORK=sepolia yarn start`. Addresses and transaction evidence: `submission.json`.

## Analysis

| Notebook | Question |
|---|---|
| `docs/analysis_pool.ipynb` (Part A) | Price impact by trade size; impermanent loss and LP profit with fees |
| `docs/analysis_slicing.ipynb` (Part B) | Lump sum vs 5, 10, 20 slices, with and without refill; reconciliation with the contracts |
| `docs/analysis_costs.ipynb` (Part C) | USD cost of each action; when slicing pays after gas; break-even volume |

Run with `source .venv/bin/activate && jupyter lab docs/` (Python packages: numpy, pandas, matplotlib, jupyter).

## Repository map

```
packages/hardhat/contracts/     Pool, PriceGuard, OrderBook, libraries/PriceMath, interfaces/, mocks/
packages/hardhat/test/          Pool, PriceGuard, OrderBook, EndToEnd, gas tests
packages/hardhat/deploy/        01..05 deploy and seed, 98 writes the address file
packages/hardhat/scripts/       keeper.ts, arb.ts, offchain/ (shared bot code), measureCostGas.ts
packages/nextjs/                web app (app/page.tsx, app/_components, hooks/streaming, utils/streaming)
docs/                           notebooks, report drafts, Slither, gas, deployment, AI-use log
```

## Known limitations

- A slice can be sandwiched within the guard band and the seller's tolerance (no private mempool).
- The proposed protocol fee and execution fee are not implemented; the Pool pays the whole 30 bps fee to LPs.
- No external audit. Testnet only.

Built on [Scaffold-ETH 2](https://scaffoldeth.io) (Hardhat, Next.js, wagmi, viem, RainbowKit). AI use: `docs/ai-use.md`.
