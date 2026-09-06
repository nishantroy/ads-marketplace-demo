import type { RequestListItem, RunOutput, RunRecord, ScenarioSnapshot } from "../contracts";

export interface RequestQuery {
  /** Inclusive sequence number. nextCursor is the next unseen sequence. */
  cursor: number;
  limit: number;
  /** Exclusive simulated timestamp cutoff. */
  beforeMs?: number;
}

interface DemoResult { run: RunRecord; output: RunOutput }

/** Two result slots, not run history. Local, single-process, non-durable demo state. */
export class LiveDemoStore {
  private scenario?: ScenarioSnapshot;
  private results = new Map<boolean, DemoResult>();

  getScenario(create: () => ScenarioSnapshot) {
    this.scenario ??= structuredClone(create());
    return structuredClone(this.scenario);
  }

  reset(snapshot: ScenarioSnapshot) {
    this.scenario = structuredClone(snapshot);
    this.results.clear();
  }

  publish(run: RunRecord, output: RunOutput) {
    // Clone before replacing the previous result; partial/failed runs never overwrite it.
    const result = structuredClone({ run, output });
    this.results.set(run.pacingEnabled, result);
  }

  listRuns() {
    return structuredClone([...this.results.values()].map(r => r.run)
      .sort((a, b) => Number(a.pacingEnabled) - Number(b.pacingEnabled)));
  }

  private find(id: string) { return [...this.results.values()].find(r => r.run.id === id); }

  getRun(id: string) {
    const run = this.find(id)?.run;
    return run ? structuredClone(run) : undefined;
  }

  getTimeline(id: string) {
    const timeline = this.find(id)?.output.timeline;
    return timeline ? structuredClone(timeline) : undefined;
  }

  listRequests(id: string, query: RequestQuery) {
    const traces = this.find(id)?.output.traces;
    if (!traces) return undefined;
    const visible = traces.filter(t => query.beforeMs === undefined || t.timestampMs < query.beforeMs);
    const eligible = visible.filter(t => t.sequence >= query.cursor);
    const items: RequestListItem[] = eligible.slice(0, query.limit).map(t => ({
      requestId: t.requestId, sequence: t.sequence, timestampMs: t.timestampMs,
      userId: t.userId, category: t.category, query: t.query, retrievedCount: t.retrievedCount,
      participantCount: t.participantCount, winnerCampaignId: t.winnerCampaignId,
      priceMicros: t.priceMicros, filled: t.filled,
    }));
    return { runId: id, items, nextCursor: eligible[query.limit]?.sequence ?? null, total: visible.length };
  }

  getTrace(id: string, requestId: string) {
    const trace = this.find(id)?.output.traces.find(t => t.requestId === requestId);
    return trace ? structuredClone(trace) : undefined;
  }
}
