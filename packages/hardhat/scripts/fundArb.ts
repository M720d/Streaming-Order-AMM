import "dotenv/config";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { numEnv, requireEnv } from "./offchain/common.js";

/**
 * Gives the arbitrage account test WBTC and USDC from the mock tokens' public faucets (testnet only; the faucets are
 * capped per call, so FUND_ROUNDS calls are made per token). Uses ARB_PRIVATE_KEY, so the key never has to be imported
 * into a wallet app. The account still needs a little Sepolia ETH for gas.
 *
 *   yarn fund-arb                  # one round: 5 WBTC and 500,000 USDC
 *   FUND_ROUNDS=3 yarn fund-arb
 */
const TOKEN_ABI = [
  "function faucet(uint256 amount)",
  "function FAUCET_CAP() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

async function main() {
  const provider = new JsonRpcProvider(requireEnv("RPC_URL"), undefined, { cacheTimeout: -1 });
  const signer = new Wallet(requireEnv("ARB_PRIVATE_KEY"), provider);
  const pool = new Contract(
    requireEnv("POOL"),
    ["function token0() view returns (address)", "function token1() view returns (address)"],
    provider,
  );
  const rounds = numEnv("FUND_ROUNDS", 1);
  console.log(`funding ${signer.address}`);
  for (const addr of [await pool.token0(), await pool.token1()]) {
    const token = new Contract(addr, TOKEN_ABI, signer);
    const cap = BigInt(await token.FAUCET_CAP());
    for (let i = 0; i < rounds; i++) await (await token.faucet(cap)).wait();
    const [bal, dec, sym] = [
      BigInt(await token.balanceOf(signer.address)),
      Number(await token.decimals()),
      await token.symbol(),
    ];
    console.log(`${sym}: ${Number(bal) / 10 ** dec} (token ${addr})`);
  }
}

main().catch(err => {
  console.error(`fund-arb failed: ${(err as Error).message}`);
  process.exit(1);
});
