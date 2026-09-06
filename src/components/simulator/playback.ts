import type { TimelineBucket } from "../../lib/contracts";

export function money(micros: number | null, digits = 2): string {
  if (micros === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(micros / 1_000_000);
}

export function sessionTime(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** A cursor counts completed buckets; zero means nothing has been revealed. */
export function playbackFrame(buckets: TimelineBucket[], cursor: number) {
  const visible = buckets.slice(0, Math.max(0, Math.min(Math.floor(cursor), buckets.length)));
  const latest = visible.at(-1);
  return {
    visible,
    latest,
    cutoffMs: latest?.endMs ?? 0,
    revenueMicros: latest?.cumulativeRevenueMicros ?? 0,
    requests: visible.reduce((sum, b) => sum + b.requests, 0),
    filled: visible.reduce((sum, b) => sum + b.filled, 0),
  };
}
