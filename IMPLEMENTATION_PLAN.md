# Ads marketplace simulator — implementation plan

## Goal and scope

Build a small educational simulator for a non-technical audience showing candidate generation → ranking → auction, and how budget pacing changes campaign spend and marketplace competition over time.

Target: a basic local prototype in approximately 2–3 hours of implementation, not a production-ready application. Use TypeScript, Next.js, and Postgres. Eventual Vercel hosting should remain possible, but deployment, authentication, workers, WebSockets, real ad integrations, and simulated clicks/conversions are out of scope.

Compute a whole run server-side, persist it, then animate a lightweight timeline in the browser. Store every request trace; fetch details on demand. Do not implement an HTTP call or database write per simulated impression.

### Scope decisions (confirmed 2026-09-06)

- Verification load is deliberately light for the prototype: focused unit tests written alongside code, plus manual human testing. Real-database integration tests, Playwright/browser automation, rollback-on-failure tests, and similar hardening are deferred follow-ups, listed under "Deferred productionization" below.
- Updated by human request: M1 continues on `main` with another agent; the UI lane now runs in parallel on branch `ui-workspace`, worktree `../ads-marketplace-demo-ui`. Shared contracts remain frozen; UI work does not edit engine/API/dependency files.
- Get the basic simulator working end to end before wiring persistence. Postgres is provided by Neon (serverless Postgres compatible with Vercel), not a local Docker container. Until M3, runs live in an in-memory server-side store behind a small repository interface so Neon can replace it without touching the engine or UI.
- Impression-objective campaigns carry a seeded per-campaign quality prior in (0, 1] instead of a constant base score of 1, so they do not all tie at the top of every category's ranking.
- Ranking order within a category is intentionally static across requests (score is a per-campaign constant times a per-user relevance shared by every candidate in the request). This is enough to demonstrate the funnel; per-user or per-campaign signals are not being added.
- Pacing keeps the simple spend-versus-target probability. Because second-price charges sit below bid, the probability is fractional only inside a one-bid-wide band and behaves almost binarily. A later option, sequenced only if needed, is to make probability also depend on the fraction of total budget already spent.

## Progress and coordination

Status values: `TODO`, `IN PROGRESS`, `BLOCKED`, `DONE`. Completion requires the stated gate and recorded evidence. Owners claim tasks before editing; use handoff notes for branch/commit and unresolved issues.

| ID | Milestone | Depends on | Status | Owner | Evidence / handoff |
| --- | --- | --- | --- | --- | --- |
| M0 | Approve boundaries, scaffold, freeze contracts | — | DONE | Claude (coordinating assistant) | Next.js 16 scaffold on 127.0.0.1:3002; contracts in `src/lib/contracts/`; spec in `docs/engine-spec.md`; typecheck, lint, 4 unit tests, dev-server smoke all pass (see log) |
| M1 | Pure engine and unit tests | M0 | TODO | Unassigned | — |
| M2 | Seeded marketplace and paired-run diagnostics | M1 | TODO | Unassigned | — |
| M3 | Neon Postgres persistence and API (in-memory store first) | M0; final integration M1/M2 | TODO | Unassigned | — |
| M4 | Playback workspace and request side sheet | M0; final integration M2/M3 | IN PROGRESS | UI assistant (`ui-workspace`) | First chunk: contract-shaped tiny preview, playback/charts/request side sheet. Engine/API wiring and real-data gate remain pending. |
| M5 | Integrated verification and educational guide | M2/M3/M4 | TODO | Unassigned | — |

### Work lane boundaries

M1 and UI now run in separate worktrees per the latest human request. UI owns `src/components/simulator/**`, app page/layout/styles, and branch-local README/plan updates. It will not edit shared contracts, package files, or the other agent's working tree. After M0 freezes shared types, path ownership is:

