# Ads marketplace simulator — implementation plan

## Goal and scope

Build a small educational simulator for a non-technical audience showing candidate generation → ranking → auction, and how budget pacing changes campaign spend and marketplace competition over time.

Target: a basic local prototype in approximately 2–3 hours of implementation, not a production-ready application. Use TypeScript and Next.js. Latest human scope reduction: this is a live demo, with no database, durable persistence, run history, or historical request browser. Deployment, authentication, workers, WebSockets, real ad integrations, and simulated clicks/conversions remain out of scope.

Compute a whole run server-side and retain only the latest pacing-on and pacing-off outputs in memory, then animate a lightweight timeline in the browser. Current-pair traces remain available on demand for the funnel lesson. A new run replaces that mode's result; reset clears both. No simulation or accounting is performed by browser playback.

### Scope decisions (confirmed 2026-09-06)

- Verification load is deliberately light for the prototype: focused unit tests written alongside code, plus manual human testing. Real-database integration tests, Playwright/browser automation, rollback-on-failure tests, and similar hardening are deferred follow-ups, listed under "Deferred productionization" below.
- Latest human direction: engine work continues on main, UI lives on `ui-workspace`, and the API/in-memory repository lane runs on `api-integration` in `../ads-marketplace-demo-api`. No cross-worktree edits. The API branch starts at committed main `6c6888e`; uncommitted contract/engine changes on main are an integration dependency, not copied into this branch.
- Superseded by latest human direction: no persistence implementation or database abstraction is needed. Keep only two live result slots in one local server process. Restart loses both results. Neon, historical snapshots, and history browsing are removed from the current scope.
- Impression-objective campaigns carry a seeded per-campaign quality prior in (0, 1] instead of a constant base score of 1, so they do not all tie at the top of every category's ranking.
- Ranking order within a category is intentionally static across requests (score is a per-campaign constant times a per-user relevance shared by every candidate in the request). This is enough to demonstrate the funnel; per-user or per-campaign signals are not being added.
- Pacing keeps the simple spend-versus-target probability. Because second-price charges sit below bid, the probability is fractional only inside a one-bid-wide band and behaves almost binarily. A later option, sequenced only if needed, is to make probability also depend on the fraction of total budget already spent.

## Progress and coordination

Status values: `TODO`, `IN PROGRESS`, `BLOCKED`, `DONE`. Completion requires the stated gate and recorded evidence. Owners claim tasks before editing; use handoff notes for branch/commit and unresolved issues.

| ID | Milestone | Depends on | Status | Owner | Evidence / handoff |
| --- | --- | --- | --- | --- | --- |
| M0 | Approve boundaries, scaffold, freeze contracts | — | DONE | Claude (coordinating assistant) | Next.js 16 scaffold on 127.0.0.1:3002; contracts in `src/lib/contracts/`; spec in `docs/engine-spec.md`; typecheck, lint, 4 unit tests, dev-server smoke all pass (see log) |
| M1 | Pure engine and unit tests | M0 | DONE | Claude (coordinating assistant) | `simulate()` plus stage modules in `src/lib/simulation/`; 24 unit tests, typecheck and lint pass; no React/database import in the engine |
| M2 | Seeded marketplace and paired-run diagnostics | M1 | DONE | Claude (coordinating assistant) | Generator with baseline and small presets, budgets calibrated for full delivery (`baseline-2`); `docs/m2-diagnostics.md` committed; 44 tests, typecheck and lint pass |
| M3 | Live-demo API and latest on/off result pair | M0; final integration M1/M2 | IN PROGRESS | API assistant (`api-integration`) | API chunk passes 6 focused tests, typecheck/lint/build, and paired 4,000-request HTTP smoke against committed main `6c6888e`. Pending engine-contract/UI integration; no DB/history. |
| M4 | Playback workspace and request side sheet | M0; final integration M2/M3 | TODO | Unassigned | — |
| M5 | Integrated verification and educational guide | M2/M3/M4 | TODO | Unassigned | — |

