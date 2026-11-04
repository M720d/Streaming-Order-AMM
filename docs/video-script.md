# Demo video script (about 9 minutes, three speakers)

**How to read this script.** Every beat has two lines, always in this order:

- **Page reference →** what to put on screen first: the report page and section (`docs/report.pdf`, 29 pages), or the app, a terminal or Etherscan.
- **Speech:** what to say while it is on screen.

Show the page *before* you start speaking. Numbers come from the report; do not add new ones. **[T]** marks a moment to note the video time
(it goes into `submission.json` later). "bps" means basis points: one hundredth of a percent (100 bps = 1%).

The brief requires: the app working **on Sepolia**, **at least one live transaction**, and **every member speaks**.

| Part | Speaker | Time | Report pages used |
|---|---|---|---|
| 1. The problem | Aditya | 0:00 to 1:00 | 1, 2 |
| 2. The design | Dev | 1:00 to 2:45 | 2, 3, 4, 6, 7, 25 |
| 3. Live demo | Sid | 2:45 to 6:15 | app, terminals, Etherscan (backup: 23, 24) |
| 4. Results and business | Aditya | 6:15 to 7:30 | 8, 9, 14, 20, 21 |
| 5. Testing and gas | Dev | 7:30 to 8:30 | 16, 17, 18 |
| 6. Wrap-up | Sid | 8:30 to 9:00 | 21, 22 |

## Before you press record (Sid, 2 minutes)

1. In a terminal at the repo root run `yarn demo-check` (or `node .yarn/releases/yarn-4.13.0.cjs demo-check`). Every line should say OK.
2. Two terminals visible side by side, both running: `yarn keeper` (left) and `yarn arb` (right).
3. Browser at `http://localhost:3000`, MetaMask on **Sepolia**, account `0xcc9D...2c26` selected.
4. Open `docs/report.pdf`, the OrderBook on Etherscan (Contract tab), and one spare terminal for `yarn test`.
5. Start the screen recording, then take Cmd+Shift+5 screenshots of the Review dialog and the order card during Part 3 (names at the end).

---

## Part 1 | Aditya | the problem (0:00 to 1:00)

**Page reference →** Report **page 1**: title and contents.

**Speech:** "Hi, we are Aditya, Dev and Sid. This is our final project for Blockchain and Cryptocurrency: a streaming-order AMM, running on the Ethereum Sepolia test network."

**Page reference →** Report **page 1**, **Section 1, Objective** (first paragraph).

**Speech:** "Here is the problem. When you sell a large amount of a token into a trading pool, the price drops with every coin you sell. In our test pool, selling 20 WBTC in one go gets you about four percent less than the starting price. Most of that loss is the price moving, not the fee."

**Page reference →** Report **page 1**, **Section 1**, the list of what we built.

**Speech:** "The usual fix is to split the sale into smaller slices. But slicing only helps if something pushes the price back up between the slices. If nothing does, you end up in the same place as one big sale. So we built a system that sells an order in slices: a pool, an order contract, a price check against Chainlink, a keeper script that runs the slices, an arbitrage bot that pushes the price back, and a web app."

**Page reference →** Report **page 2**, **Section 1.1**, "Why we chose this".

**Speech:** "Our question is simple: how much does slicing save compared with selling everything at once, and when does that saving disappear? Dev will explain how it is built."

---

## Part 2 | Dev | the design (1:00 to 2:45)

**Page reference →** Report **page 4**, **Section 3.1**, the contract diagram.

**Speech:** "There are three main contracts. The Pool holds the two tokens and sets the price, using the constant-product rule with a 0.3 percent fee. The OrderBook holds each order. The PriceGuard checks the Chainlink BTC/USD price before every slice."

**Page reference →** Report **page 6**, **Section 3.3**, the OrderBook table.

**Speech:** "Each order is an NFT, an ERC-721. Whoever holds the NFT owns the unsold coins and the money from the sales. They can claim the money or cancel the order at any time. We mint two tokens of our own: this order NFT, and the Pool's liquidity token, called SALP."