- Engine lane: `src/lib/simulation/**`, engine tests; owns M1 then M2.
- Persistence lane: `src/lib/db/**`, migrations, `src/app/api/**`, API tests; owns M3. Use a tiny contract fixture until the engine is available.
- UI lane: `src/components/**`, page/layout/style files, UI tests; owns M4. Use contract-shaped responses until APIs are available.
- Coordinator: shared contracts, package/lock files, root configuration, progress tracking, integration, M5. Batch dependency installation before parallel work.

Paths are proposed and become final in M0. Shared types live in `src/lib/contracts/**`. A worker must request coordination before changing a shared contract. Parallel scaffolding is allowed; no milestone is DONE until its real integration gate passes.

## Locked simulation contract

### Inputs

Initial fixture targets (tune and version before freezing the baseline):

- Six-hour session; budgets apply to the session, not a 24-hour day.
- 4,000 pre-generated requests, 20 static users, four categories.
- 32 campaigns, initially eight per category, mixed impression/click/conversion objectives.
- One ad slot per request; all campaigns bid and pay per impression.
- Users have category relevance in [0, 1]. Campaigns have category, objective, fixed historical rates, maximum impression bid, and session budget.
- Requests contain ID, simulated timestamp, user ID, category, and optional illustrative query text. Category alone drives retrieval.
- No clicks/conversions are sampled; no prediction noise or changing user behavior.

### Ordered funnel

1. Retrieve all campaigns matching the request category. Objectives label candidates and determine scoring; no random retrieval quota is needed.
2. Exclude campaigns with remaining budget below the reserve price.
3. Apply campaign-specific pacing admission.
4. Score admitted campaigns, apply a fixed threshold, retain the top four qualifying candidates.
5. Run a single-slot second-price auction among finalists.
6. Deduct the clearing price and record the complete trace, including empty auctions.

Use deterministic score/bid tie-breaking by campaign ID and order requests by timestamp then request ID. A paced-out campaign cannot win or set a price.

### Ranking

```text
score = fixed_normalized_objective_prediction × user_category_relevance
```

Normalize using fixed scenario parameters, not current candidate-pool statistics. The common user relevance multiplier changes threshold eligibility, not relative ordering within a request. Scores are educational objective proxies, not calibrated economic values. Exact objective formulas/scales and threshold are an M0 decision, not permission to invent new signals silently.

Confirmed objective bases (all clamped to [0, 1]):

```text
impression: quality_prior                      (seeded per campaign, in (0, 1])
click:      historical_ctr / ctr_scale
conversion: historical_cvr / cvr_scale         (per-impression conversion rate)
```

Scales are fixed scenario parameters chosen so a good campaign of any objective lands around 0.7–0.9. Because the shortlist is score-only, only campaigns in a category's score top four can ever support prices; the M2 fixture must deliberately decorrelate score rank from bid rank.

### Pacing

```text
target = session_budget × elapsed_time / session_duration
probability = clamp((target - spend_so_far) / bid_per_impression, 0, 1)
admit = stable_random(seed, request_id, campaign_id, "pacing") < probability
```

Pacing off sets probability to one. There is no look-ahead allowance. At time zero, pacing on rejects all candidates. A bid must be positive. Use a specified stable hash-to-[0,1) mapping; never use a shared sequential random stream in request processing.

Known behaviour: since clearing prices are at or below bid, spend lags target and the probability is nearly always 0 or 1. Keep it simple for now; a budget-fraction-aware variant is a possible later follow-up, not part of this build.

### Auction and accounting

```text
effective_bid = min(bid_per_impression, remaining_budget)
winner = finalist with highest effective_bid
price = max(reserve, second_highest_effective_bid)
```

Only finalists with effective bid at least the reserve participate. One bidder pays reserve; no bidders means no winner and zero spend. Store all monetary amounts in integer microdollars and validate safe ranges. Reserve must be positive. Target and probability may use fractional arithmetic; actual charges remain integers.

### Comparability and interpretation

