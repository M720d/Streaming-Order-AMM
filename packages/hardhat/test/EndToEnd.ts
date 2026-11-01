import { expect } from "chai";
import { network } from "hardhat";
import { Arbitrageur, optimalTradeIn, parseDecimal, type ArbConfig } from "../scripts/offchain/arbCore.js";
import { Keeper } from "../scripts/offchain/keeperCore.js";

const { networkHelpers, ethers } = await network.create();

const BTC = 10n ** 8n;
const USD = 10n ** 6n;
const INTERVAL = 600n;
const FEED_60K = 60_000n * 10n ** 8n;
const TOTAL = 20n * BTC;
const SLICES = 5;

// Same deployment as test/OrderBook.ts: 500 WBTC / 30M USDC pool (60,000 USDC per WBTC), feed at 60,000,
// guard band 5%. `keeperSigner` and `arbSigner` are separate accounts, like on a live network.
async function fixture() {
  const [owner, seller, arbSigner, keeperSigner] = await ethers.getSigners();
  const wbtc = await ethers.deployContract("MockWBTC", [owner.address]);
  const usdc = await ethers.deployContract("MockUSDC", [owner.address]);
  const wbtcAddr = await wbtc.getAddress();
  const usdcAddr = await usdc.getAddress();
  const pool = await ethers.deployContract("Pool", [wbtcAddr, usdcAddr]);
  const poolAddr = await pool.getAddress();
  const feed = await ethers.deployContract("MockAggregator", [8, FEED_60K]);
  const guard = await ethers.deployContract("PriceGuard", [await feed.getAddress(), owner.address, 86_400n, 500n]);
  const book = await ethers.deployContract("OrderBook", [poolAddr, await guard.getAddress()]);
  const bookAddr = await book.getAddress();

  for (const who of [owner, seller, arbSigner]) {
    await wbtc.mint(who.address, 1000n * BTC);
    await usdc.mint(who.address, 100_000_000n * USD);
  }
  for (const t of [wbtc, usdc]) await t.connect(owner).approve(poolAddr, 2n ** 255n);
  await wbtc.connect(seller).approve(bookAddr, 2n ** 255n);
  await pool.addLiquidity(500n * BTC, 30_000_000n * USD, 0, 0, owner.address);

  return { owner, seller, arbSigner, keeperSigner, wbtc, usdc, pool, feed, book, wbtcAddr, bookAddr, poolAddr };
}

// The bots keep state (scan cursor, watched orders), so each test builds its own on top of the shared chain snapshot.
async function setup(
  extraKeeper: Partial<ConstructorParameters<typeof Keeper>[1]> = {},
  extraArb: Partial<ArbConfig> = {},
) {
  const f = await networkHelpers.loadFixture(fixture);
  const keeperLines: string[] = [];
  const arbLines: string[] = [];
  const keeper = new Keeper(f.keeperSigner, { orderBook: f.bookAddr, retryDelaySec: 0, ...extraKeeper }, l =>
    keeperLines.push(l),
  );
  const arb = new Arbitrageur(
    f.arbSigner,
    { pool: f.poolAddr, feed: await f.feed.getAddress(), gapThresholdBps: 100, minProfitUsdc: "1", ...extraArb },
    l => arbLines.push(l),
  );
  return { ...f, keeper, arb, keeperLines, arbLines };
}
type Fx = Awaited<ReturnType<typeof setup>>;

// One interval passes, the (mock) feed refreshes like a live one would, then the keeper and optionally the bot act.
async function round(f: Fx, withArb: boolean) {
  await networkHelpers.time.increase(INTERVAL);
  await f.feed.setAnswer(FEED_60K);
  const slices = await f.keeper.tick();
  const trade = withArb ? await f.arb.tick() : undefined;
  return { slices, trade };
}

