# Sepolia runbook (deploy, demo, evidence)

Follow top to bottom. Every command runs from the repo root unless it says otherwise. **Testnet only: never put real money in
any wallet used here, and never paste a key into chat, a commit or a screenshot.** `.env` files are gitignored.

**Sepolia rehearsal done 2026-11-01** (steps 4 to 6 with the arb wallet as seller; hashes in `docs/data/evidence_sepolia.json`). Remaining: the recorded demo order from a person's wallet in the front end, and the optional guard-skip and cancel evidence.

Status of this runbook: the local-chain version of steps 4 to 8 was rehearsed on 2026-11-01 (keeper `filled` x3 with tx hashes, two
arbitrage refills, claim, evidence script). **No transaction has been sent on Sepolia yet.** Read-only checks done 2026-11-01 with the team's Alchemy key: chain id, block number, the Chainlink feed, and the log-range limit (below). Etherscan key supplied and checked (Sepolia API answers on the free plan). Keeper and arb wallets generated into `.env` (addresses only in chat). Still missing: the deployer wallet (`yarn generate`, needs a password) and Sepolia ETH in all three wallets.

## 1. Get the credentials (all free)

| Item | Where | Goes into |
|---|---|---|
| Alchemy API key (**have it; works on Sepolia; free tier allows `eth_getLogs` over only 10 blocks**) | alchemy.com: create an app on "Ethereum Sepolia" | `packages/hardhat/.env` `ALCHEMY_API_KEY`; `packages/nextjs/.env.local` `NEXT_PUBLIC_ALCHEMY_API_KEY`; bots' `RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<key>` |
| Etherscan API key | etherscan.io: sign up, "API Keys" | `packages/hardhat/.env` `ETHERSCAN_API_KEY` |
| Deployer account | `yarn generate` (asks for a password, stores an encrypted key in `.env`) | `DEPLOYER_PRIVATE_KEY_ENCRYPTED` (written for you) |
| Keeper and arb accounts | two fresh throwaway wallets, see below | `KEEPER_PRIVATE_KEY`, `ARB_PRIVATE_KEY` |
| Sepolia ETH | any Sepolia faucet (Alchemy, Google Cloud Web3, pk910 PoW) | send to deployer, keeper, arb and your MetaMask seller |

Make a throwaway wallet (prints address and key in your own terminal):
```bash
cd packages/hardhat && node -e "const {Wallet}=require('ethers');const w=Wallet.createRandom();console.log(w.address,w.privateKey)"
```
Rough ETH needs (keeper and arb at 10 gwei are about $5 per slice on L1, far less on Sepolia): deployer a few hundredths of an ETH,
keeper and arb about 0.05 each, seller 0.05. Faucet amounts vary; get more if a step fails on gas.

## 2. Check the Chainlink feed before deploying

Open Chainlink BTC/USD on Sepolia, `0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43`, on sepolia.etherscan.io, "Read Contract",
`latestRoundData`. If `updatedAt` is older than 1 hour, slices will revert with `StalePrice`. Either wait, or deploy with a
looser limit (the owner may raise it up to 1 day): `PRICE_MAX_STALENESS=86400` in the deploy command below, and **say so in the
video**. Measured 2026-11-01: the feed read $77,767 and was already about 1 hour old (right at the 3,600 s default), so a default
deploy risks intermittent `StalePrice` reverts; use `PRICE_MAX_STALENESS=7200` or more. Also note the answer's price: the pool is seeded at that price, and `PriceGuard` skips slices when the pool is more than
`PRICE_MAX_DEVIATION_BPS` (default 500 = 5%) from Chainlink.

## 3. Deploy, seed, verify (Dev, or whoever holds the deployer)

```bash
SEED_POOL=true yarn deploy --network sepolia --tags StreamingAMM     # asks for the deployer password
yarn verify --network sepolia                                         # every contract in deployments/sepolia
```
Then: `packages/hardhat/deployments.json` holds every address, deploy tx and block (commit it). `packages/nextjs/contracts/deployedContracts.ts`
is regenerated for chain 11155111 (commit it too). Open each address on Etherscan and confirm the green "verified" tick.
Write the OrderBook's `blockNumber` from `deployments.json` down: it is the keeper's `START_BLOCK`.