### Work lane boundaries

Latest human direction authorizes parallel isolated worktrees. API assistant owns `src/app/api/**`, `src/lib/server/**`, and branch-local README/plan/API documentation. No UI, shared-contract, engine, or dependency edits. Existing lane guidance:

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

- [x] Implement `simulate(scenarioSnapshot, pacingEnabled)` with no I/O and an in-memory campaign balance map.
- [x] Implement retrieval, eligibility, pacing, scoring/shortlist, auction, and accounting as testable functions.
- [x] Produce request traces, five-minute buckets, and run summary.
- [x] Capture candidate exclusion reasons, budget before/after, target, probability, random draw, score components, shortlist, effective bids, winner, runner-up, and price.
- [x] Distinguish not-evaluated downstream stages from rejected stages in traces.

Required tests:

- [x] Repeat execution yields identical results for the same inputs and mode.
- [x] Hand-calculated one-bidder, multi-bidder, tied-bid, and empty-auction cases.
- [x] Paced-out, below-threshold, and budget-ineligible candidates cannot set prices or win.
- [x] Remaining budget caps effective bids; winner price never exceeds effective bid.
- [x] Time zero, same-timestamp ordering, session boundary, and pacing probability limits.
- [x] Revenue equals total campaign spend and sum of request prices; no overspend; at most one winner per request.
- [x] Buckets reconcile with request events and final summaries.

Gate: engine tests and typecheck pass on the tiny fixture. No React/database dependency enters the engine.

## M2 — Seeded marketplace and experimental diagnostics

Tasks:

- [x] Generate deterministic users, campaigns, and timestamped requests for the six-hour session.
- [x] Include uneven traffic and substantial late traffic in every category.
- [x] Include several strong bidders with finite budgets, medium price-support bidders, and funded lower bidders per category.
- [x] Ensure ranking scores/threshold do not collapse most auctions to zero or one participant. Include all objectives in score-qualified candidates.
- [x] Run pacing on/off and produce a reproducible diagnostic report (`npm run diagnose`).
- [x] Freeze/version the baseline seed and parameter values after inspection; retain the report.

Report: score-qualified request coverage, filled requests, multiple-bidder auction share, budget-exhaustion times, early/late participant counts and prices, campaign spend trajectories, final revenue, and unspent budgets. Separate threshold qualification from pacing/shortlist attrition.

Gate: accounting invariants pass for both modes; the report demonstrates understandable spend-pattern differences and assesses late competition. If it does not illustrate the intended lesson, discuss fixture tuning with the human before UI polish. Higher paced revenue is not a correctness assertion. Confirm an explicit coverage target with the human rather than treating “majority” as an unstated numeric requirement.

## M3 — Live-demo API (revised scope)

Latest human decision removes persistence and run history. One immutable active scenario and at most two result slots live in server memory: latest pacing off, latest pacing on. Each result contains its input hash, scenario/engine versions, summary, timeline, and traces. Creating another run in a mode replaces its previous result; old IDs return 404. Reset regenerates the baseline and clears both slots. Restart also clears them. These are local single-process semantics, not serverless durability.

No tables, migrations, general repository interface, history selector, retention policy, or failed-run archive. A failed computation leaves the previous successful pair untouched. Publish a completed result only after the full engine output and invariants are available.

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

- [x] Seed the active baseline lazily; keep fresh balances per run.
- [x] Validate mode/pagination inputs and return consistent JSON errors with no-store caching.
- [x] Compute using the committed engine behind one adapter; publish completed results into the mode's slot.
- [x] Preserve the previous successful pair on failure; do not retain failed runs or partial outputs.
- [x] Reset clears both results and restores baseline defaults.
- [x] Retrieve current timelines separately from paginated current requests and individual traces.
- [x] Run focused unit checks and an actual 4,000-request paired API smoke check.
- [ ] Integrate the other agent's pending contract/engine changes and connect the UI's live pair; prevent duplicate submission in that UI lane.

