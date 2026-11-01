import { useMemo } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { useDeployedContractInfo, useScaffoldEventHistory, useTargetNetwork } from "~~/hooks/scaffold-eth";

export type MyOrder = {
  id: bigint;
  /** Slices the order was created with (from the OrderCreated event). */
  totalSlices: number;
  totalIn: bigint;
  remainingIn: bigint;
  proceeds: bigint;
  slicesLeft: number;
  interval: number;
  nextExecution: number;
  toleranceBps: number;
  skips: number;
};

/** Orders the connected wallet currently holds, newest first. Cancelled (burned) orders are left out. */
export const useMyOrders = () => {
  const { address } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const { data: book } = useDeployedContractInfo({ contractName: "OrderBook" });

  const created = useScaffoldEventHistory({
    contractName: "OrderBook",
    eventName: "OrderCreated",
    fromBlock: 0n,
    watch: true,
    enabled: !!address,
  });
  const skipped = useScaffoldEventHistory({
    contractName: "OrderBook",
    eventName: "SliceSkipped",
    fromBlock: 0n,
    watch: true,
    enabled: !!address,
  });

  // Anyone can receive an order NFT, so ownership is checked on chain instead of trusting the creator in the event.
  const candidates = useMemo(
    () =>
      (created.data ?? []).map(e => ({
        id: e.args.orderId as bigint,
        totalIn: e.args.totalIn as bigint,
        slices: Number(e.args.slices),
      })),
    [created.data],
  );

  const contracts = useMemo(
    () =>
      book
        ? candidates.flatMap(c => [
            { address: book.address, abi: book.abi, functionName: "ownerOf", args: [c.id], chainId: targetNetwork.id },
            { address: book.address, abi: book.abi, functionName: "getOrder", args: [c.id], chainId: targetNetwork.id },
          ])
        : [],
    [book, candidates, targetNetwork.id],
  );
  const reads = useReadContracts({
    contracts: contracts as any,
    query: { enabled: contracts.length > 0 && !!address, refetchInterval: 4000 },
  });

  const orders: MyOrder[] = useMemo(() => {
    if (!reads.data || !address) return [];
    const skipCount = new Map<string, number>();
    for (const e of skipped.data ?? []) {
      const k = String(e.args.orderId);
      skipCount.set(k, (skipCount.get(k) ?? 0) + 1);
    }
    const out: MyOrder[] = [];
    candidates.forEach((c, i) => {
      const owner = reads.data[2 * i];
      const order = reads.data[2 * i + 1];
      if (owner?.status !== "success" || order?.status !== "success") return;
      if ((owner.result as string).toLowerCase() !== address.toLowerCase()) return;
      const o = order.result as any;
      out.push({
        id: c.id,
        totalSlices: c.slices,
        totalIn: c.totalIn,
        remainingIn: o.remainingIn,
        proceeds: o.proceeds,
        slicesLeft: Number(o.slicesLeft),
        interval: Number(o.interval),
        nextExecution: Number(o.nextExecution),
        toleranceBps: Number(o.toleranceBps),
        skips: skipCount.get(String(c.id)) ?? 0,
      });
    });
    return out.sort((a, b) => (a.id < b.id ? 1 : -1));
  }, [reads.data, candidates, address, skipped.data]);

  return { orders, isLoading: created.isLoading || reads.isLoading, refetch: reads.refetch };
};
