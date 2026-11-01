import { Contract, type ContractTransactionResponse, type Signer } from "ethers";
import { ORDER_BOOK_ABI } from "./abis.js";
import { chainTime, consoleLogger, logRecord, revertName, type Logger } from "./common.js";

export interface KeeperConfig {
  /** OrderBook address. */
  orderBook: string;
  /** First block to scan for OrderCreated. Set it to the OrderBook deployment block on a live network. */
  fromBlock: number;
  /** Largest eth_getLogs range per request (free RPC tiers cap this). */
  maxLogRange: number;
  /** Blocks re-scanned behind the last scanned block each tick, so a short reorg cannot hide an OrderCreated. */
  reorgDepth: number;
  /** Wall-clock seconds to wait before re-checking an order whose last attempt was refused or failed. */
  retryDelaySec: number;
  /** Seconds to wait for a receipt before the tx is parked as pending (never re-sent while pending). */
  txTimeoutSec: number;
  /** Blocks to wait for after inclusion. */
  confirmations: number;
  /** Send executeSlice even when the guard would skip it, so SliceSkipped is recorded on chain. Default: off. */
  sendSkips: boolean;
}

export const DEFAULT_KEEPER_CONFIG: Omit<KeeperConfig, "orderBook"> = {
  fromBlock: 0,
  maxLogRange: 500,
  reorgDepth: 5,
  retryDelaySec: 30,
  txTimeoutSec: 120,
  confirmations: 1,
  sendSkips: false,
};

export type KeeperStatus =
  | "filled" // executeSlice mined and emitted SliceExecuted
  | "skipped" // PriceGuard refused: pool price out of bounds. txHash only if sendSkips is on
  | "reverted" // the call reverts (simulated, nothing sent) or the mined tx reverted (txHash set)
  | "pending" // a tx sent earlier has no receipt yet; nothing new was sent
  | "error"; // RPC or signer failure

export interface KeeperResult {
  orderId: bigint;
  status: KeeperStatus;
  txHash?: string;
  detail: string;
  amountIn?: bigint;
  amountOut?: bigint;
  slicesLeft?: number;
}

interface PendingTx {
  hash: string;
  sentAtSec: number;
}

/**
 * Permissionless keeper for OrderBook.executeSlice.
 *
 * Safety against double-sending:
 *  1. One tx at a time, awaited, so the signer's nonce never races.
 *  2. A tx that did not confirm in time stays in `pending`; the order is not touched again until that tx has a
 *     receipt, so a slow network never produces a second tx for the same slice.
 *  3. Every send is preceded by a staticCall at the current state. An order that was already executed (by this
 *     keeper's earlier tx, another keeper, or anyone) reverts with TooEarly and nothing is sent.
 *  4. On chain, executeSlice itself refuses a second call inside the interval (TooEarly), so even a duplicate that
 *     slipped through could not move more than one slice.
 */
export class Keeper {
  readonly book: Contract;
  private readonly cfg: KeeperConfig;
  private readonly log: Logger;
  private readonly signer: Signer;
  private readonly tracked = new Set<bigint>();
  private readonly pending = new Map<bigint, PendingTx>();
  private readonly retryAfterSec = new Map<bigint, number>();
  private lastScanned: number;

  constructor(
    signer: Signer,
    cfg: Partial<KeeperConfig> & Pick<KeeperConfig, "orderBook">,
    log: Logger = consoleLogger,
  ) {
    this.signer = signer;
    this.cfg = { ...DEFAULT_KEEPER_CONFIG, ...cfg };
    this.log = log;
    this.book = new Contract(this.cfg.orderBook, ORDER_BOOK_ABI, signer);
    this.lastScanned = this.cfg.fromBlock - 1;
  }

  /** Order ids the keeper currently watches. */
  get watching(): bigint[] {
    return [...this.tracked];
  }

  /** One pass: discover new orders, then try every due order once. Returns what happened per order. */
  async tick(): Promise<KeeperResult[]> {
    const provider = this.signer.provider;
    if (!provider) throw new Error("keeper signer has no provider");
    await this.scan();
    const now = await chainTime(provider);
    const results: KeeperResult[] = [];

    for (const id of [...this.tracked]) {
      const res = await this.handle(id, now);
      if (res) {
        results.push(res);
        this.record(res);
      }
    }
    return results;
  }

  /** Picks up OrderCreated events since the last scanned block, in chunks of maxLogRange. */
  private async scan() {
    const provider = this.signer.provider!;
    const latest = await provider.getBlockNumber();
    // Re-scan a few blocks (discovery is idempotent) and follow the chain if it rolled back below our cursor.
    this.lastScanned = Math.min(this.lastScanned, latest) - this.cfg.reorgDepth;
    const filter = this.book.filters.OrderCreated();
    for (let from = Math.max(this.lastScanned + 1, this.cfg.fromBlock); from <= latest; from += this.cfg.maxLogRange) {
      const to = Math.min(from + this.cfg.maxLogRange - 1, latest);
      const logs = await this.book.queryFilter(filter, from, to);
      for (const l of logs) {
        const id = (l as unknown as { args: { orderId: bigint } }).args.orderId;
        if (!this.tracked.has(id)) {
          this.tracked.add(id);
          logRecord(this.log, "keeper", { event: "order-discovered", orderId: id, block: l.blockNumber });
        }
      }
      this.lastScanned = to;
    }
  }