Gate (prototype): focused live-state/input-validation tests, typecheck/lint/build, and HTTP smoke flow for the real baseline. No database or browser test suite. Final M3 integration stays pending until the active engine and UI branches agree.

## M4 — Playback workspace and request inspection

Tasks:

- [ ] Add pacing toggle, run button, computation status, and reset-defaults button.
- [ ] Load the latest pacing-on/off pair; no run-history selector. Refresh the pair after a mode is replaced or reset.
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
- [ ] Run the full local flow: seed → unpaced run → paced run → comparison playback → current request inspection → replace one mode → reset both results.
- [ ] Verify paired inputs match, all accounting invariants hold, and timelines reconcile with traces.
- [ ] Document setup, migrations, reset behavior, test commands, known limits, and actual diagnostic observations in README.
- [ ] Record checks, remaining limitations, and local commit handoff.

Gate: engine/unit tests and typecheck pass; the documented manual demo flow works from local setup. No claim of deployed readiness or guaranteed pacing uplift.

## Deferred productionization (follow-ups, not in this build)

- Database persistence and history are outside the current live-demo scope, not prerequisites.
- Playwright/browser automation for playback controls and error/empty states.
- Job/idempotency handling for run submission; hosting-limit assessment for synchronous run computation on Vercel.
- Optional pacing refinement: probability that also accounts for the fraction of total budget spent.

## Decisions requiring confirmation at M0

| Question | Proposed default | Status |
| --- | --- | --- |
| Package manager, ORM, tests/charts | npm; Drizzle + node-postgres (M3); Vitest; Recharts | Confirmed 2026-09-06 |
| Objective score definitions | Impression: seeded per-campaign quality prior in (0,1]; click: historical CTR / fixed CTR scale; conversion: per-impression conversion rate / fixed conversion scale; clamp bases to [0,1], then multiply relevance | Confirmed 2026-09-06 |
| Rates, budgets, bids, reserve, threshold | Versioned fixture parameters, tuned via M2 diagnostics; scales chosen so a good campaign of any objective scores about 0.7–0.9 | Numeric values selected in M2 |
| Threshold-qualified coverage target | At least 90% of requests have two score-qualified, category-matching campaigns before budget/pacing exclusions | Confirmed 2026-09-06 |
| Time boundaries | Request timestamps in [0, 6 hours); append closing timeline point at 6 hours | Confirmed 2026-09-06 |
| Ports | App 3002, test server 3012; database is Neon (remote), so no local Postgres port | Confirmed 2026-09-06 |
| Database | None; local server memory holds the latest on/off results only | Latest human scope reduction supersedes Neon plan |
| Reset/history | Regenerate baseline and clear both result slots; no history retained | Latest human scope reduction |

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

### M1 chunk

- Date / task / owner: 2026-09-06 / M1 pure deterministic engine / Claude (coordinating assistant).
- Paths: `src/lib/simulation/{engine,pacing,auction,timeline,invariants}.ts`, `src/lib/simulation/engine.test.ts`, `README.md`, `IMPLEMENTATION_PLAN.md`.
- Commands run and outcomes: `npx vitest run` 24/24 passed across 2 files; `npm run typecheck` OK; `npm run lint` OK.
- Observed simulation results: the tiny fixture unpaced yields revenue $2.20, split c1 $0.90 and c3 $1.30 with c2 at $0, matching the hand calculation in `src/lib/fixtures/tiny.ts`. Paced mode on the same fixture leaves the first request unfilled because every target is 0 at t = 0. `checkInvariants` returns no violations in either mode.
- Decisions / deviations: added `src/lib/simulation/invariants.ts` so M2 diagnostics and the API reuse one accounting check instead of re-deriving it. Timeline buckets carry a per-campaign linear target in both modes so the unpaced chart can still show the reference line. A test asserts no engine file imports React, Next, `pg`, or Drizzle and that none call `Date.now`, `new Date`, or `Math.random`. No test asserts that pacing raises or lowers revenue.
- Remaining blockers / next owner: none. Next is M2 (seeded six-hour marketplace and paired-run diagnostics), same implementer.