**Page reference →** Report **page 2**, **Section 2.1**, "One price unit across the system".

**Speech:** "Three design choices matter. First, prices. Our two tokens use 8 and 6 decimals, and Chainlink uses 8. An early version mixed these up and was off by a factor of 100. So now every price uses one unit, and all conversions happen in one small library."

**Page reference →** Report **page 3**, **Section 2.3**, "skip when the pool is off, revert when the oracle is bad".

**Speech:** "Second, the price guard. If the pool price has drifted too far from Chainlink, the slice is skipped and tried again later. If Chainlink itself is broken or out of date, the transaction is stopped, because we never want to trade blind."

**Page reference →** Report **page 3**, **Section 2.6**, "Trust and admin surface".

**Speech:** "Third, almost no admin. The Pool and the OrderBook have no owner at all. The PriceGuard's owner can change only two settings, and both have hard limits."

**Page reference →** Report **page 7**, **Section 3.5**, the address table. Then open the OrderBook on Etherscan, Contract tab (backup: report **page 25**, Figure 13). **[T]** verified source

**Speech:** "Every contract is deployed on Sepolia and verified on Etherscan. Here is the OrderBook: the green tick says the source code matches exactly what is on chain, so anyone can read it."

---

## Part 3 | Sid | live demo on Sepolia (2:45 to 6:15)

**Page reference →** The **app** at localhost:3000, with the two terminals beside it.

**Speech:** "This is our app, connected to our contracts on Sepolia. On the left is the pool: about 499 WBTC and 38.9 million USDC. The pool price is within a fraction of a percent of the Chainlink price. In the terminals, the keeper is on the left and the arbitrage bot is on the right."

**Page reference →** The **app**, "Create a streaming sell order" form. Type 2 WBTC, 3 slices, 60 seconds, 3 percent.

**Speech:** "I will sell 2 WBTC in three slices, one minute apart. This table is a preview. It compares selling everything now, slicing with no help, and slicing when the pool gets refilled."

**Page reference →** The **app**, click **Review order** and show the dialog. **[T]** confirmation step. *(Screenshot this dialog.)*

**Speech:** "Before I sign anything, the app shows exactly what I am agreeing to: how much it will hold, the number of slices, the time between them, and my price limit."

**Page reference →** **MetaMask**, approve and then create. Then click the transaction link and show it on **Etherscan**. **[T]** live createOrder

**Speech:** "That is a real transaction on Sepolia. The order contract took my 2 WBTC and gave me the order NFT."

**Page reference →** The **keeper terminal** (left), about a minute later. **[T]** keeper fills a slice

**Speech:** "About a minute later, the keeper sends the first slice. This line says 'filled' and shows the transaction hash. The keeper tests every call before sending it, and never sends the same slice twice."

**Page reference →** The **arb bot terminal** (right), then the **progress bar** in the app. **[T]** arb refill. *(Screenshot the order card.)*

**Speech:** "After that sale the pool price dropped below Chainlink. The arbitrage bot saw the gap, checked it could make a profit after the fee, and traded the price back up. That refill is what makes slicing worth it. In the app, the progress bar moves and the USDC I can claim goes up."

**Page reference →** The **app**, after slice 3: click **Claim**, confirm in MetaMask, show the USDC balance. **[T]** claim

**Speech:** "All three slices are done. I claim my money, and the USDC arrives in my wallet. If Chainlink went stale, a warning banner would appear here, and any error is explained in plain words."

**Backup if the live run is slow →** Report **page 23**, **Appendix A.1** (earlier transaction links) and **page 24**, **Appendix A.2** (keeper log). Say: "Here is the same flow from an earlier run, with every transaction on Etherscan."

---

## Part 4 | Aditya | results and business (6:15 to 7:30)

**Page reference →** Report **page 8**, **Section 4.2**, the table "Lump sum versus 5, 10 and 20 slices".

