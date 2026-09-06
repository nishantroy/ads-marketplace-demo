import type { Campaign, Micros, ScenarioConfig, User } from "../contracts";

export function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

/**
 * Objective-specific normalised engagement prediction in [0, 1]. Fixed per campaign; uses scenario scales
 * only, never live candidate-pool statistics.
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

export function categoryRelevance(user: User, category: string): number {
  return clamp01(user.relevance[category] ?? 0);
}

/** How well this campaign targets the segment this user belongs to. */
export function segmentAffinity(campaign: Campaign, user: User): number {
  return clamp01(campaign.affinity[user.segment] ?? 0);
}

/**
 * Relevance of a campaign to a user: the user's interest in the category times the campaign's fit for the
 * user's segment. Unlike category relevance alone, this differs between candidates in the same request, so
 * ranking order genuinely varies from request to request.
 */
export function pairRelevance(campaign: Campaign, user: User): number {
  return categoryRelevance(user, campaign.category) * segmentAffinity(campaign, user);
}

/** quality = engagement x pair relevance. Decides the gate, and scales both utility and price. */
export function qualityScore(campaign: Campaign, user: User, config: ScenarioConfig): number {
  return baseScore(campaign, config) * pairRelevance(campaign, user);
}

/**
 * Utility of showing this ad: what the impression is worth to the marketplace as a whole. Bid carries the
 * platform's value, quality carries the user's and the advertiser's. Expressed in micro-utility, since the
 * bid is in microdollars.
 */
export function utilityOf(effectiveBidMicros: Micros, quality: number): number {
  return effectiveBidMicros * quality;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Higher utility first; ties broken by ascending campaign id. */
export function compareByUtilityDesc(
  a: { utility: number; campaignId: string },
  b: { utility: number; campaignId: string },
): number {
  if (b.utility !== a.utility) return b.utility - a.utility;
  return compareIds(a.campaignId, b.campaignId);
}
