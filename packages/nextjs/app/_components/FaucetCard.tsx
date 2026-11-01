"use client";

import { useAccount } from "wagmi";
import { TxStatus } from "~~/app/_components/TxStatus";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useTxFlow } from "~~/hooks/streaming/useTxFlow";
import { fmtUsdc, fmtWbtc } from "~~/utils/streaming/format";

/** Test tokens for the demo: MockWBTC and MockUSDC have a capped public faucet. */
export const FaucetCard = () => {
  const { address } = useAccount();
  const { data: wbtc } = useScaffoldReadContract({
    contractName: "MockWBTC",
    functionName: "balanceOf",
    args: [address],
  });
  const { data: usdc } = useScaffoldReadContract({
    contractName: "MockUSDC",
    functionName: "balanceOf",
    args: [address],
  });
  const wbtcWrite = useScaffoldWriteContract({ contractName: "MockWBTC" });
  const usdcWrite = useScaffoldWriteContract({ contractName: "MockUSDC" });
  const flow = useTxFlow();

  return (
    <div className="card bg-base-100 shadow-md border border-base-300">
      <div className="card-body gap-3">
        <h2 className="card-title">Your test tokens</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="opacity-60 text-xs">WBTC</div>
            <div className="font-semibold text-base">{address ? fmtWbtc(wbtc) : "-"}</div>
          </div>
          <div>
            <div className="opacity-60 text-xs">USDC</div>
            <div className="font-semibold text-base">{address ? fmtUsdc(usdc) : "-"}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn btn-sm btn-outline"
            disabled={!address || flow.busy}
            onClick={() =>
              flow.execute([
                {
                  label: "Get 5 test WBTC",
                  run: () =>
                    wbtcWrite.writeContractAsync({ functionName: "faucet", args: [500_000_000n] }) as Promise<
                      string | undefined
                    >,
                },
              ])
            }
          >
            Get 5 test WBTC
          </button>
          <button
            className="btn btn-sm btn-outline"
            disabled={!address || flow.busy}
            onClick={() =>
              flow.execute([
                {
                  label: "Get 100,000 test USDC",
                  run: () =>
                    usdcWrite.writeContractAsync({ functionName: "faucet", args: [100_000_000_000n] }) as Promise<
                      string | undefined
                    >,
                },
              ])
            }
          >
            Get 100,000 test USDC
          </button>
        </div>
        <p className="text-xs opacity-60">Test tokens only. They have no value.</p>
        <TxStatus steps={flow.steps} />
      </div>
    </div>
  );
};