Both modes use identical immutable inputs, deterministic predictions, ordering, and auction rules, and start with fresh balances. Pacing is the only mode difference. Store engine version plus input snapshot/hash, including request-stream identity and configuration. Only compare runs with matching input hashes and engine versions (mode excluded from the input hash).

Pacing may preserve later competition and reduce cheap late impressions; it need not increase total revenue. If both modes exhaust every budget, their final revenue is equal. Scarce supply alone does not guarantee a revenue uplift.

## M0 — Foundation and shared contracts

Tasks:

- [x] Inspect repository and parent instructions; confirm the unresolved choices below with the human.
- [x] Choose explicit unused local app and test-server ports after checking the parent registry and listeners (confirmed: app 3002, test server 3012; no local Postgres port because the database is Neon). Update the parent registry and root Makefile together.
- [x] Scaffold Next.js/TypeScript, environment example, and test commands (npm, Vitest, Recharts; Drizzle with node-postgres when M3 begins).
- [x] Define shared scenario, campaign, user, request, candidate trace, run summary, timeline, and API error/response types.
- [x] Specify score formulas, numeric bounds, threshold, hash behavior, timestamp boundaries, and tie-breaking in code and docs.
- [x] Provide a tiny hand-calculable fixture (`src/lib/fixtures/tiny.ts`). Contract-shaped API response examples were skipped because lanes run sequentially; the API types in `src/lib/contracts/api.ts` are the contract.

Gate: typecheck and a smoke unit test pass; local setup commands are documented; no unresolved question changes the shared contract. Record actual port reservations, commands, and decisions below.

## M1 — Pure deterministic engine

Tasks:

- [ ] Implement `simulate(scenarioSnapshot, pacingEnabled)` with no I/O and an in-memory campaign balance map.
- [ ] Implement retrieval, eligibility, pacing, scoring/shortlist, auction, and accounting as testable functions.
- [ ] Produce request traces, five-minute buckets, and run summary.
- [ ] Capture candidate exclusion reasons, budget before/after, target, probability, random draw, score components, shortlist, effective bids, winner, runner-up, and price.
- [ ] Distinguish not-evaluated downstream stages from rejected stages in traces.

Required tests:

- [ ] Repeat execution yields identical results for the same inputs and mode.
- [ ] Hand-calculated one-bidder, multi-bidder, tied-bid, and empty-auction cases.
- [ ] Paced-out, below-threshold, and budget-ineligible candidates cannot set prices or win.
- [ ] Remaining budget caps effective bids; winner price never exceeds effective bid.
- [ ] Time zero, same-timestamp ordering, session boundary, and pacing probability limits.
- [ ] Revenue equals total campaign spend and sum of request prices; no overspend; at most one winner per request.
- [ ] Buckets reconcile with request events and final summaries.

Gate: engine tests and typecheck pass on the tiny fixture. No React/database dependency enters the engine.

## M2 — Seeded marketplace and experimental diagnostics

Tasks:

- [ ] Generate deterministic users, campaigns, and timestamped requests for the six-hour session.
- [ ] Include uneven traffic and substantial late traffic in every category.
- [ ] Include several strong bidders with finite budgets, medium price-support bidders, and funded lower bidders per category.
- [ ] Ensure ranking scores/threshold do not collapse most auctions to zero or one participant. Include all objectives in score-qualified candidates.
- [ ] Run pacing on/off and produce a reproducible diagnostic report.
- [ ] Freeze/version the baseline seed and parameter values after inspection; retain the report.

Report: score-qualified request coverage, filled requests, multiple-bidder auction share, budget-exhaustion times, early/late participant counts and prices, campaign spend trajectories, final revenue, and unspent budgets. Separate threshold qualification from pacing/shortlist attrition.

Gate: accounting invariants pass for both modes; the report demonstrates understandable spend-pattern differences and assesses late competition. If it does not illustrate the intended lesson, discuss fixture tuning with the human before UI polish. Higher paced revenue is not a correctness assertion. Confirm an explicit coverage target with the human rather than treating “majority” as an unstated numeric requirement.

