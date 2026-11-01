"use client";

import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useMarket } from "~~/hooks/streaming/useMarket";
import { fmtDuration } from "~~/utils/streaming/format";

/** Warns when the Chainlink feed is stale, invalid, or about to be, because the order book pauses slices then. */
export const StaleFeedBanner = () => {
  const { feedHealth, feedAging, feedAgeSec, maxStaleness, poolOutsideBand, gapBps } = useMarket();

  if (feedHealth === "stale" || feedHealth === "invalid") {
    return (
      <div role="alert" className="alert alert-error">
        <ExclamationTriangleIcon className="h-6 w-6 shrink-0" />
        <div>
          <p className="font-bold">
            The Chainlink price feed is {feedHealth === "stale" ? "stale" : "returning an invalid price"}
          </p>
          <p className="text-sm">
            Slices of every order are paused until it recovers
            {feedAgeSec !== undefined ? ` (last update ${fmtDuration(feedAgeSec)} ago)` : ""}. Your funds are safe: you
            can still cancel an order at any time. Creating a new order now is possible but nothing will be sold until
            the feed is fresh.
          </p>
        </div>
      </div>
    );
  }
  if (feedAging) {
    return (
      <div role="alert" className="alert alert-warning">
        <ExclamationTriangleIcon className="h-6 w-6 shrink-0" />
        <p className="text-sm">
          The price feed was last updated {fmtDuration(feedAgeSec ?? 0)} ago. Slices pause if it is older than{" "}
          {fmtDuration(Number(maxStaleness))}.
        </p>
      </div>
    );
  }
  if (poolOutsideBand) {
    return (
      <div role="alert" className="alert alert-warning">
        <ExclamationTriangleIcon className="h-6 w-6 shrink-0" />
        <p className="text-sm">
          The pool price is {((gapBps ?? 0) / 100).toFixed(2)}% away from Chainlink, outside the safety band. Slices are
          skipped until an arbitrageur brings the pool back.
        </p>
      </div>
    );
  }
  return null;
};
