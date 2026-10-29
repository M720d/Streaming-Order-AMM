import { expect } from "chai";
import { network } from "hardhat";

const { networkHelpers, ethers } = await network.create();

async function fixture() {
  const [owner, alice] = await ethers.getSigners();
  const wbtc = await ethers.deployContract("MockWBTC", [owner.address]);
  const usdc = await ethers.deployContract("MockUSDC", [owner.address]);
  return { owner, alice, wbtc, usdc };
}

describe("Mock tokens", function () {
  it("have the right decimals", async function () {
    const { wbtc, usdc } = await networkHelpers.loadFixture(fixture);
    expect(await wbtc.decimals()).to.equal(8n);
    expect(await usdc.decimals()).to.equal(6n);
  });

  for (const name of ["wbtc", "usdc"] as const) {
    describe(name, function () {
      it("lets the owner mint", async function () {
        const f = await networkHelpers.loadFixture(fixture);
        const token = f[name];
        await token.mint(f.alice.address, 123n);
        expect(await token.balanceOf(f.alice.address)).to.equal(123n);
      });

      it("blocks non-owners from minting", async function () {
        const f = await networkHelpers.loadFixture(fixture);
        const token = f[name];
        await expect(token.connect(f.alice).mint(f.alice.address, 1n)).to.be.revertedWithCustomError(
          token,
          "OwnableUnauthorizedAccount",
        );
      });

      it("faucet mints to the caller up to the cap", async function () {
        const f = await networkHelpers.loadFixture(fixture);
        const token = f[name];
        const cap = await token.FAUCET_CAP();
        await token.connect(f.alice).faucet(cap);
        expect(await token.balanceOf(f.alice.address)).to.equal(cap);
      });

      it("faucet reverts above the cap", async function () {
        const f = await networkHelpers.loadFixture(fixture);
        const token = f[name];
        const cap = await token.FAUCET_CAP();
        await expect(token.connect(f.alice).faucet(cap + 1n))
          .to.be.revertedWithCustomError(token, "FaucetCapExceeded")
          .withArgs(cap + 1n, cap);
      });
    });
  }
});
