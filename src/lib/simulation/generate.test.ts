import { describe, expect, it } from "vitest";
import { qualityScore } from "./scoring";
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

  it("gives every campaign a segment it targets well and one it does not", () => {
    for (const campaign of scenario.campaigns) {
      const values = scenario.segments.map((s) => campaign.affinity[s] ?? 0);
      expect(Math.max(...values)).toBeGreaterThan(0.8);
      expect(Math.min(...values)).toBeLessThan(0.4);
    }
    expect(new Set(scenario.users.map((u) => u.segment)).size).toBeGreaterThan(1);
  });

  it("does not let bid rank stand in for quality rank", () => {
    const category = scenario.categories[0];
    const campaigns = scenario.campaigns.filter((c) => c.category === category);
    const byBid = [...campaigns].sort((a, b) => b.bidMicros - a.bidMicros).map((c) => c.id);
    for (const user of scenario.users) {
      const byQuality = [...campaigns]
        .sort((a, b) => qualityScore(b, user, scenario.config) - qualityScore(a, user, scenario.config))
        .map((c) => c.id);
      expect(byQuality).not.toEqual(byBid);
    }
  });

  it("keeps traffic broadly even, with every category represented late", () => {
    const lateStart = scenario.config.sessionDurationMs - 2 * HOUR;
    const late = scenario.requests.filter((r) => r.timestampMs >= lateStart);
    expect(late.length / scenario.requests.length).toBeGreaterThan(0.3);
    for (const category of scenario.categories) {
      expect(late.some((r) => r.category === category)).toBe(true);
    }
    const firstHour = scenario.requests.filter((r) => r.timestampMs < HOUR).length;
    expect(firstHour / scenario.requests.length).toBeGreaterThan(0.14);
    expect(firstHour / scenario.requests.length).toBeLessThan(0.2);
  });

  it("keeps the near-uniform traffic curve and bucket allocation exact", () => {
    expect(Math.abs(trafficWeight(0, 72) - trafficWeight(71, 72))).toBeLessThan(0.15);
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

  it("reaches the quality-qualified coverage target", () => {
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
        if (candidate.ranking.evaluated && candidate.ranking.shortlisted) objectives.add(candidate.objective);
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
