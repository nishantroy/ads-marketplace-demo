import {
  dollars,
  type Campaign,
  type Category,
  type Objective,
  type ScenarioConfig,
  type ScenarioSnapshot,
  type SimRequest,
  type User,
} from "../contracts";
import { mulberry32 } from "./hash";
import { compareRequests } from "./snapshot";

/**
 * Deterministic scenario generation. Runs once, before a simulation, so it may use the seeded
 * `mulberry32` stream; request processing may not. Same preset and seed always produce the same scenario.
 */

export interface GeneratorPreset {
  scenarioId: string;
  /** Bump when generation logic or numbers change, so historical runs stay interpretable. */
  version: string;
  seed: string;
  categoryCount: number;
  userCount: number;
  campaignsPerCategory: number;
  requestCount: number;
  config: ScenarioConfig;
  /**
   * Multiplies every archetype budget. Defaults to `requestCount / (categoryCount * 1000)` so a smaller
   * scenario exhausts budgets on the same schedule as the baseline instead of never running dry.
   */
  budgetScale?: number;
}

const CATEGORY_NAMES: Category[] = ["travel", "electronics", "home", "fitness"];

const USER_NAMES = [
  "Avery", "Blake", "Casey", "Devon", "Emery", "Finley", "Gray", "Harper", "Indigo", "Jordan",
  "Kai", "Logan", "Marlow", "Noor", "Oakley", "Parker", "Quinn", "Riley", "Sage", "Tatum",
];

const QUERY_TEMPLATES: Record<Category, string[]> = {
  travel: ["weekend flights", "beach hotel deals", "rail pass", "city break"],
  electronics: ["noise cancelling headphones", "budget laptop", "smart watch", "4k monitor"],
  home: ["standing desk", "espresso machine", "wool rug", "air purifier"],
  fitness: ["running shoes", "yoga mat", "adjustable dumbbells", "gym membership"],
};

/**
 * Campaign archetypes, strongest bid first. Score order is deliberately not bid order: the shortlist is
 * score-only, so if the two ranks agreed the same campaigns would always both rank and outbid everyone and
 * no losing campaign could ever support a price. Here the top scorer (index 2) is beaten on bid by two
 * campaigns that score below it, which keeps clearing prices informative.
 *
 * As budgets run out the winner walks down this ladder, which is the "cheap late impressions" lesson.
 */
interface Archetype {
  tier: "strong" | "medium" | "low";
  bid: number;
  budget: number;
  /** Normalised objective prediction in [0, 1] before per-category jitter. */
  base: number;
  objective: Objective;
}

/**
 * Budgets are not free parameters. A campaign can only spend what it can win, and in this ladder a winner
 * pays roughly the next bid down, so budget is sized as `target impressions x price paid when winning`,
 * then calibrated against both pacing modes until every tier spends out. Budgets that ignore this starve
 * the cheap tiers: they only win when the tiers above them are out of budget or paced out, so an
 * over-funded cheap campaign strands most of its money in both modes.
 *
 * Target impressions per tier: 120, 115, 115, 110, 105, 100, 95, 90 out of roughly 1,000 requests per
 * category, which keeps total demand just under the supply of score-qualified requests.
 */
const ARCHETYPES: Archetype[] = [
  { tier: "strong", bid: 1.45, budget: 156, base: 0.9, objective: "click" },
  { tier: "strong", bid: 1.3, budget: 109, base: 0.82, objective: "conversion" },
  { tier: "medium", bid: 0.95, budget: 97, base: 0.95, objective: "impression" },
  { tier: "medium", bid: 0.85, budget: 79, base: 0.86, objective: "click" },
  { tier: "medium", bid: 0.72, budget: 50, base: 0.78, objective: "conversion" },
  { tier: "low", bid: 0.48, budget: 36, base: 0.74, objective: "impression" },
  { tier: "low", bid: 0.38, budget: 23, base: 0.7, objective: "click" },
  { tier: "low", bid: 0.3, budget: 5, base: 0.66, objective: "conversion" },
];

/** Smallest gap between adjacent archetype base scores is 0.04, so jitter stays below half of that. */
const BASE_JITTER = 0.015;

