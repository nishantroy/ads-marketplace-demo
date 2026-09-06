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
    users: [{ id: "u1", name: "Avery", segment: "s1", relevance: { shoes: overrides.relevance ?? 1 } }],
    campaigns: overrides.campaigns ?? tinyScenario.campaigns,
    requests: overrides.requests ?? [{ id: "r1", timestampMs: HOUR, userId: "u1", category: "shoes" }],
  };
}

/** An impression campaign with an explicit quality prior and full affinity, so quality equals the prior. */
function impressionCampaign(id: string, bid: number, budget: number, prior = 0.9, affinityS1 = 1): Campaign {
  return {
    id,
    name: id,
    category: "shoes",
    objective: "impression",
    qualityPrior: prior,
    bidMicros: dollars(bid),
    budgetMicros: dollars(budget),
    affinity: { s1: affinityS1, s2: affinityS1 },
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

  // Guard for the determinism rules in AGENTS.md. Add a pattern here whenever a rule is added there.
  it("keeps banned non-deterministic sources out of the engine", () => {
    const banned: Array<[string, RegExp]> = [
      ["Math.random", /\bMath\.random\b/],
      ["crypto.getRandomValues", /\bgetRandomValues\b/],
      ["Date.now", /\bDate\.now\b/],
      ["new Date", /\bnew Date\b/],
      ["performance.now", /\bperformance\.now\b/],
      ["process.env", /\bprocess\.env\b/],
      ["setTimeout", /\bsetTimeout\b/],
      ["a React, Next, or database import", /from\s+["'](react|next|pg|drizzle)/],
    ];
    const dir = path.join(process.cwd(), "src/lib/simulation");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(path.join(dir, file), "utf8");
      for (const [label, pattern] of banned) {
        expect(source, `${file} must not use ${label}`).not.toMatch(pattern);
      }
    }
  });

  it("gives every request-time draw its own key so results never depend on evaluation order", () => {
    const scenario = scenarioWith({
      campaigns: [impressionCampaign("c1", 1, 5), impressionCampaign("c2", 1, 5)],
      requests: [
        { id: "r1", timestampMs: HOUR, userId: "u1", category: "shoes" },
        { id: "r2", timestampMs: 2 * HOUR, userId: "u1", category: "shoes" },
      ],
    });
    const draws = simulate(scenario, true).traces.flatMap((trace) =>
      trace.candidates.map((c) => (c.pacing.evaluated ? c.pacing.draw : null)),
    );
    expect(draws.every((d) => d !== null)).toBe(true);
    expect(new Set(draws).size).toBe(draws.length);

    const reversed = { ...scenario, campaigns: [...scenario.campaigns].reverse() };
    const byId = (output: ReturnType<typeof simulate>) =>
      output.traces.map((t) => [...t.candidates].sort((a, b) => a.campaignId.localeCompare(b.campaignId)));
    expect(byId(simulate(reversed, true))).toEqual(byId(simulate(scenario, true)));
  });
});

describe("hand-calculated auctions on the tiny fixture", () => {
  const output = simulate(tinyScenario, false);

  it("lets the lowest bidder win when it matches the user best", () => {
    const r1 = traceFor(output, "r1");
    expect(r1.winnerCampaignId).toBe("c2");
    expect(r1.runnerUpCampaignId).toBe("c1");
    // c2 bids $0.60 against c1's $1.00 and c3's $0.80, and still wins on utility.
    const c2 = candidateFor(output, "r1", "c2");
    const c1 = candidateFor(output, "r1", "c1");
    expect(c2.bidMicros).toBeLessThan(c1.bidMicros);
    expect(c2.ranking.evaluated && c2.ranking.utility).toBeGreaterThan(
      c1.ranking.evaluated ? c1.ranking.utility : Infinity,
    );
    expect(c2.ranking.evaluated && c2.ranking.rank).toBe(1);
  });

  it("charges the runner-up utility divided by the winner's quality", () => {
    const r1 = traceFor(output, "r1");
    // runner-up utility 0.36 / winner quality 0.80 = $0.45, below c2's own $0.60 bid.
    expect(r1.priceMicros).toBe(dollars(0.45));
    expect(r1.priceMicros).toBeLessThan(dollars(0.6));
    expect(r1.priceBasis).not.toBeNull();
    expect(r1.priceBasis?.winnerQuality).toBeCloseTo(0.8);
  });

  it("charges the reserve when only one campaign passes the gate", () => {
    const r2 = traceFor(output, "r2");
    expect(r2.participantCount).toBe(1);
    expect(r2.winnerCampaignId).toBe("c1");
    expect(r2.runnerUpCampaignId).toBeNull();
    expect(r2.priceMicros).toBe(tinyScenario.config.reserveMicros);
    expect(r2.priceBasis).toBeNull();
    expect(candidateFor(output, "r2", "c2").outcome).toBe("excluded_threshold");
  });

  it("lowers utility as the remaining budget caps the effective bid", () => {
    const r3 = traceFor(output, "r3");
    const c1 = candidateFor(output, "r3", "c1");
    expect(c1.ranking.evaluated && c1.ranking.effectiveBidMicros).toBe(dollars(0.7));
    // c1's utility falls to 0.315, so c3 becomes the runner-up and sets the price instead.
    expect(r3.runnerUpCampaignId).toBe("c3");
    expect(r3.priceMicros).toBe(dollars(0.4));
  });

  it("returns no winner when nothing passes the gate", () => {
    const r4 = traceFor(output, "r4");
    expect(r4.filled).toBe(false);
    expect(r4.priceMicros).toBe(0);
    expect(r4.participantCount).toBe(0);
    for (const candidate of r4.candidates) {
      expect(candidate.outcome).toBe("excluded_threshold");
      expect(candidate.ranking.evaluated).toBe(false);
    }
  });

  it("reports session totals that match the hand calculation", () => {
    expect(output.summary.revenueMicros).toBe(dollars(0.95));
    const spend = Object.fromEntries(output.summary.campaigns.map((c) => [c.campaignId, c.spendMicros]));
    expect(spend).toEqual({ c1: dollars(0.1), c2: dollars(0.85), c3: 0 });
    expect(checkInvariants(tinyScenario, output)).toEqual([]);
  });
});

describe("quality-adjusted pricing", () => {
  it("gives a better-quality winner a lower price for the same position", () => {
    const reserve = dollars(0.1);
    const runnerUp = { campaignId: "b", bidMicros: dollars(1.2), remainingMicros: dollars(50), quality: 0.4 };
    const cheap = runAuction(
      [{ campaignId: "a", bidMicros: dollars(0.6), remainingMicros: dollars(50), quality: 0.9 }, runnerUp],
      reserve,
    );
    // A wins at half B's bid: utility 0.54 against 0.48. It pays 0.48 / 0.9 = $0.533.
    expect(cheap.winnerCampaignId).toBe("a");
    expect(cheap.priceMicros).toBe(533333);
    expect(cheap.priceMicros).toBeLessThan(dollars(0.6));

    const better = runAuction(
      [{ campaignId: "a", bidMicros: dollars(0.6), remainingMicros: dollars(50), quality: 0.98 }, runnerUp],
      reserve,
    );
    expect(better.winnerCampaignId).toBe("a");
    expect(better.priceMicros).toBeLessThan(cheap.priceMicros);
  });

  it("never charges more than the winner's effective bid", () => {
    const result = runAuction(
      [
        { campaignId: "a", bidMicros: dollars(1), remainingMicros: dollars(0.3), quality: 0.9 },
        { campaignId: "b", bidMicros: dollars(2), remainingMicros: dollars(0.25), quality: 0.9 },
      ],
      dollars(0.1),
    );
    expect(result.winnerCampaignId).toBe("a");
    expect(result.priceMicros).toBeLessThanOrEqual(dollars(0.3));
  });

  it("floors the price at the reserve", () => {
    const result = runAuction(
      [
        { campaignId: "a", bidMicros: dollars(1), remainingMicros: dollars(5), quality: 0.9 },
        { campaignId: "b", bidMicros: dollars(0.11), remainingMicros: dollars(5), quality: 0.1 },
      ],
      dollars(0.1),
    );
    expect(result.priceMicros).toBe(dollars(0.1));
  });

  it("breaks tied utilities by campaign id", () => {
    const result = runAuction(
      [
        { campaignId: "c2", bidMicros: dollars(1), remainingMicros: dollars(5), quality: 0.5 },
        { campaignId: "c1", bidMicros: dollars(1), remainingMicros: dollars(5), quality: 0.5 },
      ],
      dollars(0.1),
    );
    expect(result.winnerCampaignId).toBe("c1");
    expect(result.runnerUpCampaignId).toBe("c2");
    expect(result.priceMicros).toBe(dollars(1));
  });
});

describe("gate and shortlist", () => {
  it("keeps campaigns that cannot pay the reserve out of the funnel entirely", () => {
    const scenario = scenarioWith({
      campaigns: [impressionCampaign("c1", 1, 5), impressionCampaign("c2", 1, 0.05)],
    });
    const output = simulate(scenario, false);
    const poor = candidateFor(output, "r1", "c2");
    expect(poor.outcome).toBe("excluded_budget");
    expect(poor.pacing.evaluated).toBe(false);
    expect(poor.ranking.evaluated).toBe(false);
    expect(poor.auction.evaluated).toBe(false);
    expect(traceFor(output, "r1").priceMicros).toBe(scenario.config.reserveMicros);
  });

  it("keeps gated and unshortlisted candidates from setting the price", () => {
    const campaigns = [
      impressionCampaign("c1", 1, 50, 0.9),
      impressionCampaign("c2", 1, 50, 0.85),
      impressionCampaign("c3", 1, 50, 0.8),
      impressionCampaign("c4", 1, 50, 0.75),
      impressionCampaign("c5", 1, 50, 0.7),
      impressionCampaign("c6", 9, 50, 0.9, 0.05), // huge bid, but affinity 0.05 fails the gate
    ];
    const scenario = scenarioWith({ campaigns });
    const output = simulate(scenario, false);
    const trace = traceFor(output, "r1");
    expect(trace.shortlist).toEqual(["c1", "c2", "c3", "c4"]);
    expect(candidateFor(output, "r1", "c5").outcome).toBe("excluded_shortlist");
    expect(candidateFor(output, "r1", "c6").outcome).toBe("excluded_threshold");
    expect(candidateFor(output, "r1", "c5").auction.evaluated).toBe(false);
    expect(candidateFor(output, "r1", "c6").ranking.evaluated).toBe(false);
    // The $9 bid never reaches the auction, so the price comes from c2, the shortlisted runner-up.
    expect(trace.priceMicros).toBe(dollars(0.944444));
  });

  it("ranks by utility, not by quality or bid alone", () => {
    const scenario = scenarioWith({
      campaigns: [
        impressionCampaign("high_quality_cheap", 0.5, 50, 0.95),
        impressionCampaign("low_quality_rich", 1.5, 50, 0.4),
      ],
    });
    const trace = traceFor(simulate(scenario, false), "r1");
    // utilities: 0.5 x 0.95 = 0.475 against 1.5 x 0.40 = 0.60, so the richer bid wins this time.
    expect(trace.winnerCampaignId).toBe("low_quality_rich");
    expect(trace.shortlist[0]).toBe("low_quality_rich");
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
      expect(candidate.ranking.evaluated).toBe(false);
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

  it("processes same-timestamp requests in stable id order", () => {
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
    const c2Final = output.timeline[71].campaigns.find((c) => c.campaignId === "c2");
    expect(c2Final?.cumulativeSpendMicros).toBe(dollars(0.85));
  });

  it("distinguishes an unfilled bucket from a zero price", () => {
    expect(output.timeline[1].requests).toBe(0);
    expect(output.timeline[1].avgClearingPriceMicros).toBeNull();
    expect(output.timeline[1].avgParticipants).toBeNull();
    expect(output.timeline[0].avgClearingPriceMicros).toBe(dollars(0.45));
    expect(output.timeline[36].filled).toBe(0); // r4 was an empty auction
    expect(output.timeline[36].emptyAuctions).toBe(1);
  });
});