## M3 — Persistence and APIs

Sequencing: an in-memory run store behind a repository interface is used from M1 onward so the UI can be exercised before any database exists. M3 replaces that store with Neon Postgres (Drizzle + node-postgres, `DATABASE_URL` from an ignored `.env.local`; a committed `.env.example` shows the shape). No local Docker Postgres is planned.

Proposed minimal schema:

| Table | Stored data |
| --- | --- |
| `scenarios` | Immutable version, seed, config, campaign/user JSONB; active default selection |
| `requests` | Scenario ID, request ID, timestamp/order, user/category/query |
| `runs` | Input snapshot/hash, immutable request reference, engine version, pacing mode, status, summary |
| `request_results` | Run/request IDs, winner, price, full trace JSONB |
| `run_buckets` | Five-minute marketplace and per-campaign metrics |

Index request ordering and run/request lookup. Enforce uniqueness of run/request results. Preserve historical input references when defaults change.

Endpoints:

```text
GET  /api/scenario
POST /api/scenario/reset
POST /api/runs                    { pacingEnabled }
GET  /api/runs
GET  /api/runs/:id
GET  /api/runs/:id/timeline
GET  /api/runs/:id/requests        paginated
GET  /api/runs/:id/requests/:requestId
```

Tasks:

- [ ] Add schema/migrations and idempotent default seeding.
- [ ] Validate inputs and return consistent errors and not-found responses.
- [ ] Load immutable input, compute on the server, and batch-save outputs transactionally.
- [ ] Mark a run completed only after all outputs are durable; represent running/failed states honestly.
- [ ] Disable duplicate submission in the UI; avoid adding a job/idempotency framework unless a demonstrated need is discussed.
- [ ] Reset restores/activates baseline defaults without changing historical runs. Starting a run always resets balances independently of this action.
- [ ] Retrieve timelines separately from paginated request lists and detailed traces.

Gate (prototype): unit tests for input validation and the repository interface; manual check that a run can be created, reloaded after a server restart, and reset preserves historical runs. Run the complete 4,000-request engine through the API and record runtime/output size. Real-database integration tests and rollback-on-failure coverage are deferred (see "Deferred productionization").

## M4 — Playback workspace and request inspection

Request-funnel UI chunk implemented: the sheet now presents a connected trace-derived journey. Owned paths: `src/components/simulator/{request-sheet,request-funnel}.tsx`, funnel CSS, README/plan, and UI design principles on `ui-workspace`. No shared types, engine, API, or dependency edits. UI/playback tests remain deferred; human visual review and full M4 integration are still pending.

All UI work follows [UI design principles](docs/ui-design-principles.md). They govern presentation and interactions, not simulation semantics.

UI refinement chunk implemented on `ui-workspace`: progressive disclosure, design-principle documentation/agent links, and the human-authorized Recharts → amCharts 5 dependency migration (`package.json` and lockfile included). Main's engine/API files remain untouched. UI testing stays deferred; full M4 remains IN PROGRESS.

### UI preview chunk (parallel worktree)

- [x] Create isolated `ui-workspace` branch/worktree from `a47f34b`; leave M1 work on `main` untouched.
- [x] Build the responsive workspace, controls, charts, and keyboard-dismissable request side sheet against the frozen types.
- [x] Use an explicitly labeled, hand-authored four-request M0 walkthrough; do not fabricate paced results.
- [x] Reveal only completed buckets/earlier requests; support play/pause, speed, restart, scrub, campaign selection, and local list pagination.
- [x] Keep actual run execution disabled until API wiring; label reset as UI-only.
- [x] Run typecheck, lint, production build, and an HTTP smoke check.
- [ ] Connect server run creation/reset/history, fetch request pages/details on demand, and support matched pacing overlays after M1/M2/API readiness.
- [ ] Human visual review and later UI/playback testing. Per the latest human request, no playback test suite is added in this chunk; prioritize the usable prototype and polish.

