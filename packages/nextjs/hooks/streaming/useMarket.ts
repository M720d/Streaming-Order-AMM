import { useEffect, useState } from "react";
import { useBlock, useReadContract } from "wagmi";
import { useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-eth";

const FEED_ABI = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

export type FeedHealth = "loading" | "ok" | "stale" | "invalid" | "unavailable";

/**
 * Current time as the contracts see it, in seconds, ticking every second. The contracts compare against
 * block.timestamp, so this is the latest block's timestamp plus the wall-clock time since it was seen; on a live
 * chain that is about the wall clock, and on a local chain whose time was moved forward it follows the chain.
 */
export const useNowSec = () => {
  const { targetNetwork } = useTargetNetwork();
  const { data: block } = useBlock({ chainId: targetNetwork.id, watch: true });
  const [wall, setWall] = useState(() => Math.floor(Date.now() / 1000));
  const [seen, setSeen] = useState<{ chain: number; wall: number }>();
  useEffect(() => {
    const id = setInterval(() => setWall(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (block) setSeen({ chain: Number(block.timestamp), wall: Math.floor(Date.now() / 1000) });
  }, [block]);
  return seen ? Math.max(wall, seen.chain + (wall - seen.wall)) : wall;
};

/** Pool reserves and price, guard settings and Chainlink feed health, all in one place. */
export const useMarket = () => {
  const { targetNetwork } = useTargetNetwork();
  const now = useNowSec();

  const { data: reserves, isLoading: reservesLoading } = useScaffoldReadContract({
    contractName: "Pool",
    functionName: "getReserves",
  });
  const { data: spotPriceE18 } = useScaffoldReadContract({ contractName: "Pool", functionName: "spotPriceE18" });
  const { data: feeBps } = useScaffoldReadContract({ contractName: "Pool", functionName: "FEE_BPS" });
  const { data: maxStaleness } = useScaffoldReadContract({ contractName: "PriceGuard", functionName: "maxStaleness" });
  const { data: maxDeviationBps } = useScaffoldReadContract({
    contractName: "PriceGuard",
    functionName: "maxDeviationBps",
  });
  // Reverts (stale / invalid feed) are expected states here, so they are read as an error, not thrown at the user.
  const { data: oraclePriceE18, isError: oracleReverted } = useScaffoldReadContract({
    contractName: "PriceGuard",
    functionName: "getOraclePrice",
  });

  // The guard knows its own feed: Chainlink BTC/USD on Sepolia, the MockAggregator on a local chain.
  const { data: feedAddress } = useScaffoldReadContract({ contractName: "PriceGuard", functionName: "feed" });
  const { data: round } = useReadContract({
    address: feedAddress as `0x${string}` | undefined,
    abi: FEED_ABI,
    functionName: "latestRoundData",
    chainId: targetNetwork.id,
    query: { enabled: !!feedAddress, refetchInterval: 10_000 },
  });

  const updatedAt = round ? Number(round[3]) : undefined;
  const feedAgeSec = updatedAt !== undefined ? Math.max(0, now - updatedAt) : undefined;
  let feedHealth: FeedHealth = "loading";
  if (oraclePriceE18 !== undefined && !oracleReverted) feedHealth = "ok";
  else if (oracleReverted) {
    if (round && round[1] <= 0n) feedHealth = "invalid";
    else feedHealth = "stale";
  } else if (!feedAddress && !reservesLoading) feedHealth = "unavailable";
  // Warn before the guard starts reverting: past 80% of the allowed age.
  const feedAging =
    feedHealth === "ok" &&
    feedAgeSec !== undefined &&
    maxStaleness !== undefined &&
    feedAgeSec > Number(maxStaleness) * 0.8;

  const reserveWbtc = reserves?.[0];
  const reserveUsdc = reserves?.[1];
  // Typed explicitly: before a Sepolia deployment exists the generated contract types cannot narrow these.
  const spot = spotPriceE18 as bigint | undefined;
  const oracle = oraclePriceE18 as bigint | undefined;
  const gapBps =
    spot !== undefined && oracle !== undefined && oracle > 0n
      ? Number(((spot > oracle ? spot - oracle : oracle - spot) * 10_000n) / oracle)
      : undefined;

  return {
    reserveWbtc,
    reserveUsdc,
    spotPriceE18,
    oraclePriceE18: oracleReverted ? undefined : oraclePriceE18,
    feeBps,
    maxStaleness,
    maxDeviationBps,
    feedHealth,
    feedAging,
    feedAgeSec,
    gapBps,
    poolOutsideBand: gapBps !== undefined && maxDeviationBps !== undefined ? BigInt(gapBps) > maxDeviationBps : false,
    isLoading: reservesLoading,
  };
};
