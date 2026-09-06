import { describe, expect, it } from "vitest";
import { baseScore } from "./scoring";
import { BASELINE_PRESET, SMALL_PRESET, smallScenario } from "../fixtures/presets";
import { simulate } from "./engine";
import { allocate, generateScenario, trafficWeight } from "./generate";
import { checkInvariants } from "./invariants";
import { inputHash, validateSnapshot } from "./snapshot";

const HOUR = 60 * 60 * 1000;

describe("scenario generation", () => {
  const scenario = smallScenario();

  it("is deterministic for a seed and changes with the seed", () => {
    expect(generateScenario(SMALL_PRESET)).toEqual(scenario);
    const other = generateScenario({ ...SMALL_PRESET, seed: "different" });
    expect(inputHash(other)).not.toBe(inputHash(scenario));
    expect(other.requests).toHaveLength(scenario.requests.length);
  });

  it("produces a valid, correctly sized, ordered snapshot", () => {
    expect(() => validateSnapshot(scenario)).not.toThrow();
    expect(scenario.categories).toHaveLength(SMALL_PRESET.categoryCount);
    expect(scenario.users).toHaveLength(SMALL_PRESET.userCount);
    expect(scenario.campaigns).toHaveLength(SMALL_PRESET.categoryCount * SMALL_PRESET.campaignsPerCategory);
    expect(scenario.requests).toHaveLength(SMALL_PRESET.requestCount);
    const last = scenario.requests[scenario.requests.length - 1];
    expect(last.timestampMs).toBeLessThan(scenario.config.sessionDurationMs);
  });

  it("gives every category campaigns of every objective and a full bid ladder", () => {
    for (const category of scenario.categories) {
      const campaigns = scenario.campaigns.filter((c) => c.category === category);
      expect(new Set(campaigns.map((c) => c.objective)).size).toBe(3);
      const bids = campaigns.map((c) => c.bidMicros);
      expect(Math.max(...bids)).toBeGreaterThan(Math.min(...bids) * 1.5);
    }
  });

  it("does not let bid rank stand in for score rank", () => {
    const category = scenario.categories[0];
    const campaigns = scenario.campaigns.filter((c) => c.category === category);
    const byBid = [...campaigns].sort((a, b) => b.bidMicros - a.bidMicros).map((c) => c.id);
    const byScore = [...campaigns]
      .sort((a, b) => baseScore(b, scenario.config) - baseScore(a, scenario.config))
      .map((c) => c.id);
    expect(byScore).not.toEqual(byBid);
  });

  it("spreads traffic unevenly with substantial late volume in every category", () => {
    const lateStart = scenario.config.sessionDurationMs - 2 * HOUR;
    const late = scenario.requests.filter((r) => r.timestampMs >= lateStart);
    expect(late.length / scenario.requests.length).toBeGreaterThan(0.35);
    for (const category of scenario.categories) {
      expect(late.some((r) => r.category === category)).toBe(true);
    }
    const firstHour = scenario.requests.filter((r) => r.timestampMs < HOUR).length;
    expect(firstHour).toBeLessThan(late.length);
  });

  it("keeps the traffic curve and bucket allocation exact", () => {
    expect(trafficWeight(0, 72)).toBeLessThan(trafficWeight(71, 72));
    const counts = allocate(60, [1, 2, 3]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(60);
    expect(counts).toEqual([10, 20, 30]);
    expect(allocate(7, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(7);
  });
});

describe("small-preset runs", () => {
  const scenario = smallScenario();
  const unpaced = simulate(scenario, false);
  const paced = simulate(scenario, true);

  it("holds every accounting invariant in both modes", () => {
    expect(checkInvariants(scenario, unpaced)).toEqual([]);
    expect(checkInvariants(scenario, paced)).toEqual([]);
  });

  it("reaches the score-qualified coverage target", () => {
    const coverage = unpaced.summary.thresholdQualifiedPairRequests / unpaced.summary.totalRequests;
    expect(coverage).toBeGreaterThanOrEqual(0.9);
    expect(paced.summary.thresholdQualifiedPairRequests).toBe(unpaced.summary.thresholdQualifiedPairRequests);
  });

  it("does not collapse auctions to a single participant", () => {
    const share = unpaced.summary.multiBidderAuctions / unpaced.summary.filledRequests;
    expect(share).toBeGreaterThan(0.5);
  });

  it("puts all three objectives on shortlists", () => {
    const objectives = new Set<string>();
    for (const trace of unpaced.traces) {
      for (const candidate of trace.candidates) {
        if (candidate.scoring.evaluated && candidate.scoring.shortlisted) objectives.add(candidate.objective);
      }
    }
    expect(objectives.size).toBe(3);
  });
});

describe("baseline preset", () => {
  it("generates the full six-hour marketplace at the documented size", () => {
    const scenario = generateScenario(BASELINE_PRESET);
    expect(() => validateSnapshot(scenario)).not.toThrow();
    expect(scenario.requests).toHaveLength(4000);
    expect(scenario.campaigns).toHaveLength(32);
    expect(scenario.users).toHaveLength(20);
  });
});