These are preview-only completions. The full milestone tasks/gate below remain pending real integration.

Tasks:

- [ ] Add pacing toggle, run button, computation status, and reset-defaults button.
- [ ] Load the latest results and provide a minimal selector for persisted runs.
- [ ] Add play/pause, speed, restart, and six-hour simulated clock; no simulation logic in the browser.
- [ ] Chart marketplace cumulative revenue and per-campaign spend versus target.
- [ ] Show competition and clearing-price time series with units and empty-auction semantics clearly labeled.
- [ ] Overlay matching on/off runs only; explain incompatible comparisons rather than silently allowing them.
- [ ] Build paginated request list tied to the playback cursor and a detail side sheet.
- [ ] Explain retrieval, exclusions, pacing, scores, shortlist, bids, runner-up, price, and budget changes in the side sheet.
- [ ] Include loading, failure, empty-auction, and no-run states; make the side sheet keyboard usable.

Playback contract: five-minute buckets (72 points), with metrics advancing at bucket boundaries. Do not imply exact request-level interpolation. Fetch detailed traces only when needed. Current metrics and visible request cutoffs must agree with the cursor; label final-run summaries separately. Average clearing price is over filled impressions; distinguish no sales from a zero price.

Gate (prototype): manual browser check that controls, error/empty states, matched overlays, and the side sheet work; playback never mutates results; requests do not leak beyond the cursor; a side sheet agrees with its persisted trace. Changing the pacing toggle affects the next run, never relabels the displayed run. Automated UI tests are deferred.

## M5 — End-to-end verification and handoff

Tasks:

- [ ] Add short in-context tooltips and a demo guide: run without pacing, inspect early/late behavior, run with pacing, compare matched runs, inspect supporting auctions.
- [ ] Explain session budgets, threshold-only relevance effect, per-impression billing, losing-bid price support, and non-guaranteed revenue improvement.
- [ ] Run the full local flow: seed → unpaced run → paced run → playback → request inspection → reload → reset → reopen historical run.
- [ ] Verify paired inputs match, all accounting invariants hold, and timelines reconcile with traces.
- [ ] Document setup, migrations, reset behavior, test commands, known limits, and actual diagnostic observations in README.
- [ ] Record checks, remaining limitations, and local commit handoff.

Gate: engine/unit tests and typecheck pass; the documented manual demo flow works from local setup. No claim of deployed readiness or guaranteed pacing uplift.

## Deferred productionization (follow-ups, not in this build)

- Real Postgres integration tests: seed repeatability, run reload, reset preservation, rollback on persistence failure.
- Playwright/browser automation for playback controls and error/empty states.
- Job/idempotency handling for run submission; hosting-limit assessment for synchronous run computation on Vercel.
- Optional pacing refinement: probability that also accounts for the fraction of total budget spent.

## Decisions requiring confirmation at M0

| Question | Proposed default | Status |
| --- | --- | --- |
| Package manager, ORM, tests/charts | npm; Drizzle + node-postgres (M3); Vitest; amCharts 5 | Human changed chart library from Recharts to amCharts 5 in the UI refinement chunk |
| Objective score definitions | Impression: seeded per-campaign quality prior in (0,1]; click: historical CTR / fixed CTR scale; conversion: per-impression conversion rate / fixed conversion scale; clamp bases to [0,1], then multiply relevance | Confirmed 2026-09-06 |
| Rates, budgets, bids, reserve, threshold | Versioned fixture parameters, tuned via M2 diagnostics; scales chosen so a good campaign of any objective scores about 0.7–0.9 | Numeric values selected in M2 |
| Threshold-qualified coverage target | At least 90% of requests have two score-qualified, category-matching campaigns before budget/pacing exclusions | Confirmed 2026-09-06 |
| Time boundaries | Request timestamps in [0, 6 hours); append closing timeline point at 6 hours | Confirmed 2026-09-06 |
| Ports | App 3002, test server 3012; database is Neon (remote), so no local Postgres port | Confirmed 2026-09-06 |
| Database | Neon Postgres, added after the basic simulator works; in-memory store until then | Confirmed 2026-09-06 |
| Reset/history | Reset re-seeds the baseline scenario if missing and marks it active; retain immutable historical runs | Confirmed 2026-09-06 |

