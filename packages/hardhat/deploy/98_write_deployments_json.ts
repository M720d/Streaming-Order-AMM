import fs from "fs";
import { deployScript } from "../rocketh/deploy.js";

// Hardhat (in process or node) and Anvil. Rocketh names the in-process network "memory", so match on chain id.
const LOCAL_CHAIN_IDS = [31337, 1337];

const CONTRACTS = ["MockWBTC", "MockUSDC", "Pool", "MockAggregator", "PriceGuard", "OrderBook"];

/**
 * Writes every deployed address to deployments.json (live networks) or deployments.local.json (hardhat and
 * localhost), keyed by network name. Entries for other networks already in the file are kept.
 */
export default deployScript(
  async env => {
    const local = LOCAL_CHAIN_IDS.includes(env.network.chain.id);
    const file = local ? "deployments.local.json" : "deployments.json";
    const all: Record<string, unknown> = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};

    const contracts: Record<string, unknown> = {};
    for (const name of CONTRACTS) {
      const d = env.getOrNull(name);
      if (!d) continue;
      contracts[name] = {
        address: d.address,
        transactionHash: d.transaction?.hash ?? null,
        blockNumber: d.receipt?.blockNumber ? Number(d.receipt.blockNumber) : null,
        constructorArgsData: d.argsData,
      };
    }
    const guard = env.getOrNull("PriceGuard");
    const feed = guard ? await env.read(guard, { functionName: "feed" }) : null;

    all[env.name] = {
      chainId: env.network.chain.id,
      deployer: env.namedAccounts.deployer,
      btcUsdFeed: feed,
      contracts,
    };
    fs.writeFileSync(file, JSON.stringify(all, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
    console.log(`Wrote ${file} (${Object.keys(contracts).length} contracts on ${env.name})`);
  },
  { tags: ["StreamingAMM", "Deployments"], runAtTheEnd: true },
);
