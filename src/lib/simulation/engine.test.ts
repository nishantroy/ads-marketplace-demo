import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dollars, type Campaign, type ScenarioSnapshot, type SimRequest } from "../contracts";
import { tinyScenario } from "../fixtures/tiny";
import { runAuction } from "./auction";
import { simulate } from "./engine";
import { checkInvariants } from "./invariants";
import { admissionProbability, pacingTarget } from "./pacing";
import { validateSnapshot } from "./snapshot";

const HOUR = 60 * 60 * 1000;

function scenarioWith(overrides: {
  campaigns?: Campaign[];
  requests?: SimRequest[];
  relevance?: number;
}): ScenarioSnapshot {
  return {
    ...tinyScenario,
    users: [{ id: "u1", name: "Avery", relevance: { shoes: overrides.relevance ?? 1 } }],
    campaigns: overrides.campaigns ?? tinyScenario.campaigns,
    requests: overrides.requests ?? [{ id: "r1", timestampMs: HOUR, userId: "u1", category: "shoes" }],
  };
}

function impressionCampaign(id: string, bid: number, budget: number, prior = 0.9): Campaign {
  return {
    id,
    name: id,
    category: "shoes",
    objective: "impression",
    qualityPrior: prior,
    bidMicros: dollars(bid),
    budgetMicros: dollars(budget),
  };
}

function traceFor(output: ReturnType<typeof simulate>, requestId: string) {
  const trace = output.traces.find((t) => t.requestId === requestId);
  if (!trace) throw new Error(`no trace for ${requestId}`);
  return trace;
}

function candidateFor(output: ReturnType<typeof simulate>, requestId: string, campaignId: string) {
  const candidate = traceFor(output, requestId).candidates.find((c) => c.campaignId === campaignId);
  if (!candidate) throw new Error(`no candidate ${campaignId} on ${requestId}`);
  return candidate;
}

describe("engine determinism and purity", () => {
  it("produces identical output for the same inputs and mode", () => {
    const a = simulate(tinyScenario, false);
    const b = simulate(tinyScenario, false);
    expect(b).toEqual(a);
    const paced = simulate(tinyScenario, true);
    expect(paced).not.toEqual(a);
  });

  it("does not leave the engine depending on React, a database, HTTP, or the wall clock", () => {
    const dir = path.join(process.cwd(), "src/lib/simulation");
    const forbidden = /(from\s+"(react|next|pg|drizzle)|Date\.now|new Date\(|Math\.random)/;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      expect(readFileSync(path.join(dir, file), "utf8"), file).not.toMatch(forbidden);
    }
  });
});

describe("hand-calculated auctions on the tiny fixture", () => {
  const output = simulate(tinyScenario, false);

  it("charges the second-highest effective bid in a multi-bidder auction", () => {
    const r1 = traceFor(output, "r1");
    expect(r1.winnerCampaignId).toBe("c1");
    expect(r1.runnerUpCampaignId).toBe("c3");
    expect(r1.priceMicros).toBe(dollars(0.8));
    expect(r1.participantCount).toBe(3);
    expect(candidateFor(output, "r1", "c1").budgetAfterMicros).toBe(dollars(0.7));
  });

  it("caps the effective bid at the remaining budget", () => {
    const r2 = traceFor(output, "r2");
    const c1 = candidateFor(output, "r2", "c1");
    expect(c1.auction.evaluated && c1.auction.effectiveBidMicros).toBe(dollars(0.7));
    expect(r2.winnerCampaignId).toBe("c3");
    expect(r2.priceMicros).toBe(dollars(0.7));
  });

  it("charges the reserve when only one campaign qualifies", () => {
    const r3 = traceFor(output, "r3");
    expect(r3.participantCount).toBe(1);
    expect(r3.winnerCampaignId).toBe("c1");
    expect(r3.runnerUpCampaignId).toBeNull();
    expect(r3.priceMicros).toBe(tinyScenario.config.reserveMicros);
    expect(candidateFor(output, "r3", "c2").outcome).toBe("excluded_threshold");
  });

  it("breaks tied second-place bids deterministically by campaign id", () => {
    const r4 = traceFor(output, "r4");
    expect(r4.winnerCampaignId).toBe("c3");
    expect(r4.runnerUpCampaignId).toBe("c1");
    expect(r4.priceMicros).toBe(dollars(0.6));
  });

  it("reports session totals that match the hand calculation", () => {
    expect(output.summary.revenueMicros).toBe(dollars(2.2));
    const spend = Object.fromEntries(output.summary.campaigns.map((c) => [c.campaignId, c.spendMicros]));
    expect(spend).toEqual({ c1: dollars(0.9), c2: 0, c3: dollars(1.3) });
    expect(checkInvariants(tinyScenario, output)).toEqual([]);
  });
});

