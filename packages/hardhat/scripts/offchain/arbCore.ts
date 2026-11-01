import { Contract, type Signer } from "ethers";
import { ERC20_ABI, FEED_ABI, POOL_ABI } from "./abis.js";
import { chainTime, consoleLogger, isqrt, logRecord, revertName, type Logger } from "./common.js";

const BPS = 10_000n;
const E18 = 10n ** 18n;

export interface ArbConfig {
  pool: string;
  /** Chainlink BTC/USD aggregator. */
  feed: string;
  /** Minimum |pool - oracle| / oracle, in bps, before the bot even looks at a trade. */
  gapThresholdBps: number;
  /** Largest trade, in WBTC (decimal string, whole coins) when selling WBTC. Raw units are derived from decimals. */
  maxTradeWbtc: string;
  /** Largest trade, in USDC (decimal string) when buying WBTC. */
  maxTradeUsdc: string;
  /** Skip the trade unless the expected profit, in USDC at the oracle price, is at least this (covers gas). */
  minProfitUsdc: string;
  /** Tolerated worsening of the pool quote between quote and mining, in bps. */
  slippageBps: number;
  /** Ignore the oracle when its last update is older than this. */
  oracleMaxAgeSec: number;
  confirmations: number;
}

export const DEFAULT_ARB_CONFIG: Omit<ArbConfig, "pool" | "feed"> = {
  gapThresholdBps: 100,
  maxTradeWbtc: "5",
  maxTradeUsdc: "300000",
  minProfitUsdc: "1",
  slippageBps: 50,
  oracleMaxAgeSec: 3600,
  confirmations: 1,
};

export type ArbDirection = "buy-wbtc" | "sell-wbtc";

export interface ArbResult {
  action: "traded" | "none" | "reverted";
  /** Why nothing happened, or a one-line summary of the trade. */
  detail: string;
  gapBps?: number;
  direction?: ArbDirection;
  poolPriceE18?: bigint;
  oraclePriceE18?: bigint;
  /** Raw units of the token sent in / received. */
  amountIn?: bigint;
  amountOut?: bigint;
  /** Expected profit in raw USDC at the oracle price, from the pool's own quote. */
  expectedProfitUsdc?: bigint;
  txHash?: string;
}

/** Decimal string -> raw units, without float rounding. "0.5" with 8 decimals -> 50000000n. */
export function parseDecimal(s: string, decimals: number): bigint {
  const [whole, frac = ""] = s.trim().split(".");
  if (!/^\d+$/.test(whole || "0") || !/^\d*$/.test(frac)) throw new Error(`Not a decimal amount: "${s}"`);
  return (
    BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0")
  );
}

/**
 * Profit-maximising trade size against an external price, for a constant-product pool with an input fee.
 *
 * Pool reserves x (WBTC raw) and y (USDC raw), fee factor g = (10000 - feeBps) / 10000, oracle price P in raw USDC
 * per raw WBTC (pNum / pDen). The arbitrageur values WBTC at P and keeps trading while the marginal price paid is
 * below P. Setting d(out * P - in)/d(in) = 0 gives
 *   buy WBTC with USDC:  in = (sqrt(g x y P) - y) / g        (only when the pool WBTC price is below P)
 *   sell WBTC for USDC:  in = (sqrt(g x y / P) - x) / g      (only when the pool WBTC price is above P)
 * This is the same rule as `arb_usdc_in` in docs/analysis_slicing.ipynb. Returns 0 when there is no profitable
 * trade in that direction. Integer maths, floors.
 */
export function optimalTradeIn(
  direction: ArbDirection,
  x: bigint,
  y: bigint,
  pNum: bigint,
  pDen: bigint,
  feeBps: bigint,
): bigint {
  const g = BPS - feeBps;
  if (direction === "buy-wbtc") {
    const root = isqrt((g * x * y * pNum) / (BPS * pDen));
    return root > y ? ((root - y) * BPS) / g : 0n;
  }
  const root = isqrt((g * x * y * pDen) / (BPS * pNum));
  return root > x ? ((root - x) * BPS) / g : 0n;
}

/**
 * Trades the pool back toward the Chainlink price when the gap is large enough and the trade is profitable after
 * the pool fee. It refills the pool between OrderBook slices in the demo. It never trades against a stale or
 * invalid oracle, never exceeds the configured trade size and never sends a trade that its own quote says loses
 * money.
 */
export class Arbitrageur {
  private readonly signer: Signer;
  private readonly cfg: ArbConfig;
  private readonly log: Logger;
  private readonly pool: Contract;
  private readonly feed: Contract;
  private meta?: {
    wbtc: Contract;
    usdc: Contract;
    wbtcDecimals: number;
    usdcDecimals: number;
    feedDecimals: number;
    maxWbtc: bigint;
    maxUsdc: bigint;
    minProfit: bigint;
    feeBps: bigint;
    me: string;
  };

  constructor(signer: Signer, cfg: Partial<ArbConfig> & Pick<ArbConfig, "pool" | "feed">, log: Logger = consoleLogger) {
    this.signer = signer;
    this.cfg = { ...DEFAULT_ARB_CONFIG, ...cfg };
    this.log = log;
    this.pool = new Contract(this.cfg.pool, POOL_ABI, signer);
    this.feed = new Contract(this.cfg.feed, FEED_ABI, signer);
  }

