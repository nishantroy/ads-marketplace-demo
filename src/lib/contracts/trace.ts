import type { Micros } from "./money";
import type { Category, Objective } from "./scenario";

/**
 * Stage records distinguish "not evaluated because an earlier stage rejected the candidate"
 * (`evaluated: false`) from "evaluated and rejected" (`evaluated: true` with a failing result).
 */
export type NotEvaluated = { evaluated: false };

export interface EligibilityStage {
  evaluated: true;
  remainingMicros: Micros;
  reserveMicros: Micros;
  passed: boolean;
}

export interface PacingStage {
  evaluated: true;
  pacingEnabled: boolean;
  /** session_budget × elapsed / duration, fractional micros. */
  targetMicros: number;
  spendSoFarMicros: Micros;
  /** clamp((target − spend) / bid, 0, 1); always 1 when pacing is off. */
  probability: number;
  /** Stable hash draw in [0, 1) keyed by (seed, requestId, campaignId, "pacing"). */
  draw: number;
  admitted: boolean;
}

export interface ScoringStage {
  evaluated: true;
  /** Objective-specific normalised prediction in [0, 1]. */
  base: number;
  /** User category relevance in [0, 1]. */
  relevance: number;
  /** base × relevance. */
  score: number;
  passedThreshold: boolean;
  /** 1-based rank among threshold-qualified candidates for this request; undefined when not qualified. */
  rank?: number;
  shortlisted: boolean;
}

export type AuctionRole = "winner" | "runner_up" | "other";

export interface AuctionStage {
  evaluated: true;
  /** min(bid, remaining budget). */
  effectiveBidMicros: Micros;
  /** effective bid ≥ reserve. Only participants can win or set the price. */
  participates: boolean;
  role: AuctionRole;
}

export type CandidateOutcome =
  | "won"
  | "lost"
  | "excluded_budget"
  | "excluded_pacing"
  | "excluded_threshold"
  | "excluded_shortlist"
  | "excluded_reserve";

export interface CandidateTrace {
  campaignId: string;
  objective: Objective;
  bidMicros: Micros;
  budgetBeforeMicros: Micros;
  budgetAfterMicros: Micros;
  eligibility: EligibilityStage;
  pacing: PacingStage | NotEvaluated;
  scoring: ScoringStage | NotEvaluated;
  auction: AuctionStage | NotEvaluated;
  outcome: CandidateOutcome;
}

export interface RequestTrace {
  requestId: string;
  /** 0-based position in the stable request order. */
  sequence: number;
  timestampMs: number;
  userId: string;
  category: Category;
  query?: string;
  /** Number of campaigns retrieved by category match. */
  retrievedCount: number;
  /**
   * Diagnostic only: how many retrieved campaigns would pass the score threshold for this user,
   * ignoring budget and pacing. Separates threshold qualification from later attrition.
   */
  thresholdQualifiedCount: number;
  /** Candidates in funnel order: shortlist by rank, then the rest by campaign id. */
  candidates: CandidateTrace[];
  /** Campaign ids on the shortlist in rank order. */
  shortlist: string[];
  /** Finalists with effective bid ≥ reserve. */
  participantCount: number;
  winnerCampaignId: string | null;
  runnerUpCampaignId: string | null;
  /** Clearing price charged to the winner; 0 when no winner. */
  priceMicros: Micros;
  filled: boolean;
}

/** Compact list-row projection of a trace. */
export interface RequestListItem {
  requestId: string;
  sequence: number;
  timestampMs: number;
  userId: string;
  category: Category;
  query?: string;
  retrievedCount: number;
  participantCount: number;
  winnerCampaignId: string | null;
  priceMicros: Micros;
  filled: boolean;
}
