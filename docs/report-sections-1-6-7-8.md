# Report draft: Sections 1, 6, 7 and 8

Streaming-Order AMM, FRE-GY 6931. Draft for team review. Items marked **[OPEN]** need a team decision; **[PENDING]** needs the
Sepolia deployment. Numbers come from the test suite, `docs/analysis_pool.ipynb`, `docs/analysis_slicing.ipynb` and
`docs/analysis_costs.ipynb`; each is cited where it is used.

---

## 1. Objective

Selling a large amount of a token into a constant-product pool is expensive: the price moves against the seller with every unit
sold, so the last coins sell far below the first. Selling 20 WBTC into a pool of 500 WBTC and 30 M USDC in one swap returns
1,150,517 USDC, 4.1% below what the same coins are worth at the pool's starting price, and most of that is price impact, not the
0.3% fee. The usual answer is to split the order. Splitting only helps, though, if someone puts the price back between the
pieces; otherwise each piece sells into the price the previous one left behind, and the total is the same as one big trade.

We built a small exchange that does the splitting for the seller and measured when it actually helps:

- a constant-product **Pool** for mock WBTC and USDC with a 30 bps fee, LP shares and a time-weighted average price;
- an **OrderBook** where a seller deposits the whole order once and receives an ERC-721 that owns it; the order is sold in a
  fixed number of equal slices, one per interval, by anyone who calls `executeSlice` (our keeper script does);
- a **PriceGuard** that reads Chainlink BTC/USD, refuses to trade on a stale, zero or carried-over price, and skips a slice when
  the pool has drifted too far from Chainlink;
- off-chain, a **keeper**, an **arbitrage bot** that refills the pool between slices, and a **web app** to create, watch, claim
  and cancel orders.

The research question is the one in the proposal: **how much does slicing save compared with a lump sum, and when does the
saving disappear?** Section 4 answers it with notebooks whose integer model reproduces the contracts exactly, and Part C adds
what the saving is worth after gas and whether a business could run on it. Everything runs on Ethereum's Sepolia testnet with
mock tokens **[PENDING: deployment]**; no real money is involved.

---

## 6. Going to market

### 6.1 Users

The people who lose the most to price impact are those who must sell a lot at once and cannot wait for a perfect market:
**DAO and company treasuries** paying expenses in stablecoins, **funds** rebalancing or meeting redemptions, **miners and
long-term holders** converting BTC exposure, and **token teams** selling grants or unlocks. Today they choose between eating
slippage on a public pool, splitting the trade by hand (which needs someone watching for hours), or an OTC desk (a quoted spread,
counterparty trust, and minimum sizes). Our order runs unattended, on public rails, and the seller can see every slice.

Part C (Section 4.7) shows who we are actually for: on Ethereum L1 slicing pays after gas from about **0.7 WBTC** (~$40k) at
10 gwei, and the saving becomes large only when the order is a meaningful share of the pool (342 bps for a 20 WBTC order in a
500 WBTC pool with 10 slices and full refill). Retail-size trades should keep using a normal swap.

### 6.2 Trust

A treasury will not hand a large order to an unknown contract on our word. What we can show instead:

- **Non-custodial ownership.** The order is an NFT held by the seller. Only the holder can cancel, and cancelling returns all
  unsold WBTC and unclaimed USDC in the same transaction (tested, including after transferring the NFT).
- **Almost no admin.** `Pool` and `OrderBook` have **no owner at all**: no pause, no upgrade, no fee switch, no way to move user
  funds. `PriceGuard` has one owner who can change exactly two numbers, each with a hard cap and an event: the staleness limit
  (at most 1 day) and the allowed deviation (at most 20%). It cannot change the feed or touch funds. This list is in the source
  comments and in Section 2.6.
- **No trading blind.** If Chainlink is stale, zero or negative, or the round is carried over, slices revert; if the pool is
  far from Chainlink, they are skipped. Every slice must return at least the Chainlink-implied amount minus the seller's own
  tolerance. The web app shows a warning as soon as the feed is stale or close to it.
- **Evidence.** Verified source on Etherscan **[PENDING]**, Slither results with every finding fixed or explained
  (`docs/slither-full.md`: no high-severity finding), 92 automated tests including expected-revert, reentrancy, a seeded
  invariant test on the pool, and mutation checks; gas reports; and notebooks that reproduce the contracts to the last unit.
