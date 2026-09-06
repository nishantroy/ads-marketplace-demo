import type {
  Campaign,
  CandidateTrace,
  Micros,
  RequestTrace,
  RunOutput,
  RunSummary,
  ScenarioSnapshot,
  SimRequest,
  User,
} from "../contracts";
import { effectiveBid, runAuction, type Finalist } from "./auction";
import { decidePacing } from "./pacing";
import {
  baseScore,
  categoryRelevance,
  compareByUtilityDesc,
  pairRelevance,
  qualityScore,
  segmentAffinity,
  utilityOf,
} from "./scoring";
import { validateSnapshot } from "./snapshot";
import { buildTimeline } from "./timeline";

/** Campaigns whose category matches the request. Category alone drives retrieval. */
export function retrieve(campaigns: Campaign[], category: string): Campaign[] {
  return campaigns.filter((campaign) => campaign.category === category);
}

/** A campaign can only take part while it can still pay the reserve. */
export function isBudgetEligible(remainingMicros: Micros, reserveMicros: Micros): boolean {
  return remainingMicros >= reserveMicros;
}

interface WorkingCandidate {
  campaign: Campaign;
  trace: CandidateTrace;
  campaignId: string;
  quality: number;
  utility: number;
}

/**
 * Run one pacing mode over the whole session.
 *
 * Pure: no I/O, no wall-clock, no shared mutable state beyond the local balance map. Given the same snapshot
 * and mode it always produces identical output. Balances start fresh, so the two modes are directly comparable.
 *
 * The funnel is: retrieve by category, drop campaigns that cannot pay the reserve, apply pacing admission,
 * apply the quality gate, rank the survivors by utility and keep the top few, then run a single-slot auction
 * priced on the runner-up's utility adjusted for the winner's quality.
 */
