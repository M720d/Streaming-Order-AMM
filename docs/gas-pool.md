# Gas: pool side

Measured with `hardhat test --network hardhat test/GasPool.ts` (exact `gasUsed` from receipts; solc 0.8.30, optimizer 200 runs).
Run 2026-11-01. Each call is mined 60 seconds after the previous one, so every call also writes an oracle observation (the common
case). Pool of 500 WBTC / 30,000,000 USDC; the trader and the second LP already hold the tokens, so no row includes a first transfer
to a fresh address. Absolute numbers shift a little with account state; before and after were measured the same way.

## Before and after: pack the reserves and the update time into one storage slot

The first version of `Pool.sol` stored `reserve0`, `reserve1` and `lastTimestamp` as three separate `uint256` variables, so every
`addLiquidity`, `removeLiquidity` and `swapExactIn` read three slots and wrote three. The optimized version declares

```solidity
struct Reserves { uint112 reserve0; uint112 reserve1; uint32 timestamp; }   // 112 + 112 + 32 = 256 bits
Reserves internal _reserves;
```

and `_update` writes the whole struct in one store. This is the same layout `getReserves()` already returns, so the interface does not
change. The cost: reserves are capped at `2^112 - 1` (about 5.2e33 raw units, vastly more than the 8-decimal WBTC supply), enforced with
`SafeCast.toUint112`, which reverts instead of truncating. No other change was made between "before" and "after".
The "before" source is kept at `docs/gas-baseline/Pool.baseline.sol.txt` (rename to `.sol` under `contracts/` to rerun it).

| Function | Before (gas) | After (gas) | Saved |
|----------|-------------:|------------:|------:|
| addLiquidity (first deposit) | 288,208 | 244,666 | 43,542 (15.1%) |
| addLiquidity (second LP, new share holder) | 167,076 | 157,772 | 9,304 (5.6%) |
| addLiquidity (existing LP) | 132,852 | 123,548 | 9,304 (7.0%) |
| swapExactIn (sell WBTC) | 114,761 | 105,419 | 9,342 (8.1%) |
| swapExactIn (sell USDC) | 114,832 | 105,487 | 9,345 (8.1%) |
| removeLiquidity (half of an LP's shares) | 120,694 | 111,431 | 9,263 (7.7%) |
| removeLiquidity (rest of an LP's shares) | 115,894 | 106,631 | 9,263 (8.0%) |

Why: two fewer slots to load (cold SLOAD 2,100 each) and two fewer slots to write (about 2,900 each for an existing non-zero value),
roughly 10,000 gas, less a few hundred for masking the packed fields. The first deposit saves much more because two of the
three slots went from zero to non-zero (about 22,100 each) in the baseline and only one does now. Behaviour is unchanged: all 77 tests
in the suite pass before and after, including the 24 OrderBook tests that run against the real pool.

## What was not measured

- `consultTwapE18` and the other view functions (called off-chain, no gas for the caller). Its cost grows with `log2(observations)`.
- Deployment cost.
- A second call in the same block (no observation write): not measured; it skips the observation push, so it should be cheaper.
- The first trade from a brand-new address: a zero-to-non-zero token balance write costs more than an update (roughly 17,000 by EVM schedule; not measured here).

## What did not change

`priceCumulative` and the observation array stay in their own slots. `priceCumulative` could be narrowed to `uint224` and packed with
the reserves' timestamp, but that would need a new `uint256 -> uint224` check on every update for a saving of about one more slot;
not done, because the interface freeze and the deadline made one clear, safe change the better trade.
