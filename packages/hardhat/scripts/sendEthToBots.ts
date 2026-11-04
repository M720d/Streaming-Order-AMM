import "dotenv/config";
import { JsonRpcProvider, Wallet, formatEther, isAddress, parseEther } from "ethers";
import password from "@inquirer/password";
import { numEnv, requireEnv } from "./offchain/common.js";

/**
 * Sends a small amount of testnet ETH from the deployer to the keeper and arbitrage accounts, so one faucet request
 * is enough. Asks for the deployer's keystore password (same prompt as `yarn deploy`); nothing is stored.
 *
 *   yarn send-eth                  # 0.005 ETH to each
 *   SEND_ETH=0.01 yarn send-eth
 *   SEND_TO=0xYourWallet SEND_ETH=0.003 yarn send-eth    # only that address (e.g. the MetaMask account for the demo)
 *
 * Refuses to run on a chain that is not Sepolia (11155111) or a local node (31337), and never sends more than half of
 * the deployer's balance in total.
 */
async function main() {
  const provider = new JsonRpcProvider(requireEnv("RPC_URL"), undefined, { cacheTimeout: -1 });
  const chainId = Number((await provider.getNetwork()).chainId);
  if (![11155111, 31337].includes(chainId)) throw new Error(`Refusing to send on chain ${chainId}: testnets only`);

  const encrypted = requireEnv("DEPLOYER_PRIVATE_KEY_ENCRYPTED");
  const pass = await password({ message: "Enter password to decrypt the deployer key:" });
  const deployer = (await Wallet.fromEncryptedJson(encrypted, pass)).connect(provider);

  const each = parseEther(String(numEnv("SEND_ETH", 0.005)));
  const sendTo = process.env.SEND_TO?.trim();
  if (sendTo && !isAddress(sendTo)) throw new Error(`SEND_TO is not a valid address: ${sendTo}`);
  const targets: (readonly [string, string])[] = sendTo
    ? [["wallet", sendTo]]
    : [
        ["keeper", new Wallet(requireEnv("KEEPER_PRIVATE_KEY")).address],
        ["arb", new Wallet(requireEnv("ARB_PRIVATE_KEY")).address],
      ];
  const balance = await provider.getBalance(deployer.address);
  if (each * BigInt(targets.length) > balance / 2n) {
    throw new Error(
      `Deployer holds ${formatEther(balance)} ETH; sending ${formatEther(each)} to each is over half of it`,
    );
  }
  for (const [name, to] of targets) {
    const tx = await deployer.sendTransaction({ to, value: each });
    const receipt = await tx.wait();
    console.log(`${name} ${to}: +${formatEther(each)} ETH, tx ${receipt?.hash}`);
  }
}

main().catch(err => {
  console.error(`send-eth failed: ${(err as Error).message}`);
  process.exit(1);
});
