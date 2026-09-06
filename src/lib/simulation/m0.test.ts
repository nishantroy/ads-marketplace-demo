import { describe, expect, it } from "vitest";
import { tinyScenario } from "../fixtures/tiny";
import { assertMicros, dollars, MAX_MONEY_MICROS } from "../contracts";
import { fnv1a32, stableRandom, stableStringify } from "./hash";
import { baseScore, qualityScore } from "./scoring";
import { inputHash, validateSnapshot } from "./snapshot";

describe("M0 contracts", () => {
  it("accepts the tiny fixture and hashes it stably", () => {
    expect(() => validateSnapshot(tinyScenario)).not.toThrow();
    const a = inputHash(tinyScenario);
    const b = inputHash(JSON.parse(JSON.stringify(tinyScenario)));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("rejects out-of-order requests and invalid money", () => {
    const bad = { ...tinyScenario, requests: [tinyScenario.requests[1], tinyScenario.requests[0]] };
    expect(() => validateSnapshot(bad)).toThrow(/ordered/);
    expect(() => assertMicros(1.5, "x")).toThrow(RangeError);
    expect(() => assertMicros(MAX_MONEY_MICROS + 1, "x")).toThrow(RangeError);
    expect(dollars(0.1)).toBe(100_000);
  });

  it("computes the documented engagement bases and qualities", () => {
    const [c1, c2, c3] = tinyScenario.campaigns;
    const cfg = tinyScenario.config;
    expect(baseScore(c1, cfg)).toBeCloseTo(0.9);
    expect(baseScore(c2, cfg)).toBeCloseTo(0.8);
    expect(baseScore(c3, cfg)).toBeCloseTo(0.5);
    const [u1, u2] = tinyScenario.users;
    // Quality is engagement x category relevance x segment affinity, so it differs by user.
    expect(qualityScore(c1, u1, cfg)).toBeCloseTo(0.45);
    expect(qualityScore(c2, u1, cfg)).toBeCloseTo(0.8);
    expect(qualityScore(c2, u2, cfg)).toBeCloseTo(0.2);
  });

  it("stable hashing is deterministic, keyed, and in [0, 1)", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    const x = stableRandom("s", "r1", "c1", "pacing");
    expect(x).toBe(stableRandom("s", "r1", "c1", "pacing"));
    expect(x).not.toBe(stableRandom("s", "r1", "c2", "pacing"));
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(1);
    expect(stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
  });
});
