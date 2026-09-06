import type { Micros } from "./money";

/** Category identifier, e.g. "travel". Category alone drives retrieval. */
export type Category = string;

export type Objective = "impression" | "click" | "conversion";

/**
 * A user segment, e.g. "bargain". Campaigns declare an affinity per segment, which is what makes
 * relevance a property of the user-campaign pair rather than of the category alone.
 */
export type Segment = string;

export const OBJECTIVES: readonly Objective[] = ["impression", "click", "conversion"];

/** Fixed scenario parameters. Normalisation uses these, never live candidate-pool statistics. */
export interface ScenarioConfig {
  /** Session length in simulated milliseconds. Budgets apply to this session. */
  sessionDurationMs: number;
  /** Timeline bucket width in simulated milliseconds (5 minutes → 72 buckets over 6 hours). */
  bucketDurationMs: number;
  /** Auction reserve price. Must be positive. */
  reserveMicros: Micros;
  /** Minimum quality to pass the gate, in (0, 1]. Quality is engagement x pair relevance. */
  qualityThreshold: number;
  /** Maximum number of quality-qualified candidates that reach the auction, ranked by utility. */
  shortlistSize: number;
  /** Fixed scale that maps a historical click-through rate to a [0, 1] base score. */
  ctrScale: number;
  /** Fixed scale that maps a historical per-impression conversion rate to a [0, 1] base score. */
  cvrScale: number;
}

export interface User {
  id: string;
  name: string;
  /** Which segment this user belongs to; campaigns target segments. */
  segment: Segment;
  /** Relevance of each category to this user, in [0, 1]. Missing category means 0. */
  relevance: Record<Category, number>;
}

interface CampaignBase {
  id: string;
  name: string;
  category: Category;
  /** Maximum bid per impression. Must be positive. */
  bidMicros: Micros;
  /** Session budget. Must be positive. */
  budgetMicros: Micros;
  /**
   * How well this campaign fits each user segment, in [0, 1]. A missing segment means 0.
   * Combined with the user's category relevance this gives a per-pair relevance, so ranking order can
   * differ from one request to the next instead of being a fixed leaderboard.
   */
  affinity: Record<Segment, number>;
}

export type Campaign = CampaignBase &
  (
    | { objective: "impression"; qualityPrior: number }
    | { objective: "click"; historicalCtr: number }
    | { objective: "conversion"; historicalCvr: number }
  );

export interface SimRequest {
  id: string;
  /** Simulated time since session start, in [0, sessionDurationMs). */
  timestampMs: number;
  userId: string;
  category: Category;
  /** Optional illustrative query text; not used by retrieval. */
  query?: string;
}

/**
 * Immutable, versioned input for one simulation run. Both pacing modes consume the identical snapshot.
 * Requests are stored in stable order (timestamp, then id).
 */
export interface ScenarioSnapshot {
  scenarioId: string;
  /** Fixture/parameter version, bumped whenever generation logic or defaults change. */
  version: string;
  /** Seed string used both for scenario generation and for request–campaign keyed pacing randomness. */
  seed: string;
  categories: Category[];
  segments: Segment[];
  config: ScenarioConfig;
  users: User[];
  campaigns: Campaign[];
  requests: SimRequest[];
}

/** Scenario without the request stream, for lightweight API responses. */
export type ScenarioSummary = Omit<ScenarioSnapshot, "requests"> & {
  requestCount: number;
  inputHash: string;
};