  private async handle(id: bigint, now: bigint): Promise<KeeperResult | null> {
    const provider = this.signer.provider!;

    // A tx sent earlier that has not been seen mined: look at it before anything else.
    const pend = this.pending.get(id);
    if (pend) {
      const receipt = await provider.getTransactionReceipt(pend.hash);
      if (!receipt) {
        const waited = Math.floor(Date.now() / 1000) - pend.sentAtSec;
        return {
          orderId: id,
          status: "pending",
          txHash: pend.hash,
          detail: `no receipt after ${waited}s, not re-sending`,
        };
      }
      this.pending.delete(id);
      return this.fromReceipt(id, receipt.hash, receipt.status, receipt.logs);
    }

    const retryAt = this.retryAfterSec.get(id);
    if (retryAt !== undefined && Date.now() / 1000 < retryAt) return null;

    let order;
    try {
      order = await this.book.getOrder(id);
    } catch {
      // Cancelled orders burn the NFT, so getOrder reverts: stop watching.
      this.tracked.delete(id);
      logRecord(this.log, "keeper", { event: "order-dropped", orderId: id, reason: "cancelled or burned" });
      return null;
    }
    if (order.slicesLeft === 0n || Number(order.slicesLeft) === 0) {
      this.tracked.delete(id);
      logRecord(this.log, "keeper", { event: "order-dropped", orderId: id, reason: "all slices executed" });
      return null;
    }
    if (now < order.nextExecution) return null; // not due yet, nothing to say

    // Simulate first: no gas is spent on a call that would revert or be skipped.
    let wouldExecute: boolean;
    try {
      wouldExecute = (await this.book.executeSlice.staticCall(id)) as boolean;
    } catch (err) {
      if (revertName(err).startsWith("TooEarly")) return null; // someone else executed it first: nothing to do
      this.retryAfterSec.set(id, Date.now() / 1000 + this.cfg.retryDelaySec);
      return { orderId: id, status: "reverted", detail: `simulation reverted: ${revertName(err)} (not sent)` };
    }
    if (!wouldExecute && !this.cfg.sendSkips) {
      this.retryAfterSec.set(id, Date.now() / 1000 + this.cfg.retryDelaySec);
      return {
        orderId: id,
        status: "skipped",
        detail: "PriceGuard: pool price outside the oracle band (not sent, will re-check)",
      };
    }

    return this.send(id);
  }

  private async send(id: bigint): Promise<KeeperResult> {
    let tx: ContractTransactionResponse;
    try {
      tx = await this.book.executeSlice(id);
    } catch (err) {
      this.retryAfterSec.set(id, Date.now() / 1000 + this.cfg.retryDelaySec);
      return { orderId: id, status: "error", detail: `send failed: ${revertName(err)}` };
    }
    this.pending.set(id, { hash: tx.hash, sentAtSec: Math.floor(Date.now() / 1000) });

    let receipt;
    try {
      receipt = await tx.wait(this.cfg.confirmations, this.cfg.txTimeoutSec * 1000);
    } catch (err) {
      const e = err as { code?: string; receipt?: { status: number | null; logs: readonly unknown[] } };
      if (e.code === "CALL_EXCEPTION" && e.receipt) {
        // Mined but reverted.
        this.pending.delete(id);
        this.retryAfterSec.set(id, Date.now() / 1000 + this.cfg.retryDelaySec);
        return { orderId: id, status: "reverted", txHash: tx.hash, detail: "mined but reverted" };
      }
      // Timeout or RPC hiccup: leave it in `pending`; the next tick checks the receipt before doing anything.
      return {
        orderId: id,
        status: "pending",
        txHash: tx.hash,
        detail: `not confirmed within ${this.cfg.txTimeoutSec}s`,
      };
    }
    this.pending.delete(id);
    if (!receipt) return { orderId: id, status: "pending", txHash: tx.hash, detail: "no receipt yet" };
    return this.fromReceipt(id, receipt.hash, receipt.status, receipt.logs);
  }

  /** Turns a mined receipt into a result by reading our own events out of its logs. */
  private fromReceipt(
    id: bigint,
    hash: string,
    status: number | null,
    logs: readonly { topics: readonly string[]; data: string }[],
  ): KeeperResult {
    if (status !== 1) {
      this.retryAfterSec.set(id, Date.now() / 1000 + this.cfg.retryDelaySec);
      return { orderId: id, status: "reverted", txHash: hash, detail: "mined but reverted" };
    }
    for (const l of logs) {
      const parsed = this.book.interface.parseLog({ topics: [...l.topics], data: l.data });
      if (!parsed) continue;
      if (parsed.name === "SliceExecuted" && parsed.args.orderId === id) {
        this.retryAfterSec.delete(id);
        return {
          orderId: id,
          status: "filled",
          txHash: hash,
          detail: `slice executed, ${parsed.args.slicesLeft} left`,
          amountIn: parsed.args.amountIn,
          amountOut: parsed.args.amountOut,
          slicesLeft: Number(parsed.args.slicesLeft),
        };
      }
      if (parsed.name === "SliceSkipped" && parsed.args.orderId === id) {
        this.retryAfterSec.set(id, Date.now() / 1000 + this.cfg.retryDelaySec);
        return {
          orderId: id,
          status: "skipped",
          txHash: hash,
          detail: `PriceGuard skip recorded on chain (pool ${parsed.args.poolPriceE18}, oracle ${parsed.args.oraclePriceE18})`,
        };
      }
    }
    return {
      orderId: id,
      status: "error",
      txHash: hash,
      detail: "mined ok but no SliceExecuted/SliceSkipped event for this order",
    };
  }

  private record(r: KeeperResult) {
    logRecord(this.log, "keeper", {
      event: r.status,
      orderId: r.orderId,
      txHash: r.txHash ?? null,
      detail: r.detail,
      amountIn: r.amountIn,
      amountOut: r.amountOut,
      slicesLeft: r.slicesLeft,
    });
  }
}
