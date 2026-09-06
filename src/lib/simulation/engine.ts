import type {
  Campaign,
  CandidateTrace,
  Micros,
  RequestTrace,
  RunOutput,
  RunSummary,
  ScenarioSnapshot,
  ScoringStage,
  SimRequest,
  User,
} from "../contracts";
import { runAuction, type Finalist } from "./auction";
import { decidePacing } from "./pacing";
import { compareByScoreDesc, score as scoreOf, userRelevance } from "./scoring";
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
  /** Rank order key; only set for threshold-qualified candidates. */
  score: number;
  campaignId: string;
}

/**
 * Run one pacing mode over the whole session.
 *
 * Pure: no I/O, no wall-clock, no shared mutable state beyond the local balance map. Given the same snapshot
 * and mode it always produces identical output. Balances start fresh, so the two modes are directly comparable.
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
    const relevance = userRelevance(user, request.category);

    // Diagnostic only: score qualification before budget and pacing attrition.
    let thresholdQualifiedCount = 0;
    for (const campaign of retrieved) {
      if (scoreOf(campaign, user, config) >= config.scoreThreshold) thresholdQualifiedCount += 1;
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
        auction: { evaluated: false },
        outcome: "excluded_budget",
      };
      const candidate: WorkingCandidate = { campaign, trace, score: 0, campaignId: campaign.id };
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

      const value = scoreOf(campaign, user, config);
      const passedThreshold = value >= config.scoreThreshold;
      const scoring: ScoringStage = {
        evaluated: true,
        base: relevance === 0 ? value : value / relevance,
        relevance,
        score: value,
        passedThreshold,
        shortlisted: false,
      };
      trace.scoring = scoring;
      candidate.score = value;
      if (!passedThreshold) {
        trace.outcome = "excluded_threshold";
        continue;
      }
      trace.outcome = "excluded_shortlist";
      qualified.push(candidate);
    }

    qualified.sort(compareByScoreDesc);
    qualified.forEach((candidate, index) => {
      const scoring = candidate.trace.scoring;
      if (scoring.evaluated) scoring.rank = index + 1;
    });

    const shortlisted = qualified.slice(0, config.shortlistSize);
    const finalists: Finalist[] = shortlisted.map((candidate) => {
      const scoring = candidate.trace.scoring;
      if (scoring.evaluated) scoring.shortlisted = true;
      return {
        campaignId: candidate.campaignId,
        bidMicros: candidate.campaign.bidMicros,
        remainingMicros: remaining.get(candidate.campaignId) ?? 0,
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
      candidate.trace.auction = {
        evaluated: true,
        effectiveBidMicros: entrant.effectiveBidMicros,
        participates: entrant.participates,
        role,
      };
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

    // Shortlist first in rank order, then the remaining candidates by campaign id.
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