**Speech:** "First, the model. Selling 50 WBTC into a pool of 500 WBTC all at once costs about 934 bps, that is, 9.3 percent. Split into 20 slices with the pool refilled each time, the cost falls to about 108 bps, around 1 percent."

**Page reference →** Report **page 9**, **Figure 3**, "slicing pays only with a refill".

**Speech:** "This chart is our key point. The grey bars are slicing with no refill: no saving at all. The blue bars are slicing with a refill: a big saving. Slicing by itself does nothing. The refill does the work."

**Page reference →** Report **page 14**, **Section 4.5**, the slice table and **Figure 10**.

**Speech:** "Then we tested it for real on Sepolia. A 5 WBTC order in three slices returned 387,501 USDC. Selling the same coins at once would have returned 384,946. That is 66 bps better. We also checked our maths against the blockchain: for all three slices, our model gives exactly the amount the contract paid."

**Page reference →** Report **page 20**, **Section 6.4**, the break-even table.

**Speech:** "As a business: right now the protocol earns nothing, because we did not build the fees. That is future work. With a small fee on each order and a share of the swap fee, about four orders of 250,000 dollars a month would cover our running costs of about 1,800 dollars."

**Page reference →** Report **pages 20 to 21**, **Section 6.5**, the risks table.

**Speech:** "The main risks are honest ones: we have no external audit, a large trader could still move the price before a slice within our limits, and bigger players like CoW Swap already offer similar tools."

---

## Part 5 | Dev | testing, security and gas (7:30 to 8:30)

**Page reference →** A **terminal** running `yarn test`, then report **page 16**, **Section 5.1**, the tests table. **[T]** tests

**Speech:** "One command, yarn test, runs all 92 tests. They include tests that expect an error, attacks that try to re-enter the contract, a random stress test on the pool, and full end-to-end tests with our real keeper and bot. We also broke the code on purpose to make sure the tests catch it, and they did."

**Page reference →** Report **page 17**, **Section 5.2**, the Slither table.

**Speech:** "We scanned the code with Slither, a security tool. It found no high-severity problems, and every finding is fixed or explained."

**Page reference →** Report **page 18**, **Section 5.3**, the gas tables.

**Speech:** "We also cut gas costs. Storing the pool's balances in one slot made swaps about 8 percent cheaper. Storing each order in two slots instead of three saved about 22,000 gas when creating an order. One surprise: on Sepolia, actions that store new data cost two to four times more gas than in our local tests."

---

## Part 6 | Sid | wrap-up (8:30 to 9:00)

**Page reference →** Report **page 21**, **Section 7, Summary**, "What we found".

**Speech:** "To sum up: the whole system works on Sepolia. An order was created in the app, filled by the keeper, refilled by the bot, and claimed by its owner. Slicing saved 66 bps, and only because the pool was refilled. That answers our question."

**Page reference →** Report **page 22**, **Section 7**, "What we learned".

**Speech:** "What we did not do: an external audit, full protection against front-running, and the fee model. What we learned: get decimals right first, the saving comes from the refill and not from slicing itself, and a local test is not the real network. Thanks for watching."

---

## If something goes wrong on camera

- **MetaMask says the transaction count is wrong:** MetaMask, Settings, Advanced, "Clear activity tab data", then try again. Mention that the app explained the error in plain words.
- **A slice does not fill within about two minutes:** keep talking. The keeper checks every 15 seconds. If it says `skipped`, the bot fixes the price and the next try fills.
- **A Chainlink warning banner appears:** say that this is the stale-price warning working. Our guard allows two hours, and the feed updates every hour.
- **The pool numbers show dashes for a few seconds:** they are loading from the network. Wait five seconds.
- **Anything else fails:** use the backup in Part 3 (report pages 23 and 24).

## After recording

1. Save the two screenshots into `docs/screenshots/` as `app_02_confirmation_dialog.png` (the Review dialog) and `app_03_order_progress.png` (the order card).
2. Send the video link, the team name or number, and the times you noted at each **[T]**. They fill the remaining TODOs in `submission.json`, and the report and zip get rebuilt.
