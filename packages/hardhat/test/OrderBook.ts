import { expect } from "chai";
import { network } from "hardhat";

const { networkHelpers, ethers } = await network.create();

const BTC = 10n ** 8n;
const USD = 10n ** 6n;
const E18 = 10n ** 18n;
const DAY = 86_400n;
const INTERVAL = 600n;
const FEED_60K = 60_000n * 10n ** 8n;
const ATTACKS = ["function executeSlice(uint256)", "function claim(uint256)", "function cancel(uint256)"];
const REENTRANCY_SELECTOR = ethers.id("ReentrancyGuardReentrantCall()").slice(0, 10);

// Independent model of the 30 bps constant-product pool: same integer formula as docs/analysis_pool.ipynb.
const amountOut = (a: bigint, rIn: bigint, rOut: bigint) => {
  const w = a * 9970n;
  return (w * rOut) / (rIn * 10_000n + w);
};
// Sells `amounts` one after another into reserves (r0 WBTC, r1 USDC) and returns every output.
const simulate = (amounts: bigint[], r0: bigint, r1: bigint) => {
  const outs: bigint[] = [];
  for (const a of amounts) {
    const out = amountOut(a, r0, r1);
    outs.push(out);
    r0 += a;
    r1 -= out;
  }
  return { outs, r0, r1 };
};

async function fixture() {
  const [owner, alice, bob, keeper] = await ethers.getSigners();
  const wbtc = await ethers.deployContract("MockWBTC", [owner.address]);
  const usdc = await ethers.deployContract("MockUSDC", [owner.address]);
  const wbtcAddr = await wbtc.getAddress();
  const usdcAddr = await usdc.getAddress();
  const pool = await ethers.deployContract("Pool", [wbtcAddr, usdcAddr]);
  const poolAddr = await pool.getAddress();
  const feed = await ethers.deployContract("MockAggregator", [8, FEED_60K]);
  const guard = await ethers.deployContract("PriceGuard", [await feed.getAddress(), owner.address, DAY, 500n]);
  const book = await ethers.deployContract("OrderBook", [poolAddr, await guard.getAddress()]);
  const bookAddr = await book.getAddress();

  for (const who of [owner, alice, bob]) {
    await wbtc.mint(who.address, 1000n * BTC);
    await usdc.mint(who.address, 100_000_000n * USD);
    await wbtc.connect(who).approve(poolAddr, 2n ** 255n);
    await usdc.connect(who).approve(poolAddr, 2n ** 255n);
    await wbtc.connect(who).approve(bookAddr, 2n ** 255n);
  }
  await pool.addLiquidity(500n * BTC, 30_000_000n * USD, 0, 0, owner.address); // 60,000 USDC per WBTC
  return { owner, alice, bob, keeper, wbtc, usdc, pool, feed, guard, book, wbtcAddr, usdcAddr, bookAddr, poolAddr };
}

type Fx = Awaited<ReturnType<typeof fixture>>;

// Waits one interval, refreshes the feed (it would go stale otherwise) and runs one slice.
async function runSlice(f: Fx, id: bigint, who = f.keeper) {
  await networkHelpers.time.increase(INTERVAL);
  await f.feed.setAnswer(FEED_60K);
  return f.book.connect(who).executeSlice(id);
}

async function orderOf(f: Fx, totalIn = 10n * BTC, slices = 5, tol = 500) {
  await f.book.connect(f.alice).createOrder(totalIn, slices, INTERVAL, tol);
  return 1n;
}

