import type { Micros } from "./money";
import type { RequestTrace } from "./trace";

export interface CampaignBucketMetrics {
  campaignId: string;
  impressions: number;
  /** Spend inside this bucket. */
  spendMicros: Micros;
  /** Spend from session start through the end of this bucket. */
  cumulativeSpendMicros: Micros;
  /** Linear pacing target at the end of this bucket (reported for both modes). */
  targetMicros: number;
}

/** Metrics for one five-minute bucket; cumulative values are as of the bucket end. */
export interface TimelineBucket {
  index: number;
  startMs: number;
  endMs: number;
  requests: number;
  filled: number;
  /** requests − filled. */
  emptyAuctions: number;
  /** Auctions with at least two participants. */
  multiBidderAuctions: number;
  revenueMicros: Micros;
  cumulativeRevenueMicros: Micros;
  /** Mean clearing price over filled impressions in this bucket; null when nothing was filled. */
  avgClearingPriceMicros: number | null;
  /** Mean number of auction participants per request in this bucket; null when no requests. */
  avgParticipants: number | null;
  campaigns: CampaignBucketMetrics[];
}

export interface CampaignSummary {
  campaignId: string;
  budgetMicros: Micros;
  spendMicros: Micros;
  impressions: number;
  /** Simulated time at which remaining budget fell below the reserve; null if never. */
  exhaustedAtMs: number | null;
}

export interface RunSummary {
  totalRequests: number;
  filledRequests: number;
  emptyAuctions: number;
  multiBidderAuctions: number;
  /** Requests with at least one threshold-qualified retrieved campaign (before budget/pacing). */
  thresholdQualifiedRequests: number;
  /** Requests with at least two threshold-qualified retrieved campaigns (coverage target). */
  thresholdQualifiedPairRequests: number;
  /** Sum of clearing prices; equals total campaign spend. */
  revenueMicros: Micros;
  avgClearingPriceMicros: number | null;
  campaigns: CampaignSummary[];
}

export type RunStatus = "running" | "completed" | "failed";

export interface RunRecord {
  id: string;
  scenarioId: string;
  scenarioVersion: string;
  engineVersion: string;
  /** Hash of the scenario snapshot (mode excluded). Only runs with equal hash and engine version are comparable. */
  inputHash: string;
  pacingEnabled: boolean;
  status: RunStatus;
  createdAt: string;
  completedAt?: string;
  summary?: RunSummary;
  error?: string;
}

/** Everything the engine produces for one run. */
export interface RunOutput {
  summary: RunSummary;
  timeline: TimelineBucket[];
  traces: RequestTrace[];
}
