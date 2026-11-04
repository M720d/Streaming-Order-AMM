import "dotenv/config";
import fs from "fs";
import { Contract, JsonRpcProvider } from "ethers";
import { numEnv, requireEnv } from "./offchain/common.js";

/**
 * Read-only evidence collector for the submission package. Reads the deployment file written by deploy/98 and scans the
 * Pool and OrderBook events, then prints (and saves) the deploy hashes plus the first transaction of each kind, with
 * Etherscan links. It sends nothing and needs no key.
 *
 *   RPC_URL=<sepolia rpc> yarn evidence                # network "sepolia", file deployments.json
 *   NETWORK=localhost DEPLOYMENTS_FILE=deployments.local.json RPC_URL=http://127.0.0.1:8545 yarn evidence
 *
 * Output: a markdown table on stdout and docs/data/evidence_<network>.json. Copy the hashes into the course's
 * submission.json template; this script does not guess its layout.
 */
const POOL_EVENTS = [
  "event LiquidityAdded(address indexed provider, uint256 amount0, uint256 amount1, uint256 shares, address indexed to)",
  "event Swap(address indexed sender, address indexed tokenIn, uint256 amountIn, uint256 amountOut, address indexed to)",
];
const BOOK_EVENTS = [
  "event OrderCreated(uint256 indexed orderId, address indexed owner, uint256 totalIn, uint32 slices, uint32 interval, uint16 toleranceBps)",
  "event SliceExecuted(uint256 indexed orderId, uint256 amountIn, uint256 amountOut, uint32 slicesLeft)",
  "event SliceSkipped(uint256 indexed orderId, uint256 poolPriceE18, uint256 oraclePriceE18)",
  "event Claimed(uint256 indexed orderId, address indexed to, uint256 amountOut)",
  "event Cancelled(uint256 indexed orderId, address indexed to, uint256 refundedIn, uint256 proceedsPaid)",
];

interface Deployed {
  address: string;
  transactionHash: string | null;
  blockNumber: number | null;
}

async function main() {
  const network = process.env.NETWORK?.trim() || "sepolia";
  const file = process.env.DEPLOYMENTS_FILE?.trim() || "deployments.json";
  const entry = JSON.parse(fs.readFileSync(file, "utf8"))[network];
  if (!entry) throw new Error(`No "${network}" entry in ${file}. Deploy first (docs/sepolia-runbook.md).`);
  const contracts = entry.contracts as Record<string, Deployed>;
  const provider = new JsonRpcProvider(requireEnv("RPC_URL"), undefined, { cacheTimeout: -1 });
  const chainId = Number((await provider.getNetwork()).chainId);
  if (chainId !== Number(entry.chainId))
    throw new Error(`RPC chain ${chainId} differs from ${file} chain ${entry.chainId}`);
  const explorer = chainId === 11155111 ? "https://sepolia.etherscan.io" : null;
  const txLink = (h: string) => (explorer ? `${explorer}/tx/${h}` : h);
  const addrLink = (a: string) => (explorer ? `${explorer}/address/${a}` : a);

  const pool = new Contract(contracts.Pool.address, POOL_EVENTS, provider);
  const book = new Contract(contracts.OrderBook.address, BOOK_EVENTS, provider);
  const first = Math.min(...Object.values(contracts).map(c => c.blockNumber ?? Infinity));
  const latest = await provider.getBlockNumber();
  const range = numEnv("MAX_LOG_RANGE", 500);

  const seen: Record<string, { count: number; firstTx: string | null; block: number | null }> = {};
  const note = (name: string, tx: string, block: number) => {
    const s = (seen[name] ??= { count: 0, firstTx: null, block: null });
    s.count += 1;
    if (!s.firstTx) [s.firstTx, s.block] = [tx, block];
  };
  const bookAddr = contracts.OrderBook.address.toLowerCase();
  for (let from = first; from <= latest; from += range) {
    const to = Math.min(from + range - 1, latest);
    for (const l of await pool.queryFilter("*", from, to)) {
      const name = (l as unknown as { fragment?: { name: string } }).fragment?.name;
      if (!name) continue;
      // Swaps sent by the OrderBook are slices; swaps sent by anyone else are trades or the arbitrage refill.
      const key =
        name === "Swap"
          ? String((l as unknown as { args: { sender: string } }).args.sender).toLowerCase() === bookAddr
            ? "Swap (slice, from OrderBook)"
            : "Swap (trader or arbitrage refill)"
          : name;
      note(key, l.transactionHash, l.blockNumber);
    }
    for (const l of await book.queryFilter("*", from, to)) {
      const name = (l as unknown as { fragment?: { name: string } }).fragment?.name;
      if (name) note(name, l.transactionHash, l.blockNumber);
    }
  }

  // Measured gas of the first tx of each kind, so the cost analysis can use real numbers from this chain.
  const gasOf = async (hash: string | null) => {
    const r = hash ? await provider.getTransactionReceipt(hash) : null;
    return r ? { gasUsed: String(r.gasUsed), effectiveGwei: Number(r.gasPrice) / 1e9 } : null;
  };
  const deployGas: Record<string, { gasUsed: string; effectiveGwei: number } | null> = {};
  for (const [n, c] of Object.entries(contracts)) deployGas[n] = await gasOf(c.transactionHash);
  const eventGas: Record<string, { gasUsed: string; effectiveGwei: number } | null> = {};
  for (const [n, s] of Object.entries(seen)) eventGas[n] = await gasOf(s.firstTx);

  const out = {
    network,
    chainId,
    scannedBlocks: [first, latest],
    contracts: Object.fromEntries(
      Object.entries(contracts).map(([n, c]) => [
        n,
        { address: c.address, deployTx: c.transactionHash, block: c.blockNumber, gas: deployGas[n] },
      ]),
    ),
    events: Object.fromEntries(Object.entries(seen).map(([n, s]) => [n, { ...s, gas: eventGas[n] }])),
  };
  fs.mkdirSync("../../docs/data", { recursive: true });
  const outFile = `../../docs/data/evidence_${network}.json`;
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + "\n");

  console.log(`Evidence for ${network} (chain ${chainId}), blocks ${first}..${latest}\n`);
  console.log("| Contract | Address | Deploy tx | Gas used |\n|---|---|---|---:|");
  for (const [n, c] of Object.entries(contracts)) {
    const link = c.transactionHash ? txLink(c.transactionHash) : "n/a";
    console.log(`| ${n} | ${addrLink(c.address)} | ${link} | ${deployGas[n]?.gasUsed ?? "n/a"} |`);
  }
  console.log("\n| Event | Count | First tx | Gas used |\n|---|---:|---|---:|");
  for (const [n, s] of Object.entries(seen)) {
    console.log(`| ${n} | ${s.count} | ${txLink(s.firstTx!)} | ${eventGas[n]?.gasUsed ?? "n/a"} |`);
  }
  const missing = [
    "LiquidityAdded",
    "OrderCreated",
    "SliceExecuted",
    "Claimed",
    "Swap (trader or arbitrage refill)",
  ].filter(n => !seen[n]);
  if (missing.length) console.log(`\nStill missing evidence for: ${missing.join(", ")}`);
  console.log(`\nSaved ${outFile}`);
}

main().catch(err => {
  console.error(`evidence failed: ${(err as Error).message}`);
  process.exit(1);
});
