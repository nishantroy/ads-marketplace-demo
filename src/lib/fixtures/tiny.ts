import { dollars, type ScenarioSnapshot } from "../contracts";

/**
 * Hand-calculable fixture: one category, two segments, three users, three campaigns, four requests.
 *
 * Engagement bases (ctrScale 0.05, cvrScale 0.01):
 *   c1 impression prior 0.9        -> 0.9
 *   c2 click ctr 0.04 / 0.05       -> 0.8
 *   c3 conversion cvr 0.005 / 0.01 -> 0.5
 *
 * Relevance is the pair product: the user's category interest times the campaign's affinity for the
 * user's segment. Quality is engagement times that relevance.
 *
 *   u1 (segment s1, category relevance 1.0): c1 0.9x0.50 = 0.45, c2 0.8x1.00 = 0.80, c3 0.5x0.80 = 0.40
 *   u2 (segment s2, category relevance 0.5): c1 0.9x0.50 = 0.45, c2 0.8x0.25 = 0.20, c3 0.5x0.40 = 0.20
 *   u3 (segment s2, category relevance 0.3): c1 0.27, c2 0.12, c3 0.12
 *
 * With a quality gate of 0.30, u2 keeps only c1 and u3 keeps nothing.
 *
 * Walkthrough with pacing off (reserve $0.10). Note c1's budget of $0.80 caps its $1.00 bid from the start.
 *
 *   r1 t=0h u1: effective bids c1 $0.80, c2 $0.60, c3 $0.80.
 *               utilities c1 0.80x0.45 = 0.36, c2 0.60x0.80 = 0.48, c3 0.80x0.40 = 0.32.
 *               c2 wins on the LOWEST bid in the auction, because it matches this user best.
 *               price = runner-up utility / winner quality = 0.36 / 0.80 = $0.45, under its own $0.60 bid.
 *   r2 t=1h u2: only c1 passes the gate, so it is the sole participant and pays the reserve $0.10.
 *               c1 budget 0.80 -> 0.70.
 *   r3 t=2h u1: c1's effective bid is now $0.70, so its utility drops to 0.315 and c3 becomes runner-up.
 *               c2 wins again and pays 0.32 / 0.80 = $0.40.
 *   r4 t=3h u3: nothing passes the gate, so the auction is empty and no one is charged.
 *
 *   Revenue $0.95 = c1 $0.10 + c2 $0.85; c3 spends nothing while still setting a price in r3.
 *
 * Pacing on: r1 sits at t=0, where every target is 0, so every candidate is paced out and r1 is empty.
 */
export const tinyScenario: ScenarioSnapshot = {
  scenarioId: "tiny",
  version: "tiny-2",
  seed: "tiny-seed",
  categories: ["shoes"],
  segments: ["s1", "s2"],
  config: {
    sessionDurationMs: 6 * 60 * 60 * 1000,
    bucketDurationMs: 5 * 60 * 1000,
    reserveMicros: dollars(0.1),
    qualityThreshold: 0.3,
    shortlistSize: 4,
    ctrScale: 0.05,
    cvrScale: 0.01,
  },
  users: [
    { id: "u1", name: "Avery", segment: "s1", relevance: { shoes: 1 } },
    { id: "u2", name: "Blake", segment: "s2", relevance: { shoes: 0.5 } },
    { id: "u3", name: "Casey", segment: "s2", relevance: { shoes: 0.3 } },
  ],
  campaigns: [
    {
      id: "c1",
      name: "Runner Brand",
      category: "shoes",
      objective: "impression",
      qualityPrior: 0.9,
      bidMicros: dollars(1),
      budgetMicros: dollars(0.8),
      affinity: { s1: 0.5, s2: 1 },
    },
    {
      id: "c2",
      name: "Sneaker Outlet",
      category: "shoes",
      objective: "click",
      historicalCtr: 0.04,
      bidMicros: dollars(0.6),
      budgetMicros: dollars(5),
      affinity: { s1: 1, s2: 0.5 },
    },
    {
      id: "c3",
      name: "Boot Maker",
      category: "shoes",
      objective: "conversion",
      historicalCvr: 0.005,
      bidMicros: dollars(0.8),
      budgetMicros: dollars(5),
      affinity: { s1: 0.8, s2: 0.8 },
    },
  ],
  requests: [
    { id: "r1", timestampMs: 0, userId: "u1", category: "shoes", query: "running shoes" },
    { id: "r2", timestampMs: 1 * 60 * 60 * 1000, userId: "u2", category: "shoes", query: "trail shoes" },
    { id: "r3", timestampMs: 2 * 60 * 60 * 1000, userId: "u1", category: "shoes", query: "shoe sale" },
    { id: "r4", timestampMs: 3 * 60 * 60 * 1000, userId: "u3", category: "shoes", query: "dress shoes" },
  ],
};
