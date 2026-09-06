import type { RunRecord, TimelineBucket } from "./run";
import type { ScenarioSummary } from "./scenario";
import type { RequestListItem, RequestTrace } from "./trace";

export type ApiErrorCode = "bad_request" | "not_found" | "conflict" | "internal";

export interface ApiError {
  error: { code: ApiErrorCode; message: string };
}

/** GET /api/scenario */
export interface ScenarioResponse {
  scenario: ScenarioSummary;
}

/** POST /api/scenario/reset */
export interface ResetResponse {
  scenario: ScenarioSummary;
  reseeded: boolean;
}

/** GET /api/runs/:id — id is always "off" or "on"; both are always computable from the fixed baseline scenario. */
export interface RunResponse {
  run: RunRecord;
}

/** GET /api/runs */
export interface RunListResponse {
  runs: RunRecord[];
}

/** GET /api/runs/:id/timeline */
export interface TimelineResponse {
  runId: string;
  buckets: TimelineBucket[];
}

/** GET /api/runs/:id/requests?cursor=&limit=&beforeMs= */
export interface RequestListResponse {
  runId: string;
  items: RequestListItem[];
  /** Sequence number to pass as `cursor` for the next page; null at the end. */
  nextCursor: number | null;
  total: number;
}

/** GET /api/runs/:id/requests/:requestId */
export interface RequestTraceResponse {
  runId: string;
  trace: RequestTrace;
}
