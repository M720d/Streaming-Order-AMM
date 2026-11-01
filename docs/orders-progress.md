# Orders workstream: shared status

Living file for any agent or person working on the order side (PriceGuard, OrderBook, deploy pipeline, slicing notebook, report sections 2 and 4). Read it before starting, update it before stopping. Keep entries short and factual; mark anything unverified as such.

Last updated: 2026-11-01 (end of order session)

## Ownership

- Order side was Aditya Shah's (as22008). Aditya cannot complete it; **Dev Salvi (ds8259) is doing it**. Dev also owns the Pool, so Dev approves interface changes on both sides.
- **Do not touch Pool files** (`Pool.sol`, LP share token, `IPool.sol` beyond what Dev edits) unless Dev asks in this session.
- Siddhant Yadav (sy4583): role not recorded here yet.

## Agreed conventions

- Pair: token0 = WBTC (8 decimals), token1 = USDC (6 decimals). Orders sell WBTC for USDC through the single pool fixed at OrderBook construction.
- **One price unit everywhere: USDC per whole WBTC, scaled by 1e18** (60,000 USDC/BTC = `60_000e18`). Pool exposes `spotPriceE18()` and `consultTwapE18(window)`; PriceGuard's `getOraclePrice()` and `poolWithinBounds(poolPriceE18)` use the same unit.
- Chainlink feed has 8 decimals; conversion to the unit above handles feed decimals and token decimals (8 and 6) in one function.
- One owner role (OpenZeppelin Ownable). Owner-settable limits (staleness, max deviation bps) each have a hard cap.
- Pool fee is 30 bps, flat.

## Interfaces

| File | Status |
|---|---|
| `packages/hardhat/contracts/interfaces/IPool.sol` | Dev's. Approved by Dev; Aditya's ack no longer needed. |
| `packages/hardhat/contracts/interfaces/IPriceGuard.sol` | Approved by Dev (unit change above). |
| `packages/hardhat/contracts/interfaces/IOrderBook.sol` | Approved by Dev. |

The signatures live in those files, not in CLAUDE.md or AGENTS.md (neither contains them). Change an interface only with Dev's approval, and record the change here.

## Task list (do in order, one at a time, tests for each)

| # | Task | Status |
|---|---|---|
| 1 | IPriceGuard / IOrderBook interfaces | Done, approved by Dev, compiled. |
| 2 | PriceGuard.sol + tests with mock aggregator | Done 2026-11-01: `PriceGuard.sol`, `libraries/PriceMath.sol`, `mocks/MockAggregator.sol`; `test/PriceGuard.ts` 16 tests. |
| 3 | OrderBook.sol (ERC-721) | Done 2026-11-01: `OrderBook.sol`; tested against the real `Pool` and a `MockPool`. |
| 4 | OrderBook and PriceGuard test suite | Done: `test/OrderBook.ts` 24 tests (lifecycle, too early, stale/zero/negative feed, deviation skip, NFT transfer then claim, cancel, non-owner, 4 reentrancy cases); 4 mutants caught. Full suite 76 passing. |
| 5 | Slither + gas | Done: `docs/slither-orders.md`, `docs/gas-orders.md` (run `test/GasOrders.ts`). One optimization: 2-slot storage, createOrder -22,054 gas. |
| 6 | Deploy pipeline | Scripts done and run locally; see `docs/deployment.md`. **Live deploy, Etherscan verification: not tested.** |
| 7 | `docs/analysis_slicing.ipynb` | Done and executed; exact match with the contracts locally (56 comparisons). **Sepolia slice reconciliation PENDING** (needs deployment). |
| 8 | Report sections 2 and 4 | First draft in `docs/report-sections-2-4.md`; has [OPEN] items for the team. |

Pool and `IPool` were used as-is (real Pool for lifecycle tests, `MockPool` only for the reentrancy tests). No Pool file was edited.

## Remaining order-side work

1. Fund a testnet-only deployer, set `ALCHEMY_API_KEY` and `ETHERSCAN_API_KEY`, run the Sepolia deploy and `yarn verify --network sepolia`.
2. Create one order, run one slice, paste the tx hash into the last cell of `analysis_slicing.ipynb`, re-run; put the matching numbers in report 4.5.
3. Decide the [OPEN] items in `report-sections-2-4.md` (execution fee, Pool-as-LP-token, sandwich limitation).

## Environment

- Repo: `streaming-amm/`, Hardhat 3 flavor (`packages/hardhat`), branch `dev/pool`. Not a git repo at the parent folder; the repo root is `streaming-amm/`.
- **Node blocker resolved 2026-11-01.** Node v22.23.4 is installed at `~/.local/node` (not on the default PATH). In every new shell run `export PATH=$HOME/.local/node/bin:$PATH`. Yarn 1.22.22 is installed. Run commands from `packages/hardhat`: `yarn compile`, `yarn test`. Do not use Homebrew's broken node. See `PROJECT_STATE.md` section 3.
- Python tooling is in `streaming-amm/.venv` (`slither`, `solc`, `solc-select`, `jupyter`).
- Hardhat binary: `packages/hardhat/node_modules/.bin/hardhat`. Once Node 22 is on PATH: `hardhat compile`, `hardhat test --network hardhat --gas-stats`.
- OpenZeppelin ^5.0.2 and `@chainlink/contracts` ^1.5.0 are already dependencies.
- Gas limit note for deploy scripts is in AGENTS.md (set gas at the call site for post-deploy calls).

## Open questions

- Sepolia BTC/USD feed address and RPC/Etherscan keys for step 6 and the step 7 reconciliation: not yet provided.
- Role of Siddhant Yadav and who owns the report sections beyond 2 and 4.

## Change log

- 2026-11-01 (off-chain): keeper, arb bot, e2e tests, `slither-full.md` added by Sid's session (see `PROJECT_STATE.md`); no contract file changed.
- 2026-11-01 (end of session): tasks 2 to 8 done as listed above, except live-network steps.
- 2026-11-01 (later): Node 22 installed, interfaces compiled, cross-linked with `PROJECT_STATE.md`.
- 2026-11-01: Created. Interfaces drafted, then edited and approved by Dev. Tooling blocker found.
