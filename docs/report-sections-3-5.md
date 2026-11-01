# Report draft: Section 3 and the pool half of Section 5

Streaming-Order AMM, FRE-GY 6931. Draft for team review. Items marked **[OPEN]** are not done or not decided. **[PENDING]** means it needs the Sepolia deployment, which has not been run.

**Assumption to confirm:** the project files do not say what Section 5 is. This draft treats it as "Security, testing and gas" (Slither, test suite, gas measurement). If Section 5 is something else, only 5.x below needs to move; Section 3 does not depend on it.

---

## 3. Architecture

### 3.1 Contracts and how they connect

The system is six contracts on Sepolia: two test tokens, a pool, an oracle guard, an order book, and Chainlink's BTC/USD feed, which we read but do not own.

```
             seller / keeper
                  |
                  v
   +------------------------------+     reads     +--------------------+
   |   OrderBook (ERC-721)        |-------------->|    PriceGuard      |----> Chainlink BTC/USD
   |   one NFT per streaming order|  is the pool  |  staleness, sign,  |      (Sepolia feed)
   +------------------------------+  price within |  deviation checks  |
                  | swapExactIn     limits?       +--------------------+
                  v                                        ^
   +------------------------------+   spotPriceE18()       |
   |   Pool  (x*y = k, 30 bps)    |------------------------+
   |   is also the LP share token |   consultTwapE18() (any reader)
   +------------------------------+
        ^                    ^
        | LPs: addLiquidity  | traders: swapExactIn
        |  removeLiquidity   |
   +----------+        +----------+
   | MockWBTC |        | MockUSDC |   token0 = WBTC (8 decimals), token1 = USDC (6 decimals)
   +----------+        +----------+
```

The pool is the only contract that holds liquidity and the only one that sets prices. The order book never computes a price itself; it asks the pool for a swap and asks the guard whether the pool's price is acceptable. Sections 2 and 4 cover the order side.

### 3.2 The pool-side contracts

**MockWBTC and MockUSDC** are test tokens (OpenZeppelin ERC-20) with 8 and 6 decimals, matching the real assets. Sepolia has a BTC/USD price feed but no liquid WBTC/USDC market, so we issue our own pair. Each has an owner-only `mint` and a public `faucet(amount)` capped per call (5 WBTC, 500,000 USDC) so teammates can fund themselves without asking the owner. These are the only owner powers in the pool-side contracts, and they exist for testing only.

**Pool** is a constant-product pool for the pair, and it is also the ERC-20 that represents LP shares (symbol `SALP`). Everything a liquidity provider or trader does goes through five functions:

| Function | What it does |
|---|---|
| `addLiquidity(a0Desired, a1Desired, a0Min, a1Min, to)` | Takes tokens in the pool's current ratio (never less than the minimums) and mints shares to `to`. The first deposit mints `sqrt(a0 * a1) - 1000` shares and locks 1000 forever, so the pool can never be emptied and the price stays defined. |
| `removeLiquidity(shares, a0Min, a1Min, to)` | Burns the caller's shares and sends the matching share of both reserves to `to`. |
| `swapExactIn(tokenIn, amountIn, minAmountOut, to)` | Sells an exact amount in, reverts with `SlippageExceeded` if the output is below `minAmountOut`. The 30 bps fee is deducted from the input and stays in the reserves, so it accrues to LPs and `k` grows on every trade. |
| `spotPriceE18()` | Current price, USDC per whole WBTC, scaled by 1e18 (60,000 USDC/BTC reads as `60_000e18`). |
| `consultTwapE18(window)` | Time-weighted average of that price over the last `window` seconds. |

Design points specific to the pool:

- **Integer maths only, floor division.** The swap formula is `out = in*9970 * reserveOut / (reserveIn*10000 + in*9970)`. Because there is no floating point, the Python model in `docs/analysis_pool.ipynb` reproduces every contract output exactly, and the Hardhat tests assert values computed in Python rather than values read back from the contract.
- **TWAP from the pool's own accumulator.** On every reserve change the pool adds `price * seconds elapsed` to a running total and records `(timestamp, total)`. `consultTwapE18` finds the record at the start of the window, interpolates to the exact start using the price that was in force then, and divides the difference by the window. Records are stored once per block timestamp, packed into one 256-bit slot. A window longer than the pool's age reverts with `InsufficientHistory` instead of returning a biased number.
- **No admin.** The pool has no owner, no pause, no upgrade path and no fee switch. The fee is a constant. Nothing in it can be changed after deployment.
- **One price unit.** The pool reads both tokens' decimals at construction and converts internally, so the raw reserve ratio never leaves the contract (Section 2.1 explains why this mattered).
- **Reserves and update time share one storage slot** (112 + 112 + 32 bits). This is the gas optimization in Section 5.3; it caps each reserve at about 5.2e33 raw units, enforced with a checked cast.

**What the pool does not support:** fee-on-transfer and rebasing tokens (it credits the amount it asked for), and ERC-777-style token callbacks. Both tokens here are our own plain ERC-20s.

### 3.3 Address table

Sepolia deployment has not been run: no deployer key, funded account, RPC key or Etherscan key was available when this draft was written. The scripts exist (`deploy/01_..` to `05_..`, described in `docs/deployment.md`) and ran against a local chain. Fill the table from `packages/hardhat/deployments.json` after `yarn deploy --network sepolia --tags StreamingAMM` and `yarn verify --network sepolia`.

