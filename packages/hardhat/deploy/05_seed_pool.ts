import { deployScript } from "../rocketh/deploy.js";

// Hardhat (in process or node) and Anvil. Rocketh names the in-process network "memory", so match on chain id.
const LOCAL_CHAIN_IDS = [31337, 1337];

/**
 * Optional demo setup: mints test tokens to the deployer and adds first liquidity at the oracle price, so the pool
 * starts inside the PriceGuard bounds. Runs by default on local networks; elsewhere set SEED_POOL=true.
 * SEED_WBTC is the WBTC side in whole coins (default 500); the USDC side is derived from the oracle price.
 */
export default deployScript(
  async env => {
    const local = LOCAL_CHAIN_IDS.includes(env.network.chain.id);
    if (!local && process.env.SEED_POOL !== "true") {
      console.log("Skipping pool seeding (set SEED_POOL=true to seed on this network)");
      return;
    }
    const { deployer } = env.namedAccounts;
    const wbtc = env.get("MockWBTC");
    const usdc = env.get("MockUSDC");
    const pool = env.get("Pool");
    const guard = env.get("PriceGuard");

    const priceE18 = (await env.read(guard, { functionName: "getOraclePrice" })) as bigint;
    const amount0 = BigInt(process.env.SEED_WBTC ?? 500) * 10n ** 8n;
    const amount1 = (amount0 * priceE18 * 10n ** 6n) / (10n ** 8n * 10n ** 18n);

    await env.execute(wbtc, { account: deployer, functionName: "mint", args: [deployer, amount0] });
    await env.execute(usdc, { account: deployer, functionName: "mint", args: [deployer, amount1] });
    await env.execute(wbtc, { account: deployer, functionName: "approve", args: [pool.address, amount0] });
    await env.execute(usdc, { account: deployer, functionName: "approve", args: [pool.address, amount1] });
    await env.execute(pool, {
      account: deployer,
      functionName: "addLiquidity",
      args: [amount0, amount1, 0n, 0n, deployer],
    });
    console.log(`Seeded pool with ${amount0} raw WBTC and ${amount1} raw USDC (price ${priceE18} e18)`);
  },
  { tags: ["StreamingAMM", "Seed"], dependencies: ["Pool", "PriceGuard"] },
);
