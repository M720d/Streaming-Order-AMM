# Video plan

The word-for-word script for each speaker is in `docs/video-script.md`; this file keeps the longer checklist.

Target length about 9 minutes (**[OPEN]** check the brief's limit and trim to fit). Live on Sepolia with at least one real
transaction shown on Etherscan. Every member speaks. Record the screen at 1080p with the browser zoomed to 125%.

## Before recording (day of)

- [ ] Contracts deployed and verified on Sepolia; addresses in `submission.json`.
- [ ] Front end running with `NEXT_PUBLIC_TARGET_NETWORK=sepolia` (local `yarn start` or Vercel).
- [ ] MetaMask on Sepolia with ETH for gas and at least 2 test WBTC (use the app's faucet).
- [ ] Keeper and arb bot `.env` filled with testnet-only keys; arb account holds WBTC and USDC.
- [ ] Chainlink feed fresh: check the app shows no stale banner. If the Sepolia feed is stale, the PriceGuard owner raises
      `maxStaleness` (at most 1 day) beforehand, and the video says so.
- [ ] **Backup:** one order created and sliced an hour earlier, so a finished order with real hashes can be shown even if the
      live slice is slow. Also a local-chain recording of the full flow in case Sepolia is down.
- [ ] Use a short interval (60 s) and 3 slices, so the order finishes on camera.

## Running order

| Time | Speaker | Shows | Says |
|---|---|---|---|
| 0:00–1:00 | **Dev** | Title slide, then the proposal's problem | The problem: big sells move the price; splitting only helps if the pool is refilled. Our question: how much does slicing save, and when does the saving disappear? |
| 1:00–2:30 | **Dev** | Architecture diagram (Section 3), `Pool.sol`, `OrderBook.sol` on Etherscan (verified tab) | Pool, PriceGuard, OrderBook; one price unit; equal slices; skip vs revert; no owner on Pool and OrderBook. |
| 2:30–5:30 | **Sid** | Web app on Sepolia | Pool card and Chainlink price. Create an order: 1 WBTC, 3 slices, 60 s, 3%. Point at the preview table (lump sum vs sliced). **Review order → confirmation dialog → sign approve and create in MetaMask (real transactions).** Click the hash, show it on Etherscan. |
| (cont.) | **Sid** | Terminal split screen: `yarn keeper` and `yarn arb` | Keeper log: "filled" with tx hash. Arb log: "traded" refilling the pool. Back in the app: progress bar moves, USDC to claim grows. Claim; show the USDC arrive. Mention the stale-feed banner and plain-language errors (show the screenshot from local testing if the feed is fresh). |
| 5:30–7:30 | **Aditya** | `analysis_slicing.ipynb`, `analysis_costs.ipynb` | Lump sum vs 5/10/20 slices with and without refill; the refill curve; the model equals the contracts exactly, and the Sepolia slice from a minute ago matches the model (reconciliation cell). Part C: about $5 of keeper gas per slice on L1; break-even about 4 orders of $250k a month with the proposed fees. |
| 7:30–8:30 | **Aditya** | Test run (`yarn test`: 92 passing), `docs/slither-full.md`, gas tables | Tests, revert test, mutation checks, Slither (no high finding), the two gas improvements. |
| 8:30–9:00 | **Dev** (or all) | Summary slide | What works, what does not (sandwich risk, fees not implemented, no audit), what we would do next. |

**[OPEN]** Swap the speaker assignments if the team prefers; the brief only requires that every member speaks. If Aditya is
not available to present the analysis, Dev takes 5:30–7:30 and Aditya presents the summary.

## What must be visible on screen (evidence)

- One real Sepolia transaction hash opened on Etherscan (the `createOrder`, and ideally an `executeSlice` from the keeper).
- The verified-source tab of at least one contract.
- The keeper's log line with its tx hash.
- The test command and its pass count.

After the edit, replace each `video TODO` in `submission.json` `features[].evidence` with the moment, e.g. `video 2:10`, and set `video` to the link. The brief says a feature counts only with evidence: a tx hash, a file in the repo, or a video moment.
