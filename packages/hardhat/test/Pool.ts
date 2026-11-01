import { expect } from "chai";
import { network } from "hardhat";

const { networkHelpers, ethers } = await network.create();

const BTC = 10n ** 8n;
const USD = 10n ** 6n;
const E18 = 10n ** 18n;
const BPS = 10_000n;
const MIN_LIQ = 1000n;

// Reference values below were computed independently in Python (integer maths, same formulas as the notebook
// `docs/analysis_pool.ipynb`), not by calling the contract.
const FIRST_SHARES = 1_224_744_870_391n; // isqrt(500e8 * 30_000_000e6) - 1000
const SELL_1_BTC = 59_700_956_293n; // raw USDC for 1e8 raw WBTC into the 500 / 30M pool
const SELL_50_BTC = 2_719_832_681_640n;
const SELL_60K_USDC = 99_501_593n; // raw WBTC for 60,000e6 raw USDC
const P0 = 60_000n * E18;
const P_A = 49_600_304_215_200_000_000_000n; // after bob sells 50 WBTC
const P_B = 61_091_068_341_502_692_381_849n; // after bob then buys WBTC with 3,000,000 USDC
const TWAP_500 = 56_276_549_022_681_076_952_739n;
const TWAP_400 = 55_345_686_278_351_346_190_924n;
const TWAP_250 = 58_792_915_516_242_153_905_479n;

const sqrt = (n: bigint) => {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
};
const amountOut = (a: bigint, rIn: bigint, rOut: bigint) => {
  const w = a * (BPS - 30n);
  return (w * rOut) / (rIn * BPS + w);
};

async function fixture() {
  const [owner, alice, bob] = await ethers.getSigners();
  const wbtc = await ethers.deployContract("MockWBTC", [owner.address]);
  const usdc = await ethers.deployContract("MockUSDC", [owner.address]);
  const pool = await ethers.deployContract("Pool", [await wbtc.getAddress(), await usdc.getAddress()]);
  const poolAddr = await pool.getAddress();
  for (const [who, btc, usd] of [
    [alice, 1000n * BTC, 100_000_000n * USD],
    [bob, 1000n * BTC, 100_000_000n * USD],
  ] as const) {
    await wbtc.mint(who.address, btc);
    await usdc.mint(who.address, usd);
    await wbtc.connect(who).approve(poolAddr, 2n ** 255n);
    await usdc.connect(who).approve(poolAddr, 2n ** 255n);
  }
  return { owner, alice, bob, wbtc, usdc, pool, poolAddr, wbtcAddr: await wbtc.getAddress(), usdcAddr: await usdc.getAddress() };
}

async function seeded() {
  const f = await fixture();
  await f.pool.connect(f.alice).addLiquidity(500n * BTC, 30_000_000n * USD, 0, 0, f.alice.address);
  return f;
}

