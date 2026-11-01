import "dotenv/config";
import { JsonRpcProvider, Wallet } from "ethers";
import { consoleLogger, logRecord, numEnv, requireEnv } from "./offchain/common.js";
import { Arbitrageur } from "./offchain/arbCore.js";

/**
 * Arbitrage bot: when the pool price drifts from the Chainlink price by more than the threshold and the trade is
 * profitable after the pool fee, trades the pool back toward the oracle price.
 *
 *   yarn arb            # loop until stopped
 *   yarn arb --once     # one look, then exit
 *
 * Env (see .env.example): RPC_URL, ARB_PRIVATE_KEY (testnet-only account holding WBTC and USDC), POOL,
 * BTC_USD_FEED, and optionally ARB_GAP_THRESHOLD_BPS, ARB_MAX_TRADE_WBTC, ARB_MAX_TRADE_USDC, ARB_MIN_PROFIT_USDC,
 * ARB_SLIPPAGE_BPS, ARB_ORACLE_MAX_AGE_SEC, ARB_POLL_INTERVAL_SEC, CONFIRMATIONS.
 */
async function main() {
  const once = process.argv.includes("--once");
  const provider = // cacheTimeout -1: ethers v6 otherwise caches eth_getTransactionCount for 250 ms, so two txs sent back to back
    // (the arb bot's approve then swap) would reuse a nonce on a fast RPC.
    new JsonRpcProvider(requireEnv("RPC_URL"), undefined, { cacheTimeout: -1 });
  const signer = new Wallet(requireEnv("ARB_PRIVATE_KEY"), provider);
  const d = (name: string, fallback: string) => process.env[name]?.trim() || fallback;
  const bot = new Arbitrageur(signer, {
    pool: requireEnv("POOL"),
    feed: requireEnv("BTC_USD_FEED"),
    gapThresholdBps: numEnv("ARB_GAP_THRESHOLD_BPS", 100),
    maxTradeWbtc: d("ARB_MAX_TRADE_WBTC", "5"),
    maxTradeUsdc: d("ARB_MAX_TRADE_USDC", "300000"),
    minProfitUsdc: d("ARB_MIN_PROFIT_USDC", "1"),
    slippageBps: numEnv("ARB_SLIPPAGE_BPS", 50),
    oracleMaxAgeSec: numEnv("ARB_ORACLE_MAX_AGE_SEC", 3600),
    confirmations: numEnv("CONFIRMATIONS", 1),
  });
  const pollMs = numEnv("ARB_POLL_INTERVAL_SEC", 15) * 1000;
  const net = await provider.getNetwork();
  logRecord(consoleLogger, "arb", { event: "start", chainId: net.chainId, arb: signer.address, once });

  let stopping = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => (stopping = true));

  do {
    try {
      await bot.tick();
    } catch (err) {
      logRecord(consoleLogger, "arb", { event: "tick-error", detail: (err as Error).message });
    }
    if (once || stopping) break;
    await new Promise(r => setTimeout(r, pollMs));
  } while (!stopping);
  logRecord(consoleLogger, "arb", { event: "stop" });
}

main().catch(err => {
  console.error(`arb failed: ${(err as Error).message}`);
  process.exit(1);
});
