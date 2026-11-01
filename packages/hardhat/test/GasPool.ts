import { network } from "hardhat";

// Prints the exact gas used by each Pool entry point. Not an assertion test: run it with
// `hardhat test --network hardhat test/GasPool.ts` to reproduce docs/gas-pool.md.
const { networkHelpers, ethers } = await network.create();

const BTC = 10n ** 8n;
const USD = 10n ** 6n;

describe("Gas (Pool)", function () {
  it("measures addLiquidity, removeLiquidity and swapExactIn", async function () {
    const [owner, lp1, lp2, trader] = await ethers.getSigners();
    const wbtc = await ethers.deployContract("MockWBTC", [owner.address]);
    const usdc = await ethers.deployContract("MockUSDC", [owner.address]);
    const pool = await ethers.deployContract("Pool", [await wbtc.getAddress(), await usdc.getAddress()]);
    const [wAddr, uAddr, pAddr] = [await wbtc.getAddress(), await usdc.getAddress(), await pool.getAddress()];
    for (const who of [lp1, lp2, trader]) {
      await wbtc.mint(who.address, 1000n * BTC);
      await usdc.mint(who.address, 100_000_000n * USD);
      await wbtc.connect(who).approve(pAddr, 2n ** 255n);
      await usdc.connect(who).approve(pAddr, 2n ** 255n);
    }
    // Every measured call is mined 60 s after the previous one, so each one writes an oracle observation
    // (the common case).
    const gas = async (tx: () => Promise<{ wait(): Promise<{ gasUsed: bigint } | null> }>) => {
      await networkHelpers.time.increase(60);
      return (await (await tx()).wait())!.gasUsed;
    };

    const rows: Record<string, bigint> = {};
    rows["addLiquidity (first deposit)"] = await gas(() =>
      pool.connect(lp1).addLiquidity(500n * BTC, 30_000_000n * USD, 0, 0, lp1.address),
    );
    rows["addLiquidity (second LP, new share holder)"] = await gas(() =>
      pool.connect(lp2).addLiquidity(50n * BTC, 3_000_000n * USD, 0, 0, lp2.address),
    );
    rows["addLiquidity (existing LP)"] = await gas(() =>
      pool.connect(lp2).addLiquidity(10n * BTC, 600_000n * USD, 0, 0, lp2.address),
    );
    rows["swapExactIn (sell WBTC)"] = await gas(() => pool.connect(trader).swapExactIn(wAddr, 1n * BTC, 0, trader.address));
    rows["swapExactIn (sell USDC)"] = await gas(() =>
      pool.connect(trader).swapExactIn(uAddr, 60_000n * USD, 0, trader.address),
    );
    const s = await pool.balanceOf(lp2.address);
    rows["removeLiquidity (partial, 1/2)"] = await gas(() => pool.connect(lp2).removeLiquidity(s / 2n, 0, 0, lp2.address));
    rows["removeLiquidity (rest of LP's shares)"] = await gas(() =>
      pool.connect(lp2).removeLiquidity(s - s / 2n, 0, 0, lp2.address),
    );

    console.log("\n  GAS_TABLE_START");
    for (const [k, v] of Object.entries(rows)) console.log(`  ${k.padEnd(52)} ${v}`);
    console.log("  GAS_TABLE_END");
  });
});
