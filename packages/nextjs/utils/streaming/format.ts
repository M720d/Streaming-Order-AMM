import { formatUnits } from "viem";
import { USDC_DECIMALS, WBTC_DECIMALS } from "~~/utils/streaming/math";

const trim = (s: string, maxFrac: number) => {
  const [whole, frac = ""] = s.split(".");
  const f = frac.slice(0, maxFrac).replace(/0+$/, "");
  return `${Number(whole).toLocaleString("en-US")}${f ? `.${f}` : ""}`;
};

export const fmtWbtc = (raw: bigint | undefined, maxFrac = 6) =>
  raw === undefined ? "-" : trim(formatUnits(raw, WBTC_DECIMALS), maxFrac);
export const fmtUsdc = (raw: bigint | undefined, maxFrac = 2) =>
  raw === undefined ? "-" : trim(formatUnits(raw, USDC_DECIMALS), maxFrac);
/** priceE18 is USDC per whole WBTC scaled by 1e18. */
export const fmtPrice = (priceE18: bigint | undefined) =>
  priceE18 === undefined ? "-" : `$${trim(formatUnits(priceE18, 18), 2)}`;

export const fmtDuration = (secs: number) => {
  if (secs < 0) secs = 0;
  if (secs < 90) return `${secs}s`;
  if (secs < 5400) return `${Math.round(secs / 60)} min`;
  if (secs < 172800) return `${(secs / 3600).toFixed(1)} h`;
  return `${(secs / 86400).toFixed(1)} days`;
};

export const shortHash = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;