Do not quietly substitute a different ranking/pacing/auction mechanism to make the plots look better. Surface ambiguous or conflicting outcomes and agree on changes.

## Validation and handoff log

Append an entry per completed logical chunk:

```text
Date / task / owner:
Paths and branch or commit:
Commands run and outcomes:
Observed simulation results (if applicable):
Decisions / deviations:
Remaining blockers / next owner:
```

### Planning chunk

- Owner: coordinating assistant.
- Paths: `IMPLEMENTATION_PLAN.md`, `AGENTS.md`, `README.md`.
- Checks: `git diff --check`; Python standard-library check of local Markdown link targets, balanced fenced blocks, and M0–M5 headings. All passed.
- Implementation status: no application code or application checks yet; no ports assigned or services started.
- Next: human confirmation of M0 choices, then scaffold and freeze shared contracts.
- Commit: local documentation chunk, `docs: record simulator plan and agent workflow`.

### M0 chunk

- Date / task / owner: 2026-09-06 / M0 scaffold and frozen contracts / Claude (coordinating assistant).
- Paths: `package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `vitest.config.mts`, `.gitignore`, `.env.example`, `CLAUDE.md`, `AGENTS.md` (Next.js managed block appended), `README.md`, `docs/engine-spec.md`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `src/lib/contracts/**`, `src/lib/simulation/{version,hash,scoring,snapshot,m0.test}.ts`, `src/lib/fixtures/tiny.ts`. Parent registry `../AGENTS.md` and `../Makefile` gained ports 3002 (app) and 3012 (reserved test server).
- Commands run and outcomes: `npm install` (Next 16.3.4, React 19.2.8, Recharts 3.10, Vitest 5.0, `@types/node` bumped to 24 for Vitest peer range); `npx next typegen` OK; `npm run typecheck` OK; `npm run lint` OK; `npx vitest run` 4/4 passed; `npm run dev` served HTTP 200 on 127.0.0.1:3002 and was stopped.
- Decisions / deviations: Google Fonts removed from the scaffold layout to avoid a network dependency at build time. Objective bases, stable hash, request ordering, and tie-breaking are frozen in `docs/engine-spec.md`. `thresholdQualifiedCount` is recorded per request as a diagnostic (score-only, before budget/pacing) so M2 can separate threshold qualification from attrition without changing the funnel.
- Remaining blockers / next owner: none. Next is M1 (pure engine), same implementer.

### M4 UI preview chunk

- Owner: UI assistant; branch `ui-workspace`, worktree `../ads-marketplace-demo-ui`, based on `a47f34b`.
- Owned paths changed: `src/components/simulator/**`, `src/app/{page.tsx,layout.tsx,globals.css}`, branch-local `README.md` and this plan. No engine, API, contract, dependency/lockfile, or parent infrastructure edits.
- Implemented: responsive light workspace, empty state, explicit preview load/reset, next-run pacing preference with disabled server execution, bucket playback/scrub/speed, campaign selector, four chart views, cursor-filtered locally paginated requests, native modal side sheet, adjacent educational explanations.
- Data boundary: four hand-authored unpaced M0 examples with contract-shaped traces/timeline/summary; not simulation evidence. Preview-only aggregation summarizes those recorded examples and does not implement an engine. All four traces are bundled temporarily; production request fetching and comparisons are pending.
- Validation: `npm ci` succeeded without dependency changes; `npx next typegen`, `npm run typecheck`, `npm run lint`, `npm run build` passed. Initial lint caught an ordinary home anchor; replaced with Next Link and reran successfully. `curl --fail http://127.0.0.1:3012` returned HTTP 200; listener verified on loopback 3012, the existing reserved test port. No browser/playback tests run or added, per human direction.
- Manual preview server: `npx next start -p 3012 -H 127.0.0.1`; log `/tmp/ads-marketplace-ui-preview.log`. Main's development port 3002 is left free. No permanent port assignment changed.
- Integration handoff: chart and request sheet consume frozen contract types; replace the isolated preview controller/data source with API loading once ready. Merge README/plan sections carefully because the M1 agent may also update them. Do not mark M4 DONE until real-data integration and the agreed manual gate pass.
- Commit intent: `feat(ui): add isolated simulator workspace preview`.

### M4 UI principles and progressive-disclosure refinement

- Owner/branch: UI assistant / `ui-workspace`; no changes to main's worktree.
- Human decisions: document explicit UI design principles for all agents; replace Recharts with amCharts; collapse secondary controls/views; keep formulas and implementation arithmetic optional. Continue to defer UI/playback tests and theme polish.
- Paths: `docs/ui-design-principles.md`, `AGENTS.md`, README/plan, `src/components/simulator/{simulator-preview,request-sheet,timeline-chart}.tsx`, `src/app/globals.css`, `package.json`, `package-lock.json`, `public/licenses/amcharts5-LICENSE.txt`. Dependency edits specifically authorized by the human's chart-library change.
- Implemented: one dominant revenue chart; collapsed scenario/settings, campaign chart, competition charts, request list, guide, and candidate arithmetic. amCharts roots mount client-side, update data during playback, and dispose on unmount. Fixed time domain and input-derived value bounds avoid future-result leakage and shifting scales. No engine, API, or comparison semantics changed.
- Licensing: read the installed amCharts LICENSE; retain default branding and include the original license in public assets. No license key supplied or branding suppression. Review release requirements before hosting publicly.
- Validation: `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check` passed. Refreshed the preview on reserved loopback port 3012; HTTP smoke checks returned 200 for `/` and `/licenses/amcharts5-LICENSE.txt`. `npm ls @amcharts/amcharts5 --depth=0` confirms 5.20.5. No automated UI/playback suite added or run. Human visual review and real-data integration remain pending.
- Handoff: bring the design-principle document and AGENTS link into main along with the UI branch so all agents receive the rule. Preserve main's newer engine/M2 progress when merging plan/README conflicts. Reinstall dependencies after integration.

### M4 request-funnel presentation

- Owner/branch: UI assistant / `ui-workspace`.
- Implemented: six connected numbered stages, entrant/survivor counts, bars proportional to retrieved candidates, plain-language attrition, expandable per-stage campaign decisions, threshold versus shortlist exclusions, auction bidders with recorded winner/runner-up, and terminal winner/charge explanation. Auction bids start visible; formulas and candidate arithmetic remain in a separate collapsed section.
- Trace semantics: use stage `evaluated` flags and recorded decisions, not re-computed scores or budget rules. A campaign excluded earlier never appears as rejected again downstream. Empty stages and no-winner outcomes remain readable; minimum-price pricing is distinguished from runner-up price support.
- Paths: `src/components/simulator/{request-funnel,request-sheet}.tsx`, `src/app/globals.css`, `docs/ui-design-principles.md`, README, plan. No engine/API/contracts/dependencies changed.
- Validation: `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check` passed. Refreshed the worktree's preview on 127.0.0.1:3012; HTTP smoke check returned 200 and listener was verified. No UI/playback tests added or run.
- Human review suggestion: load walkthrough, inspect r1 for a multi-bidder auction; advance past 02:00 and inspect r3 for ranking narrowing three campaigns to one and minimum-price billing. The preview does not contain a paced run or all exclusion cases; real-data integration remains pending.