describe("Pool", function () {
  describe("liquidity", function () {
    it("first deposit mints sqrt(a*b) minus the locked minimum and prices the pool", async function () {
      const { pool, alice } = await networkHelpers.loadFixture(fixture);
      await expect(pool.connect(alice).addLiquidity(500n * BTC, 30_000_000n * USD, 0, 0, alice.address))
        .to.emit(pool, "LiquidityAdded")
        .withArgs(alice.address, 500n * BTC, 30_000_000n * USD, FIRST_SHARES, alice.address);
      expect(FIRST_SHARES).to.equal(sqrt(500n * BTC * 30_000_000n * USD) - MIN_LIQ);
      expect(await pool.balanceOf(alice.address)).to.equal(FIRST_SHARES);
      expect(await pool.balanceOf("0x000000000000000000000000000000000000dEaD")).to.equal(MIN_LIQ);
      expect(await pool.totalSupply()).to.equal(FIRST_SHARES + MIN_LIQ);
      const [r0, r1] = await pool.getReserves();
      expect([r0, r1]).to.deep.equal([500n * BTC, 30_000_000n * USD]);
      expect(await pool.spotPriceE18()).to.equal(P0);
    });

    it("rejects a first deposit too small to cover the locked minimum", async function () {
      const { pool, alice } = await networkHelpers.loadFixture(fixture);
      await expect(pool.connect(alice).addLiquidity(1000n, 1000n, 0, 0, alice.address)).to.be.revertedWithCustomError(
        pool,
        "InsufficientLiquidityMinted",
      );
    });

    it("add then remove all shares returns the deposit minus only rounding and the locked minimum", async function () {
      const { pool, alice, wbtc, usdc } = await networkHelpers.loadFixture(seeded);
      const b0 = await wbtc.balanceOf(alice.address);
      const b1 = await usdc.balanceOf(alice.address);
      const shares = await pool.balanceOf(alice.address);
      const supply = await pool.totalSupply();
      await pool.connect(alice).removeLiquidity(shares, 0, 0, alice.address);
      const got0 = (await wbtc.balanceOf(alice.address)) - b0;
      const got1 = (await usdc.balanceOf(alice.address)) - b1;
      expect(got0).to.equal((shares * 500n * BTC) / supply);
      expect(got1).to.equal((shares * 30_000_000n * USD) / supply);
      // The locked 1000 shares keep a sliver: alice gets back at least 99.9999% of what she put in.
      expect(got0).to.be.lessThan(500n * BTC);
      expect(got0 * 1_000_000n).to.be.greaterThan(500n * BTC * 999_999n);
      expect(got1 * 1_000_000n).to.be.greaterThan(30_000_000n * USD * 999_999n);
      expect(await pool.balanceOf(alice.address)).to.equal(0n);
    });

    it("a second LP depositing at the pool ratio gets proportional shares and can exit with at most rounding loss", async function () {
      const { pool, bob, wbtc, usdc } = await networkHelpers.loadFixture(seeded);
      const supply = await pool.totalSupply();
      const d0 = 50n * BTC;
      const d1 = 3_000_000n * USD;
      const b0 = await wbtc.balanceOf(bob.address);
      const b1 = await usdc.balanceOf(bob.address);
      await pool.connect(bob).addLiquidity(d0, d1, d0, d1, bob.address);
      const shares = await pool.balanceOf(bob.address);
      expect(shares).to.equal((d0 * supply) / (500n * BTC));
      await pool.connect(bob).removeLiquidity(shares, 0, 0, bob.address);
      // Flooring the shares loses less than one share's worth of each token (reserve / supply, rounded up),
      // and flooring the withdrawal loses at most one more raw unit.
      const bound0 = (500n * BTC + supply - 1n) / supply + 1n;
      const bound1 = (30_000_000n * USD + supply - 1n) / supply + 1n;
      expect(b0 - (await wbtc.balanceOf(bob.address))).to.be.within(0n, bound0);
      expect(b1 - (await usdc.balanceOf(bob.address))).to.be.within(0n, bound1);
    });

    it("takes only the amounts that match the pool ratio and enforces the minimums", async function () {
      const { pool, bob, usdc, wbtc } = await networkHelpers.loadFixture(seeded);
      const u0 = await usdc.balanceOf(bob.address);
      // Offer 10 WBTC but 9,000,000 USDC: only 600,000 USDC matches 10 WBTC at 60,000.
      await pool.connect(bob).addLiquidity(10n * BTC, 9_000_000n * USD, 10n * BTC, 600_000n * USD, bob.address);
      expect(u0 - (await usdc.balanceOf(bob.address))).to.equal(600_000n * USD);
      await expect(pool.connect(bob).addLiquidity(10n * BTC, 9_000_000n * USD, 10n * BTC, 600_001n * USD, bob.address))
        .to.be.revertedWithCustomError(pool, "SlippageExceeded")
        .withArgs(600_000n * USD, 600_001n * USD);
      void wbtc;
    });

    it("removeLiquidity enforces minimum outputs", async function () {
      const { pool, alice } = await networkHelpers.loadFixture(seeded);
      const shares = await pool.balanceOf(alice.address);
      const supply = await pool.totalSupply();
      const exp0 = (shares * 500n * BTC) / supply;
      await expect(pool.connect(alice).removeLiquidity(shares, exp0 + 1n, 0, alice.address))
        .to.be.revertedWithCustomError(pool, "SlippageExceeded")
        .withArgs(exp0, exp0 + 1n);
    });

    it("reverts on zero amounts", async function () {
      const { pool, alice } = await networkHelpers.loadFixture(seeded);
      await expect(pool.connect(alice).addLiquidity(0, 1n, 0, 0, alice.address)).to.be.revertedWithCustomError(pool, "ZeroAmount");
      await expect(pool.connect(alice).addLiquidity(1n, 0, 0, 0, alice.address)).to.be.revertedWithCustomError(pool, "ZeroAmount");
      await expect(pool.connect(alice).removeLiquidity(0, 0, 0, alice.address)).to.be.revertedWithCustomError(pool, "ZeroAmount");
    });
  });

  describe("swapExactIn", function () {
    it("selling 1 WBTC returns the hand-computed amount and moves the reserves", async function () {
      const { pool, bob, wbtc, usdc, wbtcAddr } = await networkHelpers.loadFixture(seeded);
      expect(await pool.getAmountOut(wbtcAddr, BTC)).to.equal(SELL_1_BTC);
      const u0 = await usdc.balanceOf(bob.address);
      const w0 = await wbtc.balanceOf(bob.address);
      await expect(pool.connect(bob).swapExactIn(wbtcAddr, BTC, SELL_1_BTC, bob.address))
        .to.emit(pool, "Swap")
        .withArgs(bob.address, wbtcAddr, BTC, SELL_1_BTC, bob.address);
      expect((await usdc.balanceOf(bob.address)) - u0).to.equal(SELL_1_BTC);
      expect(w0 - (await wbtc.balanceOf(bob.address))).to.equal(BTC);
      const [r0, r1] = await pool.getReserves();
      expect([r0, r1]).to.deep.equal([501n * BTC, 30_000_000n * USD - SELL_1_BTC]);
    });

    it("matches the hand-computed values for a large sell and for the reverse direction", async function () {
      const { pool, bob, wbtcAddr, usdcAddr } = await networkHelpers.loadFixture(seeded);
      expect(await pool.getAmountOut(wbtcAddr, 50n * BTC)).to.equal(SELL_50_BTC);
      expect(await pool.getAmountOut(usdcAddr, 60_000n * USD)).to.equal(SELL_60K_USDC);
      await pool.connect(bob).swapExactIn(usdcAddr, 60_000n * USD, SELL_60K_USDC, bob.address);
    });

    it("keeps the fee in the pool so k strictly grows", async function () {
      const { pool, bob, wbtcAddr } = await networkHelpers.loadFixture(seeded);
      const [a0, a1] = await pool.getReserves();
      await pool.connect(bob).swapExactIn(wbtcAddr, 5n * BTC, 0, bob.address);
      const [b0, b1] = await pool.getReserves();
      expect(b0 * b1).to.be.greaterThan(a0 * a1);
    });

    it("reverts when the output is below minAmountOut and passes when it equals it", async function () {
      const { pool, bob, wbtcAddr } = await networkHelpers.loadFixture(seeded);
      await expect(pool.connect(bob).swapExactIn(wbtcAddr, BTC, SELL_1_BTC + 1n, bob.address))
        .to.be.revertedWithCustomError(pool, "SlippageExceeded")
        .withArgs(SELL_1_BTC, SELL_1_BTC + 1n);
      await pool.connect(bob).swapExactIn(wbtcAddr, BTC, SELL_1_BTC, bob.address);
    });

    it("reverts when a prior trade moved the price against the caller", async function () {
      const { pool, alice, bob, wbtcAddr } = await networkHelpers.loadFixture(seeded);
      await pool.connect(alice).swapExactIn(wbtcAddr, 100n * BTC, 0, alice.address); // front-run
      await expect(pool.connect(bob).swapExactIn(wbtcAddr, BTC, SELL_1_BTC, bob.address)).to.be.revertedWithCustomError(
        pool,
        "SlippageExceeded",
      );
    });

    it("reverts on a zero amount, an unknown token and an empty pool", async function () {
      const { pool, bob, wbtcAddr, usdc } = await networkHelpers.loadFixture(seeded);
      await expect(pool.connect(bob).swapExactIn(wbtcAddr, 0, 0, bob.address)).to.be.revertedWithCustomError(pool, "ZeroAmount");
      await expect(pool.connect(bob).swapExactIn(bob.address, 1n, 0, bob.address)).to.be.revertedWithCustomError(pool, "InvalidToken");
      const empty = await networkHelpers.loadFixture(fixture);
      await expect(empty.pool.connect(empty.bob).swapExactIn(empty.wbtcAddr, 1n, 0, empty.bob.address)).to.be.revertedWithCustomError(
        empty.pool,
        "InsufficientLiquidity",
      );
      void usdc;
    });

    it("reverts when the output would round to zero", async function () {
      const { pool, bob, usdcAddr } = await networkHelpers.loadFixture(seeded);
      // 1 raw USDC buys less than 1 raw WBTC at 60,000 USDC/BTC.
      await expect(pool.connect(bob).swapExactIn(usdcAddr, 1n, 0, bob.address)).to.be.revertedWithCustomError(pool, "InsufficientLiquidity");
    });
  });

  describe("invariants (seeded fuzz)", function () {
    it("k never decreases across random swaps and pool balances always equal reserves", async function () {
      const { pool, poolAddr, alice, bob, wbtc, usdc, wbtcAddr, usdcAddr } = await networkHelpers.loadFixture(seeded);
      let seed = 0x9e3779b97f4a7c15n;
      const rand = (max: bigint) => {
        seed ^= (seed << 13n) & 0xffffffffffffffffn;
        seed ^= seed >> 7n;
        seed ^= (seed << 17n) & 0xffffffffffffffffn;
        return seed % max;
      };
      let swaps = 0;
      for (let i = 0; i < 250; i++) {
        const [r0, r1] = await pool.getReserves();
        const kBefore = r0 * r1;
        const kind = rand(10n);
        if (kind < 8n) {
          const sellBtc = rand(2n) === 0n;
          const reserveIn = sellBtc ? r0 : r1;
          const amount = 1n + rand((reserveIn * 30n) / 100n); // up to 30% of the input reserve
          const tokenIn = sellBtc ? wbtcAddr : usdcAddr;
          const quote = await pool.getAmountOut(tokenIn, amount).catch(() => 0n);
          if (quote === 0n) continue; // dust trade that rounds to zero is rejected by design
          await pool.connect(bob).swapExactIn(tokenIn, amount, quote, bob.address);
          swaps++;
          const [n0, n1] = await pool.getReserves();
          expect(n0 * n1, `k fell on swap ${i}`).to.be.greaterThanOrEqual(kBefore);
        } else if (kind === 8n) {
          const d0 = 1n + rand(r0 / 4n);
          await pool.connect(alice).addLiquidity(d0, (d0 * r1) / r0 + 1n, 0, 0, alice.address);
        } else {
          const s = (await pool.balanceOf(alice.address)) / (2n + rand(5n));
          if (s > 0n) await pool.connect(alice).removeLiquidity(s, 0, 0, alice.address).catch(() => undefined);
        }
        const [c0, c1] = await pool.getReserves();
        expect(await wbtc.balanceOf(poolAddr), `btc balance != reserve at ${i}`).to.equal(c0);
        expect(await usdc.balanceOf(poolAddr), `usdc balance != reserve at ${i}`).to.equal(c1);
      }
      expect(swaps).to.be.greaterThan(100);
    });

    it("every swap output equals the independent integer model", async function () {
      const { pool, bob, wbtcAddr } = await networkHelpers.loadFixture(seeded);
      let r0 = 500n * BTC;
      let r1 = 30_000_000n * USD;
      for (const amt of [1n, 12_345n, BTC / 3n, 7n * BTC, 40n * BTC]) {
        const exp = amountOut(amt, r0, r1);
        if (exp === 0n) continue;
        await pool.connect(bob).swapExactIn(wbtcAddr, amt, exp, bob.address);
        r0 += amt;
        r1 -= exp;
        const [g0, g1] = await pool.getReserves();
        expect([g0, g1]).to.deep.equal([r0, r1]);
      }
    });
  });

  describe("TWAP", function () {
    async function scenario() {
      const f = await fixture();
      const T = (await networkHelpers.time.latest()) + 1000;
      const at = async (t: number) => networkHelpers.time.setNextBlockTimestamp(t);
      await at(T);
      await f.pool.connect(f.alice).addLiquidity(500n * BTC, 30_000_000n * USD, 0, 0, f.alice.address);
      await at(T + 100);
      await f.pool.connect(f.bob).swapExactIn(f.wbtcAddr, 50n * BTC, 0, f.bob.address); // price drops to P_A
      await at(T + 300);
      await f.pool.connect(f.bob).swapExactIn(f.usdcAddr, 3_000_000n * USD, 0, f.bob.address); // price rises to P_B
      await at(T + 500);
      await networkHelpers.mine();
      return { ...f, T };
    }

    it("spot price follows the reserves", async function () {
      const { pool } = await networkHelpers.loadFixture(scenario);
      expect(await pool.spotPriceE18()).to.equal(P_B);
    });

    it("full-history window averages all three price levels by time", async function () {
      const { pool } = await networkHelpers.loadFixture(scenario);
      expect(await pool.consultTwapE18(500)).to.equal(TWAP_500); // (P0*100 + P_A*200 + P_B*200) / 500
    });

    it("a window starting on an observation averages the later two levels", async function () {
      const { pool } = await networkHelpers.loadFixture(scenario);
      expect(await pool.consultTwapE18(400)).to.equal(TWAP_400); // (P_A*200 + P_B*200) / 400
    });

    it("a window starting between observations is interpolated, not snapped", async function () {
      const { pool } = await networkHelpers.loadFixture(scenario);
      expect(await pool.consultTwapE18(250)).to.equal(TWAP_250); // (P_A*50 + P_B*200) / 250
    });

    it("a window inside the latest price level returns that spot price", async function () {
      const { pool } = await networkHelpers.loadFixture(scenario);
      expect(await pool.consultTwapE18(100)).to.equal(P_B);
    });

    it("differs from spot, so it is really time-weighted", async function () {
      const { pool } = await networkHelpers.loadFixture(scenario);
      const twap = await pool.consultTwapE18(500);
      expect(twap).to.not.equal(await pool.spotPriceE18());
      expect(twap).to.be.lessThan(P0);
      expect(twap).to.be.greaterThan(P_A);
    });

    it("reverts with InsufficientHistory when the window is longer than the pool's life, and on a zero window", async function () {
      const { pool } = await networkHelpers.loadFixture(scenario);
      await expect(pool.consultTwapE18(501)).to.be.revertedWithCustomError(pool, "InsufficientHistory");
      await expect(pool.consultTwapE18(0)).to.be.revertedWithCustomError(pool, "ZeroAmount");
      const fresh = await networkHelpers.loadFixture(fixture);
      await expect(fresh.pool.consultTwapE18(60)).to.be.revertedWithCustomError(fresh.pool, "InsufficientHistory");
    });

    it("one swap after a quiet period: the old price counts for exactly the quiet time", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      const T = (await networkHelpers.time.latest()) + 1000;
      await networkHelpers.time.setNextBlockTimestamp(T);
      await f.pool.connect(f.alice).addLiquidity(500n * BTC, 30_000_000n * USD, 0, 0, f.alice.address);
      await networkHelpers.time.setNextBlockTimestamp(T + 100);
      await f.pool.connect(f.bob).swapExactIn(f.wbtcAddr, BTC, 0, f.bob.address);
      await networkHelpers.time.setNextBlockTimestamp(T + 200);
      await networkHelpers.mine();
      // Price was P0 for the first 100s (nothing changed it before the swap), then the post-swap price.
      const spot = await f.pool.spotPriceE18();
      expect(await f.pool.consultTwapE18(200)).to.equal((P0 * 100n + spot * 100n) / 200n);
    });
  });
});
