// Pure helpers for the order preview. Same integer formula as Pool.sol, test/OrderBook.ts and the notebooks, so the
// preview matches what the contracts will do (floor division, fee taken from the input).
// Raw units: token0 = WBTC (8 decimals), token1 = USDC (6 decimals). Prices are USDC per whole WBTC scaled by 1e18.

export const WBTC_DECIMALS = 8;
export const USDC_DECIMALS = 6;
export const BPS = 10_000n;
const E18 = 10n ** 18n;

/** Output of a constant-product swap with the fee taken from the input. */
export const amountOut = (amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps: bigint): bigint => {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const withFee = amountIn * (BPS - feeBps);
  return (withFee * reserveOut) / (reserveIn * BPS + withFee);
};

/** The amounts a streaming order sells: equal slices, the last one also takes the rounding remainder. */
export const sliceAmounts = (total: bigint, slices: number): bigint[] => {
  if (slices < 1 || total < BigInt(slices)) return [];
  const size = total / BigInt(slices);
  return Array.from({ length: slices }, (_, i) => (i === slices - 1 ? total - size * BigInt(slices - 1) : size));
};

/** USDC raw units for `wbtcRaw` WBTC at `priceE18` (no fee, no impact). */
export const quoteUsdc = (wbtcRaw: bigint, priceE18: bigint): bigint =>
  (wbtcRaw * priceE18 * 10n ** BigInt(USDC_DECIMALS)) / (10n ** BigInt(WBTC_DECIMALS) * E18);

export type OrderPreview = {
  sliceCount: number;
  sliceSize: bigint;
  /** All WBTC in one swap, now. */
  lumpOut: bigint;
  /** Sliced, nobody refills the pool between slices (worst case). */
  slicedNoRefillOut: bigint;
  /** Sliced, an arbitrageur restores the pool before every slice (best case). */
  slicedRefillOut: bigint;
  /** Value of the same WBTC at the current pool spot price: the "no impact, no fee" reference. */
  spotValue: bigint;
  /** Output of the first slice alone, used to check the tolerance. */
  firstSliceOut: bigint;
};

export const previewOrder = (p: {
  total: bigint;
  slices: number;
  reserveWbtc: bigint;
  reserveUsdc: bigint;
  feeBps: bigint;
}): OrderPreview | undefined => {
  const parts = sliceAmounts(p.total, p.slices);
  if (!parts.length || p.reserveWbtc === 0n || p.reserveUsdc === 0n) return undefined;
  let r0 = p.reserveWbtc;
  let r1 = p.reserveUsdc;
  let noRefill = 0n;
  let refill = 0n;
  for (const a of parts) {
    const out = amountOut(a, r0, r1, p.feeBps);
    noRefill += out;
    r0 += a;
    r1 -= out;
    refill += amountOut(a, p.reserveWbtc, p.reserveUsdc, p.feeBps);
  }
  return {
    sliceCount: parts.length,
    sliceSize: parts[0],
    lumpOut: amountOut(p.total, p.reserveWbtc, p.reserveUsdc, p.feeBps),
    slicedNoRefillOut: noRefill,
    slicedRefillOut: refill,
    spotValue: (p.total * p.reserveUsdc) / p.reserveWbtc,
    firstSliceOut: amountOut(parts[0], p.reserveWbtc, p.reserveUsdc, p.feeBps),
  };
};

/** Shortfall of `out` against `reference`, in percent with two decimals (e.g. 4.13). Never negative. */
export const shortfallPct = (out: bigint, reference: bigint): number => {
  if (reference <= 0n || out >= reference) return 0;
  return Number(((reference - out) * 1_000_000n) / reference) / 10_000;
};
