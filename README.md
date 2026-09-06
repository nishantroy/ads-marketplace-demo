# ads-marketplace-demo

Educational search-ads marketplace simulator: candidate generation, ranking,
second-price auctions, and budget pacing over a replayable six-hour session.

- [Implementation plan and progress](IMPLEMENTATION_PLAN.md)
- [Engine specification](docs/engine-spec.md)
- [Project agent rules](AGENTS.md)
- [UI design principles](docs/ui-design-principles.md)

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

Click **Load unpaced walkthrough**, then play, change speed, or scrub the six-hour timeline. The
marketplace revenue chart is the primary view. Expand **Follow one campaign** for spending against its
target, **Why do impression prices change?** for competition/price charts, or **Inspect a request**
for the request list and side sheet (Escape closes it). The side sheet now follows a connected funnel:
**Category matches → Budget eligibility → Pacing admission → Ranking finalists → Auction → Winner**.
Each stage shows entering/surviving counts and a survivor bar; expand it to see which campaigns
continued or dropped out, and why. Ranking distinguishes minimum-score failures from shortlist cuts.
Auction bids are visible by default, with the recorded winner and runner-up highlighted; the final
step explains the charge. Candidate formulas/arithmetic live under **Curious about the implementation?**
and start collapsed. The funnel only projects the existing trace—it does not rerun any engine logic.

Scenario/next-run settings and the guide are also collapsed; the pacing formula lives under optional
implementation details in the guide, not alongside the main playback controls.

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

No new port is needed. Charts now use **amCharts 5**, replacing Recharts. Chart roots are created only
in the browser and disposed on unmount; playback updates data without recreating the chart. Cumulative
spend axes use input-budget ceilings rather than hidden future results or continuously rescaling.
Default amCharts attribution is retained, and its original license is served at
[`/licenses/amcharts5-LICENSE.txt`](public/licenses/amcharts5-LICENSE.txt). Review licensing before public release.

API integration, matched pacing overlays, live request fetching, run history, and UI/playback testing remain later chunks. For now validation is typecheck, lint, build,
and an HTTP smoke check; visual/browser testing is deferred at the human's request.

## Layout

- `src/lib/contracts/` shared types: scenario, campaigns, users, requests, traces, run summary, timeline, API shapes.
- `src/lib/simulation/` pure engine code (no React, database, HTTP, or wall-clock).
- `src/lib/fixtures/` hand-calculable tiny scenario used by unit tests.
- `src/app/` Next.js app router pages, layout, and styles.
- `src/components/simulator/` preview controller, chart, request side sheet, formatting/playback projections,
  and clearly isolated hand-authored preview data. Replace the preview controller's data loading with
  API responses when the server lane is ready; the chart and sheet already consume contract-shaped values.

## UI design direction

[UI design principles](docs/ui-design-principles.md) are required reading for UI agents and are linked
from `AGENTS.md`. Lead with the learning question, reveal complexity progressively, connect outcomes to
causes, compare fairly, make motion useful, and explain decisions before showing formulas. These are
presentation/interaction rules, not changes to the simulation contract. Theme polish can follow once
the prototype flow works.

Status: M0 complete; M4 UI preview and progressive-disclosure refinement implemented on a separate
worktree. Full M4 integration remains pending.
