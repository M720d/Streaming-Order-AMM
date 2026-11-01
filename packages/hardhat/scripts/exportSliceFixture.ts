import fs from "fs";
import { network } from "hardhat";

/**
 * Runs the same streaming order on the real contracts with and without an arbitrage refill between slices, plus
 * the same total as one lump-sum swap, and writes every amount and reserve to docs/data/slice_fixture_local.json.
 * docs/analysis_slicing.ipynb reproduces these numbers with its own integer model and asserts they are equal.
 *
 *   hardhat run scripts/exportSliceFixture.ts --network hardhat
 */
const { networkHelpers, ethers } = await network.create();

const BTC = 10n ** 8n;
const USD = 10n ** 6n;
const INTERVAL = 600n;
const FEED = 60_000n * 10n ** 8n;
const SLICES = 5;
const TOTAL = 20n * BTC;
const RESERVE0 = 500n * BTC;
const RESERVE1 = 30_000_000n * USD;
const TOLERANCE_BPS = 1000;

// Integer square root (floor), Newton's method.
const isqrt = (n: bigint) => {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
};

// USDC an arbitrageur must pay to move the pool to its no-profit point at the external price of 60,000 USDC/WBTC
// (the same rule as `arb_usdc_in` in the notebook). Zero when the pool is not below that point.
const PRICE_NUM = 60_000n * USD; // external price in raw USDC ...
const PRICE_DEN = BTC; // ... per raw WBTC
const arbUsdcIn = (x: bigint, y: bigint) => {
  if (y * 10_000n * PRICE_DEN >= 9970n * PRICE_NUM * x) return 0n;
  const root = isqrt((9970n * PRICE_NUM * x * y) / (10_000n * PRICE_DEN));
  return ((root - y) * 10_000n) / 9970n;
};

async function setup() {
  const [owner, seller, arb] = await ethers.getSigners();
  const wbtc = await ethers.deployContract("MockWBTC", [owner.address]);
  const usdc = await ethers.deployContract("MockUSDC", [owner.address]);
  const pool = await ethers.deployContract("Pool", [await wbtc.getAddress(), await usdc.getAddress()]);
  const feed = await ethers.deployContract("MockAggregator", [8, FEED]);
  const guard = await ethers.deployContract("PriceGuard", [await feed.getAddress(), owner.address, 86_400n, 2000n]);
  const book = await ethers.deployContract("OrderBook", [await pool.getAddress(), await guard.getAddress()]);
  for (const who of [owner, seller, arb]) {
    await wbtc.mint(who.address, 1000n * BTC);
    await usdc.mint(who.address, 100_000_000n * USD);
    for (const spender of [pool, book]) {
      await wbtc.connect(who).approve(await spender.getAddress(), 2n ** 255n);
      await usdc.connect(who).approve(await spender.getAddress(), 2n ** 255n);
    }
  }
  await pool.addLiquidity(RESERVE0, RESERVE1, 0, 0, owner.address);
  return { seller, arb, wbtc, usdc, pool, feed, book };
}

async function reserves(pool: Awaited<ReturnType<typeof setup>>["pool"]) {
  const [r0, r1] = await pool.getReserves();
  return { reserve0: r0.toString(), reserve1: r1.toString(), spotPriceE18: (await pool.spotPriceE18()).toString() };
}

async function streamed(refill: boolean) {
  const f = await setup();
  await f.book.connect(f.seller).createOrder(TOTAL, SLICES, INTERVAL, TOLERANCE_BPS);
  const slices: Record<string, unknown>[] = [];
  const arbs: Record<string, string>[] = [];
  for (let i = 0; i < SLICES; i++) {
    await networkHelpers.time.increase(INTERVAL);
    await f.feed.setAnswer(FEED);
    const rcpt = await (await f.book.executeSlice(1n)).wait();
    const ev = f.book.interface.parseLog(
      rcpt!.logs.find(l => l.topics[0] === f.book.interface.getEvent("SliceExecuted")!.topicHash)!,
    )!;
    slices.push({
      amountIn: ev.args.amountIn.toString(),
      amountOut: ev.args.amountOut.toString(),
      slicesLeft: Number(ev.args.slicesLeft),
      gasUsed: rcpt!.gasUsed.toString(),
      after: await reserves(f.pool),
    });
    if (refill && i < SLICES - 1) {
      const [r0, r1] = await f.pool.getReserves();
      const usdcIn = arbUsdcIn(r0, r1);
      const wbtcOut = usdcIn === 0n ? 0n : await f.pool.getAmountOut(await f.usdc.getAddress(), usdcIn);
      if (usdcIn > 0n) await f.pool.connect(f.arb).swapExactIn(await f.usdc.getAddress(), usdcIn, 0, f.arb.address);
      arbs.push({
        usdcIn: usdcIn.toString(),
        wbtcOut: wbtcOut.toString(),
        after: JSON.stringify(await reserves(f.pool)),
      });
    }
  }
  const order = await f.book.getOrder(1n);
  return { slices, arbs, proceeds: order.proceeds.toString(), remainingIn: order.remainingIn.toString() };
}

async function lump() {
  const f = await setup();
  const before = await f.usdc.balanceOf(f.arb.address);
  await f.pool.connect(f.arb).swapExactIn(await f.wbtc.getAddress(), TOTAL, 0, f.arb.address);
  return { amountOut: ((await f.usdc.balanceOf(f.arb.address)) - before).toString(), after: await reserves(f.pool) };
}

const fixture = {
  description: "Local hardhat run of the real contracts. See scripts/exportSliceFixture.ts.",
  params: {
    reserve0: RESERVE0.toString(),
    reserve1: RESERVE1.toString(),
    total: TOTAL.toString(),
    slices: SLICES,
    interval: Number(INTERVAL),
    externalPriceUsdcPerWbtc: 60_000,
    feeBps: 30,
  },
  lumpSum: await lump(),
  noRefill: await streamed(false),
  withRefill: await streamed(true),
};
fs.mkdirSync("../../docs/data", { recursive: true });
fs.writeFileSync("../../docs/data/slice_fixture_local.json", JSON.stringify(fixture, null, 2) + "\n");
console.log(
  "lump out",
  fixture.lumpSum.amountOut,
  "| no refill",
  fixture.noRefill.proceeds,
  "| with refill",
  fixture.withRefill.proceeds,
);
