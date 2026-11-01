import { deployScript, artifacts } from "../rocketh/deploy.js";

/** Pool(token0 = WBTC, token1 = USDC). The pool is also the LP share token. */
export default deployScript(
  async env => {
    const { deployer } = env.namedAccounts;
    const wbtc = env.get("MockWBTC");
    const usdc = env.get("MockUSDC");
    await env.deploy("Pool", { account: deployer, artifact: artifacts.Pool, args: [wbtc.address, usdc.address] });
  },
  { tags: ["StreamingAMM", "Pool"], dependencies: ["Tokens"] },
);
