import { expect } from "chai";
import { network } from "hardhat";

const { networkHelpers, ethers } = await network.create();

const E18 = 10n ** 18n;
const ONE_HOUR = 3600n;
const FEED_ANSWER = 6_000_012_345_678n; // 60,000.12345678 USD with 8 feed decimals
const ORACLE_E18 = 60_000_123_456_780_000_000_000n; // the same price scaled to 1e18, worked out by hand

async function fixture() {
  const [owner, alice] = await ethers.getSigners();
  const feed = await ethers.deployContract("MockAggregator", [8, FEED_ANSWER]);
  const guard = await ethers.deployContract("PriceGuard", [await feed.getAddress(), owner.address, ONE_HOUR, 500n]);
  const math = await ethers.deployContract("PriceMathHarness");
  return { owner, alice, feed, guard, math };
}

describe("PriceMath", function () {
  it("scales feed answers of any decimals to 1e18", async function () {
    const { math } = await networkHelpers.loadFixture(fixture);
    expect(await math.feedToE18(FEED_ANSWER, 8)).to.equal(ORACLE_E18);
    expect(await math.feedToE18(60_000n * 10n ** 18n, 18)).to.equal(60_000n * E18);
    expect(await math.feedToE18(1n, 0)).to.equal(E18);
    // 20 decimals divides and rounds down
    expect(await math.feedToE18(60_000n * 10n ** 20n + 99n, 20)).to.equal(60_000n * E18);
  });

  it("quotes raw WBTC (8) into raw USDC (6)", async function () {
    const { math } = await networkHelpers.loadFixture(fixture);
    const p = 60_000n * E18;
    expect(await math.quoteRaw(10n ** 8n, p, 8, 6)).to.equal(60_000n * 10n ** 6n); // 1 WBTC -> 60,000 USDC
    expect(await math.quoteRaw(5n * 10n ** 7n, p, 8, 6)).to.equal(30_000n * 10n ** 6n); // 0.5 WBTC
    expect(await math.quoteRaw(1n, p, 8, 6)).to.equal(600n); // 1 satoshi = 0.0006 USDC = 600 raw
    expect(await math.quoteRaw(1n, 1n, 8, 6)).to.equal(0n); // rounds down
    // 2.5 WBTC at 60,000.12345678 = 150,000.30864195 USDC, floored to 6 decimals
    expect(await math.quoteRaw(250_000_000n, ORACLE_E18, 8, 6)).to.equal(150_000_308_641n);
  });
});

