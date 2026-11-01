import { useCallback, useState } from "react";
import { getParsedError } from "~~/utils/scaffold-eth";

export type TxStepState = "waiting" | "sending" | "done" | "failed";
export type TxStep = { label: string; state: TxStepState; hash?: string; error?: string };

/**
 * Tracks a short sequence of transactions (for example approve, then create) so the page can show where the user
 * is: waiting for the wallet and the network, confirmed with a hash, or failed with a plain-language reason.
 * Each `run` function must resolve to the transaction hash (the scaffold write hook does), or undefined when
 * nothing was sent.
 */
export const useTxFlow = () => {
  const [steps, setSteps] = useState<TxStep[]>([]);
  const [busy, setBusy] = useState(false);

  const execute = useCallback(async (plan: { label: string; run: () => Promise<string | undefined> }[]) => {
    setBusy(true);
    setSteps(plan.map(p => ({ label: p.label, state: "waiting" })));
    let ok = true;
    for (let i = 0; i < plan.length; i++) {
      const update = (patch: Partial<TxStep>) =>
        setSteps(prev => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
      update({ state: "sending" });
      try {
        const hash = await plan[i].run();
        if (!hash) {
          update({
            state: "failed",
            error: "Nothing was sent. Check that your wallet is connected to the right network.",
          });
          ok = false;
          break;
        }
        update({ state: "done", hash });
      } catch (e) {
        update({ state: "failed", error: getParsedError(e) });
        ok = false;
        break;
      }
    }
    setBusy(false);
    return ok;
  }, []);

  const reset = useCallback(() => setSteps([]), []);
  return { steps, busy, execute, reset };
};