describe("winner and price selection", () => {
  it("gives a tied top bid to the lower campaign id and charges that bid", () => {
    const scenario = scenarioWith({
      campaigns: [impressionCampaign("c2", 1, 5), impressionCampaign("c1", 1, 5)],
    });
    const output = simulate(scenario, false);
    const trace = traceFor(output, "r1");
    expect(trace.winnerCampaignId).toBe("c1");
    expect(trace.runnerUpCampaignId).toBe("c2");
    expect(trace.priceMicros).toBe(dollars(1));
  });

  it("returns no winner and no spend when nothing qualifies", () => {
    const scenario = scenarioWith({ relevance: 0 });
    const output = simulate(scenario, false);
    const trace = traceFor(output, "r1");
    expect(trace.filled).toBe(false);
    expect(trace.winnerCampaignId).toBeNull();
    expect(trace.priceMicros).toBe(0);
    expect(trace.participantCount).toBe(0);
    expect(output.summary.revenueMicros).toBe(0);
    expect(output.summary.emptyAuctions).toBe(1);
  });

  it("keeps campaigns that cannot pay the reserve out of the auction entirely", () => {
    const scenario = scenarioWith({
      campaigns: [impressionCampaign("c1", 1, 5), impressionCampaign("c2", 1, 0.05)],
    });
    const output = simulate(scenario, false);
    const poor = candidateFor(output, "r1", "c2");
    expect(poor.outcome).toBe("excluded_budget");
    expect(poor.auction.evaluated).toBe(false);
    expect(poor.pacing.evaluated).toBe(false);
    expect(traceFor(output, "r1").priceMicros).toBe(scenario.config.reserveMicros);
  });

  it("keeps below-threshold and unshortlisted candidates from setting the price", () => {
    const campaigns = [
      impressionCampaign("c1", 1, 5, 0.9),
      impressionCampaign("c2", 5, 50, 0.8),
      impressionCampaign("c3", 5, 50, 0.7),
      impressionCampaign("c4", 5, 50, 0.6),
      impressionCampaign("c5", 5, 50, 0.5),
      impressionCampaign("c6", 9, 50, 0.2), // below the 0.45 threshold despite the highest bid
    ];
    const scenario = scenarioWith({ campaigns });
    const output = simulate(scenario, false);
    const trace = traceFor(output, "r1");
    expect(trace.shortlist).toEqual(["c1", "c2", "c3", "c4"]);
    expect(candidateFor(output, "r1", "c5").outcome).toBe("excluded_shortlist");
    expect(candidateFor(output, "r1", "c6").outcome).toBe("excluded_threshold");
    expect(candidateFor(output, "r1", "c5").auction.evaluated).toBe(false);
    expect(candidateFor(output, "r1", "c6").auction.evaluated).toBe(false);
    // The $9 bid never reaches the auction, so the price is the second shortlisted bid, not $9.
    expect(trace.priceMicros).toBe(dollars(5));
  });

  it("never charges more than the winner's effective bid", () => {
    const result = runAuction(
      [
        { campaignId: "a", bidMicros: dollars(1), remainingMicros: dollars(0.3) },
        { campaignId: "b", bidMicros: dollars(2), remainingMicros: dollars(0.25) },
      ],
      dollars(0.1),
    );
    expect(result.winnerCampaignId).toBe("a");
    expect(result.priceMicros).toBe(dollars(0.25));
    expect(result.priceMicros).toBeLessThanOrEqual(dollars(0.3));
  });
});

