import type { Campaign, ScenarioConfig, User } from "../contracts";

export function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

/**
 * Objective-specific normalised prediction in [0, 1]. Fixed per campaign; uses scenario scales only.
 *   impression: quality_prior
 *   click:      historical_ctr / ctr_scale
 *   conversion: historical_cvr / cvr_scale
 */
export function baseScore(campaign: Campaign, config: ScenarioConfig): number {
  switch (campaign.objective) {
    case "impression":
      return clamp01(campaign.qualityPrior);
    case "click":
      return clamp01(campaign.historicalCtr / config.ctrScale);
    case "conversion":
      return clamp01(campaign.historicalCvr / config.cvrScale);
  }
}

export function userRelevance(user: User, category: string): number {
  return clamp01(user.relevance[category] ?? 0);
}

/** score = base x relevance. Relevance is shared by every candidate in a request, so it never reorders them. */
export function score(campaign: Campaign, user: User, config: ScenarioConfig): number {
  return baseScore(campaign, config) * userRelevance(user, campaign.category);
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Higher score first; ties broken by ascending campaign id. */
export function compareByScoreDesc(
  a: { score: number; campaignId: string },
  b: { score: number; campaignId: string },
): number {
  if (b.score !== a.score) return b.score - a.score;
  return compareIds(a.campaignId, b.campaignId);
}

/** Higher effective bid first; ties broken by ascending campaign id. */
export function compareByBidDesc(
  a: { effectiveBidMicros: number; campaignId: string },
  b: { effectiveBidMicros: number; campaignId: string },
): number {
  if (b.effectiveBidMicros !== a.effectiveBidMicros) return b.effectiveBidMicros - a.effectiveBidMicros;
  return compareIds(a.campaignId, b.campaignId);
}
