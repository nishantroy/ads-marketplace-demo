import type { RunOutput, ScenarioSnapshot, ScenarioSummary } from "../contracts";
import { baselineScenario } from "../fixtures/presets";
import { simulate } from "../simulation/engine";
import { checkInvariants } from "../simulation/invariants";
import { summarizeScenario } from "../simulation/snapshot";
import { ENGINE_VERSION } from "../simulation/version";

/** The only API module importing engine/fixture implementations. Review here when main changes. */
export interface EngineAdapter {
  version: string;
  baseline(): ScenarioSnapshot;
  summarize(snapshot: ScenarioSnapshot): ScenarioSummary;
  run(snapshot: ScenarioSnapshot, pacingEnabled: boolean): RunOutput;
}

export const engineAdapter: EngineAdapter = {
  version: ENGINE_VERSION,
  baseline: baselineScenario,
  summarize: summarizeScenario,
  run(snapshot, pacingEnabled) {
    const output = simulate(snapshot, pacingEnabled);
    const violations = checkInvariants(snapshot, output);
    if (violations.length) throw new Error(`Simulation accounting failed: ${violations.join("; ")}`);
    return output;
  },
};
