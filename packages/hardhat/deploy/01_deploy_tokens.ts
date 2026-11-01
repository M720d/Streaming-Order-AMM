import { deployScript, artifacts } from "../rocketh/deploy.js";

/** Test tokens for the pool pair. Sepolia only has a BTC/USD feed, so WBTC and USDC are our own mocks. */
export default deployScript(
  async env => {
    const { deployer } = env.namedAccounts;
    await env.deploy("MockWBTC", { account: deployer, artifact: artifacts.MockWBTC, args: [deployer] });
    await env.deploy("MockUSDC", { account: deployer, artifact: artifacts.MockUSDC, args: [deployer] });
  },
  { tags: ["StreamingAMM", "Tokens"] },
);
