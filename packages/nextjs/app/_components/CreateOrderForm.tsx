"use client";

import { useMemo, useState } from "react";
import { parseUnits } from "viem";
import { useAccount } from "wagmi";
import { TxStatus } from "~~/app/_components/TxStatus";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useMarket } from "~~/hooks/streaming/useMarket";
import { useTxFlow } from "~~/hooks/streaming/useTxFlow";
import { fmtDuration, fmtUsdc, fmtWbtc } from "~~/utils/streaming/format";
import { WBTC_DECIMALS, previewOrder, quoteUsdc, shortfallPct } from "~~/utils/streaming/math";

const MAX_SLICES = 200;
const INTERVAL_PRESETS = [
  { label: "1 min", secs: 60 },
  { label: "5 min", secs: 300 },
  { label: "1 hour", secs: 3600 },
];

const parseAmount = (s: string, decimals: number): bigint | undefined => {
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return undefined;
  try {
    return parseUnits(s, decimals);
  } catch {
    return undefined;
  }
};

export const CreateOrderForm = () => {
  const { address } = useAccount();
  const market = useMarket();
  const [total, setTotal] = useState("1");
  const [slices, setSlices] = useState("5");
  const [interval, setIntervalSecs] = useState("60");
  const [tolerance, setTolerance] = useState("3");
  const [confirming, setConfirming] = useState(false);
  const flow = useTxFlow();

  const { data: book } = useDeployedContractInfo({ contractName: "OrderBook" });
  const { data: balance } = useScaffoldReadContract({
    contractName: "MockWBTC",
    functionName: "balanceOf",
    args: [address],
  });
  const { data: allowance } = useScaffoldReadContract({
    contractName: "MockWBTC",
    functionName: "allowance",
    args: [address, book?.address],
  });
  const wbtcWrite = useScaffoldWriteContract({ contractName: "MockWBTC" });
  const bookWrite = useScaffoldWriteContract({ contractName: "OrderBook" });

  const totalRaw = parseAmount(total, WBTC_DECIMALS);
  const sliceCount = /^\d+$/.test(slices) ? Number(slices) : undefined;
  const intervalSecs = /^\d+$/.test(interval) ? Number(interval) : undefined;
  const tolPct = /^\d*\.?\d*$/.test(tolerance) && tolerance !== "" && tolerance !== "." ? Number(tolerance) : undefined;
  const toleranceBps = tolPct !== undefined ? Math.round(tolPct * 100) : undefined;

  const problems: string[] = [];
  if (totalRaw === undefined || totalRaw === 0n)
    problems.push("Enter how much WBTC to sell (more than 0, up to 8 decimals).");
  else if (balance !== undefined && totalRaw > balance)
    problems.push(`You only have ${fmtWbtc(balance)} WBTC. Use the faucet to get more test WBTC.`);
  if (sliceCount === undefined || sliceCount < 1 || sliceCount > MAX_SLICES)
    problems.push(`Slices must be a whole number from 1 to ${MAX_SLICES}.`);
  else if (totalRaw !== undefined && totalRaw > 0n && totalRaw < BigInt(sliceCount))
    problems.push("That is too little WBTC for this many slices. Use fewer slices.");
  if (intervalSecs === undefined || intervalSecs < 1) problems.push("Time between slices must be at least 1 second.");
  if (toleranceBps === undefined || toleranceBps < 0 || toleranceBps > 1000)
    problems.push("Allowed shortfall must be between 0% and 10%.");

  const preview = useMemo(
    () =>
      totalRaw &&
      sliceCount &&
      market.reserveWbtc !== undefined &&
      market.reserveUsdc !== undefined &&
      market.feeBps !== undefined
        ? previewOrder({
            total: totalRaw,
            slices: sliceCount,
            reserveWbtc: market.reserveWbtc,
            reserveUsdc: market.reserveUsdc,
            feeBps: market.feeBps,
          })
        : undefined,
    [totalRaw, sliceCount, market.reserveWbtc, market.reserveUsdc, market.feeBps],
  );

  // A slice must return at least the Chainlink-implied amount minus the tolerance, or it reverts.
  const toleranceTooTight =
    preview && market.oraclePriceE18 !== undefined && toleranceBps !== undefined
      ? preview.firstSliceOut <
        (quoteUsdc(preview.sliceSize, market.oraclePriceE18) * BigInt(10_000 - toleranceBps)) / 10_000n
      : false;

  const valid = problems.length === 0 && !!preview && !!address && !!book;
  const needsApproval = totalRaw !== undefined && allowance !== undefined && allowance < totalRaw;

  const submit = async () => {
    if (
      !valid ||
      totalRaw === undefined ||
      sliceCount === undefined ||
      intervalSecs === undefined ||
      toleranceBps === undefined ||
      !book
    )
      return;
    const plan: { label: string; run: () => Promise<string | undefined> }[] = [];
    if (needsApproval) {
      plan.push({
        label: `Allow the order book to take ${fmtWbtc(totalRaw)} WBTC`,
        run: () =>
          wbtcWrite.writeContractAsync({ functionName: "approve", args: [book.address, totalRaw] }) as Promise<
            string | undefined
          >,
      });
    }
    plan.push({
      label: `Create the order (${sliceCount} slices)`,
      run: () =>
        bookWrite.writeContractAsync({
          functionName: "createOrder",
          args: [totalRaw, sliceCount, intervalSecs, toleranceBps],
        }) as Promise<string | undefined>,
    });
    setConfirming(false);
    await flow.execute(plan);
  };

  const lumpShort = preview ? shortfallPct(preview.lumpOut, preview.spotValue) : 0;
  const noRefillShort = preview ? shortfallPct(preview.slicedNoRefillOut, preview.spotValue) : 0;
  const refillShort = preview ? shortfallPct(preview.slicedRefillOut, preview.spotValue) : 0;

  return (
    <div className="card bg-base-100 shadow-md border border-base-300">
      <div className="card-body gap-4">
        <h2 className="card-title">Create a streaming sell order</h2>
        <p className="text-sm opacity-70">
          Sell WBTC for USDC in equal slices over time instead of all at once, so each slice moves the price less.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="form-control">
            <span className="label-text text-sm">Total to sell (WBTC)</span>
            <input
              className="input input-bordered w-full"
              inputMode="decimal"
              value={total}
              onChange={e => setTotal(e.target.value.trim())}
            />
            <span className="label-text-alt opacity-60">Balance: {address ? fmtWbtc(balance) : "connect wallet"}</span>
          </label>
          <label className="form-control">
            <span className="label-text text-sm">Number of slices (1 to {MAX_SLICES})</span>
            <input
              className="input input-bordered w-full"
              inputMode="numeric"
              value={slices}
              onChange={e => setSlices(e.target.value.trim())}
            />
          </label>
          <label className="form-control">
            <span className="label-text text-sm">Time between slices (seconds)</span>
            <input
              className="input input-bordered w-full"
              inputMode="numeric"
              value={interval}
              onChange={e => setIntervalSecs(e.target.value.trim())}
            />
            <span className="flex gap-1 mt-1">
              {INTERVAL_PRESETS.map(p => (
                <button
                  type="button"
                  key={p.secs}
                  className="btn btn-xs btn-ghost"
                  onClick={() => setIntervalSecs(String(p.secs))}
                >
                  {p.label}
                </button>
              ))}
            </span>
          </label>
          <label className="form-control">
            <span className="label-text text-sm">Allowed shortfall per slice (%)</span>
            <input
              className="input input-bordered w-full"
              inputMode="decimal"
              value={tolerance}
              onChange={e => setTolerance(e.target.value.trim())}
            />
            <span className="label-text-alt opacity-60">
              A slice is cancelled if it would sell this far below the Chainlink price.
            </span>
          </label>
        </div>

        {preview && sliceCount && intervalSecs ? (
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <caption className="text-left font-semibold pb-1">
                What you would get (estimate, {sliceCount} slices of {fmtWbtc(preview.sliceSize)} WBTC, finishing in
                about {fmtDuration(intervalSecs * sliceCount)})
              </caption>
              <thead>
                <tr>
                  <th>How</th>
                  <th className="text-right">USDC</th>
                  <th className="text-right">Price impact + fee</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Lump sum, now</td>
                  <td className="text-right">{fmtUsdc(preview.lumpOut)}</td>
                  <td className="text-right">{lumpShort.toFixed(2)}%</td>
                </tr>
                <tr>
                  <td>Sliced, pool not refilled</td>
                  <td className="text-right">{fmtUsdc(preview.slicedNoRefillOut)}</td>
                  <td className="text-right">{noRefillShort.toFixed(2)}%</td>
                </tr>
                <tr className="font-semibold">
                  <td>Sliced, pool refilled between slices</td>
                  <td className="text-right">{fmtUsdc(preview.slicedRefillOut)}</td>
                  <td className="text-right">{refillShort.toFixed(2)}%</td>
                </tr>
              </tbody>
            </table>
            <p className="text-xs opacity-60 mt-1">
              Measured against the current pool price. Slicing only helps if traders (arbitrage) restore the pool price
              between slices; without that it is about the same as selling at once and later slices may be skipped. The
              swap fee is {market.feeBps !== undefined ? Number(market.feeBps) / 100 : 0.3}% of each slice.
            </p>
          </div>
        ) : null}

        {toleranceTooTight && (
          <div role="alert" className="alert alert-warning text-sm">
            At the current pool price even the first slice would sell further below Chainlink than your allowed
            shortfall, so it would be rejected. Raise the allowed shortfall or use more, smaller slices.
          </div>
        )}
        {problems.length > 0 && (
          <ul className="text-sm text-warning list-disc pl-5">
            {problems.map(p => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}

        <div className="card-actions">
          <button className="btn btn-primary" disabled={!valid || flow.busy} onClick={() => setConfirming(true)}>
            {!address ? "Connect a wallet first" : flow.busy ? "Working…" : "Review order"}
          </button>
        </div>
        <TxStatus steps={flow.steps} />
      </div>

      {confirming && preview && totalRaw !== undefined && sliceCount && intervalSecs && toleranceBps !== undefined && (
        <dialog className="modal modal-open" aria-labelledby="confirm-title">
          <div className="modal-box">
            <h3 id="confirm-title" className="font-bold text-lg">
              Confirm what you are about to sign
            </h3>
            <ul className="py-3 space-y-2 text-sm">
              <li>
                You hand <b>{fmtWbtc(totalRaw)} WBTC</b> to the order book. It holds the WBTC until each slice is sold.
              </li>
              <li>
                It sells{" "}
                <b>
                  {sliceCount} slices of about {fmtWbtc(preview.sliceSize)} WBTC
                </b>
                , one every <b>{fmtDuration(intervalSecs)}</b>, for USDC through the pool (fee{" "}
                {market.feeBps !== undefined ? Number(market.feeBps) / 100 : 0.3}% each).
              </li>
              <li>
                A slice is refused if it would return more than <b>{(toleranceBps / 100).toFixed(2)}%</b> less USDC than
                the Chainlink price implies. If the pool price is far from Chainlink, the slice is skipped and retried
                later.
              </li>
              <li>
                Estimated total: <b>{fmtUsdc(preview.slicedRefillOut)}</b> USDC if the pool is refilled between slices,{" "}
                <b>{fmtUsdc(preview.slicedNoRefillOut)}</b> if not. Not guaranteed.
              </li>
              <li>You receive an order NFT. You can claim USDC at any time and cancel to get back unsold WBTC.</li>
              <li className="opacity-70">
                {needsApproval
                  ? "Your wallet will ask you to sign 2 transactions: first an approval for exactly this amount, then the order."
                  : "Your wallet will ask you to sign 1 transaction."}{" "}
                Each also costs a small network fee in ETH.
              </li>
            </ul>
            <div className="modal-action">
              <button className="btn" onClick={() => setConfirming(false)}>
                Go back
              </button>
              <button className="btn btn-primary" onClick={submit}>
                Confirm and sign
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setConfirming(false)} />
        </dialog>
      )}
    </div>
  );
};
