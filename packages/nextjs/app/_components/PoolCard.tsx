"use client";

import { useMarket } from "~~/hooks/streaming/useMarket";
import { fmtPrice, fmtUsdc, fmtWbtc } from "~~/utils/streaming/format";

export const PoolCard = () => {
  const m = useMarket();
  const gap = m.gapBps === undefined ? undefined : (m.gapBps / 100).toFixed(2);
  return (
    <div className="card bg-base-100 shadow-md border border-base-300">
      <div className="card-body gap-3">
        <h2 className="card-title">Pool</h2>
        {m.isLoading ? (
          <span className="loading loading-dots" />
        ) : (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="WBTC reserve" value={fmtWbtc(m.reserveWbtc, 4)} />
            <Stat label="USDC reserve" value={fmtUsdc(m.reserveUsdc, 0)} />
            <Stat label="Pool price" value={fmtPrice(m.spotPriceE18)} hint="USDC per WBTC" />
            <Stat
              label="Chainlink price"
              value={m.feedHealth === "ok" ? fmtPrice(m.oraclePriceE18) : "unavailable"}
              hint={gap !== undefined ? `pool is ${gap}% away` : undefined}
            />
            <Stat label="Swap fee" value={m.feeBps !== undefined ? `${Number(m.feeBps) / 100}%` : "-"} />
            <Stat
              label="Safety band"
              value={m.maxDeviationBps !== undefined ? `±${Number(m.maxDeviationBps) / 100}%` : "-"}
              hint="slices skip outside it"
            />
          </div>
        )}
      </div>
    </div>
  );
};

const Stat = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div>
    <div className="opacity-60 text-xs">{label}</div>
    <div className="font-semibold text-base">{value}</div>
    {hint && <div className="opacity-60 text-xs">{hint}</div>}
  </div>
);
