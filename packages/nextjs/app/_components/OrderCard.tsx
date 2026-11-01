"use client";

import { useState } from "react";
import { TxStatus } from "~~/app/_components/TxStatus";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useNowSec } from "~~/hooks/streaming/useMarket";
import type { MyOrder } from "~~/hooks/streaming/useMyOrders";
import { useTxFlow } from "~~/hooks/streaming/useTxFlow";
import { fmtDuration, fmtUsdc, fmtWbtc } from "~~/utils/streaming/format";

export const OrderCard = ({ order, onChanged }: { order: MyOrder; onChanged: () => void }) => {
  const now = useNowSec();
  const flow = useTxFlow();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const book = useScaffoldWriteContract({ contractName: "OrderBook" });

  const done = order.totalSlices - order.slicesLeft;
  const finished = order.slicesLeft === 0;
  const due = !finished && now >= order.nextExecution;
  const secsToNext = order.nextExecution - now;

  let status: string;
  if (finished)
    status =
      order.proceeds > 0n
        ? "Finished. Your USDC is ready to claim."
        : "Finished. Everything has been sold and claimed.";
  else if (due) status = "A slice is due. A keeper will run it, or you can run it yourself below.";
  else status = `Next slice in ${fmtDuration(secsToNext)}.`;

  const act = async (label: string, fn: () => Promise<unknown>) => {
    const ok = await flow.execute([{ label, run: fn as () => Promise<string | undefined> }]);
    if (ok) onChanged();
  };

  return (
    <div className="card bg-base-100 shadow-md border border-base-300">
      <div className="card-body gap-3">
        <div className="flex items-center justify-between">
          <h3 className="card-title text-base">Order #{String(order.id)}</h3>
          <span className={`badge ${finished ? "badge-success" : due ? "badge-warning" : "badge-info"}`}>
            {finished ? "Finished" : due ? "Due" : "Running"}
          </span>
        </div>

        <div>
          <div className="flex justify-between text-xs mb-1">
            <span>
              {done} of {order.totalSlices} slices sold
            </span>
            <span>{Math.round((done / order.totalSlices) * 100)}%</span>
          </div>
          <progress
            className="progress progress-primary w-full"
            value={done}
            max={order.totalSlices}
            aria-label="Slices executed"
          />
        </div>
        <p className="text-sm">{status}</p>

        <div className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <div className="opacity-60 text-xs">Still to sell</div>
            <div className="font-semibold">{fmtWbtc(order.remainingIn)} WBTC</div>
          </div>
          <div>
            <div className="opacity-60 text-xs">USDC to claim</div>
            <div className="font-semibold">{fmtUsdc(order.proceeds)}</div>
          </div>
          <div>
            <div className="opacity-60 text-xs">Slices skipped</div>
            <div className="font-semibold">{order.skips}</div>
          </div>
        </div>

        <div className="card-actions">
          {due && (
            <button
              className="btn btn-sm btn-outline"
              disabled={flow.busy}
              onClick={() =>
                act("Run the next slice", () =>
                  book.writeContractAsync({ functionName: "executeSlice", args: [order.id] }),
                )
              }
            >
              Run next slice
            </button>
          )}
          <button
            className="btn btn-sm btn-primary"
            disabled={flow.busy || order.proceeds === 0n}
            onClick={() =>
              act(`Claim ${fmtUsdc(order.proceeds)} USDC`, () =>
                book.writeContractAsync({ functionName: "claim", args: [order.id] }),
              )
            }
          >
            Claim USDC
          </button>
          <button
            className="btn btn-sm btn-error btn-outline"
            disabled={flow.busy}
            onClick={() => setConfirmCancel(true)}
          >
            Cancel order
          </button>
        </div>
        <TxStatus steps={flow.steps} />
      </div>

      {confirmCancel && (
        <dialog className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Cancel order #{String(order.id)}?</h3>
            <p className="py-3 text-sm">
              You get back <b>{fmtWbtc(order.remainingIn)} WBTC</b> that has not been sold
              {order.proceeds > 0n ? (
                <>
                  {" "}
                  and <b>{fmtUsdc(order.proceeds)} USDC</b> already earned
                </>
              ) : null}
              . The order NFT is destroyed and the slices already sold stay sold. This cannot be undone.
            </p>
            <div className="modal-action">
              <button className="btn" onClick={() => setConfirmCancel(false)}>
                Keep order
              </button>
              <button
                className="btn btn-error"
                onClick={() => {
                  setConfirmCancel(false);
                  void act("Cancel the order", () =>
                    book.writeContractAsync({ functionName: "cancel", args: [order.id] }),
                  );
                }}
              >
                Cancel order
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setConfirmCancel(false)} />
        </dialog>
      )}
    </div>
  );
};
