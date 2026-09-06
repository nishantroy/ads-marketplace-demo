# ads-marketplace-demo

Educational search-ads marketplace simulator: candidate generation, ranking,
second-price auctions, and budget pacing over a replayable six-hour session.

- [Implementation plan and progress](IMPLEMENTATION_PLAN.md)
- [Engine specification](docs/engine-spec.md)
- [Project agent rules](AGENTS.md)
- [Live-demo API](docs/live-demo-api.md)

## Local setup

Requires Node 22+ and npm. The app listens on `127.0.0.1:3002` (registered in the parent port registry).

```bash
npm install
npm run dev          # http://127.0.0.1:3002
npm run typecheck    # tsc --noEmit (run `npx next typegen` first on a fresh clone)
npm test             # vitest run
npm run diagnose     # regenerate docs/m2-diagnostics.md from the baseline scenario
npm run lint
```

From the parent directory, `make run-ads-marketplace-demo` starts the app on its registered port.

The latest scope is a **live demo with no database or run history**. Server memory holds only the
latest pacing-on and pacing-off results. No `DATABASE_URL` is needed; the earlier Neon environment
example is unused. Re-running a mode replaces its result, reset clears both, and server restart loses
both. Only the current pair's requests are available for funnel drill-down.

## How it works

The simulator replays a fixed six-hour session of search requests through an ads funnel and records
everything, so the browser can play the result back without recomputing anything.

1. **Scenario** (immutable input): users with a relevance score per category, campaigns with a category,
   objective (impression, click, or conversion), a max bid per impression and a session budget, and a
   pre-generated, timestamp-ordered stream of requests. The whole snapshot is hashed so runs can be compared.
2. **Funnel per request** (engine, runs server-side): retrieve campaigns in the request's category, drop
   any whose remaining budget is below the reserve, apply pacing admission, score the survivors and keep the
   top four above a fixed threshold, then run a single-slot second-price auction and charge the winner.
3. **Pacing** is the only switch between two comparable runs. With pacing on, a campaign is admitted only
   when its spend is behind a straight-line target for the elapsed session time.
4. **Outputs**: one full trace per request (every candidate and why it was excluded, bids, winner, price),
   72 five-minute timeline buckets, and a run summary. Revenue always equals total campaign spend.

Exact formulas, bounds and tie-breaking rules are in [docs/engine-spec.md](docs/engine-spec.md).

### Using the engine

`simulate(snapshot, pacingEnabled)` in `src/lib/simulation/engine.ts` is the whole simulation. It is pure:
no I/O, no clock, no randomness beyond a hash keyed by request and campaign, so the same snapshot and mode
always give the same output. It returns a run summary, 72 timeline buckets, and one trace per request.

```ts
import { simulate } from "@/lib/simulation/engine";
import { checkInvariants } from "@/lib/simulation/invariants";
import { tinyScenario } from "@/lib/fixtures/tiny";

const run = simulate(tinyScenario, /* pacingEnabled */ false);
run.summary.revenueMicros;          // total revenue, in microdollars
run.timeline[71].cumulativeRevenueMicros;
run.traces[0].candidates;           // every retrieved campaign and why it was excluded
checkInvariants(tinyScenario, run); // [] when the run is self-consistent
```

Each candidate in a trace records the stage that stopped it (`excluded_budget`, `excluded_pacing`,
`excluded_threshold`, `excluded_shortlist`, `excluded_reserve`, `lost`, or `won`), and stages after that
point are marked not evaluated rather than failed. That distinction is what the request side sheet will
show. `checkInvariants` is the shared accounting check: revenue equals total campaign spend and the sum of
clearing prices, no campaign overspends, one winner at most per request, and buckets reconcile with traces.

### The seeded marketplace

`baselineScenario()` in `src/lib/fixtures/presets.ts` generates the versioned six-hour marketplace: 4
categories, 20 users, 32 campaigns, and 4,000 requests. Generation is deterministic from the preset seed and
runs before the simulation, so it is the one place a seeded random stream is allowed.

Each category holds the same ladder of eight campaigns: two strong bidders on modest budgets, three medium
bidders that mostly support prices, and three cheap bidders with enough budget to keep late auctions alive.
Score rank deliberately does not follow bid rank. If it did, the same campaigns would both rank and outbid
everyone and no losing campaign could ever set a price. Traffic rises through the session, so more than a
third of requests arrive in the final two hours.