- **What we cannot offer yet.** No external audit, no track record, a test deployment only. A real launch needs an audit first
  (budgeted in Part C) and a capped period with small limits.

### 6.3 The first hundred users

1. **Ten design partners first.** DAO treasuries sell in public: their governance forums list planned sales. We would offer the
   first ten a free, hand-held order (we run the keeper and the arbitrage for them) in exchange for a public write-up. Ten
   real orders are enough to publish a first comparison.
2. **A public fill dashboard.** For every order, show what it received against a lump-sum swap at the moment it was created,
   computed with the same model the notebooks use. Proof on chain is our main marketing; the web app's preview table is the
   start of it.
3. **Liquidity first.** Slicing only works if the pool is deep and refilled, so the first money goes to LPs and arbitrageurs,
   not sellers: early-LP rewards (the proposal suggested paying them in our share token; that requires a reward contract we
   have not built **[OPEN]**) and an open-source arbitrage bot, which we already have.
4. **Distribution through existing tools.** A Safe (multisig) app, since treasuries sign through Safe, and integration with
   aggregators so a large swap can be routed into a streaming order automatically.
5. **Keepers as a community.** `executeSlice` is permissionless. With the execution fee (6.4) part of it can be paid to whoever
   runs the slice, so other people run keepers and the system does not depend on us.

### 6.4 Business model with numbers

Revenue would come from a **protocol share of the swap fee** (assumed 5 of the 30 bps; LPs keep 25) and an **execution fee**
(assumed 10 bps of each order's notional, which also pays the keeper's gas). **Neither is implemented in the contracts: both are future work**, and as built the protocol earns
nothing. Each needs a contract change (Section 4.7). With fixed costs of about $1,800 a month (infrastructure and an audit
amortised over two years, no salaries), at 10 gwei and $3,000 ETH, Part C finds:

| Average order | Break-even orders / month | Monthly streaming volume |
|---|---:|---:|
| $50,000, 10 slices | 35 | $1.75 M |
| $250,000, 10 slices | 4 | $1.0 M |
| $1,000,000, 10 slices | 1 | $1.0 M |

With one part-time engineer ($6,800 a month) the $250k case needs 16 orders and $4 M a month. For comparison, a seller of a
$250k order in our test pool saves far more than the 10 bps execution fee (Section 4.7). Two rules follow: a **minimum order
size** (or a per-slice fee floor), because on a busy L1 a small order's 10 to 20 keeper transactions cost more than its fee;
and a **cheap chain** for smaller orders, where keeper gas is a few cents.

### 6.5 Risks

| Risk | What could happen | What we do or would do |
|---|---|---|
| Smart-contract bug | Funds locked or lost. The slice logic is the likeliest place. | Fixed slice count, flat fee, no admin, reentrancy guards, 92 tests, Slither; an external audit before any real money. |
| Oracle failure | Chainlink stops updating or reports a wrong price. | Stale or invalid prices stop trading; deviation band; per-order tolerance. A wrong-but-fresh price is not detected. |
| No refill | Nobody arbitrages, so slicing saves nothing and the guard skips slices. | Our own open-source bot; liquidity incentives; the app shows the "no refill" estimate next to the best case. |
| MEV / sandwich | A searcher moves the pool before a slice. | Loss per slice is bounded by the deviation band and the tolerance. Not prevented (no private mempool). **[OPEN]** (Section 2.4) |
| Keeper downtime | Slices run late. | Permissionless execution; the seller can run a slice from the app; the next slice is always one interval after the last attempt, so a late keeper never causes a burst. |
| Thin liquidity | Large orders still move the price a lot. | Preview before signing; minimum interval; deeper pools come first. |
| Competition | CoW Swap's TWAP orders, Uniswap X, TWAMM-style hooks and OTC desks already serve large sellers. | Our edge is the simplest possible trust model (no owner, NFT ownership, oracle guard) and published fill evidence. Honestly, it is a small edge. |
| Regulation | Running a front end and collecting fees may bring obligations. | Legal review before charging any fee. Not assessed here. |

---

## 7. Summary

We built and tested a streaming-order AMM: a 30 bps constant-product pool with LP shares and a TWAP, a Chainlink price guard,
and an ERC-721 order book that sells a large order in equal slices, plus a keeper, an arbitrage bot and a web app.

