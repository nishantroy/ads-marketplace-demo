import type { RunRecord } from "../../lib/contracts";
import { tinyScenario } from "../../lib/fixtures/tiny";
import { simulate } from "../../lib/simulation/engine";
import { summarizeScenario } from "../../lib/simulation/snapshot";
import { ENGINE_VERSION } from "../../lib/simulation/version";

/**
 * Real engine output on the tiny hand-calculable fixture, computed once at build time rather than fetched
 * from a run. This is a stand-in for the live API (M3), not a second implementation of the funnel: it calls
 * the same `simulate()` the real app uses, so it can never drift from engine behaviour the way hand-typed
 * numbers could. It is not evidence of marketplace-scale pacing effects; there are only four requests here.
 */
const preview = simulate(tinyScenario, false);

export const previewScenario = summarizeScenario(tinyScenario);
export const previewTraces = preview.traces;
export const previewTimeline = preview.timeline;

export const previewRun: RunRecord = {
  id: "preview-unpaced",
  scenarioId: tinyScenario.scenarioId,
  scenarioVersion: tinyScenario.version,
  engineVersion: ENGINE_VERSION,
  inputHash: previewScenario.inputHash,
  pacingEnabled: false,
  status: "completed",
  createdAt: "2026-09-06T00:00:00.000Z",
  summary: preview.summary,
};
