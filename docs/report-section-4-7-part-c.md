# Report draft: Section 4.7 (Part C: costs and break-even)

Streaming-Order AMM, FRE-GY 6931. Draft for team review. Source: `docs/analysis_costs.ipynb` (executed, its checks pass).
Gas: `docs/data/gas_costs_local.json` from `packages/hardhat/scripts/measureCostGas.ts`, plus the liquidity rows of
`docs/gas-pool.md`. Items marked **[OPEN]** need a team decision.

---

### 4.7 Cost per user action and break-even (Part C)

**Assumptions, stated once.** Gas price 10 gwei on Ethereum L1, ETH at $3,000, BTC at $60,000. These are round assumptions,
not observations; the notebook shows 1 to 50 gwei and $2,000 to $5,000. An "L2-like" column at 0.05 gwei shows how much of
the cost is the chain rather than the design (rollup data fees are ignored). Gas was measured on a local Hardhat chain with
the deployed compiler settings; **the Sepolia deployment contradicts the assumption that other networks cost the same.** Measured on Sepolia
(2026-11-01, `docs/data/evidence_sepolia.json`): contract creation used about 7x the gas of our local figures (Pool 12.0M, OrderBook
15.7M, PriceGuard 3.9M, each mock token 4.2M; the table below says 4.63M for the three order-side contracts), a first-time
`approve` estimates at 129,365 gas against 46,353 locally, and the seed `addLiquidity` used 925,874. The cause is not verified (new
storage appears to be priced higher on that network). **[OPEN: re-measure the user actions on Sepolia after the demo and either
replace the table or state both columns.]** The USD figures below are therefore lower bounds for Sepolia-like pricing.

Measured on Sepolia (rehearsal order, 1 WBTC in 3 slices, 2026-11-01), against the local figures used in the table below:

| Action | Local gas | Sepolia gas | Ratio |
|---|---:|---:|---:|
| Approve WBTC (exact amount) | 46,353 | 128,273 | 2.8x |
| `createOrder` | 158,734 | 608,006 | 3.8x |
| `executeSlice` (first slice) | 190,399 | 509,033 | 2.7x |
| `swapExactIn` (arbitrage refill) | 117,775 | 234,251 | 2.0x |
| `claim` | 56,705 | 60,164 | 1.1x |

Actions that create new storage cost far more there; `claim`, which only updates existing storage, barely changes. One order each, so treat the ratios as indicative.

**What each action costs.**

| Who pays | Action | Gas | USD at 10 gwei | USD at 50 gwei | USD, L2-like |
|---|---|---:|---:|---:|---:|
| Seller | Approve WBTC (exact amount) | 46,353 | 1.39 | 6.95 | 0.007 |
| Seller | `createOrder` | 158,734 | 4.76 | 23.81 | 0.024 |
| Seller | `claim` | 56,705 | 1.70 | 8.51 | 0.009 |
| Seller | `cancel` (unfilled) | 56,148 | 1.68 | 8.42 | 0.008 |
| Keeper | `executeSlice` (mean of 4) | 163,545 | 4.91 | 24.53 | 0.025 |
| Keeper | `executeSlice` (first slice, worst case) | 190,399 | 5.71 | 28.56 | 0.029 |
| Trader / arbitrageur | `swapExactIn` | 117,775 | 3.53 | 17.67 | 0.018 |
| LP | `addLiquidity` (existing LP) | 123,548 | 3.71 | 18.53 | 0.019 |
| LP | `removeLiquidity` | 111,431 | 3.34 | 16.71 | 0.017 |

A full 10-slice order (approve, create, 10 slices, claim) is 1,897,242 gas: **$56.92** at 10 gwei and $3,000, from $3.79
(1 gwei, $2,000) to $474 (50 gwei, $5,000). The seller pays about $7.85 of that; the keeper pays the other $49.06.
Deploying Pool, PriceGuard and OrderBook is 4.63 M gas, $139 once. Our numbers agree with the before/after tables in
`gas-orders.md` and `gas-pool.md` to within a few percent; the differences come from account state, not the code.

**Does slicing still pay after the keeper's gas?** In the 500 WBTC / 30 M USDC pool, assuming arbitrage fully refills the
pool between slices (the best case; Section 4.2 shows how partial refill shrinks it):

