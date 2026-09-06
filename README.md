# ads-marketplace-demo

Educational search-ads marketplace simulator: candidate generation, ranking,
second-price auctions, and budget pacing over a replayable six-hour session.

- [Implementation plan and progress](IMPLEMENTATION_PLAN.md)
- [Engine specification](docs/engine-spec.md)
- [Project agent rules](AGENTS.md)

## Local setup

Requires Node 22+ and npm. The app listens on `127.0.0.1:3002` (registered in the parent port registry).

```bash
npm install
npm run dev          # http://127.0.0.1:3002
npm run typecheck    # tsc --noEmit (run `npx next typegen` first on a fresh clone)
npm test             # vitest run
npm run lint
```

From the parent directory, `make run-ads-marketplace-demo` starts the app on its registered port.

Persistence (Neon Postgres) arrives in milestone M3; until then runs are held in server memory. Copy
`.env.example` to `.env.local` and fill in `DATABASE_URL` once M3 lands.

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

On the `ui-workspace` branch, the home page now offers a **UI preview** alongside the M0 shared types,
score formulas, stable hash, snapshot validation, and tiny fixture. Another agent is implementing M1
on `main`; this worktree does not include or change that in-progress engine work.

### Try the UI preview

Click **Load unpaced walkthrough**, then play, change speed, or scrub the six-hour timeline. Select a
campaign to see spend against its target. **Inspect** a request to follow eligibility, ranking,
runner-up price support, and budget deductions in the side sheet (Escape closes it).

The preview uses four hand-authored requests from the documented tiny fixture, not engine-produced
results. It only includes pacing off. The pacing switch sets a future-run preference; **Run simulation**
is deliberately disabled until server execution is connected. **Reset UI preview** clears browser view
state only—it does not reset a database. Reloading the page clears the preview too.

Only completed five-minute buckets are revealed; request timestamps must be strictly before the
cursor. Price-chart gaps mean no filled impressions, not free impressions. Full-session totals are
separately labeled. There is no simulated auction or budget mutation during browser playback.

For side-by-side manual preview while `main` uses development port 3002, use the already-reserved test
port 3012 (check it is free first):

```bash
npm run build
npx next start -p 3012 -H 127.0.0.1   # http://127.0.0.1:3012
```

No new port or dependency is needed. API integration, matched pacing overlays, live request fetching,
run history, and UI/playback testing remain later chunks. For now validation is typecheck, lint, build,
and an HTTP smoke check; visual/browser testing is deferred at the human's request.

## Layout

- `src/lib/contracts/` shared types: scenario, campaigns, users, requests, traces, run summary, timeline, API shapes.
- `src/lib/simulation/` pure engine code (no React, database, HTTP, or wall-clock).
- `src/lib/fixtures/` hand-calculable tiny scenario used by unit tests.
- `src/app/` Next.js app router pages, layout, and styles.
- `src/components/simulator/` preview controller, chart, request side sheet, formatting/playback projections,
  and clearly isolated hand-authored preview data. Replace the preview controller's data loading with
  API responses when the server lane is ready; the chart and sheet already consume contract-shaped values.

Status: M0 complete; M4 UI preview chunk implemented on a separate worktree. Full M4 integration remains pending.