**Done 2026-11-01:** steps 1 to 3 (deployed and verified, addresses in `packages/hardhat/deployments.json` and `submission.json`).
Top up the bot wallets from the deployer in one go: `yarn send-eth` (asks for the deployer password; default 0.005 ETH each, and it refuses to send more than half the balance in total). The deployer holds only about 0.0125 ETH after the deploy, so use `SEND_ETH=0.003`. To fund a person's MetaMask account for the demo: `SEND_TO=0xTheirAddress SEND_ETH=0.003 yarn send-eth` (sends only to that address).

**What the deploy really cost (2026-11-01):** about 0.036 ETH, not the few millionths first estimated. Two reasons: the deploy tool paid a fixed 1 gwei priority fee (the network suggests about 0.0005 gwei), and Sepolia charged about 7x our local gas for contract creation (Pool 12.0M, OrderBook 15.7M). A full redeploy would therefore need about 0.036 ETH again, i.e. another faucet trip. Bots use ethers 6.17, which asks the RPC for its suggested tip, so each bot transaction costs a negligible amount.

## 4. Configure the bots (`packages/hardhat/.env`)

```
RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<key>
ORDER_BOOK=<from deployments.json>      POOL=<from deployments.json>
BTC_USD_FEED=0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43
KEEPER_PRIVATE_KEY=<throwaway>          ARB_PRIVATE_KEY=<throwaway>
START_BLOCK=<OrderBook blockNumber>
MAX_LOG_RANGE=10        # required with Alchemy's free tier (checked: 11 blocks is rejected). Fine because START_BLOCK is recent
ARB_GAP_THRESHOLD_BPS=50
```
Give the arb account tokens (needs a little ETH first):
```bash
yarn fund-arb            # 5 WBTC and 500,000 USDC from the mock faucets; FUND_ROUNDS=3 for more
```

## 5. Rehearse one cycle before recording

```bash
yarn arb --once          # realign the pool if Chainlink moved since the seed
NEXT_PUBLIC_TARGET_NETWORK=sepolia yarn start     # http://localhost:3000, connect MetaMask on Sepolia
```
In the app: faucet WBTC, create an order (1 WBTC, 3 slices, 60 s, 3% tolerance), review, sign approve and create. Then:
```bash
yarn keeper              # loop; expect {"event":"filled", "txHash":...} about every 60 s
yarn arb                 # loop; expect "traded" once the pool drifts from Chainlink
```
Local rehearsal results for reference: three `filled` slices (about 0.6667 WBTC each, 2 WBTC order), first slice
`0x8e3ce0b4...` locally; arb sat out the first round (26 bps gap is below the 30 bps fee, so no profit) and traded in rounds 2
and 3. Expect the same shape on Sepolia: that is correct behaviour, not a bug. Claim in the app when the order is finished.

## 6. Collect the evidence (after the rehearsal and again after the recorded run)

```bash
RPC_URL=https://ethereum-sepolia-rpc.publicnode.com MAX_LOG_RANGE=5000 yarn evidence
```
Prints a table with Etherscan links (deploy hashes, first `LiquidityAdded`, `OrderCreated`, `SliceExecuted`, arbitrage `Swap`,
`Claimed`) and saves `docs/data/evidence_sepolia.json`. It sends nothing and needs no key. Use PublicNode here, not the Alchemy URL: scanning days of blocks 10 at a time would take thousands of requests. It lists what is still missing.
`submission.json` already follows the course template (checked against the brief); add any new hashes to its `transactions` list.
Add the video timestamp for each item after the edit.

## 7. Rubric items that need Sepolia data

- **Slice reconciliation (Dev's notebook).** `docs/analysis_slicing.ipynb`, last section: give it one `executeSlice` tx hash from
  the evidence table; the model's output must equal the on-chain `amountOut`.
- **At least one real transaction in the video:** the `createOrder` hash opened on Etherscan, plus the keeper's `filled` line.
- **A guard skip** is optional evidence (`SEND_SKIPS=true` records `SliceSkipped` on chain); the local test shows how.

## 8. Before the deadline (Nov 4, 11:59pm ET)

- [ ] Contracts verified on Etherscan; addresses in `submission.json`.
- [ ] `yarn test`: 92 passing from a fresh clone.
- [ ] PRs from `sid/offchain` into `main`, each reviewed by another member. Tag `final` on the merged commit.
- [ ] Repo shared with the professor and TA (needs their GitHub usernames).
- [ ] Each member has read the files they claim in report Section 8.
