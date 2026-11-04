import "dotenv/config";
import fs from "fs";
import { Contract, JsonRpcProvider, Wallet, formatEther } from "ethers";
import { numEnv, requireEnv } from "./offchain/common.js";

/**
 * Read-only pre-flight check before recording the demo. Sends nothing.
 *
 *   yarn demo-check                      # uses packages/hardhat/.env and deployments.json (sepolia)
 *   DEMO_WALLET=0xYourMetaMask yarn demo-check   # also checks the wallet that will create the order
 *
 * Prints OK / WARN / FAIL per item and exits 1 on any FAIL.
 */
const ERC20 = ["function balanceOf(address) view returns (uint256)"];
const GUARD = [
  "function maxStaleness() view returns (uint256)",
  "function maxDeviationBps() view returns (uint256)",
  "function getOraclePrice() view returns (uint256)",
  "function feed() view returns (address)",
];
const FEED = ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"];
const POOL = [
  "function getReserves() view returns (uint256,uint256)",
  "function spotPriceE18() view returns (uint256)",
];

let failed = false;
const line = (level: "OK" | "WARN" | "FAIL", what: string) => {
  if (level === "FAIL") failed = true;
  console.log(`${level.padEnd(4)}  ${what}`);
};
const check = (ok: boolean, okMsg: string, bad: "WARN" | "FAIL", badMsg: string) =>
  line(ok ? "OK" : bad, ok ? okMsg : badMsg);
const eth = (v: bigint) => Number(formatEther(v)).toFixed(4);

async function main() {
  const dep = JSON.parse(fs.readFileSync("deployments.json", "utf8")).sepolia.contracts;
  const provider = new JsonRpcProvider(requireEnv("RPC_URL"), undefined, { cacheTimeout: -1 });
  const chainId = Number((await provider.getNetwork()).chainId);
  check(chainId === 11155111, "RPC is Sepolia", "FAIL", `RPC is chain ${chainId}, expected 11155111`);

  const guard = new Contract(dep.PriceGuard.address, GUARD, provider);
  const pool = new Contract(dep.Pool.address, POOL, provider);
  const [maxStale, band] = [Number(await guard.maxStaleness()), Number(await guard.maxDeviationBps())];

  const feed = new Contract(await guard.feed(), FEED, provider);
  const round = await feed.latestRoundData();
  const now = (await provider.getBlock("latest"))!.timestamp;
  const age = now - Number(round[3]);
  const price = Number(round[1]) / 1e8;
  const ageMsg = `Chainlink BTC/USD $${price.toFixed(2)}, updated ${Math.round(age / 60)} min ago (guard allows ${Math.round(maxStale / 60)} min)`;
  if (round[1] <= 0n || age > maxStale) line("FAIL", ageMsg + ": slices will revert, raise maxStaleness or wait");
  else if (age > maxStale * 0.8) line("WARN", ageMsg + ": close to the limit");
  else line("OK", ageMsg);

  const [r0, r1] = await pool.getReserves();
  const poolPx = Number(await pool.spotPriceE18()) / 1e18;
  const gap = Math.round((Math.abs(poolPx - price) / price) * 1e4);
  const gapMsg = `pool ${(Number(r0) / 1e8).toFixed(2)} WBTC / ${(Number(r1) / 1e6).toLocaleString()} USDC at $${poolPx.toFixed(2)}, ${gap} bps from Chainlink (band ${band} bps)`;
  const arbThreshold = numEnv("ARB_GAP_THRESHOLD_BPS", 100);
  if (gap >= band) line("FAIL", gapMsg + ": slices will be skipped, run the arb bot once");
  else if (gap >= arbThreshold) line("WARN", gapMsg + ": the arb bot will trade on its first look");
  else line("OK", gapMsg);

  for (const [name, key] of [
    ["keeper", "KEEPER_PRIVATE_KEY"],
    ["arb", "ARB_PRIVATE_KEY"],
  ] as const) {
    const a = new Wallet(requireEnv(key)).address;
    const bal = await provider.getBalance(a);
    const msg = `${name} ${a} holds ${eth(bal)} ETH`;
    check(bal >= 5n * 10n ** 14n, msg, "FAIL", msg + " (need at least 0.0005)");
  }
  const arbAddr = new Wallet(requireEnv("ARB_PRIVATE_KEY")).address;
  const wbtc = new Contract(dep.MockWBTC.address, ERC20, provider);
  const usdc = new Contract(dep.MockUSDC.address, ERC20, provider);
  const [aw, au] = [Number(await wbtc.balanceOf(arbAddr)) / 1e8, Number(await usdc.balanceOf(arbAddr)) / 1e6];
  const arbMsg = `arb wallet holds ${aw.toFixed(2)} mWBTC and ${au.toLocaleString()} mUSDC`;
  check(aw >= 1 && au >= 300_000, arbMsg, "WARN", arbMsg + ": a refill needs about 130,000 USDC, run yarn fund-arb");

  const demo = process.env.DEMO_WALLET?.trim();
  if (demo) {
    const [e, w] = [await provider.getBalance(demo), Number(await wbtc.balanceOf(demo)) / 1e8];
    check(
      e >= 3n * 10n ** 15n,
      `demo wallet holds ${eth(e)} ETH`,
      "WARN",
      `demo wallet ${demo} holds ${eth(e)} ETH (need about 0.003)`,
    );
    check(
      w >= 1,
      `demo wallet holds ${w} mWBTC`,
      "WARN",
      `demo wallet holds ${w} mWBTC: press "Get 5 test WBTC" in the app`,
    );
  } else line("WARN", "DEMO_WALLET not set: the wallet that creates the order was not checked");

  for (const k of ["ORDER_BOOK", "POOL", "START_BLOCK"])
    check(!!process.env[k], `${k} is set for the bots`, "FAIL", `${k} is missing in .env`);
  console.log(failed ? "\nNot ready: fix the FAIL lines." : "\nReady (read any WARN lines before recording).");
  process.exit(failed ? 1 : 0);
}

main().catch(err => {
  console.error(`demo-check failed: ${(err as Error).message}`);
  process.exit(1);
});
