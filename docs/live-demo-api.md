# Live-demo API

## Scope

There are exactly two results, always: pacing off (`id: "off"`) and pacing on (`id: "on"`). Both are pure,
cheap (well under a second) functions of the fixed baseline scenario and a pacing mode, so any server
instance can recompute either one from nothing on any request — there is no "creating" a run distinct from
"getting" it, and no random run IDs. A process-local cache avoids recomputing when the same instance
already has, but it is only a performance optimization: a cache miss (a fresh cold start, a different
serverless instance, a reset) is never an error, it just means the next request recomputes. This is not
persistence or run history; there is nothing to browse beyond the current pair's request traces, which
exist only to explain the funnel. No database, user sessions, job queue, or historical request browser.

The API is merged into `main` and typechecks against the current quality/utility auction contract.
`src/lib/server/engine-adapter.ts` is the only API module importing engine/fixture implementations, so
future engine integration remains localized. The UI workspace is merged but still uses preview data; its
next chunk replaces that source with these same-origin endpoints.

## Endpoints

Existing shared response types in `src/lib/contracts/api.ts` are unchanged.

| Method / path | Response | Meaning |
| --- | --- | --- |
| `GET /api/scenario` | `{ scenario }` | Baseline summary without the 4,000 input requests; seeded lazily |
| `POST /api/scenario/reset` | `{ scenario, reseeded: true }` | Regenerate baseline (same fixed seed, so an identical scenario); no body required |
| `GET /api/runs` | `{ runs }` | Always both completed results, `"off"` then `"on"`; not a history list |
| `GET /api/runs/:id` | `{ run }` | `id` is `"off"` or `"on"`; anything else is 404 |
| `GET /api/runs/:id/timeline` | `{ runId, buckets }` | Lightweight five-minute metrics |
| `GET /api/runs/:id/requests` | `{ runId, items, nextCursor, total }` | Compact request rows for that mode; no candidate traces |
| `GET /api/runs/:id/requests/:requestId` | `{ runId, trace }` | One funnel trace for that mode |

### Computing a result

There is no `POST /api/runs`: every `GET` above computes on demand from the baseline scenario if this
instance hasn't already, checking accounting invariants each time. If a recompute throws, the instance
falls back to whatever it last cached for that mode rather than erroring, so a transient failure never
takes away a result someone already saw; only a first-ever computation on a fresh instance can surface
HTTP 500.

Wall-clock metadata (`createdAt`/`completedAt`) differs on each recomputation; it never feeds the
simulation. Compare only opposite modes with identical `inputHash` and `engineVersion`. Do not assume
higher revenue with pacing.

### Current request pagination

- `cursor`: inclusive sequence number, default `0`.
- `limit`: integer `1..200`, default `50`.
- `beforeMs`: optional exclusive simulated timestamp cutoff. `0` reveals nothing; a request exactly at
  the cutoff is not visible. Omitted means all requests in the current result.
- `total` counts all requests passing the cutoff, independently of cursor/limit.
- `nextCursor` is the next unseen sequence, or `null` when the filtered stream ends. Reset pagination
  when changing the playback cutoff or run. Request ordering is the engine's stable sequence order.
- Negative/fractional/unsafe integers, unknown parameters, and duplicate parameters return HTTP 400.

### Errors

Errors use `{ "error": { "code": "bad_request" | "not_found" | "internal", "message": "..." } }`.
Invalid inputs return 400; an id other than `"off"`/`"on"` returns 404; a first-ever computation failure
on a fresh instance (nothing cached yet to fall back to) returns 500. Next.js handles unsupported HTTP
methods with 405. JSON responses set `Cache-Control: no-store`.

## Local use

Use the app's existing `npm run dev` command on `127.0.0.1:3002`, **only when main is not using that port**.
The UI preview on 3012 is a separate worktree, not yet wired to these APIs; no cross-origin API bridge is
added. Merge/integrate the lanes before switching the UI to same-origin fetches.

```bash
curl http://127.0.0.1:3002/api/scenario
curl http://127.0.0.1:3002/api/runs
curl 'http://127.0.0.1:3002/api/runs/off/requests?limit=10&beforeMs=3600000'
curl 'http://127.0.0.1:3002/api/runs/on/requests?limit=10&beforeMs=3600000'
curl -X POST http://127.0.0.1:3002/api/scenario/reset
```

Each server instance's cache (retained across ordinary dev hot reloads) is local to that process, not
shared across multiple processes or Vercel instances — but this no longer matters for correctness, only
for whether a given request recomputes or reuses a cached result. The demo is local-only and unauthenticated; a reset
or replacement affects every browser using that server. Do not deploy this as durable multi-user state.
Restart the server after engine/schema updates. There are no new dependencies or port assignments.
