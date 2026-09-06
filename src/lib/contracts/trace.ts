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

/**
 * The quality gate. Quality is what the user is predicted to get out of the ad: how engaging the campaign
 * is, times how well it matches this particular user. It decides participation only; ordering is decided by
 * utility in the ranking stage below.
 */
export interface ScoringStage {
  evaluated: true;
  /** Objective-specific normalised engagement prediction in [0, 1]. */
  base: number;
  /** This user's relevance for the campaign's category, in [0, 1]. */
  categoryRelevance: number;
  /** The campaign's affinity for this user's segment, in [0, 1]. */
  affinity: number;
  /** categoryRelevance x affinity: relevance of this campaign to this user. */
  relevance: number;
  /** base x relevance. */
  quality: number;
  passedThreshold: boolean;
}

/**
 * Ranking by utility: what the impression is worth to everyone at once. Bid carries the platform's value,
 * quality carries the user's and the advertiser's. A cheaper, better-matched campaign can outrank a
 * more expensive, poorly-matched one, which is the whole point of ranking on utility rather than bid.
 */
export interface RankingStage {
  evaluated: true;
  /** min(bid, remaining budget): a campaign can never be charged more than it can pay. */
  effectiveBidMicros: Micros;
  /** effectiveBidMicros x quality, in micro-utility. */
  utility: number;
  /** 1-based rank by utility among quality-qualified candidates for this request. */
  rank: number;
  shortlisted: boolean;
}

export type AuctionRole = "winner" | "runner_up" | "other";

export interface AuctionStage {
  evaluated: true;
  /** effective bid >= reserve. Only participants can win or set the price. */
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
  ranking: RankingStage | NotEvaluated;
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
   * Diagnostic only: how many retrieved campaigns would pass the quality gate for this user,
   * ignoring budget and pacing. Separates gate qualification from later attrition.
   */
  thresholdQualifiedCount: number;
  /** Candidates in funnel order: shortlist by utility rank, then the rest by campaign id. */
  candidates: CandidateTrace[];
  /** Campaign ids on the shortlist in utility rank order. */
  shortlist: string[];
  /** Finalists with effective bid ≥ reserve. */
  participantCount: number;
  winnerCampaignId: string | null;
  runnerUpCampaignId: string | null;
  /** Clearing price charged to the winner; 0 when no winner. */
  priceMicros: Micros;
  /**
   * How the price was derived: the runner-up's utility divided by the winner's quality, floored at the
   * reserve. Null when there was no runner-up, in which case the winner pays the reserve.
   */
  priceBasis: { runnerUpUtility: number; winnerQuality: number } | null;
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