describe("PriceGuard", function () {
  describe("oracle price", function () {
    it("returns USDC per whole WBTC scaled to 1e18", async function () {
      const { guard } = await networkHelpers.loadFixture(fixture);
      expect(await guard.getOraclePrice()).to.equal(ORACLE_E18);
      expect(await guard.feedDecimals()).to.equal(8n);
    });

    it("reverts on a zero price", async function () {
      const { guard, feed } = await networkHelpers.loadFixture(fixture);
      await feed.setAnswer(0);
      await expect(guard.getOraclePrice()).to.be.revertedWithCustomError(guard, "InvalidPrice").withArgs(0n);
    });

    it("reverts on a negative price", async function () {
      const { guard, feed } = await networkHelpers.loadFixture(fixture);
      await feed.setAnswer(-5);
      await expect(guard.getOraclePrice()).to.be.revertedWithCustomError(guard, "InvalidPrice").withArgs(-5n);
    });

    it("reverts when the feed is stale and accepts it right at the limit", async function () {
      const { guard, feed } = await networkHelpers.loadFixture(fixture);
      await feed.setAnswer(FEED_ANSWER);
      const [, , , updatedAt] = await feed.latestRoundData();
      await networkHelpers.time.setNextBlockTimestamp(updatedAt + ONE_HOUR);
      await networkHelpers.mine();
      expect(await guard.getOraclePrice()).to.equal(ORACLE_E18); // age == maxStaleness is fine
      await networkHelpers.mine(1, { interval: 1 });
      await expect(guard.getOraclePrice())
        .to.be.revertedWithCustomError(guard, "StalePrice")
        .withArgs(updatedAt, ONE_HOUR);
    });

    it("reverts when the round has no timestamp or is dated in the future", async function () {
      const { guard, feed } = await networkHelpers.loadFixture(fixture);
      await feed.setRoundData(2, FEED_ANSWER, 0, 0, 2);
      await expect(guard.getOraclePrice()).to.be.revertedWithCustomError(guard, "StalePrice");
      const now = BigInt(await networkHelpers.time.latest());
      await feed.setRoundData(3, FEED_ANSWER, now, now + 1000n, 3);
      await expect(guard.getOraclePrice()).to.be.revertedWithCustomError(guard, "StalePrice");
    });

    it("reverts when answeredInRound is behind roundId", async function () {
      const { guard, feed } = await networkHelpers.loadFixture(fixture);
      const now = BigInt(await networkHelpers.time.latest());
      await feed.setRoundData(10, FEED_ANSWER, now, now, 9);
      await expect(guard.getOraclePrice()).to.be.revertedWithCustomError(guard, "StaleRound").withArgs(10n, 9n);
    });
  });

  describe("poolWithinBounds (500 bps)", function () {
    const at = (bps: bigint) => (ORACLE_E18 * (10_000n + bps)) / 10_000n;

    it("accepts the oracle price itself and both sides up to the limit", async function () {
      const { guard } = await networkHelpers.loadFixture(fixture);
      expect(await guard.poolWithinBounds(ORACLE_E18)).to.equal(true);
      expect(await guard.poolWithinBounds(at(500n))).to.equal(true);
      expect(await guard.poolWithinBounds(at(-500n))).to.equal(true);
    });

    it("rejects one wei beyond the limit on both sides", async function () {
      const { guard } = await networkHelpers.loadFixture(fixture);
      expect(await guard.poolWithinBounds(at(500n) + 1n)).to.equal(false);
      expect(await guard.poolWithinBounds(at(-500n) - 1n)).to.equal(false);
      expect(await guard.poolWithinBounds(0)).to.equal(false);
    });

    it("tracks changes to the deviation limit", async function () {
      const { guard } = await networkHelpers.loadFixture(fixture);
      await guard.setMaxDeviationBps(100);
      expect(await guard.poolWithinBounds(at(200n))).to.equal(false);
      await guard.setMaxDeviationBps(300);
      expect(await guard.poolWithinBounds(at(200n))).to.equal(true);
    });

    it("reverts, not false, when the feed is bad", async function () {
      const { guard, feed } = await networkHelpers.loadFixture(fixture);
      await feed.setAnswer(0);
      await expect(guard.poolWithinBounds(ORACLE_E18)).to.be.revertedWithCustomError(guard, "InvalidPrice");
    });
  });

  describe("admin", function () {
    it("sets staleness and deviation and emits events", async function () {
      const { guard } = await networkHelpers.loadFixture(fixture);
      await expect(guard.setMaxStaleness(7200)).to.emit(guard, "MaxStalenessSet").withArgs(7200n);
      await expect(guard.setMaxDeviationBps(1000)).to.emit(guard, "MaxDeviationBpsSet").withArgs(1000n);
      expect(await guard.maxStaleness()).to.equal(7200n);
      expect(await guard.maxDeviationBps()).to.equal(1000n);
    });

    it("enforces the hard caps and rejects zero", async function () {
      const { guard } = await networkHelpers.loadFixture(fixture);
      const day = 86_400n;
      await guard.setMaxStaleness(day);
      await expect(guard.setMaxStaleness(day + 1n))
        .to.be.revertedWithCustomError(guard, "StalenessAboveCap")
        .withArgs(day + 1n, day);
      await guard.setMaxDeviationBps(2000);
      await expect(guard.setMaxDeviationBps(2001))
        .to.be.revertedWithCustomError(guard, "DeviationAboveCap")
        .withArgs(2001n, 2000n);
      await expect(guard.setMaxStaleness(0)).to.be.revertedWithCustomError(guard, "ZeroValue");
      await expect(guard.setMaxDeviationBps(0)).to.be.revertedWithCustomError(guard, "ZeroValue");
    });

    it("blocks non-owners from changing either setting", async function () {
      const { guard, alice } = await networkHelpers.loadFixture(fixture);
      await expect(guard.connect(alice).setMaxStaleness(10)).to.be.revertedWithCustomError(
        guard,
        "OwnableUnauthorizedAccount",
      );
      await expect(guard.connect(alice).setMaxDeviationBps(10)).to.be.revertedWithCustomError(
        guard,
        "OwnableUnauthorizedAccount",
      );
      expect(await guard.maxStaleness()).to.equal(ONE_HOUR);
      expect(await guard.maxDeviationBps()).to.equal(500n);
    });

    it("validates constructor arguments", async function () {
      const { owner, feed } = await networkHelpers.loadFixture(fixture);
      const feedAddr = await feed.getAddress();
      await expect(
        ethers.deployContract("PriceGuard", [ethers.ZeroAddress, owner.address, 1, 1]),
      ).to.be.revertedWithCustomError(await ethers.getContractFactory("PriceGuard"), "ZeroAddress");
      await expect(
        ethers.deployContract("PriceGuard", [feedAddr, owner.address, 86_401, 1]),
      ).to.be.revertedWithCustomError(await ethers.getContractFactory("PriceGuard"), "StalenessAboveCap");
      await expect(
        ethers.deployContract("PriceGuard", [feedAddr, owner.address, 1, 2001]),
      ).to.be.revertedWithCustomError(await ethers.getContractFactory("PriceGuard"), "DeviationAboveCap");
    });
  });
});
