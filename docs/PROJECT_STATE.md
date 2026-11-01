# PROJECT_STATE.md — shared state for humans and agents

**Read this first, update it last.** Every agent or person who changes code, interfaces, environment or decisions
must update the relevant section and add a line to the Handoff log before finishing. Only record what was actually
run or decided; mark anything else as "not done" or "not tested". Do not duplicate code structure that the repo
already shows.

Project: streaming-order AMM on Ethereum Sepolia (NYU FRE-GY 6931). Due **Nov 4, 11:59pm ET**.
Team: Aditya Shah (as22008), Siddhant Yadav (sy4583), Dev Salvi (ds8259).
**Ownership update (per `orders-progress.md`): Aditya cannot complete the order side; Dev owns Pool AND
PriceGuard/OrderBook/deploy/notebook-reconciliation.** Dev approves all interface changes. Siddhant's role is not
recorded. Order-side task list and details: [`orders-progress.md`](orders-progress.md) (keep both files in sync;
this file is the index, that one is the order-side detail). Pool-side detail: [`pool-progress.md`](pool-progress.md).
Full brief: `../Streaming_Order_AMM_Proposal.pdf` (one level above this repo).

## 1. Goal in one paragraph
Constant-product pool (30 bps fee, ERC-20 LP shares, TWAP accumulator) plus an ERC-721 OrderBook that executes a
seller's order in a fixed integer number of equal slices. PriceGuard compares the pool price with Chainlink BTC/USD
(Sepolia `0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43`) and skips a slice on excess deviation. Research question:
how much does slicing save versus a lump sum, and when does the saving vanish (no refill between slices)?
No continuous TWAMM math.

## 2. Hard rules (from the brief)
- Solidity ^0.8.20, OpenZeppelin v5 (ERC20, ERC721, Ownable, ReentrancyGuard, SafeERC20). Do not rewrite OZ.
- Checks-effects-interactions; `nonReentrant` on every token-moving function; SafeERC20.
- Admin functions: `onlyOwner`, hard-capped, emit events; comment exactly what the owner can change.
- NatSpec on every public/external function.
- Decimals: all price/amount conversions live in ONE place, scale named in the variable (`priceE18`), and tested.
- Slice count is a fixed integer.
- Tests: one command runs everything; at least one expected-revert test; fuzz tests for the pool invariant
  (k never decreases except rounding in favor of the pool). Run on local Hardhat; Sepolia only for final deploy/demo.
- Never put real money in a wallet. Never commit keys; `.env` is gitignored.
- Every feature needs evidence (tx hash, file, or video timestamp) and Etherscan verification.
- When finishing a task, state what was tested, what was not, and assumptions. Log AI use in `docs/ai-use.md`.
- Branches: `dev/pool`, `aditya/orders`, `sid/offchain`. Small PRs into `main`, reviewed by another person.
- `contracts/interfaces/` frozen after day two. Any signature change must be announced in the group chat.

## 3. Environment (this machine, Dev's Mac, arm64)
- Homebrew's Node is broken. Use `export PATH=$HOME/.local/node/bin:$PATH` (Node v22.23.4, checksum-verified).
- Yarn 1.22.22 (global npm install). Scaffold-ETH 2 with Hardhat 3.4.x, solc 0.8.30, OZ ^5.0.2.
- `@chainlink/contracts` added to the hardhat workspace.
- Python venv at `streaming-amm/.venv` (Python 3.9): numpy, pandas, matplotlib, jupyter, nbformat,
  slither-analyzer 0.11.4, solc-select. Activate with `source .venv/bin/activate`.