describe("End to end: keeper + arbitrage bot against the real contracts", function () {
  it("streamed proceeds with keeper and arbitrage refill beat a lump-sum sale of the same size", async function () {
    const f = await setup();
    const lumpSum = await f.pool.getAmountOut(f.wbtcAddr, TOTAL); // what one swap of TOTAL would pay right now
    await f.book.connect(f.seller).createOrder(TOTAL, SLICES, INTERVAL, 1000);

    const filled: bigint[] = [];
    let trades = 0;
    for (let i = 0; i < SLICES; i++) {
      const { slices, trade } = await round(f, true);
      expect(slices, `round ${i}`).to.have.length(1);
      expect(slices[0].status, `round ${i}: ${slices[0].detail}`).to.equal("filled");
      expect(slices[0].txHash).to.match(/^0x[0-9a-f]{64}$/);
      filled.push(slices[0].amountOut!);
      if (trade!.action === "traded") trades++;
    }

    const order = await f.book.getOrder(1n);
    expect(order.slicesLeft).to.equal(0n);
    expect(order.remainingIn).to.equal(0n);
    const streamed = order.proceeds;
    expect(streamed).to.equal(filled.reduce((a, b) => a + b, 0n));
    expect(streamed).to.be.greaterThan(lumpSum);
    expect(trades).to.be.greaterThan(0); // the bot actually refilled the pool

    // The seller can claim exactly the proceeds.
    const before = await f.usdc.balanceOf(f.seller.address);
    await f.book.connect(f.seller).claim(1n);
    expect((await f.usdc.balanceOf(f.seller.address)) - before).to.equal(streamed);

    console.log(
      `      lump sum ${Number(lumpSum) / 1e6} USDC, streamed ${Number(streamed) / 1e6} USDC ` +
        `(+${((Number(streamed - lumpSum) / Number(lumpSum)) * 1e4).toFixed(1)} bps), arb trades ${trades}`,
    );
  });

  it("a finished order is dropped: later ticks send nothing", async function () {
    const f = await setup();
    await f.book.connect(f.seller).createOrder(2n * BTC, 2, INTERVAL, 1000);
    await round(f, false);
    await round(f, false);
    expect((await f.book.getOrder(1n)).slicesLeft).to.equal(0n);
    await networkHelpers.time.increase(INTERVAL);
    expect(await f.keeper.tick()).to.deep.equal([]);
    expect(f.keeper.watching).to.deep.equal([]);
  });

  it("revert: executeSlice before the interval has elapsed reverts with TooEarly", async function () {
    const f = await setup();
    await f.book.connect(f.seller).createOrder(TOTAL, SLICES, INTERVAL, 1000);
    await expect(f.book.connect(f.keeperSigner).executeSlice(1n)).to.be.revertedWithCustomError(f.book, "TooEarly");
  });

  it("keeper does not send (and does not log a result) for an order that is not due yet", async function () {
    const f = await setup();
    await f.book.connect(f.seller).createOrder(TOTAL, SLICES, INTERVAL, 1000);
    const nonceBefore = await f.keeperSigner.getNonce();
    expect(await f.keeper.tick()).to.deep.equal([]);
    expect(await f.keeperSigner.getNonce()).to.equal(nonceBefore);
    expect(f.keeper.watching).to.deep.equal([1n]);
  });

  it("keeper never double-sends: a second tick in the same interval sends nothing", async function () {
    const f = await setup();
    await f.book.connect(f.seller).createOrder(TOTAL, SLICES, INTERVAL, 1000);
    await networkHelpers.time.increase(INTERVAL);
    await f.feed.setAnswer(FEED_60K);
    const [first] = await f.keeper.tick();
    expect(first.status).to.equal("filled");
    const nonce = await f.keeperSigner.getNonce();
    expect(await f.keeper.tick()).to.deep.equal([]); // next slice is an interval away
    expect(await f.keeperSigner.getNonce()).to.equal(nonce);
    expect((await f.book.getOrder(1n)).slicesLeft).to.equal(SLICES - 1);
  });

  it("keeper reports 'reverted' without sending when the oracle is stale", async function () {
    const f = await setup();
    await f.book.connect(f.seller).createOrder(TOTAL, SLICES, INTERVAL, 1000);
    await networkHelpers.time.increase(2n * 86_400n); // feed not refreshed: older than the guard's 1 day max
    const nonce = await f.keeperSigner.getNonce();
    const [res] = await f.keeper.tick();
    expect(res.status).to.equal("reverted");
    expect(res.detail).to.contain("StalePrice");
    expect(res.txHash).to.equal(undefined);
    expect(await f.keeperSigner.getNonce()).to.equal(nonce);
    expect((await f.book.getOrder(1n)).slicesLeft).to.equal(SLICES);
  });

  it("without the arbitrage bot the pool never refills and the guard skips later slices", async function () {
    const f = await setup();
    await f.book.connect(f.seller).createOrder(TOTAL, SLICES, INTERVAL, 1000);
    const statuses: string[] = [];
    for (let i = 0; i < SLICES; i++) {
      const { slices } = await round(f, false);
      statuses.push(slices[0].status);
    }
    expect(statuses).to.include("skipped");
    expect((await f.book.getOrder(1n)).slicesLeft).to.be.greaterThan(0n);
    expect(await f.book.queryFilter(f.book.filters.SliceSkipped())).to.have.length(0); // skips were not sent
  });

  it("with sendSkips on, the skip is recorded on chain and logged with its tx hash", async function () {
    const f = await setup({ sendSkips: true });
    const lines = f.keeperLines;
    const keeper = f.keeper;
    await f.book.connect(f.seller).createOrder(TOTAL, SLICES, INTERVAL, 1000);
    let skip;
    for (let i = 0; i < SLICES && !skip; i++) {
      await networkHelpers.time.increase(INTERVAL);
      await f.feed.setAnswer(FEED_60K);
      skip = (await keeper.tick()).find(r => r.status === "skipped");
    }
    expect(skip?.txHash).to.match(/^0x[0-9a-f]{64}$/);
    expect(await f.book.queryFilter(f.book.filters.SliceSkipped())).to.have.length(1);
    expect(lines.some(l => l.includes('"event":"skipped"') && l.includes(skip!.txHash!))).to.equal(true);
  });

  it("keeper drops a cancelled order instead of failing", async function () {
    const f = await setup();
    await f.book.connect(f.seller).createOrder(TOTAL, SLICES, INTERVAL, 1000);
    await f.keeper.tick(); // discovers the order
    await f.book.connect(f.seller).cancel(1n);
    await networkHelpers.time.increase(INTERVAL);
    expect(await f.keeper.tick()).to.deep.equal([]);
    expect(f.keeper.watching).to.deep.equal([]);
  });

  describe("arbitrage bot", function () {
    async function dumpWbtc(f: Fx, amount: bigint) {
      await f.wbtc.connect(f.seller).approve(await f.pool.getAddress(), 2n ** 255n);
      await f.pool.connect(f.seller).swapExactIn(f.wbtcAddr, amount, 0, f.seller.address);
    }

    it("does nothing when the gap is below the threshold", async function () {
      const f = await setup();
      const res = await f.arb.tick();
      expect(res.action).to.equal("none");
      expect(res.detail).to.contain("below threshold");
    });

    it("buys WBTC when the pool is below the oracle, profits at the oracle price and then finds nothing left", async function () {
      const f = await setup({}, { maxTradeUsdc: "5000000" });
      await dumpWbtc(f, 20n * BTC); // pool price falls roughly 8%
      const usdcBefore = await f.usdc.balanceOf(f.arbSigner.address);
      const wbtcBefore = await f.wbtc.balanceOf(f.arbSigner.address);
      const res = await f.arb.tick();
      expect(res.action).to.equal("traded");
      expect(res.direction).to.equal("buy-wbtc");
      expect(res.gapBps).to.be.greaterThan(100);
      expect(res.txHash).to.match(/^0x[0-9a-f]{64}$/);
      // Profit at the oracle price: WBTC gained valued at 60,000 minus USDC spent, after the 30 bps fee.
      const spent = usdcBefore - (await f.usdc.balanceOf(f.arbSigner.address));
      const got = (await f.wbtc.balanceOf(f.arbSigner.address)) - wbtcBefore;
      expect(spent).to.equal(res.amountIn);
      expect((got * 60_000n * USD) / BTC - spent).to.be.greaterThanOrEqual(res.expectedProfitUsdc! - 1n);
      expect((got * 60_000n * USD) / BTC).to.be.greaterThan(spent);
      // The pool ends within the fee band of the oracle (about 30 bps), under the 100 bps threshold.
      expect((await f.arb.tick()).action).to.equal("none");
    });

    it("sells WBTC when the pool is above the oracle", async function () {
      const f = await setup();
      await f.usdc.connect(f.seller).approve(await f.pool.getAddress(), 2n ** 255n);
      await f.pool.connect(f.seller).swapExactIn(await f.usdc.getAddress(), 3_000_000n * USD, 0, f.seller.address);
      const res = await f.arb.tick();
      expect(res.action).to.equal("traded");
      expect(res.direction).to.equal("sell-wbtc");
    });

    it("respects the maximum trade size", async function () {
      const f = await setup();
      await dumpWbtc(f, 20n * BTC);
      const small = new Arbitrageur(
        f.arbSigner,
        { pool: await f.pool.getAddress(), feed: await f.feed.getAddress(), maxTradeUsdc: "1000" },
        () => {},
      );
      const res = await small.tick();
      expect(res.action).to.equal("traded");
      expect(res.amountIn).to.equal(1000n * USD);
      expect(res.detail).to.contain("max trade size");
    });

    it("refuses to trade against a stale oracle", async function () {
      const f = await setup();
      await dumpWbtc(f, 20n * BTC);
      await networkHelpers.time.increase(7_200n); // default max age is 3600 s
      const res = await f.arb.tick();
      expect(res.action).to.equal("none");
      expect(res.detail).to.contain("stale");
    });

    it("does not trade when the profit after fees is below the minimum", async function () {
      const f = await setup();
      await dumpWbtc(f, 20n * BTC);
      const greedy = new Arbitrageur(
        f.arbSigner,
        { pool: await f.pool.getAddress(), feed: await f.feed.getAddress(), minProfitUsdc: "100000000" },
        () => {},
      );
      const res = await greedy.tick();
      expect(res.action).to.equal("none");
      expect(res.detail).to.contain("not profitable");
    });
  });

  describe("sizing helpers", function () {
    it("parseDecimal is exact", function () {
      expect(parseDecimal("5", 8)).to.equal(5n * BTC);
      expect(parseDecimal("0.5", 8)).to.equal(BTC / 2n);
      expect(parseDecimal("300000.25", 6)).to.equal(300_000_250_000n);
    });

    it("optimalTradeIn is zero at the no-profit point and positive off it", function () {
      const x = 500n * BTC;
      const y = 30_000_000n * USD;
      const pNum = 60_000n * 10n ** 18n * USD;
      const pDen = BTC * 10n ** 18n;
      expect(optimalTradeIn("buy-wbtc", x, y, pNum, pDen, 30n)).to.equal(0n); // at the oracle price, fee blocks it
      expect(optimalTradeIn("sell-wbtc", x, y, pNum, pDen, 30n)).to.equal(0n);
      expect(optimalTradeIn("buy-wbtc", x + 20n * BTC, y - 1_000_000n * USD, pNum, pDen, 30n)).to.be.greaterThan(0n);
    });
  });
});
