# Live-demo API

## Scope

A single local Next.js server keeps one baseline scenario and **at most two results**: latest pacing off
and latest pacing on. This is not persistence or run history. A successful new run replaces the previous
result for its mode. Reset clears both; server restart loses both. The current pair's request traces are
available only to explain the funnel. No database, user sessions, job queue, or historical request browser.

The API is merged into `main` and typechecks against the current quality/utility auction contract.
`src/lib/server/engine-adapter.ts` is the only API module importing engine/fixture implementations, so
future engine integration remains localized. The UI workspace is merged but still uses preview data; its
next chunk replaces that source with these same-origin endpoints.

## Endpoints

Existing shared response types in `src/lib/contracts/api.ts` are unchanged.

| Method / path | Response | Meaning |
| --- | --- | --- |
| `GET /api/scenario` | `{ scenario }` | Baseline summary without the 4,000 input requests; seeded lazily |
| `POST /api/scenario/reset` | `{ scenario, reseeded: true }` | Regenerate baseline and discard both current results; no body required |
| `POST /api/runs` | `{ run }`, HTTP 201 | Compute a whole run, then publish it into the corresponding mode slot |
| `GET /api/runs` | `{ runs }` | Zero to two completed results, pacing off then on; not a history list |
| `GET /api/runs/:id` | `{ run }` | One currently retained result's metadata and summary |
| `GET /api/runs/:id/timeline` | `{ runId, buckets }` | Lightweight five-minute metrics |
| `GET /api/runs/:id/requests` | `{ runId, items, nextCursor, total }` | Compact current-run request rows; no candidate traces |
| `GET /api/runs/:id/requests/:requestId` | `{ runId, trace }` | One current-run funnel trace |

### Run creation

Send `Content-Type: application/json` and exactly `{ "pacingEnabled": true }` or `false`.
The server supplies the baseline inputs, fresh balances, and engine version. It computes synchronously,
checks accounting invariants, then replaces the old mode slot with the complete result. Failure returns
HTTP 500 and leaves the previous pair unchanged; no partial or failed result is retained.

Run IDs and wall-clock metadata differ on each invocation; they never feed the simulation. Compare only
opposite modes with identical `inputHash` and `engineVersion`. Do not assume higher revenue with pacing.

### Current request pagination

- `cursor`: inclusive sequence number, default `0`.
- `limit`: integer `1..200`, default `50`.
- `beforeMs`: optional exclusive simulated timestamp cutoff. `0` reveals nothing; a request exactly at
  the cutoff is not visible. Omitted means all requests in the current result.
- `total` counts all requests passing the cutoff, independently of cursor/limit.
- `nextCursor` is the next unseen sequence, or `null` when the filtered stream ends. Reset pagination
  when changing the playback cutoff or run. Request ordering is the engine's stable sequence order.
- Negative/fractional/unsafe integers, unknown parameters, and duplicate parameters return HTTP 400.

### Errors and replacement

Errors use `{ "error": { "code": "bad_request" | "not_found" | "internal", "message": "..." } }`.
Invalid inputs return 400; unknown/replaced/reset IDs return 404; computation failures return 500.
Next.js handles unsupported HTTP methods with 405. JSON responses set `Cache-Control: no-store`.

If a drill-down returns 404 after another run/reset, reload `GET /api/runs` and close the stale detail
view. Only the two current IDs are valid. No lookup into old requests is supported.

## Local use

Use the app's existing `npm run dev` command on `127.0.0.1:3002`, **only when main is not using that port**.
The UI preview on 3012 is a separate worktree, not yet wired to these APIs; no cross-origin API bridge is
added. Merge/integrate the lanes before switching the UI to same-origin fetches.

```bash
curl http://127.0.0.1:3002/api/scenario
curl -X POST http://127.0.0.1:3002/api/runs \
  -H 'Content-Type: application/json' -d '{"pacingEnabled":false}'
curl -X POST http://127.0.0.1:3002/api/runs \
  -H 'Content-Type: application/json' -d '{"pacingEnabled":true}'
curl http://127.0.0.1:3002/api/runs
# Substitute a current result ID from the response:
curl 'http://127.0.0.1:3002/api/runs/RESULT_ID/requests?limit=10&beforeMs=3600000'
curl -X POST http://127.0.0.1:3002/api/scenario/reset
```

Memory is shared by route modules within one process (and retained across ordinary dev hot reloads),
not across multiple processes or Vercel instances. The demo is local-only and unauthenticated; a reset
or replacement affects every browser using that server. Do not deploy this as durable multi-user state.
Restart the server after engine/schema updates. There are no new dependencies or port assignments.
