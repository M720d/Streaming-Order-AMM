"use client";

import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { CreateOrderForm } from "~~/app/_components/CreateOrderForm";
import { FaucetCard } from "~~/app/_components/FaucetCard";
import { OrderCard } from "~~/app/_components/OrderCard";
import { PoolCard } from "~~/app/_components/PoolCard";
import { StaleFeedBanner } from "~~/app/_components/StaleFeedBanner";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";
import { useMyOrders } from "~~/hooks/streaming/useMyOrders";

const Home: NextPage = () => {
  const { address, chain } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const { orders, isLoading, refetch } = useMyOrders();
  const wrongNetwork = !!address && chain?.id !== targetNetwork.id;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 flex flex-col gap-4">
      <header>
        <h1 className="text-3xl font-bold">Streaming Order AMM</h1>
        <p className="opacity-70">
          Sell WBTC for USDC in slices over time, checked against Chainlink. Network: <b>{targetNetwork.name}</b>.
        </p>
      </header>

      {wrongNetwork && (
        <div role="alert" className="alert alert-warning">
          Your wallet is on {chain?.name ?? "another network"}. Switch to {targetNetwork.name} to use this app.
        </div>
      )}
      <StaleFeedBanner />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-1">
          <PoolCard />
          <FaucetCard />
        </div>
        <div className="lg:col-span-2">
          <CreateOrderForm />
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Your orders</h2>
        {!address ? (
          <p className="opacity-70">Connect your wallet to see your orders.</p>
        ) : isLoading ? (
          <span className="loading loading-dots" />
        ) : orders.length === 0 ? (
          <p className="opacity-70">You have no open orders. Create one above.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {orders.map(o => (
              <OrderCard key={String(o.id)} order={o} onChanged={refetch} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default Home;
