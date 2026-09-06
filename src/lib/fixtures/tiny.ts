import { dollars, type ScenarioSnapshot } from "../contracts";

/**
 * Hand-calculable fixture: one category, two users, three campaigns, four requests.
 *
 * Base scores (ctrScale 0.05, cvrScale 0.01):
 *   c1 impression prior 0.9          -> 0.9
 *   c2 click ctr 0.04 / 0.05         -> 0.8
 *   c3 conversion cvr 0.005 / 0.01   -> 0.5
 * User u1 relevance 1.0 -> scores 0.9 / 0.8 / 0.5 (all pass threshold 0.45).
 * User u2 relevance 0.5 -> scores 0.45 / 0.40 / 0.25 (only c1 qualifies).
 *
 * Pacing off walkthrough (reserve $0.10):
 *   r1 t=0h u1: bids c1 $1.00, c3 $0.80, c2 $0.60 -> c1 wins, pays $0.80. c1 budget 1.50 -> 0.70.
 *   r2 t=1h u1: c1 effective min(1.00, 0.70)=0.70, c3 0.80, c2 0.60 -> c3 wins, pays $0.70. c3 5.00 -> 4.30.
 *   r3 t=2h u2: only c1 qualifies; effective 0.70 >= reserve -> sole bidder pays reserve $0.10. c1 0.70 -> 0.60.
 *   r4 t=3h u1: c1 0.60, c3 0.80, c2 0.60 -> c3 wins; second-highest 0.60 (c1/c2 tie) -> pays $0.60. c3 4.30 -> 3.70.
 *   Revenue $2.20 = c1 spend $0.90 + c3 spend $1.30; c2 spends $0.
 *
 * Pacing on: r1 at t=0 has target 0 for every campaign -> all paced out -> empty auction, zero spend.
 */
export const tinyScenario: ScenarioSnapshot = {
  scenarioId: "tiny",
  version: "tiny-1",
  seed: "tiny-seed",
  categories: ["shoes"],
  config: {
    sessionDurationMs: 6 * 60 * 60 * 1000,
    bucketDurationMs: 5 * 60 * 1000,
    reserveMicros: dollars(0.1),
    scoreThreshold: 0.45,
    shortlistSize: 4,
    ctrScale: 0.05,
    cvrScale: 0.01,
  },
  users: [
    { id: "u1", name: "Avery", relevance: { shoes: 1 } },
    { id: "u2", name: "Blake", relevance: { shoes: 0.5 } },
  ],
  campaigns: [
    {
      id: "c1",
      name: "Runner Brand",
      category: "shoes",
      objective: "impression",
      qualityPrior: 0.9,
      bidMicros: dollars(1),
      budgetMicros: dollars(1.5),
    },
    {
      id: "c2",
      name: "Sneaker Outlet",
      category: "shoes",
      objective: "click",
      historicalCtr: 0.04,
      bidMicros: dollars(0.6),
      budgetMicros: dollars(5),
    },
    {
      id: "c3",
      name: "Boot Maker",
      category: "shoes",
      objective: "conversion",
      historicalCvr: 0.005,
      bidMicros: dollars(0.8),
      budgetMicros: dollars(5),
    },
  ],
  requests: [
    { id: "r1", timestampMs: 0, userId: "u1", category: "shoes", query: "running shoes" },
    { id: "r2", timestampMs: 1 * 60 * 60 * 1000, userId: "u1", category: "shoes", query: "trail shoes" },
    { id: "r3", timestampMs: 2 * 60 * 60 * 1000, userId: "u2", category: "shoes", query: "dress shoes" },
    { id: "r4", timestampMs: 3 * 60 * 60 * 1000, userId: "u1", category: "shoes", query: "shoe sale" },
  ],
};
