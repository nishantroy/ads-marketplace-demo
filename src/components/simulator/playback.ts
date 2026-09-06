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

/** One campaign's complete cumulative-spend curve, optionally paired with its linear target. */
export function campaignSpendSeries(timeline: TimelineBucket[], campaignId: string | undefined, withTarget: boolean) {
  return [
    { time: 0, value: 0, target: withTarget ? 0 : undefined },
    ...timeline.map(bucket => {
      const metrics = bucket.campaigns.find(item => item.campaignId === campaignId);
      return { time: bucket.endMs, value: metrics?.cumulativeSpendMicros ?? 0, target: withTarget ? metrics?.targetMicros ?? 0 : undefined };
    }),
  ];
}

/** Average price the campaign paid per impression it won in each bucket; a gap (null), not zero, when it won nothing. */
export function campaignPriceSeries(timeline: TimelineBucket[], campaignId: string | undefined) {
  return timeline.map(bucket => {
    const metrics = bucket.campaigns.find(item => item.campaignId === campaignId);
    const value = metrics && metrics.impressions > 0 ? metrics.spendMicros / metrics.impressions : null;
    return { time: bucket.endMs, value };
  });
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