| Contract | Role | Sepolia address | Etherscan (verified) | Deployment tx |
|---|---|---|---|---|
| MockWBTC | Test token, 8 decimals | [PENDING] | [PENDING] | [PENDING] |
| MockUSDC | Test token, 6 decimals | [PENDING] | [PENDING] | [PENDING] |
| Pool (and LP token `SALP`) | Constant-product pool, 30 bps, TWAP | [PENDING] | [PENDING] | [PENDING] |
| PriceGuard | Chainlink checks and pool deviation limit | [PENDING] | [PENDING] | [PENDING] |
| OrderBook | ERC-721 streaming orders | [PENDING] | [PENDING] | [PENDING] |
| Chainlink BTC/USD feed (external) | Price oracle, 8 decimals | `0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43` (from `PROJECT_STATE.md`; **[OPEN]** confirm against Chainlink's Sepolia feed list before submission) | n/a | n/a |

**[OPEN]** Evidence for each row (a transaction hash, and for the pool at least one `addLiquidity`, one `swapExactIn` and one `consultTwapE18` call on Sepolia) is required by the project rules; none exists yet.

---

## 5. Security, testing and gas: pool side

### 5.1 Tests

`test/Pool.ts` has 24 tests and `test/MockTokens.ts` has 9; the full suite (including the order side) had 77 passing at the time of writing, run with `yarn test` in `packages/hardhat`. The pool tests cover:

- **Liquidity round trip.** Adding then removing all shares returns the deposit minus rounding and the 1000 locked shares (at least 99.9999% back). A second LP's round trip loses less than one share's worth of each token.
- **Hand-computed swap values.** Selling 1 WBTC into the 500 WBTC / 30,000,000 USDC pool returns exactly 59,700,956,293 raw USDC; selling 50 WBTC returns 2,719,832,681,640; selling 60,000 USDC returns 99,501,593 raw WBTC. These came from Python integer arithmetic, not from the contract.
- **Reverts.** Output below `minAmountOut` (including after a front-running trade moves the price), zero amounts on every function, an unknown token, an empty pool, a dust trade that rounds to zero, a first deposit too small for the locked minimum, and a TWAP window longer than the pool's history.
- **Invariant fuzzing.** A seeded loop of 250 random operations (swaps of up to 30% of a reserve in both directions, plus deposits and withdrawals) checks after every swap that `k = reserve0 * reserve1` has not decreased, and after every operation that the pool's actual token balances equal its recorded reserves. A second test replays five swap sizes against an independent integer model.
- **TWAP after known price changes.** A scenario with a price drop at +100 s and a rise at +300 s checks the average at four window lengths (500, 400, 250 and 100 s), including a window that starts between two records. Expected values were computed in Python.

**Test quality check.** A passing test only counts if it can fail, so we changed the pool three ways and confirmed the suite caught each: fee changed from 30 to 25 bps (9 tests fail), TWAP interpolation removed (2 fail), slippage check removed (2 fail). The contract was restored and re-tested after each.

**Limits of the testing.** The fuzz test is a seeded TypeScript loop, not coverage-guided fuzzing (Foundry, Echidna), and 250 operations is a sample, not a proof. The pool was tested only with 8-decimal and 6-decimal tokens; it reads decimals generically but other pairs were not tried. Nothing was tested on a live network yet **[PENDING]**.

### 5.2 Slither

Slither 0.11.4 with 100 detectors, on the final code: 0 findings on both mock tokens and 16 results from 6 detectors on `Pool`, none of them a vulnerability and none about reentrancy. Every finding is fixed or explained in `docs/slither-pool.md`. In short: three divide-before-multiply notes (one exact by construction because the TWAP step is `price * seconds`, one rounding in the pool's favour, one a false positive from a branch Slither cannot tell apart); `== 0` checks on array lengths and reserves (safe, because the pool never reads `balanceOf`, which is the pattern that detector exists to catch); `block.timestamp` use (needed for a TWAP); and two notes about the frozen interface file. One finding led to a change: after we packed the reserves, the unused-return warning on the range check disappeared. The report also lists what Slither cannot see (no admin, first-depositor price setting, sandwiching, TWAP manipulation cost).

### 5.3 Gas

Measured as exact receipt gas with `test/GasPool.ts` (solc 0.8.30, optimizer 200 runs). We made one change: the first version kept `reserve0`, `reserve1` and the last update time in three separate storage slots; the final version packs them into one (112 + 112 + 32 bits), the same layout `getReserves()` returns.

| Function | Before (gas) | After (gas) | Saved |
|---|---:|---:|---:|
| addLiquidity (first deposit) | 288,208 | 244,666 | 15.1% |
| addLiquidity (existing LP) | 132,852 | 123,548 | 7.0% |
| swapExactIn (sell WBTC) | 114,761 | 105,419 | 8.1% |
| swapExactIn (sell USDC) | 114,832 | 105,487 | 8.1% |
| removeLiquidity (half of an LP's shares) | 120,694 | 111,431 | 7.7% |

Two fewer storage reads and two fewer storage writes per call account for the roughly 9,300 gas saved on every operation, and the first deposit saves more because two slots stop going from zero to non-zero. Behaviour did not change: the whole suite passed before and after. The full table, the method and what was not measured are in `docs/gas-pool.md`.

### 5.4 What is left for the pool side **[OPEN]**

- Sepolia deployment, Etherscan verification, and the transaction hashes for Section 3.3.
- One human review of `Pool.sol` and of this text; the code, tests and drafts were written with an AI assistant (logged in `docs/ai-use.md`) and checked by tests and tools, not yet by a person reading every line.
- A decision on whether the LP token should be a separate contract, as the proposal's contract table lists it. The pool-as-token design is cheaper and has fewer moving parts; nothing in the tests depends on the choice.
