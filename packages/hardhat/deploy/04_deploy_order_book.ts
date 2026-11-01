import { deployScript, artifacts } from "../rocketh/deploy.js";

/** OrderBook(pool, priceGuard): both addresses are fixed for the life of the contract. */
export default deployScript(
  async env => {
    const { deployer } = env.namedAccounts;
    const pool = env.get("Pool");
    const priceGuard = env.get("PriceGuard");
    await env.deploy("OrderBook", {
      account: deployer,
      artifact: artifacts.OrderBook,
      args: [pool.address, priceGuard.address],
    });
  },
  { tags: ["StreamingAMM", "OrderBook"], dependencies: ["Pool", "PriceGuard"] },
);