export const DEFAULT_CONFIG: ScenarioConfig = {
  sessionDurationMs: 6 * 60 * 60 * 1000,
  bucketDurationMs: 5 * 60 * 1000,
  reserveMicros: dollars(0.1),
  scoreThreshold: 0.35,
  shortlistSize: 4,
  ctrScale: 0.05,
  cvrScale: 0.01,
};

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** Weighted pick over cumulative weights; deterministic for a given draw. */
function pick<T>(items: T[], weights: number[], draw: number): T {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = draw * total;
  for (let i = 0; i < items.length; i += 1) {
    cursor -= weights[i];
    if (cursor < 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Traffic weight per bucket: a rising curve so the back half of the session carries most of the traffic,
 * with a short-period wobble so arrivals are uneven rather than a smooth ramp.
 */
export function trafficWeight(bucketIndex: number, bucketCount: number): number {
  const x = bucketCount === 1 ? 0 : bucketIndex / (bucketCount - 1);
  return (0.35 + 1.15 * x * x) * (1 + 0.35 * Math.sin(bucketIndex * 0.9));
}

/** Largest-remainder allocation, so bucket counts sum exactly to `total` without any tie-breaking drift. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  const exact = weights.map((weight) => (total * weight) / sum);
  const counts = exact.map((value) => Math.floor(value));
  let remaining = total - counts.reduce((acc, count) => acc + count, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => (b.fraction !== a.fraction ? b.fraction - a.fraction : a.index - b.index));
  for (let i = 0; remaining > 0; i = (i + 1) % order.length) {
    counts[order[i].index] += 1;
    remaining -= 1;
  }
  return counts;
}

function buildUsers(preset: GeneratorPreset, categories: Category[]): User[] {
  const rng = mulberry32(`${preset.seed}|users`);
  return Array.from({ length: preset.userCount }, (_, i) => {
    const primary = categories[i % categories.length];
    const secondary = categories[(i + 1 + Math.floor(i / categories.length)) % categories.length];
    const relevance: Record<Category, number> = {};
    for (const category of categories) {
      if (category === primary) relevance[category] = round2(0.82 + rng() * 0.18);
      else if (category === secondary) relevance[category] = round2(0.45 + rng() * 0.25);
      else relevance[category] = round2(0.12 + rng() * 0.22);
    }
    return { id: `u${pad(i + 1, 2)}`, name: USER_NAMES[i % USER_NAMES.length], relevance };
  });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildCampaigns(preset: GeneratorPreset, categories: Category[]): Campaign[] {
  const rng = mulberry32(`${preset.seed}|campaigns`);
  const budgetScale = preset.budgetScale ?? preset.requestCount / (categories.length * 1000);
  const campaigns: Campaign[] = [];

  for (const category of categories) {
    // One factor per category so categories differ in price level without changing the archetype ladder.
    const bidFactor = 0.94 + rng() * 0.12;
    const budgetFactor = 0.9 + rng() * 0.2;
    for (let i = 0; i < preset.campaignsPerCategory; i += 1) {
      const archetype = ARCHETYPES[i % ARCHETYPES.length];
      const base = clampBase(archetype.base + (rng() * 2 - 1) * BASE_JITTER);
      const common = {
        id: `${category}-c${i}`,
        name: `${title(category)} ${archetype.tier} ${i}`,
        category,
        bidMicros: dollars(round2(archetype.bid * bidFactor)),
        budgetMicros: dollars(Math.max(1, round2(archetype.budget * budgetFactor * budgetScale))),
      };
      campaigns.push(withObjective(common, archetype.objective, base, preset.config));
    }
  }
  return campaigns;
}

function clampBase(value: number): number {
  return Math.min(1, Math.max(0.01, Math.round(value * 1000) / 1000));
}

function title(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Invert the score formula so every objective reaches the intended normalised base score. */
function withObjective(
  common: { id: string; name: string; category: Category; bidMicros: number; budgetMicros: number },
  objective: Objective,
  base: number,
  config: ScenarioConfig,
): Campaign {
  switch (objective) {
    case "impression":
      return { ...common, objective, qualityPrior: base };
    case "click":
      return { ...common, objective, historicalCtr: round4(base * config.ctrScale) };
    case "conversion":
      return { ...common, objective, historicalCvr: round4(base * config.cvrScale) };
  }
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function buildRequests(preset: GeneratorPreset, categories: Category[], users: User[]): SimRequest[] {
  const rng = mulberry32(`${preset.seed}|requests`);
  const { sessionDurationMs, bucketDurationMs } = preset.config;
  const bucketCount = Math.ceil(sessionDurationMs / bucketDurationMs);
  const weights = Array.from({ length: bucketCount }, (_, i) => trafficWeight(i, bucketCount));
  const counts = allocate(preset.requestCount, weights);
  const idWidth = String(preset.requestCount).length;

  const requests: SimRequest[] = [];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const count = counts[bucket];
    const start = bucket * bucketDurationMs;
    for (let k = 0; k < count; k += 1) {
      // Even spacing inside the bucket keeps timestamps distinct and ordering stable.
      const timestampMs = Math.min(
        sessionDurationMs - 1,
        start + Math.floor(((k + 0.5) * bucketDurationMs) / count),
      );
      const user = users[Math.floor(rng() * users.length) % users.length];
      const category = pick(
        categories,
        categories.map((c) => categoryWeight(user.relevance[c] ?? 0)),
        rng(),
      );
      const templates = QUERY_TEMPLATES[category] ?? [`${category} deals`];
      requests.push({
        id: `r${pad(requests.length + 1, idWidth)}`,
        timestampMs,
        userId: user.id,
        category,
        query: templates[Math.floor(rng() * templates.length) % templates.length],
      });
    }
  }
  return requests.sort(compareRequests);
}

/**
 * Requests land mostly in categories the user actually cares about, which is what keeps score-qualified
 * coverage high. The small weight on weak categories is deliberate: those requests show relevance cutting
 * candidates out at the threshold.
 */
function categoryWeight(relevance: number): number {
  if (relevance >= 0.75) return 6;
  if (relevance >= 0.4) return 3;
  return 0.25;
}

export function generateScenario(preset: GeneratorPreset): ScenarioSnapshot {
  if (preset.categoryCount < 1 || preset.categoryCount > CATEGORY_NAMES.length) {
    throw new RangeError(`categoryCount must be between 1 and ${CATEGORY_NAMES.length}`);
  }
  if (preset.campaignsPerCategory < 1 || preset.campaignsPerCategory > ARCHETYPES.length) {
    throw new RangeError(`campaignsPerCategory must be between 1 and ${ARCHETYPES.length}`);
  }
  const categories = CATEGORY_NAMES.slice(0, preset.categoryCount);
  const users = buildUsers(preset, categories);
  return {
    scenarioId: preset.scenarioId,
    version: preset.version,
    seed: preset.seed,
    categories,
    config: preset.config,
    users,
    campaigns: buildCampaigns(preset, categories),
    requests: buildRequests(preset, categories, users),
  };
}
