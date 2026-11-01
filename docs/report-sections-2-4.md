# Report draft: Sections 2 and 4

Streaming-Order AMM, FRE-GY 6931. Draft for team review. Items marked **[OPEN]** are not decided or not done yet.

---

## 2. Design decisions

The system is four contracts on top of two test tokens: a constant-product `Pool` (also the LP share token), a `PriceGuard` that reads Chainlink BTC/USD, and an `OrderBook` that turns a large sell into an ERC-721 and executes it in equal slices. This section records the choices that shaped the contracts, what we considered, and what we changed after finding a problem.

### 2.1 One price unit across the system (changed during design)

*First idea.* Let the pool report its raw reserve ratio (raw USDC per raw WBTC, scaled by 1e18) and have the guard compare it with the oracle.

*Problem.* With WBTC at 8 decimals and USDC at 6, that ratio is 100 times smaller than the oracle's USD-per-BTC price (a pool at 60,000 USDC/BTC reports 6e17 where the oracle says 6e22). A guard comparing the two would reject every pool price, or accept a pool that is 100 times wrong, depending on which side was scaled.

*Decision.* Every price in the system is **USDC per one whole WBTC, scaled by 1e18** (60,000 USDC/BTC is `60_000e18`). The pool converts internally and raw-unit ratios never leave it. All remaining conversions on the order side (Chainlink's 8-decimal answer into this unit, and a WBTC amount into the raw USDC it is worth) live in one library, `PriceMath`, with its own tests, so there is a single place to audit. Interface functions carry the unit in their names (`spotPriceE18`, `consultTwapE18`, `poolWithinBounds(poolPriceE18)`).

### 2.2 Slicing: fixed count, equal slices, no dust

The slice count is a fixed integer (1 to 200) chosen at creation; there is no continuous TWAMM-style streaming. Each slice sells `total / slices`, and the **last slice sells everything that is left**, so rounding remainders are never stranded in the contract (tested with 10 WBTC + 3 raw units in 5 slices). The alternative, keeping dust and letting the seller sweep it, adds a state and a way to lose funds for no benefit.

*Timing.* The first slice is due one interval after creation. After every attempt, successful or skipped, the next one is due one interval **from now**, not one interval after the previous due time. We considered scheduling on a fixed grid, but a keeper that is late would then fire several slices back to back, which removes the refill time that slicing depends on (Section 4).

### 2.3 Oracle guard: skip when the pool is off, revert when the oracle is bad

Two different failures get two different behaviours.

- **Pool price outside the allowed band around the oracle** (default 5%, hard cap 20%): the slice is **skipped** with a `SliceSkipped` event, no tokens move, and the order tries again an interval later. Nothing is wrong with the order; the market is just temporarily off, and a revert would only waste the keeper's gas and hide the reason.
- **Oracle unusable** (price zero or negative, older than the staleness limit or dated in the future, or `answeredInRound` behind `roundId`): the call **reverts**. We cannot tell whether the pool is off, so trading blind is the one thing the guard must never do. This is the proposal's "no trading when the feed is stale".

The guard compares the pool's **spot** price with the oracle. We considered using the pool's own TWAP for the pool side, which resists single-block manipulation, but a TWAP lags and needs history that a young pool does not have. Spot against a fresh oracle is a tighter check at the moment of the trade, and the residual risk is covered by the minimum-output rule below.

### 2.4 Slippage: an oracle-derived minimum, per order

Each slice must return at least the oracle's quote for that slice minus the order's `toleranceBps` (capped at 10%), otherwise the pool call reverts. The seller chooses the tolerance. We learned two things from testing:

1. **Tolerance must cover the fee plus the accumulated drift.** An early test used 3% on a 10 WBTC order in five slices; the last slice reverted because, without a refill, it returned 116,365 USDC against a minimum of 116,400 (a 3.03% shortfall from the oracle quote of 120,000 for its 2 WBTC). We raised the test tolerance to 5% and wrote down the rule in the contract's NatSpec: tolerance has to cover the 30 bps fee plus the expected impact, or the slice reverts.
2. **Skip and revert coexist.** A slice that is too bad for the seller's tolerance reverts; it does not skip. The seller can always cancel.

**Known limitation [OPEN: say whether the team accepts it].** A searcher can sandwich a slice. The attacker can push the pool price up to the guard band (5% by default) and the seller still receives at least the oracle quote minus tolerance, so the worst-case loss per slice is bounded by the tolerance and band the seller and owner chose, not unbounded. We did not add a private-mempool or commit-reveal scheme.

### 2.5 The order is an ERC-721 and its holder owns everything

The NFT holder owns the unsold WBTC and the USDC proceeds. `claim` pays the **current** `ownerOf`, so a transferred order pays its new holder (tested: slices run, the NFT moves, the new holder claims and the old one cannot cancel). Further choices:

- `claim` and `executeSlice` are callable by anyone, because the money can only go to the holder and a permissionless keeper is part of the design. `cancel` is **holder only**, not an approved operator, because it releases all funds and burns the NFT.
- `cancel` returns the unsold WBTC *and* any unclaimed USDC, deletes the order and burns the NFT. On a finished order it works as claim-and-burn.
- Minting uses `_safeMint` so contract wallets (multisigs, treasuries) can receive orders. That introduces a receiver callback, which is why every state-changing function is `nonReentrant` (tested by a receiver that tries to cancel during the mint, and a pool that calls back during the swap).

### 2.6 Trust and admin surface kept as small as possible

- `OrderBook` and `Pool` have **no owner and no admin function**. The pool and guard addresses are immutable.
- `PriceGuard` has one owner who can change exactly two numbers: the staleness limit (1 second to 1 day) and the deviation band (1 to 2,000 bps). Both have hard caps, emit events, and zero is rejected so a mistake cannot brick the guard. The owner cannot change the feed or touch funds. The same list is in the contract's NatSpec.
- The `OrderBook` approves the pool for exactly the slice amount before each swap. We considered a one-time unlimited approval, which saves an estimated 20k gas per slice (not measured), and rejected it: it would expose every order's WBTC to the pool address if the pool ever had a bug.

### 2.7 Gas: one change that worked, one that did not

`createOrder`, `executeSlice`, `claim` and `cancel` were measured before and after (`docs/gas-orders.md`). The order struct in the interface needs three storage slots only because the 16-bit tolerance spills over. Keeping the interface unchanged but storing the order in two slots (narrowing the slice size to 96 bits, about 1e13 times the WBTC supply, and rejecting anything larger) saves **22,054 gas on `createOrder`** (11.9%), 1,986 on each slice and 4,005 on `cancel`. Our first attempt, caching the order in memory inside `executeSlice`, made it **924 gas worse** and was reverted.

### 2.8 What the proposal listed that is not built [OPEN]

- A small **execution fee** per order and a protocol cut of the swap fee (proposal, "Revenue") are **not implemented**; the order side has no fee and the pool's 30 bps goes entirely to LPs. Section 5 should say so or the team should add it.
- The frontend and the keeper and arbitrage scripts are outside this section.
- The LP token is the `Pool` contract itself, not a separate ERC-20 as the proposal's table shows. **[OPEN: confirm with Dev that this is acceptable.]**

---

## 4. Financial analysis

Two notebooks answer one question: how much does slicing a large order save compared with selling it at once, and when does the saving disappear? `docs/analysis_pool.ipynb` (Part A) covers the pool; `docs/analysis_slicing.ipynb` (Part B) covers slicing. Both use the contract's integer arithmetic (30 bps fee taken from the input and left in the reserves, floor division), so each number below is what the contracts compute. Starting pool: 500 WBTC and 30,000,000 USDC (60,000 USDC per WBTC), as in the proposal.

### 4.1 Price impact by trade size (Part A)

| Trade (WBTC) | % of reserve | Impact, 30 bps fee | Impact, no fee |
|---:|---:|---:|---:|
| 0.05 | 0.01% | 0.31% | 0.01% |
| 2.5 | 0.5% | 0.79% | 0.50% |
| 12.5 | 2.5% | 2.72% | 2.44% |
| 50 | 10% | 9.34% | 9.09% |
| 100 | 20% | 16.88% | 16.67% |

Impact is driven by the trade as a share of the reserve. The proposal's figures (about 9% for 50 BTC, about 0.5% for a 2.5 BTC slice) are the no-fee column; with the 30 bps fee they are 9.3% and 0.8%. A 50 BTC sale costs 9.3% in a 500 BTC pool and 1.3% in a 5,000 BTC pool.

### 4.2 Lump sum versus 5, 10 and 20 slices (Part B)

Selling 50 WBTC (10% of the pool), cost measured against the frictionless value 50 x 60,000 USDC:

| Strategy | Proceeds (USDC) | Cost vs frictionless | Saving vs lump sum |
|---|---:|---:|---:|
| Lump sum | 2,719,832.68 | 934 bps | n/a |
| 5 slices, no refill | 2,719,547.22 | 935 bps | -1.05 bps |
| 10 slices, no refill | 2,719,510.48 | 935 bps | -1.18 bps |
| 20 slices, no refill | 2,719,492.02 | 935 bps | -1.25 bps |
| 5 slices, refill | 2,925,696.22 | 248 bps | +757 bps |
| 10 slices, refill | 2,953,598.46 | 155 bps | +859 bps |
| 20 slices, refill | 2,967,746.04 | 108 bps | +912 bps |

"Refill" means an arbitrageur restores the pool to its no-profit price at the external price between slices, at no cost to the seller.

**Without a refill, slicing does not help.** The pool depends only on how much WBTC is in the reserve, not on how it arrived, so the price ends in the same place. With zero fee the sliced and lump outputs differ by a few raw units of rounding (-1, -3 and -9 raw USDC for 5, 10 and 20 slices). With the 30 bps fee the slices are 1.05 to 1.25 bps *worse*, because each slice's fee stays in the reserve and worsens the next slice's price.

**With a refill, slicing saves a lot, with diminishing returns:** 757, 859 and 912 bps for 5, 10 and 20 slices (about 9% of proceeds at 20).

**The saving does not vanish gradually.** Letting `rho` be the share of the price gap that is closed between slices:

| Gap closed per slice | Saving, 5 slices | Saving, 20 slices |
|---:|---:|---:|
| 0.1% | 0.4 bps | 4.6 bps |
| 1% | 13 bps | 56 bps |
| 10% | 133 bps | 407 bps |
| 50% | 514 bps | 817 bps |
| 100% | 757 bps | 912 bps |

The curve is steep at first and then flattens: 10% of the refill already gives 45% of the 20-slice saving. The saving disappears only when almost nothing refills the pool between slices. The slice interval matters through this share, because a longer interval gives arbitrageurs time to act. [OPEN: the notebook uses the refill share as a stand-in for the interval; the Sepolia demo would show a real one.]

**Depth and fee (20 slices, full refill, saving vs lump sum):** 4,581 bps in a 100 BTC pool, 912 bps at 500 BTC, 161 bps at 2,500 BTC; at 500 BTC the fee changes it only from 945 bps (no fee) to 833 bps (100 bps fee). Slicing saves curve impact, not fees, so the fee barely matters, but pool depth decides how much there is to save.

### 4.3 Interaction with the oracle guard

Without a refill, the 5% guard first skips at **slice 7 of 20**, and slice 20 would need 1,720 bps of tolerance, above the 1,000 bps cap. So a 50 BTC order in 20 slices **cannot finish without a refill, whatever tolerance the seller sets**. This is the guard working as intended, and it is why the demo uses our own arbitrage script to refill the thin Sepolia pool.

### 4.4 Impermanent loss and LP profit (Part A)

Impermanent loss depends only on the price move `r`: 5.72% at 2x or 0.5x, 20.0% at 4x, 42.5% at 10x, matching the closed form `2*sqrt(r)/(1+r) - 1` exactly in the integer pool. The 30 bps fee opens a no-trade band of about +/-0.3% around the start price and otherwise trims the loss by only 0.04 to 0.06 points (5.72% becomes 5.68% at 2x). Over a simulated 30-day path in the base case, fees average 1.07% of TVL against a mean IL of 0.38%, so the LP ends on average 0.68% ahead of simply holding and beats holding on 91.6% of paths. The break-even organic volume that covers expected IL is about 0.4%, 2.4% and 8.1% of TVL per day at 30%, 60% and 100% volatility. This is Part A's result; see the notebook for assumptions (price path, volume model, arbitrage timing).

### 4.5 Reconciliation: model versus contracts

- **Local, done.** `scripts/exportSliceFixture.ts` runs the real `Pool`, `PriceGuard` and `OrderBook` on a local chain: a 20 WBTC order in 5 slices with and without refill, and the same 20 WBTC as one swap. The notebook rebuilds every slice amount, slice output, reserve after each slice, arbitrage trade and total from the starting reserves, and asserts equality: **56 comparisons, all exactly equal** (lump sum 1,150,517,367,388 raw USDC; 5 slices no refill 1,150,465,094,696; with refill 1,184,117,434,876).
- **Sepolia, not done [OPEN, required by the rubric].** No Sepolia deployment exists yet. The notebook's last section is written to read one `executeSlice` transaction, take the pool reserves from the block before it, compute the slice with the model and assert it equals the event's `amountOut`; it currently prints PENDING. After deployment: create an order, wait one interval, call `executeSlice`, then set `SEPOLIA_RPC_URL`, `SLICE_TX_HASH` and `ORDER_BOOK_ADDRESS` and re-run the cell. The tx hash and the matching numbers then go here.

### 4.6 What the model leaves out

Gas and keeper costs (measured separately in `docs/gas-orders.md`: about 160k to 200k gas per slice), the cost of the arbitrage that provides the refill and the competition for it, MEV on the slices (Section 2.4), a changing external price during the order (held constant here), correlation between volume and volatility, and a protocol fee. The break-even volume for protocol revenue promised in the proposal is **not estimated** because the fee is not implemented. All of these would make real outcomes worse than the numbers above.
