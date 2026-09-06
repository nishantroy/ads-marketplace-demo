import type { RequestListItem, RunOutput, RunRecord, ScenarioSnapshot } from "../contracts";

export interface RequestQuery {
  /** Inclusive sequence number. nextCursor is the next unseen sequence. */
  cursor: number;
  limit: number;
  /** Exclusive simulated timestamp cutoff. */
  beforeMs?: number;
}

interface DemoResult { run: RunRecord; output: RunOutput }

/**
 * A per-instance performance cache, not a source of truth. The engine is a pure, cheap (well under a
 * second) function of the fixed baseline scenario and a pacing mode, so any instance can always recompute
 * a result from nothing: this class only avoids recomputing when the same instance already has. On a
 * platform that runs multiple instances with no shared memory (Vercel serverless included), a cache miss
 * must never be an error — see SimulatorService.ensureRun.
 */
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

  getCached(pacingEnabled: boolean): DemoResult | undefined {
    const cached = this.results.get(pacingEnabled);
    return cached ? structuredClone(cached) : undefined;
  }

  cache(run: RunRecord, output: RunOutput) {
    this.results.set(run.pacingEnabled, structuredClone({ run, output }));
  }

  listRequests(output: RunOutput, id: string, query: RequestQuery) {
    const visible = output.traces.filter(t => query.beforeMs === undefined || t.timestampMs < query.beforeMs);
    const eligible = visible.filter(t => t.sequence >= query.cursor);
    const items: RequestListItem[] = eligible.slice(0, query.limit).map(t => ({
      requestId: t.requestId, sequence: t.sequence, timestampMs: t.timestampMs,
      userId: t.userId, category: t.category, query: t.query, retrievedCount: t.retrievedCount,
      participantCount: t.participantCount, winnerCampaignId: t.winnerCampaignId,
      priceMicros: t.priceMicros, filled: t.filled,
    }));
    return { runId: id, items, nextCursor: eligible[query.limit]?.sequence ?? null, total: visible.length };
  }
}
