import { deployScript, artifacts } from "../rocketh/deploy.js";

// Chainlink BTC / USD on Ethereum Sepolia (8 decimals).
const SEPOLIA_BTC_USD_FEED = "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43";
const SEPOLIA_CHAIN_ID = 11155111;

/**
 * PriceGuard(feed, owner, maxStaleness, maxDeviationBps).
 * Feed: BTC_USD_FEED if set, the real Chainlink feed on Sepolia, otherwise a MockAggregator at 60,000 USD.
 * Limits (owner can change them later within the contract's hard caps):
 *   PRICE_MAX_STALENESS (seconds, default 3600), PRICE_MAX_DEVIATION_BPS (default 500).
 */
export default deployScript(
  async env => {
    const { deployer } = env.namedAccounts;

    let feed = process.env.BTC_USD_FEED as `0x${string}` | undefined;
    if (!feed && env.network.chain.id === SEPOLIA_CHAIN_ID) feed = SEPOLIA_BTC_USD_FEED;
    if (!feed) {
      const mock = await env.deploy("MockAggregator", {
        account: deployer,
        artifact: artifacts.MockAggregator,
        args: [8, 60_000n * 10n ** 8n],
      });
      feed = mock.address;
    }

    const maxStaleness = BigInt(process.env.PRICE_MAX_STALENESS ?? 3600);
    const maxDeviationBps = BigInt(process.env.PRICE_MAX_DEVIATION_BPS ?? 500);
    await env.deploy("PriceGuard", {
      account: deployer,
      artifact: artifacts.PriceGuard,
      args: [feed, deployer, maxStaleness, maxDeviationBps],
    });
  },
  { tags: ["StreamingAMM", "PriceGuard"] },
);