  private async init() {
    if (this.meta) return this.meta;
    const wbtc = new Contract(await this.pool.token0(), ERC20_ABI, this.signer);
    const usdc = new Contract(await this.pool.token1(), ERC20_ABI, this.signer);
    const wbtcDecimals = Number(await wbtc.decimals());
    const usdcDecimals = Number(await usdc.decimals());
    this.meta = {
      wbtc,
      usdc,
      wbtcDecimals,
      usdcDecimals,
      feedDecimals: Number(await this.feed.decimals()),
      maxWbtc: parseDecimal(this.cfg.maxTradeWbtc, wbtcDecimals),
      maxUsdc: parseDecimal(this.cfg.maxTradeUsdc, usdcDecimals),
      minProfit: parseDecimal(this.cfg.minProfitUsdc, usdcDecimals),
      feeBps: BigInt(await this.pool.FEE_BPS()),
      me: await this.signer.getAddress(),
    };
    return this.meta;
  }

  /** One look at the market; trades at most once. */
  async tick(): Promise<ArbResult> {
    const res = await this.run();
    logRecord(this.log, "arb", { ...res });
    return res;
  }

  private async run(): Promise<ArbResult> {
    const m = await this.init();
    const provider = this.signer.provider!;

    // Oracle: read the feed directly and refuse anything stale, non-positive or carried over from an old round.
    const [roundId, answer, , updatedAt, answeredInRound] = await this.feed.latestRoundData();
    const now = await chainTime(provider);
    if (answer <= 0n) return { action: "none", detail: `oracle answer is ${answer}, not trading` };
    if (answeredInRound < roundId) return { action: "none", detail: "oracle round is carried over, not trading" };
    if (now > updatedAt && now - updatedAt > BigInt(this.cfg.oracleMaxAgeSec)) {
      return {
        action: "none",
        detail: `oracle stale: updated ${now - updatedAt}s ago (max ${this.cfg.oracleMaxAgeSec}s)`,
      };
    }
    // USDC is treated as 1 USD, exactly like PriceMath: priceE18 = answer * 1e18 / 10^feedDecimals.
    const oracleE18 = (BigInt(answer) * E18) / 10n ** BigInt(m.feedDecimals);
    const poolE18 = BigInt(await this.pool.spotPriceE18());
    const diff = poolE18 > oracleE18 ? poolE18 - oracleE18 : oracleE18 - poolE18;
    const gapBps = Number((diff * BPS) / oracleE18);
    const base = { gapBps, poolPriceE18: poolE18, oraclePriceE18: oracleE18 };

    if (gapBps < this.cfg.gapThresholdBps) {
      return { action: "none", detail: `gap ${gapBps} bps below threshold ${this.cfg.gapThresholdBps} bps`, ...base };
    }

    const direction: ArbDirection = poolE18 < oracleE18 ? "buy-wbtc" : "sell-wbtc";
    const [r0, r1] = await this.pool.getReserves();
    const x = BigInt(r0);
    const y = BigInt(r1);
    // Oracle price in raw USDC per raw WBTC as a fraction.
    const pNum = oracleE18 * 10n ** BigInt(m.usdcDecimals);
    const pDen = 10n ** BigInt(m.wbtcDecimals) * E18;

    let amountIn = optimalTradeIn(direction, x, y, pNum, pDen, m.feeBps);
    const tokenIn = direction === "buy-wbtc" ? m.usdc : m.wbtc;
    const cap = direction === "buy-wbtc" ? m.maxUsdc : m.maxWbtc;
    const balance = BigInt(await tokenIn.balanceOf(m.me));
    let limit = "size";
    if (amountIn > cap) {
      amountIn = cap;
      limit = "max trade size";
    }
    if (amountIn > balance) {
      amountIn = balance;
      limit = "wallet balance";
    }
    if (amountIn === 0n) {
      return {
        action: "none",
        detail: `no profitable ${direction} size (fee ${m.feeBps} bps) or no balance`,
        direction,
        ...base,
      };
    }

    // Profit from the pool's own quote, valued at the oracle price (so the 30 bps fee is already in it).
    const tokenInAddr = await tokenIn.getAddress();
    const quoteOut = BigInt(await this.pool.getAmountOut(tokenInAddr, amountIn));
    const expectedProfit =
      direction === "buy-wbtc" ? (quoteOut * pNum) / pDen - amountIn : quoteOut - (amountIn * pNum) / pDen;
    if (expectedProfit < m.minProfit) {
      return {
        action: "none",
        detail: `not profitable after the ${m.feeBps} bps fee: expected ${expectedProfit} raw USDC < min ${m.minProfit}`,
        direction,
        amountIn,
        amountOut: quoteOut,
        expectedProfitUsdc: expectedProfit,
        ...base,
      };
    }

    const minOut = (quoteOut * (BPS - BigInt(this.cfg.slippageBps))) / BPS;
    try {
      // Approve exactly what this trade needs, only if the current allowance is short. No infinite approvals.
      if (BigInt(await tokenIn.allowance(m.me, this.cfg.pool)) < amountIn) {
        await (await tokenIn.approve(this.cfg.pool, amountIn)).wait(this.cfg.confirmations);
      }
      const tx = await this.pool.swapExactIn(tokenInAddr, amountIn, minOut, m.me);
      const receipt = await tx.wait(this.cfg.confirmations);
      let out = quoteOut;
      for (const l of receipt?.logs ?? []) {
        const p = this.pool.interface.parseLog({ topics: [...l.topics], data: l.data });
        if (p?.name === "Swap") out = BigInt(p.args.amountOut);
      }
      return {
        action: "traded",
        detail: `${direction}, gap ${gapBps} bps, sized by ${limit}`,
        direction,
        amountIn,
        amountOut: out,
        expectedProfitUsdc: expectedProfit,
        txHash: receipt?.hash ?? tx.hash,
        ...base,
      };
    } catch (err) {
      return { action: "reverted", detail: `trade failed: ${revertName(err)}`, direction, amountIn, ...base };
    }
  }
}
