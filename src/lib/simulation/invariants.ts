import type { RunOutput, ScenarioSnapshot } from "../contracts";

/**
 * Accounting and funnel checks that must hold for every run in either mode.
 * Returns a list of human-readable violations; an empty list means the run is self-consistent.
 * M2 diagnostics and the API reuse this rather than re-deriving the rules.
 */
export function checkInvariants(snapshot: ScenarioSnapshot, output: RunOutput): string[] {
  const problems: string[] = [];
  const { summary, timeline, traces } = output;
  const budgets = new Map(snapshot.campaigns.map((campaign) => [campaign.id, campaign.budgetMicros]));

  const priceTotal = traces.reduce((total, trace) => total + trace.priceMicros, 0);
  const campaignSpendTotal = summary.campaigns.reduce((total, campaign) => total + campaign.spendMicros, 0);
  if (summary.revenueMicros !== priceTotal) {
    problems.push(`revenue ${summary.revenueMicros} does not equal the sum of request prices ${priceTotal}`);
  }
  if (summary.revenueMicros !== campaignSpendTotal) {
    problems.push(`revenue ${summary.revenueMicros} does not equal total campaign spend ${campaignSpendTotal}`);
  }

  for (const campaign of summary.campaigns) {
    const budget = budgets.get(campaign.campaignId) ?? 0;
    if (campaign.spendMicros > budget) {
      problems.push(`campaign ${campaign.campaignId} overspent: ${campaign.spendMicros} > budget ${budget}`);
    }
    if (!Number.isInteger(campaign.spendMicros) || campaign.spendMicros < 0) {
      problems.push(`campaign ${campaign.campaignId} has a non-integer or negative spend`);
    }
  }

  for (const trace of traces) {
    const winners = trace.candidates.filter((c) => c.outcome === "won");
    if (winners.length > 1) problems.push(`request ${trace.requestId} has ${winners.length} winners`);
    if (trace.filled !== (trace.winnerCampaignId !== null)) {
      problems.push(`request ${trace.requestId} filled flag disagrees with its winner`);
    }
    if (!trace.filled && trace.priceMicros !== 0) {
      problems.push(`request ${trace.requestId} has no winner but a non-zero price`);
    }
    if (!Number.isInteger(trace.priceMicros) || trace.priceMicros < 0) {
      problems.push(`request ${trace.requestId} price is not a non-negative integer`);
    }

    const winner = winners[0];
    if (winner) {
      if (!winner.auction.evaluated || !winner.ranking.evaluated) {
        problems.push(`request ${trace.requestId} winner has no auction or ranking stage`);
      } else if (trace.priceMicros > winner.ranking.effectiveBidMicros) {
        problems.push(
          `request ${trace.requestId} price ${trace.priceMicros} exceeds the winner's effective bid ${winner.ranking.effectiveBidMicros}`,
        );
      }
      // Ranking by utility means the winner must hold the highest utility of any participant.
      if (winner.ranking.evaluated) {
        for (const other of trace.candidates) {
          if (other.campaignId === winner.campaignId) continue;
          if (!other.ranking.evaluated || !other.auction.evaluated || !other.auction.participates) continue;
          if (other.ranking.utility > winner.ranking.utility) {
            problems.push(
              `request ${trace.requestId}: ${other.campaignId} had higher utility than the winner ${winner.campaignId}`,
            );
          }
        }
      }
      if (winner.budgetAfterMicros !== winner.budgetBeforeMicros - trace.priceMicros) {
        problems.push(`request ${trace.requestId} winner balance was not reduced by the clearing price`);
      }
      if (winner.budgetAfterMicros < 0) problems.push(`request ${trace.requestId} left a negative balance`);
    }

    for (const candidate of trace.candidates) {
      const excludedBeforeAuction =
        candidate.outcome === "excluded_budget" ||
        candidate.outcome === "excluded_pacing" ||
        candidate.outcome === "excluded_threshold" ||
        candidate.outcome === "excluded_shortlist";
      if (
        (candidate.outcome === "excluded_budget" ||
          candidate.outcome === "excluded_pacing" ||
          candidate.outcome === "excluded_threshold") &&
        candidate.ranking.evaluated
      ) {
        problems.push(
          `request ${trace.requestId}: campaign ${candidate.campaignId} was ${candidate.outcome} but was still ranked`,
        );
      }
      if (excludedBeforeAuction && candidate.auction.evaluated) {
        problems.push(
          `request ${trace.requestId}: campaign ${candidate.campaignId} was ${candidate.outcome} but still entered the auction`,
        );
      }
      if (candidate.outcome !== "won" && candidate.budgetAfterMicros !== candidate.budgetBeforeMicros) {
        problems.push(`request ${trace.requestId}: non-winner ${candidate.campaignId} changed balance`);
      }
    }
  }

  const bucketRequests = timeline.reduce((total, bucket) => total + bucket.requests, 0);
  const bucketRevenue = timeline.reduce((total, bucket) => total + bucket.revenueMicros, 0);
  const bucketFilled = timeline.reduce((total, bucket) => total + bucket.filled, 0);
  if (bucketRequests !== summary.totalRequests) {
    problems.push(`buckets hold ${bucketRequests} requests but the summary reports ${summary.totalRequests}`);
  }
  if (bucketFilled !== summary.filledRequests) {
    problems.push(`buckets hold ${bucketFilled} filled requests but the summary reports ${summary.filledRequests}`);
  }
  if (bucketRevenue !== summary.revenueMicros) {
    problems.push(`bucket revenue ${bucketRevenue} does not equal summary revenue ${summary.revenueMicros}`);
  }
  const last = timeline[timeline.length - 1];
  if (last && last.cumulativeRevenueMicros !== summary.revenueMicros) {
    problems.push(`final cumulative revenue ${last.cumulativeRevenueMicros} does not equal ${summary.revenueMicros}`);
  }
  if (last) {
    for (const metrics of last.campaigns) {
      const campaign = summary.campaigns.find((c) => c.campaignId === metrics.campaignId);
      if (campaign && metrics.cumulativeSpendMicros !== campaign.spendMicros) {
        problems.push(
          `campaign ${metrics.campaignId} final bucket spend ${metrics.cumulativeSpendMicros} does not equal summary spend ${campaign.spendMicros}`,
        );
      }
    }
  }

  return problems;
}
