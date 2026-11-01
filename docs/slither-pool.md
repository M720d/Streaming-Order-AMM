# Slither results: pool side

Scope: `Pool.sol`, `mocks/MockWBTC.sol`, `mocks/MockUSDC.sol` (`node_modules` excluded).
Tool: Slither 0.11.4, solc 0.8.30 (the version Hardhat compiles with), 100 detectors, run 2026-11-01 on the final code.

```
cd packages/hardhat && source ../../.venv/bin/activate
slither contracts/Pool.sol             --solc-remaps "@openzeppelin=node_modules/@openzeppelin @chainlink=node_modules/@chainlink" --filter-paths "node_modules"
slither contracts/mocks/MockWBTC.sol   --solc-remaps "@openzeppelin=node_modules/@openzeppelin @chainlink=node_modules/@chainlink" --filter-paths "node_modules"
slither contracts/mocks/MockUSDC.sol   --solc-remaps "@openzeppelin=node_modules/@openzeppelin @chainlink=node_modules/@chainlink" --filter-paths "node_modules"
```

Result: `MockWBTC` 0 findings, `MockUSDC` 0 findings, `Pool` 16 results from 6 detectors. No high or medium finding that is a real
vulnerability, and no reentrancy finding. Changes made because of the tool or the project rules:

- Pragma changed from the scaffold's `>=0.8.0 <0.9.0` to `^0.8.20` in `Pool.sol` and both mocks (project rule).
- The first run reported `unused-return` on the two `SafeCast.toUint112` range checks in `_update`. Packing the reserves into one
  struct (gas task) made the checked values the ones that are stored, so the finding is gone.
- The result count rose from 12 to 16 between the first run and the final one because Slither started listing more `== 0` checks
  (rows 3 to 5 below) after the storage change. Those checks were already in the first version; I did not investigate why Slither
  reports them only now.

| # | Detector | Where | Verdict | Explanation |
|---|----------|-------|---------|-------------|
| 1 | divide-before-multiply | `consultTwapE18`: `priceAfter = (cum[i+1] - cum[i]) / dt`, then `priceAfter * (target - ts)` | Safe, not changed | The division is exact. Each cumulative step is `price * elapsed` added by `_update`, so `cum[i+1] - cum[i]` is exactly `price * dt` and dividing by `dt` loses nothing. Tested against an independent Python integer model at four window lengths. |
| 2 | divide-before-multiply | `addLiquidity`: `amount0 = amount1Desired * r0 / r1`, then `amount0 * supply / r0` | Safe, intended | The floor on the optimal amount only rounds in the pool's favour: the LP deposits at most what it is credited for. Rounding down shares is the standard way to keep a pool from being drained by dust. The round-trip test bounds the loss to less than one share's worth of each token. |
| 3 | divide-before-multiply | `addLiquidity`: `sqrt(amount0 * amount1)` after the division in row 2 | False positive | Slither ignores which branch it is in. `sqrt` runs only when `totalSupply() == 0`, which is exactly when the reserves are zero and `amount0`, `amount1` are the caller's unmodified desired amounts, so no division happened. |
| 4 | incorrect-equality | `observations.length == 0`, `lo == n - 1`, `n == 0` (`_update`, `consultTwapE18`) | Safe | Integer comparisons on an array length and an index, not on a balance. Nobody can push a value that makes these checks misbehave. |
| 5 | incorrect-equality | `r0 == 0 \|\| r1 == 0`, `reserveIn == 0 \|\| reserveOut == 0`, `amountOut == 0` | Safe | The risk this detector targets is code that tests `token.balanceOf(this) == x`, which an attacker breaks by sending one token. `Pool` never reads `balanceOf` (checked with grep); it tracks reserves in its own storage. A reserve of zero is the legitimate "empty pool" state, and `amountOut == 0` rejects a dust trade that rounds to nothing. |
| 6 | timestamp | `consultTwapE18`, `_update` | Accepted | A TWAP needs `block.timestamp`. A validator can move a timestamp by a few seconds; changing one observation by `s` seconds moves a window-`W` TWAP by at most `s / W` of the price change, small for windows of minutes. Do not use windows of a few seconds. |
| 7 | solc-version | `IPool.sol` (`>=0.8.0 <0.9.0`) | Accepted | The frozen interface file; Hardhat compiles everything with exactly 0.8.30 and the implementations use `^0.8.20`. |
| 8 | naming-convention | `IPool.FEE_BPS()` | Accepted | Constant-style name on purpose; same note as the order-side report. |

## Things the tool cannot see (reviewed by hand)

- **No admin at all.** `Pool` has no owner, no pause, no upgrade path and no fee switch. The fee is a constant 30 bps. The only owner
  functions in the pool-side files are `mint` on the two mock tokens, which exist for Sepolia testing only.
- **Reentrancy.** `addLiquidity`, `removeLiquidity` and `swapExactIn` are `nonReentrant`, and state (reserves, shares) is written
  before any token moves. Both tokens are our own standard ERC-20 mocks; token callbacks (ERC-777 style) are not supported.
- **Fee-on-transfer and rebasing tokens are unsupported.** The pool credits the amount it asked for, not the amount received, so such
  a token would leave it under-collateralised. The project uses its own mock WBTC and USDC.
- **Locked liquidity.** The first 1000 shares go to `0x...dEaD`, so the pool can never be fully emptied and the price is always
  defined after the first deposit.
- **First-depositor price setting.** Whoever adds liquidity first sets the price; an attacker could set a wrong price, and an
  arbitrageur would correct it at the first depositor's expense. On Sepolia the deployer seeds the pool; real use needs a price check
  at seeding (PriceGuard compares the pool with Chainlink before any order slice).
- **Sandwiching.** `minAmountOut` limits slippage but a public mempool trade can still be sandwiched up to that limit; this is the
  known limitation noted for the report.
- **TWAP manipulation cost.** A single-block price push is averaged over the window, so its effect shrinks as the window grows. A
  well-funded attacker holding the price for the whole window would move it; this pool offers no defence beyond the window length.
