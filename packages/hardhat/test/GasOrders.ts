import { network } from "hardhat";

// Prints the exact gas used by each OrderBook entry point. Not an assertion test: run it with
// `hardhat test --network hardhat test/GasOrders.ts` to reproduce docs/gas-orders.md.
const { networkHelpers, ethers } = await network.create();

const BTC = 10n ** 8n;
const USD = 10n ** 6n;
const INTERVAL = 600n;
const FEED = 60_000n * 10n ** 8n;

describe("Gas (OrderBook)", function () {
  it("measures createOrder, executeSlice, claim and cancel", async function () {
    const [owner, alice, keeper] = await ethers.getSigners();
    const wbtc = await ethers.deployContract("MockWBTC", [owner.address]);
    const usdc = await ethers.deployContract("MockUSDC", [owner.address]);
    const pool = await ethers.deployContract("Pool", [await wbtc.getAddress(), await usdc.getAddress()]);
    const feed = await ethers.deployContract("MockAggregator", [8, FEED]);
    const guard = await ethers.deployContract("PriceGuard", [await feed.getAddress(), owner.address, 86_400n, 500n]);
    const book = await ethers.deployContract("OrderBook", [await pool.getAddress(), await guard.getAddress()]);
    await wbtc.mint(owner.address, 500n * BTC);
    await usdc.mint(owner.address, 30_000_000n * USD);
    await wbtc.approve(await pool.getAddress(), 2n ** 255n);
    await usdc.approve(await pool.getAddress(), 2n ** 255n);
    await pool.addLiquidity(500n * BTC, 30_000_000n * USD, 0, 0, owner.address);
    await wbtc.mint(alice.address, 100n * BTC);
    await wbtc.connect(alice).approve(await book.getAddress(), 2n ** 255n);

    const gas = async (tx: Promise<{ wait(): Promise<{ gasUsed: bigint } | null> }>) =>
      (await (await tx).wait())!.gasUsed;
    const slice = async () => {
      await networkHelpers.time.increase(INTERVAL);
      await feed.setAnswer(FEED);
      return gas(book.connect(keeper).executeSlice(1n));
    };

    const rows: Record<string, bigint> = {};
    rows["createOrder (first order, 10 BTC, 5 slices)"] = await gas(
      book.connect(alice).createOrder(10n * BTC, 5, INTERVAL, 500),
    );
    rows["executeSlice (1st slice)"] = await slice();
    rows["executeSlice (2nd slice)"] = await slice();
    rows["claim (after 2 slices)"] = await gas(book.connect(keeper).claim(1n));
    await slice();
    await slice();
    rows["executeSlice (last slice)"] = await slice();
    rows["createOrder (second order)"] = await gas(book.connect(alice).createOrder(10n * BTC, 5, INTERVAL, 500));
    rows["cancel (unfilled order, nothing to pay in USDC)"] = await gas(book.connect(alice).cancel(2n));
    rows["cancel (finished order, USDC proceeds only)"] = await gas(book.connect(alice).cancel(1n));

    console.log("\n  GAS_TABLE_START");
    for (const [k, v] of Object.entries(rows)) console.log(`  ${k.padEnd(52)} ${v}`);
    console.log("  GAS_TABLE_END");
  });
});