**What we found.** Slicing saves money only when the pool is refilled between slices. Without refill, 20 WBTC sold in 5 slices
returns 1,150,465 USDC against 1,150,517 for one swap, so slightly less, because each slice pays the fee on a worse price. With our
arbitrage bot refilling the pool, the same order returned 1,184,117 USDC, **292 bps more**, on the real contracts. The notebook's
integer model reproduces the contracts exactly (56 of 56 comparisons locally). **On Sepolia** the same formula, applied to the pool
reserves read from the block before each slice, gives the on-chain output to the last unit for all three slices of a 5 WBTC order
(slice 1 `0x5e2d5767...`). That order, created from the web app and filled by our keeper with our arbitrage bot refilling the pool,
returned 387,501.20 USDC, against 384,946.34 for the same 5 WBTC as one swap from the same pool state: **+2,554.87 USDC, +66 bps**;
replayed without the refill, the three slices would have returned 384,942.53, 3.80 USDC less than the lump sum. After gas,
slicing pays on L1 from about 0.7 WBTC at 10 gwei, and the saving grows quickly with order size. Without refill the price guard
also stops a large order from finishing: a 50 WBTC order in 20 slices is first skipped at slice 7.

**What it would take as a business.** As built the protocol earns nothing. With a 5 bps share of swap fees and a 10 bps execution
fee it covers about $1,800 a month of running costs with four $250k orders a month on L1. That is plausible, but only for large
orders, and it requires contract changes we did not make.

**What is solid and what is not.** Solid: 92 passing tests, Slither with no high-severity finding, two measured gas improvements
(pool swaps -8.1%, `createOrder` -22,054 gas), and exact model-to-contract agreement. Not yet: the Sepolia deployment, Etherscan
verification and live evidence **[PENDING]**; an external audit; protection against sandwiching; the proposed fees and LP
incentives.

---

## 8. AI use

We used one AI assistant, Claude Code (Anthropic), throughout. Every use is logged in `docs/ai-use.md` with what it produced and
how the result was checked. In summary:

| Area | What the AI did | How we checked it | Not checked by the tools |
|---|---|---|---|
| Pool and mock tokens (Dev) | Wrote `Pool.sol`, the mocks, pool tests and gas tests, `analysis_pool.ipynb`, the pool Slither and gas reports; made the storage-packing change | Full suite before and after the change; expected values computed independently in Python; three deliberate bugs (mutants) each caught by the tests; Slither; notebook asserts | Human review of contracts and report text |
| Order side (Dev) | Wrote `PriceMath`, `PriceGuard`, `OrderBook`, their tests, deploy scripts, `analysis_slicing.ipynb`, report sections 2 and 4 | Full suite; four mutants caught; notebook model equals the contracts in 56 comparisons; deploy run locally | Live deploy and verification; human review |
| Keeper, arbitrage bot, end-to-end tests (Sid) | Wrote the two scripts, `test/EndToEnd.ts`, `docs/slither-full.md` | 17 new tests; both scripts run as real processes against a local node, which found two bugs the tests could not (a nonce cache and unreadable RPC errors) | Live network; human read of the scripts |
| Web app (Sid) | Wrote the page, components, data hooks and plain-language error messages | Type-check, lint, production build; the price-impact preview compared with the contract's output; every action driven in a real browser against the real contracts, which found three bugs (clock, error text, wallet) | MetaMask and Sepolia; a usability review by a person |
| Analysis Part C and these report sections (Sid) | Wrote `measureCostGas.ts`, `analysis_costs.ipynb`, Sections 1, 4.7, 6, 7, 8 | Notebook executes with its own arithmetic checks; cross-checked against the gas reports and the end-to-end result | Every assumption (gas price, ETH price, fees, order flow) is ours to defend |

**How we worked.** The AI was asked to state, for each task, what it tested, what it did not and what it assumed; those notes
are in `docs/ai-use.md` and `docs/PROJECT_STATE.md`. We kept it from changing the frozen interfaces, required tests for every
change and checked numbers in two independent ways (Python model against contracts, notebooks against tests).

**Limits.** Tests written by the same assistant that wrote the code can share its blind spots; the mutation checks and the
independent Python models reduce, but do not remove, that risk. **[OPEN: each member to confirm here which files they read in
full themselves before submission.]**