### M2 chunk

- Date / task / owner: 2026-09-06 / M2 seeded marketplace and paired-run diagnostics / Claude (coordinating assistant).
- Paths: `src/lib/simulation/{generate,diagnostics}.ts`, `src/lib/simulation/{generate,diagnostics}.test.ts`, `src/lib/fixtures/presets.ts`, `docs/m2-diagnostics.md`, `package.json` (`diagnose` script), `README.md`, `IMPLEMENTATION_PLAN.md`.
- Commands run and outcomes: `npx vitest run` 43/43 passed across 4 files; `npm run diagnose` wrote `docs/m2-diagnostics.md`; `npm run typecheck` OK; `npm run lint` OK.
- Observed simulation results (baseline, seed `ads-marketplace-2026`, input hash `be2b5b221abafcc4`): score-qualified pair coverage 92.6% against the 90% target. Unpaced fills 91.8% of requests for $2,414.98 revenue, 19 of 32 campaigns exhaust with a median exhaustion at 4h55, and the clearing price falls from $1.25 in the first hour to $0.33 in the last. Paced fills 92.3% for $2,273.01, only 7 campaigns exhaust, and the last hour clears at $0.48. Multi-bidder share is about 99% of filled requests in both modes. No invariant violations in either mode.
- Decisions / deviations: the small preset is the same generator at reduced size (2 categories, 8 campaigns each, 80 requests) rather than a separate hand-written fixture, so tests validate the code that ships; only the baseline is versioned and used for tuning. Campaign archetypes deliberately decorrelate score rank from bid rank, because identical ranks would stop losing campaigns from ever supporting a price. Late competition is measured by the late clearing price, not by admitted-candidate count: pacing throttles admissions, so it lowers the late participant count (3.16 unpaced to 2.99 paced) while raising the late price. An initial gate assertion that used participant count was wrong and was replaced. Paced revenue is lower than unpaced here, which is the expected honest outcome and is not asserted as a direction.
- Remaining blockers / next owner: none. Next is M3 (persistence and API, in-memory store first, then Neon), same implementer.

### M2 budget calibration chunk

- Date / task / owner: 2026-09-06 / budget delivery investigation and recalibration / Claude (coordinating assistant).
- Trigger: the first M2 report showed 19 of 32 campaigns exhausted unpaced against 7 paced, which looked like pacing stranding budget.
- Finding 1, measurement: most of that gap was an artifact of the metric. `exhaustedAtMs` only fires once remaining budget drops below the reserve, so a paced campaign sitting at 99.5% of budget is not counted. Measured by spend share at the original budgets, tiers c0 to c5 delivered 97.6% to 100% in both modes.
- Finding 2, real starvation: only the two cheapest tiers were genuinely starved, in both modes, at 69% and 2% unpaced and 14% and 0% paced.
- Finding 2a, corrected mechanism: an earlier explanation claimed pacing starved the tail because strong bidders never exhaust and so never leave room. Instrumenting the paced run disproved that. At the original budgets the two strong tiers were throttled on 90% of the requests they were evaluated on, with a mean admission probability of 0.10, so pacing was creating room exactly as intended. The cheap tiers failed for a different reason: their admission probability was pinned at 1.00 on 100% of requests, meaning they were admitted every single time and still won only 111 and 0 auctions, because they lose on bid to whoever else is admitted. A probability pinned at 1 is the signature of a campaign that is chronically behind target, and it shows the real limit of pacing: pacing controls when a campaign is allowed to bid, it cannot make that campaign win. A budget larger than what a campaign can win at its bid will underspend no matter how pacing is configured. After recalibration the same measurement shows the tail throttled 20% and 7% of the time while delivering 99% and 95% of budget.
- Finding 3, the fix is budgets, not the pacing rule: shrinking budgets uniformly made delivery worse, because a rare win becomes a large fraction of a small budget. Sizing each tier as target impressions times the price it pays when winning fixed it. Budgets moved from `[80, 70, 130, 120, 110, 70, 60, 55]` to `[156, 109, 97, 79, 50, 36, 23, 5]`. The pacing formula was left unchanged, so the locked simulation contract still holds.
- Result (baseline-2, input hash `5de9b9537dcce8b2`): campaigns delivering at least 95% of budget are 30 of 32 unpaced and 31 of 32 paced, both above the 90% target. Unspent budget fell from $281.80 to $23.59 unpaced and from $423.77 to $5.79 paced. Revenue is now nearly equal across modes, $2,129.98 unpaced against $2,147.78 paced, which is expected once both modes spend nearly every budget. Unpaced fill is 74.7% against 90.1% paced: the unpaced market now visibly burns out, filling 357 of the last hour's 1,168 requests against 984 paced, and the last-hour price is $0.23 against $0.39.
- Decisions / deviations: the diagnostics report now leads with spend-share delivery at the 95% and 99% bars and labels the reserve-based count as knife-edge. The M2 gate asserts at least 90% delivery in both modes. An earlier gate assertion that unpaced fill exceeds 80% was removed, because burn-out is now the intended unpaced behaviour. Scenario versions bumped to `baseline-2` and `small-2`.
- Commands run and outcomes: `npx vitest run` 44/44 passed; `npm run diagnose` rewrote `docs/m2-diagnostics.md`; `npm run typecheck` OK; `npm run lint` OK.

