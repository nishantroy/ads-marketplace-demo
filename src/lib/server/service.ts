import type { RequestTraceResponse, ResetResponse, RunListResponse, RunResponse, ScenarioResponse, TimelineResponse } from "../contracts";
import type { EngineAdapter } from "./engine-adapter";
import { LiveDemoStore, type RequestQuery } from "./live-demo-store";
import { ApiFailure } from "./validation";

/** The only two valid run identities: there is nothing else to compute or look up. */
const RUN_ID = { off: "off", on: "on" } as const;

function pacingFromId(id: string): boolean {
  if (id === RUN_ID.off) return false;
  if (id === RUN_ID.on) return true;
  throw new ApiFailure("not_found", "No such result. Valid results are \"off\" and \"on\".", 404);
}

export class SimulatorService {
  constructor(private store: LiveDemoStore, private engine: EngineAdapter) {}

  reset(): ResetResponse {
    const snapshot = this.engine.baseline();
    this.store.reset(snapshot);
    return { scenario: this.engine.summarize(snapshot), reseeded: true };
  }

  scenario(): ScenarioResponse {
    return { scenario: this.engine.summarize(this.store.getScenario(() => this.engine.baseline())) };
  }

  /**
   * The engine is a pure, cheap function of (baseline scenario, pacing mode): there is no "creating" a
   * result distinct from "getting" it. This computes on demand and never fails just because a different
   * process instance, or an earlier cold start, never happened to compute it — that statelessness is the
   * whole point. A cached result from this same instance is reused when present; a failed recompute falls
   * back to it rather than erroring, so a transient failure never takes away a result someone already saw.
   */
  private ensureRun(pacingEnabled: boolean): { run: import("../contracts").RunRecord; output: import("../contracts").RunOutput } {
    const cached = this.store.getCached(pacingEnabled);
    const snapshot = this.store.getScenario(() => this.engine.baseline());
    const summary = this.engine.summarize(snapshot);
    if (cached && cached.run.inputHash === summary.inputHash && cached.run.engineVersion === this.engine.version) {
      return cached;
    }
    const id = pacingEnabled ? RUN_ID.on : RUN_ID.off;
    try {
      // Fresh snapshot/balances each computation. Metadata clocks and IDs never enter the engine.
      const output = this.engine.run(snapshot, pacingEnabled);
      const now = new Date().toISOString();
      const run = {
        id, scenarioId: snapshot.scenarioId, scenarioVersion: snapshot.version,
        engineVersion: this.engine.version, inputHash: summary.inputHash, pacingEnabled,
        status: "completed" as const, createdAt: now, completedAt: now, summary: output.summary,
      };
      this.store.cache(run, output);
      return { run, output };
    } catch (error) {
      if (cached) {
        console.error(`Demo run ${id} recompute failed; serving this instance's previous result`, error);
        return cached;
      }
      console.error(`Demo run ${id} failed`, error);
      throw new ApiFailure("internal", "Simulation failed and no previous result is available on this instance.", 500);
    }
  }

  runs(): RunListResponse {
    return { runs: [this.ensureRun(false).run, this.ensureRun(true).run] };
  }

  run(id: string): RunResponse {
    return { run: this.ensureRun(pacingFromId(id)).run };
  }

  timeline(id: string): TimelineResponse {
    const { output } = this.ensureRun(pacingFromId(id));
    return { runId: id, buckets: output.timeline };
  }

  requests(id: string, query: RequestQuery) {
    const { output } = this.ensureRun(pacingFromId(id));
    return this.store.listRequests(output, id, query);
  }

  trace(id: string, requestId: string): RequestTraceResponse {
    const { output } = this.ensureRun(pacingFromId(id));
    const trace = output.traces.find(t => t.requestId === requestId);
    if (!trace) throw new ApiFailure("not_found", "Request not found in this result.", 404);
    return { runId: id, trace };
  }
}
