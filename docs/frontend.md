# Front end

Scaffold-ETH 2 app in `packages/nextjs`. One page (`app/page.tsx`); components in `app/_components/`, data hooks in
`hooks/streaming/`, pure helpers in `utils/streaming/`.

## Run locally
```
export PATH=$HOME/.local/node/bin:$PATH
yarn chain                                   # terminal 1
yarn deploy --tags StreamingAMM              # terminal 2 (also regenerates nextjs/contracts/deployedContracts.ts)
yarn start                                   # terminal 3, http://localhost:3000
```
The burner wallet connects automatically on the local chain; the header "Faucet" button gives it ETH. The page has its own
WBTC/USDC test-token faucet. Local chain time only moves when blocks are mined.

## Sepolia
Set `NEXT_PUBLIC_TARGET_NETWORK=sepolia` (and your own `NEXT_PUBLIC_ALCHEMY_API_KEY`) after the Sepolia deploy has written
Sepolia addresses into `deployedContracts.ts`. The stale-feed check reads Chainlink BTC/USD `0x1b44…Ee43` directly on Sepolia.

## What it shows
- Pool reserves, pool price, Chainlink price and the gap, fee, guard band.
- Create order: total, slices, interval, allowed shortfall; inline validation in plain language; preview of USDC out and
  price impact for lump sum, sliced without refill, sliced with refill (same integer formula as `Pool.sol`; checked equal
  to the contract for 20 WBTC: 1,150,517.367388 USDC). Warns when the tolerance is too tight for even the first slice.
- Confirmation dialog listing exactly what will be signed (amount held, slices, interval, tolerance, estimate, 1 or 2 txs).
  Approval is for the exact amount, never unlimited.
- Your orders: progress bar of executed slices, countdown, skipped-slice count, Run next slice (permissionless), Claim,
  Cancel with its own confirmation.
- Transaction status per action: waiting for wallet/network, confirmed with hash (explorer link on Sepolia), or failed with
  a plain-language reason. Known errors are mapped in `utils/streaming/errors.ts`, which also feeds the scaffold's toasts.
- Banner when the Chainlink feed is stale or invalid, a warning past 80% of the allowed age, and a warning when the pool is
  outside the guard band. Time follows the chain's latest block.

## Tested (2026-11-01)
`tsc` clean (local and `NEXT_PUBLIC_TARGET_NETWORK=sepolia`), eslint 0 errors (2 deprecation warnings for
`useScaffoldEventHistory`), `next build` passes. Headless Chrome (puppeteer, script kept outside the repo) against a local
node with the real contracts: burner connect, faucet, validation, review + approve + create, run slice, progress, claim,
stale-feed banner and plain-language revert, cancel. All passed, no uncaught page errors.
**Not tested:** MetaMask or any injected wallet, user rejection in a real wallet, Sepolia, mobile layout by eye.
Order discovery now starts at the OrderBook's deploy block (`deployedOnBlock` in `deployedContracts.ts`, written by the deploy) instead of block 0, and on Sepolia reads through PublicNode (`rpcOverrides` in `scaffold.config.ts`) because Alchemy's free tier allows `eth_getLogs` over only 10 blocks. `tsc` clean. **Checked on Sepolia 2026-11-01 (in-app browser, no wallet, read-only):** `NEXT_PUBLIC_TARGET_NETWORK=sepolia yarn start` loads the page with no console errors; pool reserves (500.75 WBTC / 38.79M USDC), pool price, Chainlink price, the 0.29% gap, the 5% band and the three-way preview table all read live from the deployed contracts; the Debug page lists all five contracts on Sepolia. (Two dev-only React hydration warnings come from Scaffold-ETH's stock Debug page.) **Not tested: any wallet-signed action on Sepolia** (create order, run slice, claim, cancel), the 'Your orders' list with a connected wallet, and event discovery with real orders. Needs a browser with MetaMask.