describe("OrderBook", function () {
  describe("createOrder", function () {
    it("pulls the tokens, mints the NFT to the seller and stores the schedule", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      const before = await f.wbtc.balanceOf(f.alice.address);
      const tx = f.book.connect(f.alice).createOrder(10n * BTC, 5, INTERVAL, 300);
      await expect(tx)
        .to.emit(f.book, "OrderCreated")
        .withArgs(1n, f.alice.address, 10n * BTC, 5n, INTERVAL, 300n);
      const created = BigInt(await networkHelpers.time.latest());

      expect(await f.wbtc.balanceOf(f.alice.address)).to.equal(before - 10n * BTC);
      expect(await f.wbtc.balanceOf(f.bookAddr)).to.equal(10n * BTC);
      expect(await f.book.ownerOf(1n)).to.equal(f.alice.address);
      expect(await f.book.nextOrderId()).to.equal(2n);
      const o = await f.book.getOrder(1n);
      expect(o.remainingIn).to.equal(10n * BTC);
      expect(o.proceeds).to.equal(0n);
      expect(o.sliceSize).to.equal(2n * BTC);
      expect(o.slicesLeft).to.equal(5n);
      expect(o.interval).to.equal(INTERVAL);
      expect(o.nextExecution).to.equal(created + INTERVAL);
      expect(o.toleranceBps).to.equal(300n);
    });

    it("rejects invalid parameters", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      const create = (...a: [bigint, number, bigint, number]) => f.book.connect(f.alice).createOrder(...a);
      const bad = (p: Promise<unknown>) => expect(p).to.be.revertedWithCustomError(f.book, "InvalidParams");
      await bad(create(0n, 5, INTERVAL, 300));
      await bad(create(10n * BTC, 0, INTERVAL, 300));
      await bad(create(10n * BTC, 201, INTERVAL, 300));
      await bad(create(4n, 5, INTERVAL, 300)); // fewer raw units than slices
      await bad(create(10n * BTC, 5, 0n, 300));
      await bad(create(10n * BTC, 5, INTERVAL, 1001));
      await bad(create(2n ** 128n, 5, INTERVAL, 300));
      await bad(create(2n ** 100n, 1, INTERVAL, 300)); // slice size above the 96-bit storage field
      await create(10n * BTC, 200, INTERVAL, 1000); // the limits themselves are fine
    });

    it("needs a prior approval", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      await f.wbtc.connect(f.alice).approve(f.bookAddr, 0);
      await expect(f.book.connect(f.alice).createOrder(BTC, 5, INTERVAL, 300)).to.be.revertedWithCustomError(
        f.wbtc,
        "ERC20InsufficientAllowance",
      );
    });
  });

  describe("lifecycle", function () {
    it("sells in equal slices, gives the last slice the rounding dust, and pays out exactly", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      const total = 10n * BTC + 3n; // 3 raw units do not divide by 5
      const slice = total / 5n;
      const amounts = [slice, slice, slice, slice, total - 4n * slice];
      expect(amounts[4]).to.equal(slice + 3n);
      const { outs, r0, r1 } = simulate(amounts, 500n * BTC, 30_000_000n * USD);
      await f.book.connect(f.alice).createOrder(total, 5, INTERVAL, 500);

      for (let i = 0; i < 5; i++) {
        await expect(runSlice(f, 1n))
          .to.emit(f.book, "SliceExecuted")
          .withArgs(1n, amounts[i], outs[i], BigInt(4 - i));
      }
      const o = await f.book.getOrder(1n);
      expect(o.remainingIn).to.equal(0n);
      expect(o.slicesLeft).to.equal(0n);
      expect(o.proceeds).to.equal(outs.reduce((s, x) => s + x, 0n));
      expect(await f.wbtc.balanceOf(f.bookAddr)).to.equal(0n); // no dust stranded
      expect(await f.wbtc.allowance(f.bookAddr, f.poolAddr)).to.equal(0n);
      const [pr0, pr1] = await f.pool.getReserves();
      expect([pr0, pr1]).to.deep.equal([r0, r1]);

      await expect(runSlice(f, 1n)).to.be.revertedWithCustomError(f.book, "OrderFinished");

      const before = await f.usdc.balanceOf(f.alice.address);
      await expect(f.book.connect(f.alice).claim(1n))
        .to.emit(f.book, "Claimed")
        .withArgs(1n, f.alice.address, o.proceeds);
      expect((await f.usdc.balanceOf(f.alice.address)) - before).to.equal(o.proceeds);
      expect(await f.usdc.balanceOf(f.bookAddr)).to.equal(0n);
      expect((await f.book.getOrder(1n)).proceeds).to.equal(0n);
      await expect(f.book.connect(f.alice).claim(1n)).to.be.revertedWithCustomError(f.book, "NothingToClaim");
    });

    it("lets anyone run slices and claim, always paying the order holder", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      await orderOf(f);
      await runSlice(f, 1n, f.bob);
      const o = await f.book.getOrder(1n);
      const bobUsdc = await f.usdc.balanceOf(f.bob.address);
      const aliceUsdc = await f.usdc.balanceOf(f.alice.address);
      await f.book.connect(f.bob).claim(1n);
      expect(await f.usdc.balanceOf(f.bob.address)).to.equal(bobUsdc);
      expect((await f.usdc.balanceOf(f.alice.address)) - aliceUsdc).to.equal(o.proceeds);
    });

    it("claims partial proceeds mid-order and keeps streaming", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      await orderOf(f);
      await runSlice(f, 1n);
      const first = (await f.book.getOrder(1n)).proceeds;
      await f.book.claim(1n);
      await runSlice(f, 1n);
      const o = await f.book.getOrder(1n);
      expect(o.slicesLeft).to.equal(3n);
      expect(o.proceeds).to.be.greaterThan(0n);
      expect(o.proceeds).to.not.equal(first);
    });

    it("reverts for an order that does not exist", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      await expect(f.book.executeSlice(7n)).to.be.revertedWithCustomError(f.book, "ERC721NonexistentToken");
      await expect(f.book.getOrder(7n)).to.be.revertedWithCustomError(f.book, "ERC721NonexistentToken");
      await expect(f.book.claim(7n)).to.be.revertedWithCustomError(f.book, "ERC721NonexistentToken");
    });
  });

  describe("timing", function () {
    it("reverts when the slice is too early and works exactly at the due time", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      await orderOf(f);
      const due = (await f.book.getOrder(1n)).nextExecution;
      await expect(f.book.executeSlice(1n)).to.be.revertedWithCustomError(f.book, "TooEarly").withArgs(due);

      await networkHelpers.time.setNextBlockTimestamp(due - 1n);
      await expect(f.book.executeSlice(1n)).to.be.revertedWithCustomError(f.book, "TooEarly");
      await f.feed.setAnswer(FEED_60K);
      await networkHelpers.time.setNextBlockTimestamp(due);
      await f.book.executeSlice(1n);

      // the next slice is due one interval after the one that just ran, not earlier
      const next = (await f.book.getOrder(1n)).nextExecution;
      expect(next).to.equal(due + INTERVAL);
      await expect(f.book.executeSlice(1n)).to.be.revertedWithCustomError(f.book, "TooEarly").withArgs(next);
    });

    it("schedules from the actual execution time when the keeper is late", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      await orderOf(f);
      await networkHelpers.time.increase(INTERVAL * 10n);
      await f.feed.setAnswer(FEED_60K);
      await f.book.executeSlice(1n);
      const now = BigInt(await networkHelpers.time.latest());
      expect((await f.book.getOrder(1n)).nextExecution).to.equal(now + INTERVAL);
    });
  });

  describe("price guard", function () {
    it("reverts on a stale feed and moves no tokens", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      await orderOf(f);
      await networkHelpers.time.increase(INTERVAL);
      await f.feed.setAnswer(FEED_60K);
      await networkHelpers.time.increase(DAY + 1n); // feed now older than maxStaleness
      await expect(f.book.executeSlice(1n)).to.be.revertedWithCustomError(f.guard, "StalePrice");
      expect((await f.book.getOrder(1n)).slicesLeft).to.equal(5n);
      expect(await f.wbtc.balanceOf(f.bookAddr)).to.equal(10n * BTC);
    });

    it("reverts on a zero or negative oracle price", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      await orderOf(f);
      await networkHelpers.time.increase(INTERVAL);
      await f.feed.setAnswer(0);
      await expect(f.book.executeSlice(1n)).to.be.revertedWithCustomError(f.guard, "InvalidPrice");
      await f.feed.setAnswer(-1);
      await expect(f.book.executeSlice(1n)).to.be.revertedWithCustomError(f.guard, "InvalidPrice");
    });

    it("skips with an event when the pool is out of bounds, then runs once the pool recovers", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      await orderOf(f);
      // bob dumps 50 WBTC: pool price falls about 17%, far beyond the 5% limit
      await f.pool.connect(f.bob).swapExactIn(f.wbtcAddr, 50n * BTC, 0, f.bob.address);
      const poolPrice = await f.pool.spotPriceE18();

      await networkHelpers.time.increase(INTERVAL);
      await f.feed.setAnswer(FEED_60K);
      await expect(f.book.executeSlice(1n))
        .to.emit(f.book, "SliceSkipped")
        .withArgs(1n, poolPrice, 60_000n * E18);
      const o = await f.book.getOrder(1n);
      expect(o.slicesLeft).to.equal(5n);
      expect(o.remainingIn).to.equal(10n * BTC);
      expect(o.proceeds).to.equal(0n);
      expect(await f.wbtc.balanceOf(f.bookAddr)).to.equal(10n * BTC);
      const now = BigInt(await networkHelpers.time.latest());
      expect(o.nextExecution).to.equal(now + INTERVAL); // a skip is rate limited like a slice
      await expect(f.book.executeSlice(1n)).to.be.revertedWithCustomError(f.book, "TooEarly");

      // an arbitrageur buys WBTC back and restores the price
      await f.pool.connect(f.bob).swapExactIn(f.usdcAddr, 3_000_000n * USD, 0, f.bob.address);
      expect(await f.guard.poolWithinBounds(await f.pool.spotPriceE18())).to.equal(true);
      await expect(runSlice(f, 1n)).to.emit(f.book, "SliceExecuted");
    });

    it("also skips when the oracle moves away from the pool", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      await orderOf(f);
      await networkHelpers.time.increase(INTERVAL);
      await f.feed.setAnswer(70_000n * 10n ** 8n);
      await expect(f.book.executeSlice(1n)).to.emit(f.book, "SliceSkipped");
    });

    it("derives minAmountOut from the oracle and the tolerance", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      // zero tolerance cannot cover the 30 bps pool fee
      await f.book.connect(f.alice).createOrder(10n * BTC, 5, INTERVAL, 0);
      await networkHelpers.time.increase(INTERVAL);
      await f.feed.setAnswer(FEED_60K);
      await expect(f.book.executeSlice(1n)).to.be.revertedWithCustomError(f.pool, "SlippageExceeded");

      // Hand-computed boundary: first slice is 2 BTC, the pool pays 117,... USDC raw; oracle quote is 120,000 USDC
      const out = amountOut(2n * BTC, 500n * BTC, 30_000_000n * USD);
      const oracleQuote = 120_000n * USD;
      const tolNeeded = ((oracleQuote - out) * 10_000n + oracleQuote - 1n) / oracleQuote; // ceil in bps
      await f.book.connect(f.alice).createOrder(10n * BTC, 5, INTERVAL, Number(tolNeeded - 1n));
      await f.book.connect(f.alice).createOrder(10n * BTC, 5, INTERVAL, Number(tolNeeded));
      await networkHelpers.time.increase(INTERVAL);
      await f.feed.setAnswer(FEED_60K);
      await expect(f.book.executeSlice(2n)).to.be.revertedWithCustomError(f.pool, "SlippageExceeded");
      await expect(f.book.executeSlice(3n))
        .to.emit(f.book, "SliceExecuted")
        .withArgs(3n, 2n * BTC, out, 4n);
    });
  });

  describe("NFT ownership", function () {
    it("pays proceeds to the new holder after a transfer", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      await orderOf(f);
      await runSlice(f, 1n);
      await runSlice(f, 1n);
      const proceeds = (await f.book.getOrder(1n)).proceeds;
      await f.book.connect(f.alice).transferFrom(f.alice.address, f.bob.address, 1n);

      const aliceBefore = await f.usdc.balanceOf(f.alice.address);
      const bobBefore = await f.usdc.balanceOf(f.bob.address);
      await expect(f.book.connect(f.keeper).claim(1n)).to.emit(f.book, "Claimed").withArgs(1n, f.bob.address, proceeds);
      expect(await f.usdc.balanceOf(f.alice.address)).to.equal(aliceBefore);
      expect((await f.usdc.balanceOf(f.bob.address)) - bobBefore).to.equal(proceeds);

      // the old holder lost control, the new holder can cancel and gets the unsold WBTC
      await expect(f.book.connect(f.alice).cancel(1n)).to.be.revertedWithCustomError(f.book, "NotOrderOwner");
      const wbtcBefore = await f.wbtc.balanceOf(f.bob.address);
      await f.book.connect(f.bob).cancel(1n);
      expect((await f.wbtc.balanceOf(f.bob.address)) - wbtcBefore).to.equal(6n * BTC);
    });

    it("lets slices keep streaming after the transfer and pays the new holder", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      await orderOf(f);
      await f.book.connect(f.alice).transferFrom(f.alice.address, f.bob.address, 1n);
      for (let i = 0; i < 5; i++) await runSlice(f, 1n);
      const proceeds = (await f.book.getOrder(1n)).proceeds;
      const before = await f.usdc.balanceOf(f.bob.address);
      await f.book.connect(f.bob).claim(1n);
      expect((await f.usdc.balanceOf(f.bob.address)) - before).to.equal(proceeds);
    });
  });

  describe("cancel", function () {
    it("refunds the unsold WBTC and pays unclaimed USDC, then burns the NFT", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      await orderOf(f);
      await runSlice(f, 1n);
      await runSlice(f, 1n);
      const o = await f.book.getOrder(1n);
      expect(o.remainingIn).to.equal(6n * BTC);

      const wbtcBefore = await f.wbtc.balanceOf(f.alice.address);
      const usdcBefore = await f.usdc.balanceOf(f.alice.address);
      await expect(f.book.connect(f.alice).cancel(1n))
        .to.emit(f.book, "Cancelled")
        .withArgs(1n, f.alice.address, 6n * BTC, o.proceeds);
      expect((await f.wbtc.balanceOf(f.alice.address)) - wbtcBefore).to.equal(6n * BTC);
      expect((await f.usdc.balanceOf(f.alice.address)) - usdcBefore).to.equal(o.proceeds);
      expect(await f.wbtc.balanceOf(f.bookAddr)).to.equal(0n);
      expect(await f.usdc.balanceOf(f.bookAddr)).to.equal(0n);

      await expect(f.book.ownerOf(1n)).to.be.revertedWithCustomError(f.book, "ERC721NonexistentToken");
      await expect(runSlice(f, 1n)).to.be.revertedWithCustomError(f.book, "ERC721NonexistentToken");
    });

    it("returns everything for an order that never ran", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      const before = await f.wbtc.balanceOf(f.alice.address);
      await orderOf(f);
      await f.book.connect(f.alice).cancel(1n);
      expect(await f.wbtc.balanceOf(f.alice.address)).to.equal(before);
    });

    it("only lets the holder cancel", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      await orderOf(f);
      await expect(f.book.connect(f.bob).cancel(1n)).to.be.revertedWithCustomError(f.book, "NotOrderOwner");
      await f.book.connect(f.alice).approve(f.bob.address, 1n); // approval is not ownership
      await expect(f.book.connect(f.bob).cancel(1n)).to.be.revertedWithCustomError(f.book, "NotOrderOwner");
    });

    it("acts as claim-and-burn on a finished order", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      await orderOf(f);
      for (let i = 0; i < 5; i++) await runSlice(f, 1n);
      const proceeds = (await f.book.getOrder(1n)).proceeds;
      await expect(f.book.connect(f.alice).cancel(1n))
        .to.emit(f.book, "Cancelled")
        .withArgs(1n, f.alice.address, 0n, proceeds);
    });
  });

  describe("reentrancy", function () {
    async function mockPoolFixture() {
      const f = await fixture();
      const mock = await ethers.deployContract("MockPool", [f.wbtcAddr, f.usdcAddr, 60_000n * E18]);
      const mockBook = await ethers.deployContract("OrderBook", [await mock.getAddress(), await f.guard.getAddress()]);
      await f.usdc.mint(await mock.getAddress(), 10_000_000n * USD);
      await f.wbtc.connect(f.alice).approve(await mockBook.getAddress(), 2n ** 255n);
      return { ...f, mock, mockBook };
    }

    for (const fn of ["executeSlice", "claim", "cancel"] as const) {
      it(`blocks ${fn} called from inside the pool swap`, async function () {
        const f = await networkHelpers.loadFixture(mockPoolFixture);
        await f.mockBook.connect(f.alice).createOrder(10n * BTC, 5, INTERVAL, 300);
        await f.mock.setAttack(
          await f.mockBook.getAddress(),
          new ethers.Interface(ATTACKS).encodeFunctionData(fn, [1n]),
        );
        await networkHelpers.time.increase(INTERVAL);
        await f.feed.setAnswer(FEED_60K);
        await f.mockBook.executeSlice(1n);

        expect(await f.mock.attackSucceeded()).to.equal(false);
        expect((await f.mock.attackRevertData()).slice(0, 10)).to.equal(REENTRANCY_SELECTOR);
        const o = await f.mockBook.getOrder(1n);
        expect(o.slicesLeft).to.equal(4n);
        expect(o.remainingIn).to.equal(8n * BTC);
        expect(o.proceeds).to.equal((2n * 120_000n * USD) / 2n); // 2 BTC at 60,000, no fee, no impact
      });
    }

    it("blocks cancel called from the onERC721Received hook during createOrder", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      const rx = await ethers.deployContract("ReentrantReceiver");
      const rxAddr = await rx.getAddress();
      await f.wbtc.mint(rxAddr, 10n * BTC);
      await rx.setAttack(f.bookAddr, new ethers.Interface(ATTACKS).encodeFunctionData("cancel", [1n]));
      await rx.approveAndCreate(f.wbtcAddr, f.bookAddr, 10n * BTC, 5, INTERVAL, 300);

      expect(await rx.attacked()).to.equal(true);
      expect(await rx.attackSucceeded()).to.equal(false);
      expect((await rx.attackRevertData()).slice(0, 10)).to.equal(REENTRANCY_SELECTOR);
      expect(await f.book.ownerOf(1n)).to.equal(rxAddr);
      expect(await f.wbtc.balanceOf(f.bookAddr)).to.equal(10n * BTC);
    });
  });
});
