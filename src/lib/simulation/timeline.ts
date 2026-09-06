import type { Micros, RequestTrace, ScenarioSnapshot, TimelineBucket } from "../contracts";

/** Bucket index for a simulated timestamp. */
export function bucketIndex(timestampMs: number, bucketDurationMs: number): number {
  return Math.floor(timestampMs / bucketDurationMs);
}

/**
 * Fixed-width buckets covering the whole session, so both modes produce the same number of points.
 * Bucket i covers [i * width, (i + 1) * width). Cumulative values are as of the bucket end, which makes the
 * last bucket the session closing point.
 */
export function buildTimeline(snapshot: ScenarioSnapshot, traces: RequestTrace[]): TimelineBucket[] {
  const { sessionDurationMs, bucketDurationMs } = snapshot.config;
  const bucketCount = Math.ceil(sessionDurationMs / bucketDurationMs);
  const campaigns = snapshot.campaigns;

  const buckets: TimelineBucket[] = Array.from({ length: bucketCount }, (_, index) => ({
    index,
    startMs: index * bucketDurationMs,
    endMs: Math.min((index + 1) * bucketDurationMs, sessionDurationMs),
    requests: 0,
    filled: 0,
    emptyAuctions: 0,
    multiBidderAuctions: 0,
    revenueMicros: 0,
    cumulativeRevenueMicros: 0,
    avgClearingPriceMicros: null,
    avgParticipants: null,
    campaigns: campaigns.map((campaign) => ({
      campaignId: campaign.id,
      impressions: 0,
      spendMicros: 0,
      cumulativeSpendMicros: 0,
      targetMicros: 0,
    })),
  }));

  const campaignSlot = new Map<string, number>(campaigns.map((campaign, index) => [campaign.id, index]));
  const participantTotals = new Array<number>(bucketCount).fill(0);

  for (const trace of traces) {
    const index = Math.min(bucketIndex(trace.timestampMs, bucketDurationMs), bucketCount - 1);
    const bucket = buckets[index];
    bucket.requests += 1;
    participantTotals[index] += trace.participantCount;
    if (trace.participantCount >= 2) bucket.multiBidderAuctions += 1;
    if (trace.filled && trace.winnerCampaignId) {
      bucket.filled += 1;
      bucket.revenueMicros += trace.priceMicros;
      const slot = campaignSlot.get(trace.winnerCampaignId);
      if (slot !== undefined) {
        const metrics = bucket.campaigns[slot];
        metrics.impressions += 1;
        metrics.spendMicros += trace.priceMicros;
      }
    }
  }

  let cumulativeRevenue: Micros = 0;
  const cumulativeSpend = new Array<Micros>(campaigns.length).fill(0);

  for (const bucket of buckets) {
    bucket.emptyAuctions = bucket.requests - bucket.filled;
    cumulativeRevenue += bucket.revenueMicros;
    bucket.cumulativeRevenueMicros = cumulativeRevenue;
    bucket.avgClearingPriceMicros = bucket.filled === 0 ? null : bucket.revenueMicros / bucket.filled;
    bucket.avgParticipants = bucket.requests === 0 ? null : participantTotals[bucket.index] / bucket.requests;

    for (let slot = 0; slot < campaigns.length; slot += 1) {
      const metrics = bucket.campaigns[slot];
      cumulativeSpend[slot] += metrics.spendMicros;
      metrics.cumulativeSpendMicros = cumulativeSpend[slot];
      // Linear pacing target at the bucket end, reported for both modes so charts can show the reference line.
      metrics.targetMicros = (campaigns[slot].budgetMicros * bucket.endMs) / sessionDurationMs;
    }
  }

  return buckets;
}