- Slither: `solc-select` global version in `.venv` was switched from 0.8.38 to **0.8.30** on 2026-11-01 to match Hardhat. Command in `docs/slither-orders.md`.
- Commands (run in `packages/hardhat`): `yarn compile`, `yarn test` (hardhat test --network hardhat --gas-stats).
- Git: `origin` = `github.com/M720d/Streaming-Order-AMM`; PR #1 (IPool draft, mocks, mock tests) merged into `main`; working branch `dev/pool`. Local commits need `--no-verify` unless `yarn` is on PATH for husky (reported by Dev's shell; not rechecked after the Node install). Later edits (E18 interface change, notebook, docs) are not committed yet.
- Verified so far: scaffold sample test passes; the three interfaces compile; `test/MockTokens.ts` 9 passing (rerun 2026-11-01 on `~/.local/node`). Note: `yarn -v` inside the repo reports 4.13.0 (the bundled release), not 1.22.22.

## 4. Decisions
| Date | Decision | Why |
|------|----------|-----|
| 2026-11-01 | One price unit everywhere: **USDC per whole WBTC, scaled 1e18** (60,000 USDC/BTC = `60_000e18`). Pool reads token decimals and converts internally; raw-unit ratios never leave the Pool. | Oracle (feed 8 dec) vs raw pool ratio differed by 100x for WBTC(8)/USDC(6). |
| 2026-11-01 | Renamed `spotPrice`→`spotPriceE18`, `consultTwap`→`consultTwapE18`; added `FEE_BPS()`; `poolWithinBounds(poolPriceE18)`. | Naming rule + unit decision above. |

| 2026-11-01 | Skip vs revert: pool price outside the guard band -> `SliceSkipped` and retry one interval later; oracle zero/negative/stale/old round -> revert. After every attempt the next slice is due `interval` from now. | A skip is a market condition, a bad oracle means we cannot judge the market. Avoids bursts after a late keeper. |
| 2026-11-01 | Order stored in 2 slots (`sliceSize` is `uint96` internally; interface struct unchanged); per-slice pool approval, not unlimited. | -22,054 gas on `createOrder`; unlimited approval would expose every order's WBTC to the pool address. |
| 2026-11-01 | Order-side contracts use `pragma ^0.8.20` (rules); frozen interfaces keep `>=0.8.0 <0.9.0`. | Project rule vs frozen interface files. |

## 5. Interfaces (`packages/hardhat/contracts/interfaces/`)
Status: **approved by Dev (ds8259). Aditya's ack is no longer needed (he is off the order side).** Treat as the
frozen v1 baseline; change only with Dev's approval and record it in section 4.

| File | Key signatures |
|------|----------------|
| IPool | `getReserves`, `addLiquidity(a0D,a1D,a0Min,a1Min,to)`, `removeLiquidity(shares,a0Min,a1Min,to)`, `swapExactIn(tokenIn,amountIn,minOut,to)`, `getAmountOut`, `FEE_BPS`, `spotPriceE18`, `consultTwapE18(window)` |
| IPriceGuard | `getOraclePrice()`, `poolWithinBounds(poolPriceE18)`, `maxStaleness`, `maxDeviationBps`, `setMaxStaleness`, `setMaxDeviationBps` |
| IOrderBook | `createOrder(totalIn,slices,interval,toleranceBps)`, `executeSlice(id)`, `claim(id)`, `cancel(id)`, `getOrder(id)` |

Token order: token0 = WBTC (8 dec), token1 = USDC (6 dec).