export function simulate(snapshot: ScenarioSnapshot, pacingEnabled: boolean): RunOutput {
  validateSnapshot(snapshot);

  const { config, seed } = snapshot;
  const usersById = new Map<string, User>(snapshot.users.map((user) => [user.id, user]));
  const remaining = new Map<string, Micros>(snapshot.campaigns.map((c) => [c.id, c.budgetMicros]));
  const spend = new Map<string, Micros>(snapshot.campaigns.map((c) => [c.id, 0]));
  const impressions = new Map<string, number>(snapshot.campaigns.map((c) => [c.id, 0]));
  const exhaustedAt = new Map<string, number | null>(snapshot.campaigns.map((c) => [c.id, null]));

  const traces: RequestTrace[] = [];

  for (let sequence = 0; sequence < snapshot.requests.length; sequence += 1) {
    const request: SimRequest = snapshot.requests[sequence];
    const user = usersById.get(request.userId);
    if (!user) throw new RangeError(`request ${request.id} references unknown user ${request.userId}`);

    const retrieved = retrieve(snapshot.campaigns, request.category);

    // Diagnostic only: quality qualification before budget and pacing attrition.
    let thresholdQualifiedCount = 0;
    for (const campaign of retrieved) {
      if (qualityScore(campaign, user, config) >= config.qualityThreshold) thresholdQualifiedCount += 1;
    }

    const candidates: WorkingCandidate[] = [];
    const qualified: WorkingCandidate[] = [];

    for (const campaign of retrieved) {
      const budgetBefore = remaining.get(campaign.id) ?? 0;
      const spendSoFar = spend.get(campaign.id) ?? 0;

      const eligible = isBudgetEligible(budgetBefore, config.reserveMicros);
      const trace: CandidateTrace = {
        campaignId: campaign.id,
        objective: campaign.objective,
        bidMicros: campaign.bidMicros,
        budgetBeforeMicros: budgetBefore,
        budgetAfterMicros: budgetBefore,
        eligibility: {
          evaluated: true,
          remainingMicros: budgetBefore,
          reserveMicros: config.reserveMicros,
          passed: eligible,
        },
        pacing: { evaluated: false },
        scoring: { evaluated: false },
        ranking: { evaluated: false },
        auction: { evaluated: false },
        outcome: "excluded_budget",
      };
      const candidate: WorkingCandidate = {
        campaign,
        trace,
        campaignId: campaign.id,
        quality: 0,
        utility: 0,
      };
      candidates.push(candidate);
      if (!eligible) continue;

      const pacing = decidePacing({
        seed,
        requestId: request.id,
        campaignId: campaign.id,
        timestampMs: request.timestampMs,
        sessionDurationMs: config.sessionDurationMs,
        budgetMicros: campaign.budgetMicros,
        spendSoFarMicros: spendSoFar,
        bidMicros: campaign.bidMicros,
        pacingEnabled,
      });
      trace.pacing = { evaluated: true, pacingEnabled, ...pacing };
      if (!pacing.admitted) {
        trace.outcome = "excluded_pacing";
        continue;
      }

      const base = baseScore(campaign, config);
      const relevance = pairRelevance(campaign, user);
      const quality = base * relevance;
      const passedThreshold = quality >= config.qualityThreshold;
      trace.scoring = {
        evaluated: true,
        base,
        categoryRelevance: categoryRelevance(user, campaign.category),
        affinity: segmentAffinity(campaign, user),
        relevance,
        quality,
        passedThreshold,
      };
      candidate.quality = quality;
      if (!passedThreshold) {
        trace.outcome = "excluded_threshold";
        continue;
      }

      const bid = effectiveBid(campaign.bidMicros, budgetBefore);
      candidate.utility = utilityOf(bid, quality);
      trace.ranking = {
        evaluated: true,
        effectiveBidMicros: bid,
        utility: candidate.utility,
        rank: 0,
        shortlisted: false,
      };
      trace.outcome = "excluded_shortlist";
      qualified.push(candidate);
    }

    qualified.sort(compareByUtilityDesc);
    qualified.forEach((candidate, index) => {
      const ranking = candidate.trace.ranking;
      if (ranking.evaluated) ranking.rank = index + 1;
    });

    const shortlisted = qualified.slice(0, config.shortlistSize);
    const finalists: Finalist[] = shortlisted.map((candidate) => {
      const ranking = candidate.trace.ranking;
      if (ranking.evaluated) ranking.shortlisted = true;
      return {
        campaignId: candidate.campaignId,
        bidMicros: candidate.campaign.bidMicros,
        remainingMicros: remaining.get(candidate.campaignId) ?? 0,
        quality: candidate.quality,
      };
    });

    const auction = runAuction(finalists, config.reserveMicros);
    const byId = new Map(candidates.map((candidate) => [candidate.campaignId, candidate]));
    for (const entrant of auction.entrants) {
      const candidate = byId.get(entrant.campaignId);
      if (!candidate) continue;
      const role =
        entrant.campaignId === auction.winnerCampaignId
          ? "winner"
          : entrant.campaignId === auction.runnerUpCampaignId
            ? "runner_up"
            : "other";
      candidate.trace.auction = { evaluated: true, participates: entrant.participates, role };
      candidate.trace.outcome = !entrant.participates
        ? "excluded_reserve"
        : entrant.campaignId === auction.winnerCampaignId
          ? "won"
          : "lost";
    }

    if (auction.winnerCampaignId) {
      const winnerId = auction.winnerCampaignId;
      const before = remaining.get(winnerId) ?? 0;
      const after = before - auction.priceMicros;
      if (after < 0) throw new Error(`campaign ${winnerId} would overspend on request ${request.id}`);
      remaining.set(winnerId, after);
      spend.set(winnerId, (spend.get(winnerId) ?? 0) + auction.priceMicros);
      impressions.set(winnerId, (impressions.get(winnerId) ?? 0) + 1);
      const winnerTrace = byId.get(winnerId);
      if (winnerTrace) winnerTrace.trace.budgetAfterMicros = after;
      if (exhaustedAt.get(winnerId) === null && !isBudgetEligible(after, config.reserveMicros)) {
        exhaustedAt.set(winnerId, request.timestampMs);
      }
    }

    // Shortlist first in utility rank order, then the remaining candidates by campaign id.
    const shortlistIds = shortlisted.map((candidate) => candidate.campaignId);
    const shortlistSet = new Set(shortlistIds);
    const rest = candidates
      .filter((candidate) => !shortlistSet.has(candidate.campaignId))
      .sort((a, b) => (a.campaignId < b.campaignId ? -1 : a.campaignId > b.campaignId ? 1 : 0));

    traces.push({
      requestId: request.id,
      sequence,
      timestampMs: request.timestampMs,
      userId: request.userId,
      category: request.category,
      ...(request.query === undefined ? {} : { query: request.query }),
      retrievedCount: retrieved.length,
      thresholdQualifiedCount,
      candidates: [...shortlisted.map((candidate) => candidate.trace), ...rest.map((candidate) => candidate.trace)],
      shortlist: shortlistIds,
      participantCount: auction.participants.length,
      winnerCampaignId: auction.winnerCampaignId,
      runnerUpCampaignId: auction.runnerUpCampaignId,
      priceMicros: auction.priceMicros,
      priceBasis: auction.priceBasis,
      filled: auction.winnerCampaignId !== null,
    });
  }

  const timeline = buildTimeline(snapshot, traces);
  const summary = summarize(snapshot, traces, spend, impressions, exhaustedAt);
  return { summary, timeline, traces };
}

function summarize(
  snapshot: ScenarioSnapshot,
  traces: RequestTrace[],
  spend: Map<string, Micros>,
  impressions: Map<string, number>,
  exhaustedAt: Map<string, number | null>,
): RunSummary {
  let filledRequests = 0;
  let multiBidderAuctions = 0;
  let thresholdQualifiedRequests = 0;
  let thresholdQualifiedPairRequests = 0;
  let revenueMicros = 0;

  for (const trace of traces) {
    if (trace.filled) {
      filledRequests += 1;
      revenueMicros += trace.priceMicros;
    }
    if (trace.participantCount >= 2) multiBidderAuctions += 1;
    if (trace.thresholdQualifiedCount >= 1) thresholdQualifiedRequests += 1;
    if (trace.thresholdQualifiedCount >= 2) thresholdQualifiedPairRequests += 1;
  }

  return {
    totalRequests: traces.length,
    filledRequests,
    emptyAuctions: traces.length - filledRequests,
    multiBidderAuctions,
    thresholdQualifiedRequests,
    thresholdQualifiedPairRequests,
    revenueMicros,
    avgClearingPriceMicros: filledRequests === 0 ? null : revenueMicros / filledRequests,
    campaigns: snapshot.campaigns.map((campaign) => ({
      campaignId: campaign.id,
      budgetMicros: campaign.budgetMicros,
      spendMicros: spend.get(campaign.id) ?? 0,
      impressions: impressions.get(campaign.id) ?? 0,
      exhaustedAtMs: exhaustedAt.get(campaign.id) ?? null,
    })),
  };
}