`smallScenario()` is the same generator at reduced size for fast unit tests. It is a test fixture, not a
second baseline: only the baseline is versioned and used for tuning judgments, because coverage and
competition depend on the ratio of budget to traffic.

Run `npm run diagnose` to regenerate [docs/m2-diagnostics.md](docs/m2-diagnostics.md), the paired-run report
for both pacing modes. The report is deterministic, so a change to that file means marketplace behaviour
actually changed.

### What the baseline shows

Unpaced, the strong bidders spend out in the first hours and the market runs dry. The clearing price falls
from $1.35 in the first hour to $0.23 in the last, and only 357 of the last hour's 1,168 requests find a
buyer. With pacing on, the same campaigns spread their budgets across the session, so the last hour fills
984 requests at $0.39.

Both modes deliver almost the same total revenue, $2,130 unpaced against $2,148 paced, because both spend
nearly every campaign's budget. That is the honest lesson and the app does not hide it: pacing changes when
budget is spent and keeps valuable bidders in late auctions, but it does not promise more revenue.

Two measurement notes that are easy to get wrong. Budget delivery should be read from the share of budget
spent, not from whether a campaign ended below the reserve price. The reserve measure is knife-edge and
counts a paced campaign holding a few cents as incomplete, which understates paced delivery badly, 7
campaigns against 31 on the same run. Late competition likewise shows up in the price the survivors pay,
not in how many candidates were admitted, since pacing throttles admissions by design.

Campaign budgets are not free parameters either. Pacing controls when a campaign is allowed to bid, but it
cannot make that campaign win, so a budget larger than what a campaign can win at its bid will underspend
however pacing is configured. The signature of that in a trace is an admission probability pinned at 1: the
campaign is so far behind its target that pacing admits it to every auction, and it still loses on bid.
Budgets are therefore sized as target impressions times the price each tier pays when it wins, which is what
lets at least 90% of campaigns deliver their budget in both modes.

Pacing does throttle the strong bidders, and it does leave room for cheaper ones. On the current baseline
the two strongest tiers are held out of roughly 80% of the auctions they are evaluated for, and the cheapest
tier wins 183 auctions it would otherwise never see.

On `api-integration`, the existing engine and fixtures now sit behind a working live-demo API:

1. `GET /api/scenario` lazily loads the baseline summary.
2. `POST /api/runs` with `{ "pacingEnabled": false }` or `true` executes the real engine server-side,
   checks invariants, and replaces only that mode's result. Failed runs leave the existing pair intact.
3. `GET /api/runs` returns zero to two current results, not history. Compare matching input hashes and
   engine versions; IDs and wall-clock metadata do not affect simulation output.
4. Fetch `/api/runs/:id/timeline` for playback, `/requests?limit=50&beforeMs=...` for compact current
   request rows, and `/requests/:requestId` for a single funnel trace.
5. `POST /api/scenario/reset` regenerates defaults and clears both results. Replaced/reset IDs return 404.

See [Live-demo API](docs/live-demo-api.md) for response semantics, paging, and curl examples.
The store is local, single-process, and not suitable for multi-instance/serverless persistence.

This API worktree branches from committed main `6c6888e`. The other agent's uncommitted engine/contracts
are not included or modified. UI work remains separate on `ui-workspace`; no pages, charts, or UI state
were changed here. Integrate the branches before wiring same-origin UI requests.

Focused API checks: `npx vitest run src/lib/server/live-demo.test.ts` (six tests). Typecheck, lint,
production build, and a real paired-baseline HTTP smoke flow also pass; UI tests remain deferred.

## Layout

- `src/lib/contracts/` shared types: scenario, campaigns, users, requests, traces, run summary, timeline, API shapes.
- `src/lib/simulation/` pure engine code (no React, database, HTTP, or wall-clock).
- `src/lib/fixtures/` the tiny hand-calculable scenario and the baseline/small generator presets.
- `src/app/` Next.js app router pages and API routes.
- `src/lib/server/` two-slot live state, API service, input validation, and a single engine adapter.

Status: live-demo API chunk implemented; integration with main's pending engine changes and the UI
worktree remains. Database persistence and historical browsing are out of scope.
