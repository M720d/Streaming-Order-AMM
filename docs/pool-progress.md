# Pool workstream: shared status

Living file for any agent or person working on the pool side (MockWBTC, MockUSDC, Pool, pool tests, Slither and gas for the pool, `analysis_pool.ipynb`, report section 3 and the pool half of section 5). Read it before starting, update it before stopping. Keep entries short and factual; mark anything unverified as such. The order side has its own file: `docs/orders-progress.md`.

Last updated: 2026-11-01

## Ownership

- Dev Salvi (ds8259) owns the pool side and approves every interface change on both sides.
- Do not edit `docs/orders-progress.md` or order-side contracts (`OrderBook`, `PriceGuard`, `IOrderBook`, `IPriceGuard`) from a pool session unless Dev asks in that session.
- Resolved 2026-11-01: Dev confirmed they are doing Aditya's order-side tasks themselves (in another session), so Aditya's ack on `IPool.sol` is moot and the interface is approved. Pool sessions still stay on pool files; order-side sessions stay on order files.

## Conventions

- Pair: token0 = WBTC (8 decimals), token1 = USDC (6 decimals).
- **One price unit everywhere: USDC per whole WBTC, scaled by 1e18** (60,000 USDC/BTC = `60_000e18`). In raw reserves: `priceE18 = reserve1 * 1e8 * 1e18 / (reserve0 * 1e6)`, floor division. Raw-unit ratios never leave the Pool.
- Fee: 30 bps flat, taken from the input and left in the reserves. `amountInWithFee = amountIn * 9970; amountOut = amountInWithFee * reserveOut / (reserveIn * 10000 + amountInWithFee)`, floor division. The notebook function `swap_out_int` is the Python twin; keep them identical.
- Integer maths only in the contract, so every number can be reproduced exactly in Python.
- Commits: no `Co-Authored-By` line (Dev's instruction). The husky pre-commit hook needs `yarn`, which is not installed on Dev's machine, so Dev commits with `--no-verify`.
- Git: branch `dev/pool`, PR into `main` (PR #1 merged with the first two tasks).

## Interface

`packages/hardhat/contracts/interfaces/IPool.sol` is the source of truth; no CLAUDE.md or AGENTS.md contains the signatures. Its header says: approved by Dev, waiting for Aditya's ack. `docs/orders-progress.md` says Aditya's ack is no longer needed. Not confirmed by Dev to the pool session.

Changes since the first draft (made by another session, recorded here): price unit changed to USDC per whole WBTC x 1e18; `spotPrice()` is now `spotPriceE18()`; `consultTwap` is now `consultTwapE18(uint32 window)`; `FEE_BPS()` added; the pool reads both token decimals at construction.

Planned Pool design decisions (not yet written, change only with Dev's approval):
- Pool inherits ERC-20 and is the LP share token (the proposal lists the LP token as a separate row; Dev has not decided whether it must be a separate contract).
- First deposit mints `sqrt(a0 * a1) - 1000` shares; 1000 shares are locked at `0x...dEaD` (OpenZeppelin 5 forbids minting to the zero address).
- Later deposits mint `min(a0 * supply / r0, a1 * supply / r1)`.
- TWAP: cumulative `price * elapsed seconds` (1e18 scaled), observations stored once per timestamp as packed `uint32 timestamp, uint224 cumulative`; `consultTwapE18(window)` finds the latest observation at or before `now - window`, interpolates to the exact window start, and reverts `InsufficientHistory` if the pool is younger than the window.
- Reentrancy guard on all state-changing functions; `SafeERC20` for transfers.
- Deliberately write the first version unoptimised (reserves read from storage repeatedly), so task 6 has a real before/after.

## Task list

| # | Task | Status |
|---|---|---|
| 1 | Scaffold + `IPool.sol` | Done. Scaffold by another session. Interface approved by Dev (see above). |
| 2 | MockWBTC, MockUSDC with owner mint and capped faucet | Done, 9 tests passing (`test/MockTokens.ts`). Faucet caps: 5 WBTC, 500,000 USDC per call. Merged in PR #1; NatSpec on all public functions added afterwards (not yet committed). |
| 3 | `Pool.sol` | Done, compiles (solc 0.8.30). Deliberately unoptimised baseline: reserves in two `uint256` slots plus `lastTimestamp` in a third, read repeatedly from storage; this is the 'before' for task 6. |
| 4 | Pool tests | Done: `test/Pool.ts`, 24 tests; whole suite 35 passing. Covers round trip, hand-computed swaps (Python-derived literals), slippage and zero-amount reverts, seeded fuzz (250 random ops: k never falls, pool balances equal reserves), TWAP at four windows from known price changes. Mutation-checked: fee 30 to 25 (9 tests fail), TWAP interpolation removed (2 fail), slippage check removed (2 fail). Fuzz is a seeded TypeScript loop, not Foundry/Hardhat Solidity fuzzing. |
| 5 | Slither, `docs/slither-pool.md` | Done 2026-11-01 on the final code: mocks 0 findings, Pool 16 results from 6 detectors, none a vulnerability, no reentrancy finding; each explained. Pragmas changed to `^0.8.20`. |
| 6 | Gas, one optimisation, `docs/gas-pool.md` | Done: reserves + update time packed into one slot. addLiquidity -5.6% to -15.1%, swapExactIn -8.1%, removeLiquidity -7.7% to -8.0%; suite 77 passing before and after. Baseline source in `docs/gas-baseline/Pool.baseline.sol.txt`; reproduce with `test/GasPool.ts`. |
| 7 | `docs/analysis_pool.ipynb` | Done, runs top to bottom, all asserts pass. Updated 2026-11-01 for the E18 price unit. Not yet committed. |
| 8 | Report section 3 and pool half of section 5 | Draft: `docs/report-sections-3-5.md`. Section 5 is ASSUMED to be security/testing/gas (not stated anywhere). Address table is [PENDING] the Sepolia deployment. |

## Pool as built (`packages/hardhat/contracts/Pool.sol`)

- `constructor(token0, token1)`; reads decimals; no owner, no admin function. LP token name `Streaming AMM LP`, symbol `SALP`. Pool is the ERC-20.
- Reverts: `ZeroAmount`, `InvalidToken`, `InsufficientLiquidity` (empty pool, or output rounds to 0), `InsufficientLiquidityMinted`, `SlippageExceeded(actual, min)`, `InsufficientHistory`.
- `addLiquidity` takes the V2-style optimal amounts and checks the minimums; `removeLiquidity` and `swapExactIn` send to `to`; tokens are pulled with `SafeERC20` after state is updated; all three are `nonReentrant`.
- TWAP: `consultTwapE18(window)` = (cumulativeNow - cumulativeAtWindowStart) / window; the window start is interpolated with the price in effect then. `window == 0` reverts `ZeroAmount`; a window longer than the pool's age reverts `InsufficientHistory`. Inside a view call, `now` is the latest block's timestamp (checked on Hardhat).
- Not supported: fee-on-transfer tokens, reserves above `uint112`.
- Known rounding: first-deposit LP loses about one share of value to the 1000 locked shares; later LPs lose less than one share's worth of each token per round trip.

## Numbers other sessions can reuse (from the notebook)

- Pool at start: 500 WBTC (`500e8`) and 30,000,000 USDC (`30_000_000e6`); `spotPriceE18` = `60_000e18`.
- Selling exactly 1 WBTC (`1e8`) into that pool at 30 bps returns **59,700,956,293** raw USDC units (59,700.956293 USDC); `test/Pool.ts` asserts it. First deposit of the full pool mints 1,224,744,870,391 shares.
- Price impact at 30 bps: 10% of the reserve (50 BTC) costs 9.34%, 0.5% (2.5 BTC) costs 0.79%.
- No-fee impermanent loss: -5.7191% at 2x or 0.5x, -20% at 4x or 0.25x, -42.5% at 10x or 0.1x.
- Base-case LP simulation (60% volatility, 30 days, 6M USD/day volume, seed 7): mean net vs HODL +0.68%, beats HODL on 91.6% of paths.

## Environment

- Repo root: `streaming-amm/` (the parent folder is not a git repo). Hardhat 3, `packages/hardhat`.
- **Node:** Hardhat 3 needs Node 22 or later. Homebrew's node is broken and `/usr/local/bin/node` is 16. Use `export PATH=$HOME/.local/node/bin:$PATH` (v22.23.4, see `PROJECT_STATE.md` section 3). This supersedes my earlier scratchpad Node, which is session-specific and can be ignored.
- **Yarn:** inside the repo `yarn` resolves to the bundled 4.13.0.
- **Tests:** from `packages/hardhat`: `yarn hardhat test --network hardhat test/MockTokens.ts` (add `--gas-stats` for gas; `yarn test` runs everything). Tests deploy with `ethers.deployContract`; they do not use the rocketh deploy fixtures.
- **Notebook:** run with `/opt/miniconda3/bin/python -m jupyter nbconvert --to notebook --execute --inplace docs/analysis_pool.ipynb` (needs numpy, pandas, matplotlib). Generated by a script that is not in the repo; edit the notebook directly if the script is gone.
- Slither and solc: not installed system-wide; `.venv` in the repo is reported to have them.

## Open questions

- Who owns the Sepolia deployer key, RPC and Etherscan keys for deployment and the address table?
- Separate LP token contract or Pool-as-ERC-20?
- Sepolia deploy, Etherscan verification and tx hashes (needs deployer key, RPC and Etherscan keys; none provided). Blocks the address table and the Sepolia reconciliation.
- Is an off-chain monitor and auditor agent (flags oracle gaps, skipped slices, TWAP/spot divergence; recomputes lump-sum vs sliced fill) in scope? Dev has parked it as an optional stretch goal needing group agreement. Not started, no work should begin without Dev's say-so. Design if approved: read-only, no keys, deterministic checks in code, an LLM only for the written summary.

## Change log

- 2026-10-29: Node 22 unpacked in scratchpad; IPool draft, MockWBTC, MockUSDC and tests written (9 passing).
- 2026-10-31: PR #1 (tasks 1 and 2) merged into `main`.
- 2026-11-01: `Pool.sol` (task 3) and `test/Pool.ts` (task 4) written; full suite 35 passing; three mutants caught. Slither, gas, report not started.
- 2026-11-01: tasks 5, 6, 8 done (see table). Storage packed in `Pool.sol` (struct `Reserves`); `test/GasPool.ts`, `docs/slither-pool.md`, `docs/gas-pool.md`, `docs/report-sections-3-5.md` added. Order side checked by this session: full suite 77 passing; `analysis_slicing.ipynb` re-executed on a copy: 0 errors, 56 model-vs-contract comparisons equal.
- 2026-11-01: NatSpec added to both mocks (tests rerun, 9 passing); linked from `PROJECT_STATE.md`.
- 2026-11-01: `IPool.sol` changed by another session (E18 price unit, renamed functions). Notebook (task 7) written and updated for the new unit. This file created.
