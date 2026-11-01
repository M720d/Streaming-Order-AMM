# Gas: order side

Measured with `hardhat test --network hardhat test/GasOrders.ts` (exact `gasUsed` from receipts; solc 0.8.30, optimizer 200 runs,
real `Pool`, 10 BTC order in 5 slices). Run 2026-11-01. Numbers are for one specific sequence, so absolute values vary a little
with account state (first USDC transfer to a fresh address costs more), but before and after were measured the same way.

## Before and after: pack the order into two storage slots

`IOrderBook.Order` has seven fields (`uint128 x3, uint32 x2, uint64, uint16`), which Solidity lays out in **three** slots because
`toleranceBps` spills into a third. The interface cannot change (frozen), but the *storage* struct can differ from it. The
OrderBook now stores a private `StoredOrder` with `sliceSize` narrowed from 128 to 96 bits, which fits everything in two slots, and
`getOrder` copies it into the interface struct. `createOrder` rejects a slice size above 2^96-1 (about 7.9e28 raw units, 1e13 times
the whole WBTC supply). No behaviour or interface change; all 24 OrderBook tests pass before and after.

| Function | Before (gas) | After (gas) | Saved |
|----------|-------------:|------------:|------:|
| createOrder (first order) | 185,588 | 163,534 | 22,054 (11.9%) |
| createOrder (second order) | 168,488 | 146,434 | 22,054 (13.1%) |
| executeSlice (1st slice) | 201,777 | 199,791 | 1,986 (1.0%) |
| executeSlice (2nd slice) | 167,577 | 165,591 | 1,986 (1.2%) |
| executeSlice (last slice) | 162,761 | 160,775 | 1,986 (1.2%) |
| claim | 61,505 | 61,505 | 0 |
| cancel (unfilled order) | 60,153 | 56,148 | 4,005 (6.7%) |
| cancel (finished order, USDC only) | 60,153 | 56,148 | 4,005 (6.7%) |

Why: one fewer cold zero-to-nonzero SSTORE in `createOrder` (about 22,100), one fewer cold SLOAD per slice (2,100, less
masking), one fewer slot to clear in `cancel`. `executeSlice` is dominated by the pool swap and the two oracle reads, so a
storage change moves it by about 1%.

## What did not help

First attempt: load the order into memory once in `executeSlice`, write it back with one struct assignment. It made the function
**worse by 924 gas** (202,701 vs 201,777 for the first slice), because assigning the whole struct also rewrites the unchanged
third slot and copies memory. Reverted before the optimization above. Not kept.

## Not done (and why)

- Approving the pool once for `type(uint256).max` in the constructor instead of per slice would save an estimated 20k gas per slice (not measured),
  but it would expose every order's WBTC to the pool address if the pool ever had a bug. Kept the per-slice approval.
- `executeSlice` reads the oracle twice (`poolWithinBounds` and `getOraclePrice`). Merging them would mean either changing the
  frozen `IPriceGuard` or duplicating the deviation logic in OrderBook. Not worth it; the second read is warm.
