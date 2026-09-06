import { randomUUID } from "node:crypto";
import type { RequestListResponse, RequestTraceResponse, ResetResponse, RunListResponse, RunResponse, ScenarioResponse, TimelineResponse } from "../contracts";
import type { EngineAdapter } from "./engine-adapter";
import { LiveDemoStore, type RequestQuery } from "./live-demo-store";
import { ApiFailure, parseCreateRun } from "./validation";

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

  createRun(body: unknown): RunResponse {
    const { pacingEnabled } = parseCreateRun(body);
    const snapshot = this.store.getScenario(() => this.engine.baseline());
    const summary = this.engine.summarize(snapshot);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    try {
      // Fresh snapshot/balances each time. Metadata clocks and IDs never enter the engine.
      const output = this.engine.run(snapshot, pacingEnabled);
      const result: RunResponse = { run: {
        id, scenarioId: snapshot.scenarioId, scenarioVersion: snapshot.version,
        engineVersion: this.engine.version, inputHash: summary.inputHash, pacingEnabled,
        status: "completed", createdAt, completedAt: new Date().toISOString(), summary: output.summary,
      } };
      this.store.publish(result.run, output);
      return result;
    } catch (error) {
      console.error(`Demo run ${id} failed`, error);
      throw new ApiFailure("internal", "Simulation failed. The previous comparison results are unchanged.", 500);
    }
  }

  runs(): RunListResponse { return { runs: this.store.listRuns() }; }

  run(id: string): RunResponse {
    const run = this.store.getRun(id);
    if (!run) throw new ApiFailure("not_found", "Result not available. It may have been replaced, reset, or lost on server restart.", 404);
    return { run };
  }

  timeline(id: string): TimelineResponse {
    this.run(id);
    return { runId: id, buckets: this.store.getTimeline(id)! };
  }

  requests(id: string, query: RequestQuery): RequestListResponse {
    this.run(id);
    return this.store.listRequests(id, query)!;
  }

  trace(id: string, requestId: string): RequestTraceResponse {
    this.run(id);
    const trace = this.store.getTrace(id, requestId);
    if (!trace) throw new ApiFailure("not_found", "Request not found in this current result.", 404);
    return { runId: id, trace };
  }
}
