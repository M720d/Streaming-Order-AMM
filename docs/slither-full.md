# Slither results: full repo (combined)

Scope: every Solidity file in `packages/hardhat/contracts/` (production, libraries, mocks and the scaffold sample), plus one combined
compilation unit that imports `Pool`, `OrderBook` and `PriceGuard` together.
Tool: Slither 0.11.4, solc 0.8.30 (the version Hardhat compiles with), 100 detectors, run 2026-11-01 on the code as it is now
(Pool, OrderBook, PriceGuard unchanged since `slither-pool.md` and `slither-orders.md`; the off-chain scripts are TypeScript and are
not covered by Slither).

```
cd packages/hardhat && source ../../.venv/bin/activate
R="@openzeppelin=node_modules/@openzeppelin @chainlink=node_modules/@chainlink hardhat=node_modules/hardhat"
for f in Pool OrderBook PriceGuard libraries/PriceMath YourContract \
         mocks/MockWBTC mocks/MockUSDC mocks/MockAggregator mocks/MockPool mocks/PriceMathHarness mocks/ReentrantReceiver; do
  slither contracts/$f.sol --solc-remaps "$R" --filter-paths "node_modules"
done
# Combined unit: a temporary contracts/__AllForSlither.sol containing only
#   import { Pool } from "./Pool.sol"; import { OrderBook } from "./OrderBook.sol"; import { PriceGuard } from "./PriceGuard.sol";
slither contracts/__AllForSlither.sol --solc-remaps "$R" --filter-paths "node_modules"   # file deleted afterwards
```

The `hardhat=` remap is only needed for `YourContract.sol` (it imports `hardhat/console.sol`). Slither exits 255 whenever it finds
anything, so a non-zero exit code is not a failure.

## Result per file

| File | Results | Where explained |
|---|---|---|
| `Pool.sol` | 16 | `slither-pool.md` (same 16, all explained) |
| `OrderBook.sol` | 4 | `slither-orders.md` |
| `PriceGuard.sol` | 3 | `slither-orders.md` |
| `libraries/PriceMath.sol` | 0 | |
| `mocks/MockWBTC.sol`, `mocks/MockUSDC.sol`, `mocks/PriceMathHarness.sol` | 0 each | |
| `mocks/MockAggregator.sol` | 1 (solc-version: `^0.8.20` lists known compiler bugs) | see note A |
| `mocks/MockPool.sol` | 12 | test-only; see note B |
| `mocks/ReentrantReceiver.sol` | 5 | test-only; see note B |
| ~~`YourContract.sol`~~ (scaffold sample) | 4 | obsolete: file deleted after this scan; see note C |
| **Combined: Pool + OrderBook + PriceGuard** | **20** | below |

## Combined unit: 20 results, by detector

| Count | Detector | Impact | Real vulnerability? | Explained in |
|---|---|---|---|---|
| 1 | reentrancy-no-eth (`OrderBook.executeSlice` writes `proceeds` after `pool.swapExactIn`) | Medium | No | `slither-orders.md` row 1. With the real Pool in the same unit the result is identical (same single finding). The pool is immutable, and its `swapExactIn` is itself `nonReentrant` (`Pool.sol` line 197); the tokens are plain OpenZeppelin ERC-20s with no transfer hooks; and OrderBook's `executeSlice`, `claim`, `cancel`, `createOrder` are all `nonReentrant` (tested in `test/OrderBook.ts`). |
| 3 | divide-before-multiply (`Pool.addLiquidity` x2, `Pool.consultTwapE18`) | Medium | No | `slither-pool.md` rows 1 to 3 (floor in the pool's favour; exact division in the TWAP; `sqrt` branch has no prior division) |
| 6 | incorrect-equality (all in `Pool`) | Medium | No | `slither-pool.md` rows 4 and 5 (array lengths and the empty-pool state; `Pool` never reads `balanceOf`) |
| 1 | unused-return (`PriceGuard.getOraclePrice` ignores `startedAt`) | Medium | No | `slither-orders.md` row 5 |
| 7 | timestamp (Pool x5, OrderBook x1, PriceGuard x1) | Low | No | `slither-orders.md` rows 2 and 6; `slither-pool.md` row 6 |
| 1 | solc-version (`>=0.8.0 <0.9.0` on the frozen interfaces) | Informational | No | `slither-orders.md` row 3 |
| 1 | naming-convention (`IPool.FEE_BPS()`) | Informational | No | `slither-orders.md` row 4 |

No High-impact finding in any file. Nothing in the combined unit is new compared with the two earlier reports: 20 results here
against 16 + 4 + 3 = 23 per file, the difference being the interface-file findings that the per-file runs each repeat.
No contract was changed because of this run.

## Notes on the non-production files

- **A. `^0.8.20` "contains known severe issues".** Slither compares the pragma range with the compiler bug list. The project builds
  with exactly 0.8.30, which is outside every bug on that list, and the project rules require `^0.8.20`. Left as it is. It appears
  on `MockAggregator` on its own but is masked by the "too complex" message in runs that include the frozen interfaces.
- **B. `MockPool` and `ReentrantReceiver`.** Test doubles that exist to attack the OrderBook (reentrancy through the pool and through
  an NFT receiver). Their findings are the point of them: unchecked `transfer`/`approve` return values, unchecked zero addresses and
  a deliberate reentrant call. They are only used in `test/OrderBook.ts` and are not part of the Sepolia deploy (`deploy/01..05`
  deploy `MockWBTC`, `MockUSDC`, `Pool`, `PriceGuard`, `OrderBook`; `MockAggregator` only on local networks).
- **C. `YourContract.sol`.** The unmodified Scaffold-ETH 2 sample (zero-check on the constructor owner, a low-level call in
  `withdraw`, a non-mixedCase parameter, the complex pragma). It is not part of the product, is not deployed with
  `--tags StreamingAMM`, and is still compiled and tested by the suite. **Update 2026-11-01: `YourContract.sol`,
  `deploy/00_deploy_your_contract.ts` and `test/YourContract.ts` were deleted** (suite 94 -> 92 passing) so the scanned repo equals
  the shipped repo. Pool, OrderBook and PriceGuard are unchanged, so their results above still hold; Slither was **not** re-run
  after the deletion.

## What was not run

- Slither does not analyse the TypeScript scripts (`scripts/keeper.ts`, `scripts/arb.ts`, `scripts/offchain/`) or the front end.
- No other tool (Mythril, Echidna, Foundry invariants) was run. The pool's fuzz-style invariant test is a seeded TypeScript loop in
  `test/Pool.ts`.
- The results above are for the local compile. Nothing is deployed to Sepolia yet.
