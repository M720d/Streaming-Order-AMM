import fs from "fs";
import { network } from "hardhat";

/**
 * Measures the gas of the user actions that docs/gas-pool.md and docs/gas-orders.md do not cover (deployments, token
 * approval, faucet) and repeats the main order actions on the same state, so Part C of the analysis has one
 * consistent table. Exact gasUsed from receipts, in-process Hardhat network, same compiler settings as the deploy.
 *
 *   hardhat run scripts/measureCostGas.ts --network hardhat
 *
 * Writes docs/data/gas_costs_local.json.
 */
const { networkHelpers, ethers } = await network.create();

const BTC = 10n ** 8n;
const USD = 10n ** 6n;
const INTERVAL = 600n;
const FEED = 60_000n * 10n ** 8n;

const gasOf = async (p: Promise<{ wait: () => Promise<{ gasUsed: bigint } | null> }>) => Number((await (await p).wait())!.gasUsed);
const deployGas = async (c: { deploymentTransaction: () => { wait: () => Promise<{ gasUsed: bigint } | null> } | null }) =>
  Number((await c.deploymentTransaction()!.wait())!.gasUsed);

const [owner, seller, keeper] = await ethers.getSigners();
const out: Record<string, number> = {};

const wbtc = await ethers.deployContract("MockWBTC", [owner.address]);
out.deploy_MockWBTC = await deployGas(wbtc);
const usdc = await ethers.deployContract("MockUSDC", [owner.address]);
out.deploy_MockUSDC = await deployGas(usdc);
const pool = await ethers.deployContract("Pool", [await wbtc.getAddress(), await usdc.getAddress()]);
out.deploy_Pool = await deployGas(pool);
const feed = await ethers.deployContract("MockAggregator", [8, FEED]);
const guard = await ethers.deployContract("PriceGuard", [await feed.getAddress(), owner.address, 86_400n, 500n]);
out.deploy_PriceGuard = await deployGas(guard);
const book = await ethers.deployContract("OrderBook", [await pool.getAddress(), await guard.getAddress()]);
out.deploy_OrderBook = await deployGas(book);
const poolAddr = await pool.getAddress();
const bookAddr = await book.getAddress();

await wbtc.mint(owner.address, 500n * BTC);
await usdc.mint(owner.address, 30_000_000n * USD);
await wbtc.approve(poolAddr, 2n ** 255n);
await usdc.approve(poolAddr, 2n ** 255n);
await pool.addLiquidity(500n * BTC, 30_000_000n * USD, 0, 0, owner.address);

// A fresh seller, as in the front end: faucet, approve exactly, create, slices, claim, cancel.
out.faucet_wbtc_first = await gasOf(wbtc.connect(seller).faucet(5n * BTC));
out.approve_wbtc_exact = await gasOf(wbtc.connect(seller).approve(bookAddr, 2n * BTC));
out.createOrder_first = await gasOf(book.connect(seller).createOrder(2n * BTC, 4, INTERVAL, 300));
const slices: number[] = [];
for (let i = 0; i < 4; i++) {
  await networkHelpers.time.increase(INTERVAL);
  await feed.setAnswer(FEED);
  slices.push(await gasOf(book.connect(keeper).executeSlice(1n)));
}
out.executeSlice_first = slices[0];
out.executeSlice_middle = slices[1];
out.executeSlice_last = slices[3];
out.executeSlice_mean_4 = Math.round(slices.reduce((a, b) => a + b, 0) / slices.length);
out.claim_first = await gasOf(book.connect(seller).claim(1n));
out.cancel_finished = await gasOf(book.connect(seller).cancel(1n));

await wbtc.connect(seller).approve(bookAddr, 1n * BTC);
out.createOrder_second = await gasOf(book.connect(seller).createOrder(1n * BTC, 4, INTERVAL, 300));
out.cancel_unfilled = await gasOf(book.connect(seller).cancel(2n));

// Arbitrage trade, as the bot does it (approve exactly, then swap).
await usdc.mint(keeper.address, 1_000_000n * USD);
out.approve_usdc_exact = await gasOf(usdc.connect(keeper).approve(poolAddr, 100_000n * USD));
out.swapExactIn_usdc_in = await gasOf(pool.connect(keeper).swapExactIn(await usdc.getAddress(), 100_000n * USD, 0, keeper.address));

const file = new URL("../../../docs/data/gas_costs_local.json", import.meta.url);
fs.writeFileSync(file, JSON.stringify({ measured: new Date().toISOString().slice(0, 10), network: "hardhat (in-process)", solc: "0.8.30, optimizer 200 runs", gasUsed: out }, null, 2) + "\n");
console.log(out);