describe("pacing", () => {
  it("admits nothing at time zero and everything when pacing is off", () => {
    const scenario = scenarioWith({
      requests: [{ id: "r1", timestampMs: 0, userId: "u1", category: "shoes" }],
    });
    const paced = simulate(scenario, true);
    const trace = traceFor(paced, "r1");
    expect(trace.filled).toBe(false);
    for (const candidate of trace.candidates) {
      expect(candidate.outcome).toBe("excluded_pacing");
      expect(candidate.pacing.evaluated && candidate.pacing.probability).toBe(0);
      expect(candidate.auction.evaluated).toBe(false);
    }
    const unpaced = simulate(scenario, false);
    expect(traceFor(unpaced, "r1").filled).toBe(true);
    const candidate = candidateFor(unpaced, "r1", "c1");
    expect(candidate.pacing.evaluated && candidate.pacing.probability).toBe(1);
  });

  it("clamps the probability to [0, 1] and tracks the linear target", () => {
    const duration = 6 * HOUR;
    expect(pacingTarget(dollars(6), 3 * HOUR, duration)).toBe(dollars(3));
    expect(admissionProbability(dollars(3), dollars(1), dollars(1), true)).toBe(1);
    expect(admissionProbability(dollars(1), dollars(3), dollars(1), true)).toBe(0);
    expect(admissionProbability(dollars(1.5), dollars(1), dollars(1), true)).toBeCloseTo(0.5);
    expect(admissionProbability(0, dollars(5), dollars(1), false)).toBe(1);
  });

  it("keeps every accounting invariant in the paced mode too", () => {
    const paced = simulate(tinyScenario, true);
    expect(checkInvariants(tinyScenario, paced)).toEqual([]);
    // Both modes consume the identical snapshot, so they are comparable. Which one earns more is a
    // marketplace outcome, not a correctness property, so nothing here asserts a direction.
    const unpaced = simulate(tinyScenario, false);
    expect(paced.summary.totalRequests).toBe(unpaced.summary.totalRequests);
    expect(Number.isInteger(paced.summary.revenueMicros)).toBe(true);
  });
});

describe("time boundaries and ordering", () => {
  it("rejects a timestamp at or past the session end and accepts the last millisecond", () => {
    const duration = tinyScenario.config.sessionDurationMs;
    const late = scenarioWith({ requests: [{ id: "r1", timestampMs: duration - 1, userId: "u1", category: "shoes" }] });
    const output = simulate(late, false);
    expect(output.timeline[output.timeline.length - 1].requests).toBe(1);
    const past = scenarioWith({ requests: [{ id: "r1", timestampMs: duration, userId: "u1", category: "shoes" }] });
    expect(() => simulate(past, false)).toThrow(/timestamp/);
  });

  it("processes same-timestamp requests in campaign-stable id order", () => {
    const scenario = scenarioWith({
      campaigns: [impressionCampaign("c1", 1, 1.5)],
      requests: [
        { id: "r1", timestampMs: HOUR, userId: "u1", category: "shoes" },
        { id: "r2", timestampMs: HOUR, userId: "u1", category: "shoes" },
      ],
    });
    const output = simulate(scenario, false);
    expect(output.traces.map((t) => t.requestId)).toEqual(["r1", "r2"]);
    expect(output.traces.map((t) => t.sequence)).toEqual([0, 1]);
    const reversed = { ...scenario, requests: [scenario.requests[1], scenario.requests[0]] };
    expect(() => validateSnapshot(reversed)).toThrow(/ordered/);
  });
});

describe("timeline buckets", () => {
  const output = simulate(tinyScenario, false);

  it("covers the session in 72 five-minute buckets ending at six hours", () => {
    expect(output.timeline).toHaveLength(72);
    expect(output.timeline[0].startMs).toBe(0);
    expect(output.timeline[71].endMs).toBe(tinyScenario.config.sessionDurationMs);
  });

  it("places requests in the right bucket and reconciles with the summary", () => {
    expect(output.timeline[0].requests).toBe(1); // r1 at t = 0
    expect(output.timeline[12].requests).toBe(1); // r2 at t = 1h
    expect(output.timeline[24].requests).toBe(1); // r3 at t = 2h
    expect(output.timeline[36].requests).toBe(1); // r4 at t = 3h
    expect(output.timeline[71].cumulativeRevenueMicros).toBe(output.summary.revenueMicros);
    const c1Final = output.timeline[71].campaigns.find((c) => c.campaignId === "c1");
    expect(c1Final?.cumulativeSpendMicros).toBe(dollars(0.9));
    expect(c1Final?.targetMicros).toBe(dollars(1.5));
  });

  it("distinguishes an unfilled bucket from a zero price", () => {
    expect(output.timeline[1].requests).toBe(0);
    expect(output.timeline[1].avgClearingPriceMicros).toBeNull();
    expect(output.timeline[1].avgParticipants).toBeNull();
    expect(output.timeline[0].avgClearingPriceMicros).toBe(dollars(0.8));
    expect(output.timeline[0].emptyAuctions).toBe(0);
  });
});