| Order | Slices | Saving vs lump sum, before gas | Keeper gas (10 gwei) | Net saving | Net, bps of order |
|---|---:|---:|---:|---:|---:|
| 1 WBTC ($60k) | 10 | $107 | $49 | $58 | 9.7 |
| 1 WBTC ($60k) | 20 | $113 | $98 | $15 | 2.5 |
| 5 WBTC ($300k) | 10 | $2,655 | $49 | $2,606 | 86.9 |
| 20 WBTC ($1.2M) | 10 | $41,130 | $49 | $41,081 | 342.3 |
| 50 WBTC ($3M) | 20 | $256,331 | $98 | $256,233 | 854.1 |

Price impact grows with the square of the order's share of the pool, while the keeper's cost grows only with the number of
slices. So gas only decides the question for small orders: on L1, slicing into 10 beats a lump sum from about **0.7 WBTC at
10 gwei** (1.6 WBTC at 50 gwei, 0.1 WBTC on an L2-like chain). Below that, more slices make it worse, not better. A cross-check
against the real contracts: the end-to-end test's 20 WBTC, 5-slice order with our real arbitrage bot earned 292 bps over the
lump sum, just under the model's full-refill ceiling of 303 bps for the same order.

**Break-even for going to market.** The proposal's revenue model has two parts, and **neither is built** (the contracts
charge no execution fee and pay the whole 30 bps swap fee to LPs):

- a protocol share of the swap fee, assumed **5 of the 30 bps** (LPs keep 25), earned on the streaming volume and on the
  arbitrage volume that refills it (about equal to it: one refill per slice in our test);
- an **execution fee of 10 bps** of each order's notional, which also pays the keeper's gas.

Fixed costs per month, assumed: RPC $50, keeper and bot server $20, front-end hosting $20, monitoring $25, and an external
audit of $40,000 amortised over 24 months ($1,667): **$1,782 in total**, no salaries. A second scenario adds one part-time
engineer at $5,000 ($6,782).

| Average order | Slices | Chain | Orders per month to break even | Streaming volume per month |
|---|---:|---|---:|---:|
| $50,000 | 10 | L1, 10 gwei | 35 | $1.75 M |
| $50,000 | 20 | L1, 10 gwei | 952 | $47.6 M |
| $50,000 | 10 | L1, 50 gwei | never (gas exceeds the fee) | never |
| **$250,000** | **10** | **L1, 10 gwei** | **4** | **$1.0 M** |
| $250,000 | 20 | L1, 50 gwei | 191 | $47.8 M |
| $250,000 | 10 | L2-like | 4 | $1.0 M |
| $1,000,000 | 10 | L1, 10 gwei | 1 | $1.0 M |

With one part-time engineer the base case ($250k, 10 slices, 10 gwei) needs **16 orders and $4.0 M a month**.

Three conclusions. First, **as built the protocol never breaks even**: it earns nothing, and someone (us, or a volunteer keeper)
pays about $5 of gas per slice on L1. The execution fee is not optional for a real launch. Second, the business only works for
**large orders**, which is also where slicing saves the most: a $250k order saves the seller tens to hundreds of bps and costs
the seller only the 10 bps execution fee on top of the 30 bps swap fee it pays anyway. The protocol earns 20 bps of the order
($500): the execution fee plus its 5 bps cut of the swap fee on the order and on the arbitrage trades that refill it, both
taken out of the LPs' 30 bps, not added to it. Small orders on a busy L1 lose money for the
operator because 10 to 20 keeper transactions cost more than the fee; a minimum order size, or a per-slice fee floor, fixes that.
Third, the levers are roughly equal: dropping the protocol share to 0 or the execution fee to 0 each takes the base case from
4 to 9 orders a month, so either one alone could carry a small operation.

**What this leaves out.** Gas and ETH prices and the order flow are assumptions, not data; break-even says how many orders are
needed, not how many we would get. Full refill is the best case. Salaries, legal and marketing are excluded from the base case.
Charging either fee needs contract changes (a fee switch in `Pool`, a fee in `OrderBook`) that were not made; **Decision (Sid, 2026-11-01; Dev to
confirm):** the report presents both fees as future work (Sections 2.8, 6.4 and 7).