## 6. Work status
| Area | Owner | State |
|------|-------|-------|
| Scaffold, deps, venv | Dev | done (see section 3) |
| Interfaces | Dev | approved, compile (`yarn compile`) |
| MockWBTC / MockUSDC | Dev | done: `contracts/mocks/`, NatSpec added 2026-11-01, `test/MockTokens.ts` 9 passing (decimals 8/6, owner mint, non-owner revert, faucet cap 5 WBTC / 500,000 USDC, over-cap revert) |
| Decimals/price conversion library | Dev | done for the order side: `contracts/libraries/PriceMath.sol` (feed to E18, WBTC amount to raw USDC quote), tested in `test/PriceGuard.ts`. Pool keeps its own internal conversion |
| Pool + LP token + TWAP | Dev | done: `contracts/Pool.sol` (Pool is the LP ERC-20), compiles; unoptimised baseline kept for the gas before/after |
| Pool tests (revert, fuzz invariant) | Dev | done: `test/Pool.ts` 24 tests, suite 35 passing (`yarn test`); fuzz is a seeded TS loop (k never falls, balances equal reserves); 3 mutants caught |
| OrderBook | Dev (was Aditya) | done: `contracts/OrderBook.sol` (ERC-721, no owner), `test/OrderBook.ts` 24 tests; 4 mutants caught (last-slice dust, claim recipient, nonReentrant, TooEarly). Storage packed to 2 slots (gas) |
| PriceGuard | Dev (was Aditya) | done: `contracts/PriceGuard.sol` + `mocks/MockAggregator.sol`, `test/PriceGuard.ts` 16 tests (zero, negative, stale, future, answeredInRound, bounds at the exact limit, caps, non-owner). Owner changes only `maxStaleness` (<= 1 day) and `maxDeviationBps` (<= 2000) |
| Keeper script, arbitrage refill script | Sid | done locally 2026-11-01: `scripts/keeper.ts`, `scripts/arb.ts`, `scripts/offchain/`; guide `docs/offchain.md`. Run as CLIs against a local `hardhat node` (fill, guard skip, finished-order drop, arb trades all observed). Live Sepolia run **not tested** |
| End-to-end tests | Sid | done: `test/EndToEnd.ts` 17 tests (streamed proceeds 1,184,117 USDC vs lump sum 1,150,518 USDC for 20 WBTC / 5 slices, +292 bps; TooEarly revert; stale-oracle; double-send; arb cases). Full suite 94 passing |
| Full-repo Slither | Sid | done: `docs/slither-full.md` (no High; combined unit 20 results, all previously explained) |
| Pool analysis notebook `docs/analysis_pool.ipynb` (Part A) | Dev | done, executes top to bottom, all asserts pass; uses E18 price unit. Not committed. |
| Slicing notebook (Part B) | Dev (was Sid/Aditya) | done and executed: `docs/analysis_slicing.ipynb`; model matches the real contracts exactly (56 comparisons via `scripts/exportSliceFixture.ts` -> `docs/data/slice_fixture_local.json`). **Sepolia slice reconciliation cell is written but PENDING (no deployment yet); rubric-required** |
| Slither run, gas before/after | Dev/all | pool side done 2026-11-01: `docs/slither-pool.md` (mocks 0, Pool 16 results, none a vulnerability), `docs/gas-pool.md` (reserves packed into one slot; swap -8.1%, addLiquidity -5.6% to -15.1%, removeLiquidity about -7.7%). Order side done: `docs/slither-orders.md` (no real vulnerability; findings explained), `docs/gas-orders.md` (createOrder -22,054 gas via 2-slot storage; a first memory-cache attempt was +924 and reverted) |
| Deploy scripts | Dev | done and run locally (in-process and `hardhat node`): `deploy/01..05, 98`, `docs/deployment.md`. Live deploy and Etherscan verify **not tested** |
| Report sections 2 and 4 | Dev | first draft: `docs/report-sections-2-4.md` (has [OPEN] items) |
| Report section 3 and pool half of section 5 | Dev | first draft: `docs/report-sections-3-5.md`; Section 5's topic is assumed (security/testing/gas); address table [PENDING] Sepolia |
| Sepolia deploy + Etherscan verify + evidence | all | not started (needs deployer key, Sepolia ETH, Alchemy and Etherscan keys) |
| `docs/ai-use.md` | all | order-side and pool-side entries present (2026-11-01) |

