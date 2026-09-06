import { dollars, type CandidateTrace, type RequestTrace, type RunRecord, type ScenarioSummary, type TimelineBucket } from "../../lib/contracts";
import { tinyScenario } from "../../lib/fixtures/tiny";

/** Hand-authored M0 walkthrough, NOT engine output. Never use as evidence of pacing effects. */
export const previewScenario: ScenarioSummary = {
  scenarioId: tinyScenario.scenarioId,
  version: tinyScenario.version,
  seed: tinyScenario.seed,
  categories: tinyScenario.categories,
  config: tinyScenario.config,
  campaigns: tinyScenario.campaigns,
  users: tinyScenario.users,
  requestCount: tinyScenario.requests.length,
  inputHash: "ui-preview-tiny-not-an-engine-hash",
};

const examples = [
  { before: [1.5, 5, 5], after: [0.7, 5, 5], winner: "c1", runner: "c3", price: 0.8, relevance: 1 },
  { before: [0.7, 5, 5], after: [0.7, 5, 4.3], winner: "c3", runner: "c1", price: 0.7, relevance: 1 },
  { before: [0.7, 5, 4.3], after: [0.6, 5, 4.3], winner: "c1", runner: null, price: 0.1, relevance: 0.5 },
  { before: [0.6, 5, 4.3], after: [0.6, 5, 3.7], winner: "c3", runner: "c1", price: 0.6, relevance: 1 },
];

export const previewTraces: RequestTrace[] = tinyScenario.requests.map((request, sequence) => {
  const example = examples[sequence];
  const candidates: CandidateTrace[] = tinyScenario.campaigns.map((campaign, i) => {
    const base = [0.9, 0.8, 0.5][i];
    const qualified = sequence !== 2 || i === 0;
    return {
      campaignId: campaign.id, objective: campaign.objective, bidMicros: campaign.bidMicros,
      budgetBeforeMicros: dollars(example.before[i]), budgetAfterMicros: dollars(example.after[i]),
      eligibility: { evaluated: true, remainingMicros: dollars(example.before[i]), reserveMicros: dollars(0.1), passed: true },
      pacing: {
        evaluated: true, pacingEnabled: false,
        targetMicros: campaign.budgetMicros * request.timestampMs / tinyScenario.config.sessionDurationMs,
        spendSoFarMicros: campaign.budgetMicros - dollars(example.before[i]),
        probability: 1, draw: 0, admitted: true,
      },
      scoring: { evaluated: true, base, relevance: example.relevance, score: base * example.relevance,
        passedThreshold: qualified, rank: qualified ? i + 1 : undefined, shortlisted: qualified },
      auction: qualified ? { evaluated: true, effectiveBidMicros: Math.min(campaign.bidMicros, dollars(example.before[i])),
        participates: true, role: campaign.id === example.winner ? "winner" : campaign.id === example.runner ? "runner_up" : "other" }
        : { evaluated: false },
      outcome: !qualified ? "excluded_threshold" : campaign.id === example.winner ? "won" : "lost",
    };
  });
  return {
    requestId: request.id, sequence, timestampMs: request.timestampMs, userId: request.userId,
    category: request.category, query: request.query, retrievedCount: 3,
    thresholdQualifiedCount: sequence === 2 ? 1 : 3, candidates,
    shortlist: sequence === 2 ? ["c1"] : ["c1", "c2", "c3"],
    participantCount: sequence === 2 ? 1 : 3, winnerCampaignId: example.winner,
    runnerUpCampaignId: example.runner, priceMicros: dollars(example.price), filled: true,
  };
});

// Aggregate the recorded walkthrough only. No retrieval, pacing or auction runs in the UI.
export const previewTimeline: TimelineBucket[] = Array.from({ length: 72 }, (_, index) => {
  const startMs = index * tinyScenario.config.bucketDurationMs;
  const endMs = startMs + tinyScenario.config.bucketDurationMs;
  const events = previewTraces.filter(t => t.timestampMs >= startMs && t.timestampMs < endMs);
  const toDate = previewTraces.filter(t => t.timestampMs < endMs);
  const revenueMicros = events.reduce((sum, t) => sum + t.priceMicros, 0);
  return {
    index, startMs, endMs, requests: events.length, filled: events.length, emptyAuctions: 0,
    multiBidderAuctions: events.filter(t => t.participantCount >= 2).length,
    revenueMicros, cumulativeRevenueMicros: toDate.reduce((sum, t) => sum + t.priceMicros, 0),
    avgClearingPriceMicros: events.length ? revenueMicros / events.length : null,
    avgParticipants: events.length ? events.reduce((sum, t) => sum + t.participantCount, 0) / events.length : null,
    campaigns: tinyScenario.campaigns.map(c => ({
      campaignId: c.id, impressions: events.filter(t => t.winnerCampaignId === c.id).length,
      spendMicros: events.filter(t => t.winnerCampaignId === c.id).reduce((sum, t) => sum + t.priceMicros, 0),
      cumulativeSpendMicros: toDate.filter(t => t.winnerCampaignId === c.id).reduce((sum, t) => sum + t.priceMicros, 0),
      targetMicros: c.budgetMicros * endMs / tinyScenario.config.sessionDurationMs,
    })),
  };
});

export const previewRun: RunRecord = {
  id: "preview-unpaced", scenarioId: tinyScenario.scenarioId, scenarioVersion: tinyScenario.version,
  engineVersion: "hand-authored-preview", inputHash: previewScenario.inputHash,
  pacingEnabled: false, status: "completed", createdAt: "2026-09-06T00:00:00.000Z",
  summary: {
    totalRequests: 4, filledRequests: 4, emptyAuctions: 0, multiBidderAuctions: 3,
    thresholdQualifiedRequests: 4, thresholdQualifiedPairRequests: 3,
    revenueMicros: dollars(2.2), avgClearingPriceMicros: dollars(0.55),
    campaigns: tinyScenario.campaigns.map((c, i) => ({
      campaignId: c.id, budgetMicros: c.budgetMicros, spendMicros: dollars([0.9, 0, 1.3][i]),
      impressions: [2, 0, 2][i], exhaustedAtMs: null,
    })),
  },
};
