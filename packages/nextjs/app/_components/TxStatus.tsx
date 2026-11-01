"use client";

import { CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/solid";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";
import type { TxStep } from "~~/hooks/streaming/useTxFlow";
import { shortHash } from "~~/utils/streaming/format";

/** Step-by-step transaction progress: waiting for the wallet and network, confirmed with a hash, or failed. */
export const TxStatus = ({ steps }: { steps: TxStep[] }) => {
  const { targetNetwork } = useTargetNetwork();
  const explorer = targetNetwork.blockExplorers?.default.url;
  if (!steps.length) return null;
  return (
    <ul className="steps steps-vertical text-sm w-full" aria-live="polite">
      {steps.map((s, i) => (
        <li
          key={i}
          className={`step ${s.state === "done" ? "step-success" : s.state === "failed" ? "step-error" : s.state === "sending" ? "step-primary" : ""}`}
        >
          <div className="text-left w-full pl-2">
            <div className="flex items-center gap-2">
              <span className="font-medium">{s.label}</span>
              {s.state === "sending" && <span className="loading loading-spinner loading-xs" />}
              {s.state === "done" && <CheckCircleIcon className="h-4 w-4 text-success" />}
              {s.state === "failed" && <XCircleIcon className="h-4 w-4 text-error" />}
            </div>
            {s.state === "waiting" && <div className="opacity-60">Queued</div>}
            {s.state === "sending" && (
              <div className="opacity-70">Confirm in your wallet, then wait for the network to include it…</div>
            )}
            {s.state === "done" && s.hash && (
              <div className="opacity-70 break-all">
                Confirmed{" "}
                {explorer ? (
                  <a className="link" href={`${explorer}/tx/${s.hash}`} target="_blank" rel="noreferrer">
                    {shortHash(s.hash)}
                  </a>
                ) : (
                  <span title={s.hash}>{shortHash(s.hash)}</span>
                )}
              </div>
            )}
            {s.state === "failed" && <div className="text-error whitespace-pre-line">{s.error}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
};
