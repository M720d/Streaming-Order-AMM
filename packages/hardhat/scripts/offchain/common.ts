import type { Provider } from "ethers";

/** One log line sink. The CLIs print to stdout; the tests collect lines. */
export type Logger = (line: string) => void;

export const consoleLogger: Logger = line => console.log(line);

/** Single-line JSON log record with an ISO timestamp (wall clock; chain time is a separate field when it matters). */
export function logRecord(log: Logger, source: "keeper" | "arb", record: Record<string, unknown>) {
  log(
    JSON.stringify({ ts: new Date().toISOString(), source, ...record }, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
  );
}

/** Timestamp of the latest block. All schedule checks use chain time, never the wall clock. */
export async function chainTime(provider: Provider): Promise<bigint> {
  const block = await provider.getBlock("latest");
  if (!block) throw new Error("provider returned no latest block");
  return BigInt(block.timestamp);
}

/** Integer square root (floor), Newton's method. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("isqrt of a negative number");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** Reads an env var, throwing a clear message when a required one is missing. Never prints the value. */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v.trim();
}

export function numEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Env var ${name} must be a non-negative number, got "${v}"`);
  return n;
}

export function boolEnv(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") return fallback;
  return ["1", "true", "yes"].includes(v.trim().toLowerCase());
}

/** Best-effort decoded name of a contract revert, e.g. "TooEarly" or "StalePrice". */
export function revertName(err: unknown): string {
  const e = err as {
    revert?: { name?: string; args?: unknown[] };
    shortMessage?: string;
    message?: string;
    info?: { error?: { message?: string } };
    error?: { message?: string };
  };
  if (e?.revert?.name) {
    const args = e.revert.args?.length ? `(${e.revert.args.map(a => String(a)).join(", ")})` : "";
    return `${e.revert.name}${args}`;
  }
  // ethers hides the node's own message (e.g. "Sender doesn't have enough funds") under info.error / error.
  const nested = e?.info?.error?.message ?? e?.error?.message;
  return nested ? `${e?.shortMessage ?? "error"}: ${nested}` : (e?.shortMessage ?? e?.message ?? String(err));
}
