import "dotenv/config";
import { JsonRpcProvider, Wallet } from "ethers";
import { boolEnv, logRecord, consoleLogger, numEnv, requireEnv } from "./offchain/common.js";
import { Keeper } from "./offchain/keeperCore.js";

/**
 * Keeper: finds open orders from OrderBook events and calls executeSlice when the interval has elapsed.
 *
 *   yarn keeper            # loop until stopped
 *   yarn keeper --once     # one pass, then exit (cron, CI, demos)
 *
 * Env (see .env.example): RPC_URL, KEEPER_PRIVATE_KEY (testnet-only account), ORDER_BOOK, and optionally
 * START_BLOCK, POLL_INTERVAL_SEC, RETRY_DELAY_SEC, TX_TIMEOUT_SEC, CONFIRMATIONS, MAX_LOG_RANGE, SEND_SKIPS.
 */
async function main() {
  const once = process.argv.includes("--once");
  const provider = // cacheTimeout -1: ethers v6 otherwise caches eth_getTransactionCount for 250 ms, so two txs sent back to back
    // (the arb bot's approve then swap) would reuse a nonce on a fast RPC.
    new JsonRpcProvider(requireEnv("RPC_URL"), undefined, { cacheTimeout: -1 });
  const signer = new Wallet(requireEnv("KEEPER_PRIVATE_KEY"), provider);
  const keeper = new Keeper(signer, {
    orderBook: requireEnv("ORDER_BOOK"),
    fromBlock: numEnv("START_BLOCK", 0),
    maxLogRange: numEnv("MAX_LOG_RANGE", 500),
    retryDelaySec: numEnv("RETRY_DELAY_SEC", 30),
    txTimeoutSec: numEnv("TX_TIMEOUT_SEC", 120),
    confirmations: numEnv("CONFIRMATIONS", 1),
    sendSkips: boolEnv("SEND_SKIPS", false),
  });
  const pollMs = numEnv("POLL_INTERVAL_SEC", 15) * 1000;
  const net = await provider.getNetwork();
  logRecord(consoleLogger, "keeper", {
    event: "start",
    chainId: net.chainId,
    keeper: signer.address,
    orderBook: requireEnv("ORDER_BOOK"),
    once,
  });

  let stopping = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => (stopping = true));

  do {
    try {
      await keeper.tick();
    } catch (err) {
      logRecord(consoleLogger, "keeper", { event: "tick-error", detail: (err as Error).message });
    }
    if (once || stopping) break;
    await new Promise(r => setTimeout(r, pollMs));
  } while (!stopping);
  logRecord(consoleLogger, "keeper", { event: "stop" });
}

main().catch(err => {
  console.error(`keeper failed: ${(err as Error).message}`);
  process.exit(1);
});