## 7. Open questions / risks
- Sepolia RPC URL, Etherscan API key and deployer key (testnet-only) not yet provided; needed for deploy/verify.
- Pool rounding direction and minimum-liquidity lock amount: implemented as floor division everywhere with 1000 shares locked; Dev has not explicitly signed off.
- Dev's pool brief said OrderBook/PriceGuard are Aditya's; this file says Dev now owns them. The pool session has not heard that from Dev directly, so it stays on pool files until told.
- Deadline is Nov 4 11:59pm ET. All 8 pool tasks and all 8 order tasks are done locally; what remains is the live part: Sepolia deploy, Etherscan verification, transaction evidence, the Sepolia slice reconciliation, keeper and arbitrage scripts (Sid), a human read of the contracts and report, and committing (nothing is committed since PR #1).
- TWAP window vs Sepolia block timing: untested.
- Time left is short; prioritise Pool + OrderBook + tests before stretch goals (frontend).

## 8. Handoff log (newest first; one line each: date, who/which agent, what, tested?, assumptions)
- 2026-11-01 Claude (off-chain session, for Sid): wrote keeper, arb bot, `test/EndToEnd.ts`, `docs/offchain.md`, `docs/slither-full.md`; added `yarn keeper`/`yarn arb` and env entries. Tested: full suite 94 passing, eslint clean on new files, both CLIs run against a local `hardhat node`; found and fixed ethers' 250 ms nonce cache (provider `cacheTimeout: -1`). Side effect: a local `yarn deploy` regenerated `packages/nextjs/contracts/deployedContracts.ts` (chain 31337). NOT done: Sepolia run, front end, Part C, README/submission.json, report sections 1/6/7/8. Assumed: no execution fee exists on chain, so the bots model none; arb valued at oracle price with USDC = 1 USD.
- 2026-11-01 Claude (pool session, for Dev): finished pool tasks 5, 6, 8: Slither, gas (one change: pack reserves + timestamp into one slot, 8% off swaps), report 3 and 5 draft; pragmas to ^0.8.20. Tested: full suite 77 passing before and after the packing; Slither on final code; re-executed `analysis_slicing.ipynb` on a copy (0 errors, 56 comparisons equal). NOT done: Sepolia deploy and verification, any commit/push, human review. Assumed: report Section 5 = security/testing/gas.
- 2026-11-01 Claude (order session, for Dev): wrote PriceMath, PriceGuard, OrderBook, mocks, tests (full suite 76 passing, eslint clean), Slither + gas docs, deploy scripts, `analysis_slicing.ipynb`, `report-sections-2-4.md`, `deployment.md`. Tested: all of the above locally; mutation check on OrderBook. NOT done: Sepolia deploy, Etherscan verification, Sepolia slice reconciliation, any live-network step; keeper/arbitrage scripts (Sid). Assumed: no OrderBook owner, no execution fee (proposal mentions one: not built), Pool-as-LP-token accepted, interface sources untouched. Did not edit Pool files.
- 2026-11-01 Claude (pool session, for Dev): wrote `Pool.sol` and `test/Pool.ts`. Tested: full hardhat suite 35 passing; mutation check (fee, TWAP interpolation, slippage) all caught. Not done: Slither, gas, deploy, any order-side contract. Assumed: Pool-as-ERC-20, 1000 locked shares, floor rounding.
- 2026-11-01 Claude (pool session, for Dev): wrote `analysis_pool.ipynb` (Part A, executed, asserts pass), NatSpec on mocks (9 tests pass), `pool-progress.md`; updated notebook for E18 unit. Not done: Pool.sol and tasks 3 to 6, 8; nothing committed since PR #1. Assumed: IPool as edited is final; Pool-as-ERC-20 is acceptable.
- 2026-11-01 Claude (for Dev): reconciled with `orders-progress.md` (ownership, Node blocker resolved).
- 2026-11-01 Claude (for Dev): fixed price unit, updated 3 interfaces, created this file. Tested: `yarn compile` only.
  Assumed uint128 fields in `IOrderBook.Order` are sufficient for 8-decimal WBTC and 6-decimal USDC amounts.
- 2026-10-29 Claude (for Dev): installed Node 22, yarn, scaffolded SE-2 (Hardhat), added Chainlink, Python venv,
  Slither. Tested: scaffold sample test passes. Slither not yet run on any contract.
