import type { ScenarioSnapshot } from "../contracts";
import { DEFAULT_CONFIG, generateScenario, type GeneratorPreset } from "../simulation/generate";

/**
 * The baseline marketplace: the versioned scenario the app seeds and every run is compared against.
 * Changing any number here changes historical results, so bump `version` when you do.
 */
export const BASELINE_PRESET: GeneratorPreset = {
  scenarioId: "baseline",
  version: "baseline-2",
  seed: "ads-marketplace-2026",
  categoryCount: 4,
  userCount: 20,
  campaignsPerCategory: 8,
  requestCount: 4000,
  config: DEFAULT_CONFIG,
};

/**
 * A small scenario from the same generator, used by unit tests so they stay fast. It is a test fixture,
 * not a second baseline: only the baseline is versioned, seeded into the app, and used for tuning
 * judgments, because coverage and competition depend on the ratio of budget to traffic.
 */
export const SMALL_PRESET: GeneratorPreset = {
  scenarioId: "small",
  version: "small-2",
  seed: "small-seed",
  categoryCount: 2,
  userCount: 6,
  campaignsPerCategory: 8,
  requestCount: 80,
  config: DEFAULT_CONFIG,
};

export function baselineScenario(): ScenarioSnapshot {
  return generateScenario(BASELINE_PRESET);
}

export function smallScenario(): ScenarioSnapshot {
  return generateScenario(SMALL_PRESET);
}