### M3 live-demo API chunk

- Owner/branch/worktree: API assistant / `api-integration` / `../ads-marketplace-demo-api`, branched from committed main `6c6888e`.
- Scope change during implementation: human removed persistence/history. The initial repository abstraction was discarded before commit. Final implementation holds one immutable active scenario and only the latest completed result for each pacing mode. No Neon, migrations, database abstraction, failed-run archive, history browser, or historical request access.
- Owned paths: `src/app/api/**`, `src/lib/server/**`, `docs/live-demo-api.md`, README, plan. No UI, engine, shared-contract, dependency, environment, or parent infrastructure edits.
- Implementation: seven route files using existing response shapes; mode validation, compact bounded request pagination with exclusive playback cutoff, no-store JSON/error responses, server-only runtime store shared across routes, and a single engine adapter. New same-mode result invalidates its old ID; reset clears both. Failed computation keeps the previous successful pair unchanged.
- Checks: `npm ci` (no lockfile changes), `npx next typegen`, `npm run typecheck`, `npm run lint`, `npx vitest run src/lib/server/live-demo.test.ts` (6/6), `npm run build`, and `git diff --check` passed. No full engine-suite rerun, database tests, or UI tests claimed.
- HTTP smoke: launched the production API temporarily on its existing configured loopback port 3002 after checking listeners; exercised scenario, real off/on creation, summaries/timelines, cross-route shared state, pagination, current trace, cutoff zero, invalid inputs, same-mode replacement with identical summary, old-ID 404s, and reset. All passed. Off run + timeline fetch took 0.203s (4,286-byte run response / 298,518-byte timeline); on took 0.185s (4,216 / 309,275 bytes). Both have 4,000 requests, 72 buckets, matching input hash/engine version, and reconciled campaign spend/revenue. Revenues were $2,129.98 off / $2,147.78 on for the committed baseline. These timings include local HTTP work and are not engine-only benchmarks.
- Server lifecycle: API smoke process stopped in a finally block; UI preview on 3012 left untouched. No additional port assigned.
- Handoff: main has in-progress contract/engine changes, including candidate trace fields. Reconcile those commits before integrating this API and `ui-workspace`; the adapter isolates engine imports. Preserve each lane's README/plan additions on merge. Update the UI to consume the current pair, handle stale-ID 404s, and reset both comparison views. No cross-origin UI bridge added. Single-process memory is intentionally not durable or multi-user/serverless-ready.
