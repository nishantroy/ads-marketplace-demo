# Ads marketplace simulator — implementation plan

## Goal and scope

Build a small educational simulator for a non-technical audience showing candidate generation → quality gating → utility ranking → auction, and how budget pacing changes campaign spend and marketplace competition over time.

Target: a basic local prototype in approximately 2–3 hours of implementation, not a production-ready application. Use TypeScript, Next.js, and Postgres. Eventual Vercel hosting should remain possible, but deployment, authentication, workers, WebSockets, real ad integrations, and simulated clicks/conversions are out of scope.

Compute a whole run server-side, persist it, then animate a lightweight timeline in the browser. Store every request trace; fetch details on demand. Do not implement an HTTP call or database write per simulated impression.

### Scope decisions (confirmed 2026-09-06)

- Verification load is deliberately light for the prototype: focused unit tests written alongside code, plus manual human testing. Real-database integration tests, Playwright/browser automation, rollback-on-failure tests, and similar hardening are deferred follow-ups, listed under "Deferred productionization" below.
- Updated by human request: M1 continues on `main` with another agent; the UI lane now runs in parallel on branch `ui-workspace`, worktree `../ads-marketplace-demo-ui`. Shared contracts remain frozen; UI work does not edit engine/API/dependency files.
- Get the basic simulator working end to end before wiring persistence. Postgres is provided by Neon (serverless Postgres compatible with Vercel), not a local Docker container. Until M3, runs live in an in-memory server-side store behind a small repository interface so Neon can replace it without touching the engine or UI.
- Impression-objective campaigns carry a seeded per-campaign quality prior in (0, 1] instead of a constant base score of 1, so they do not all tie at the top of every category's ranking.
- Superseded 2026-09-06: ranking order was originally static across requests, because relevance was per category and so common to every candidate. Campaigns now carry a per-segment affinity, making relevance a property of the user-campaign pair, so ranking order varies per request. See the utility auction decision below.
- Pacing keeps the simple spend-versus-target probability. Because second-price charges sit below bid, the probability is fractional only inside a one-bid-wide band and behaves almost binarily. A later option, sequenced only if needed, is to make probability also depend on the fraction of total budget already spent.

## Progress and coordination

Status values: `TODO`, `IN PROGRESS`, `BLOCKED`, `DONE`. Completion requires the stated gate and recorded evidence. Owners claim tasks before editing; use handoff notes for branch/commit and unresolved issues.

| ID | Milestone | Depends on | Status | Owner | Evidence / handoff |
| --- | --- | --- | --- | --- | --- |
| M0 | Approve boundaries, scaffold, freeze contracts | — | DONE | Claude (coordinating assistant) | Next.js 16 scaffold on 127.0.0.1:3002; contracts in `src/lib/contracts/`; spec in `docs/engine-spec.md`; typecheck, lint, 4 unit tests, dev-server smoke all pass (see log) |
| M1 | Pure engine and unit tests | M0 | DONE | Claude (coordinating assistant) | `simulate()` plus stage modules in `src/lib/simulation/`; 24 unit tests, typecheck and lint pass; no React/database import in the engine |
| M2 | Seeded marketplace and paired-run diagnostics | M1 | DONE | Claude (coordinating assistant) | Generator with baseline and small presets, budgets calibrated for full delivery (`baseline-2`); `docs/m2-diagnostics.md` committed; 44 tests, typecheck and lint pass |
| M3 | Live-demo API, no persistence | M0; final integration M1/M2 | DONE | API assistant (`api-integration`, merged) | Latest on/off pair in server memory, no database/history; 6 focused tests, full suite, typecheck/lint/build, and paired 4,000-request smoke pass after merge. |
| M4 | Playback workspace and request side sheet | M0; final integration M2/M3 | IN PROGRESS | UI assistant | Live API wiring complete: current on/off pair, shared-cursor overlays, current request rows/traces, reset/replacement/error states. Manual end-to-end review and polish remain. |
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
- 4,000 pre-generated requests, 20 static users, four categories, four user segments.
- 32 campaigns, initially eight per category, mixed impression/click/conversion objectives.
- One ad slot per request; all campaigns bid and pay per impression.
- Users have category relevance in [0, 1] and belong to a segment. Campaigns have category, objective, fixed historical rates, maximum impression bid, session budget, and an affinity in [0, 1] per segment.
- Requests contain ID, simulated timestamp, user ID, category, and optional illustrative query text. Category alone drives retrieval.
- No clicks/conversions are sampled; no prediction noise or changing user behavior.

### Ordered funnel

1. Retrieve all campaigns matching the request category. Objectives label candidates and determine scoring; no random retrieval quota is needed.
2. Exclude campaigns with remaining budget below the reserve price.
3. Apply campaign-specific pacing admission.
4. Compute quality for admitted campaigns, apply the fixed quality gate, then rank survivors by utility and retain the top four.
5. Run a single-slot auction among finalists: highest utility wins, priced by the runner-up's utility adjusted for the winner's quality.
6. Deduct the clearing price and record the complete trace, including empty auctions.

Use deterministic utility tie-breaking by campaign ID and order requests by timestamp then request ID. A paced-out campaign cannot win or set a price.

### Ranking and utility

```text
relevance = user_category_relevance[category] x campaign_affinity[user_segment]
quality   = fixed_normalized_engagement_prediction x relevance
utility   = effective_bid x quality
```

Normalize engagement using fixed scenario parameters, not current candidate-pool statistics. Relevance is a
property of the user-campaign pair, so ranking order varies between requests rather than being a fixed
leaderboard per category. Quality decides participation through the gate; utility decides order.

Confirmed engagement bases (all clamped to [0, 1]):

```text
impression: quality_prior                      (seeded per campaign, in (0, 1])
click:      historical_ctr / ctr_scale
conversion: historical_cvr / cvr_scale         (per-impression conversion rate)
```

Bids are kept within a narrow range, about 2.7x from top to bottom. If bids spanned an order of magnitude
the bid term would decide every auction and quality would be decorative.

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
utility       = effective_bid x quality
winner        = finalist with highest utility
price         = clamp(round(runner_up_utility / winner_quality), reserve, winner_effective_bid)
```

Only finalists with effective bid at least the reserve participate. The winner pays the least it could have
bid and still stayed ahead of the runner-up, which means better quality buys the same position for less. One
bidder pays reserve; no bidders means no winner and zero spend. Store all monetary amounts in integer
microdollars and validate safe ranges. Reserve must be positive. Targets, qualities and utilities may use
fractional arithmetic; actual charges remain integers.

Charging the runner-up's raw bid is not an option under utility ranking: the runner-up may outbid the
winner, so the winner would be charged above its own maximum, and capping there would remove the advantage
quality is supposed to confer.

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
- [x] Ensure ranking scores/threshold do not collapse most auctions to zero or one participant. Include all objectives in quality-qualified candidates.
- [x] Run pacing on/off and produce a reproducible diagnostic report (`npm run diagnose`).
- [x] Freeze/version the baseline seed and parameter values after inspection; retain the report.

Report: quality-qualified request coverage, filled requests, multiple-bidder auction share, budget-exhaustion times, early/late participant counts and prices, campaign spend trajectories, final revenue, and unspent budgets. Separate threshold qualification from pacing/shortlist attrition.

Gate: accounting invariants pass for both modes; the report demonstrates understandable spend-pattern differences and assesses late competition. If it does not illustrate the intended lesson, discuss fixture tuning with the human before UI polish. Higher paced revenue is not a correctness assertion. Confirm an explicit coverage target with the human rather than treating “majority” as an unstated numeric requirement.

## M3 — Live-demo API (persistence cut 2026-09-06)

Human decision: no database, no Neon, and no run history. The API holds one immutable active scenario and only the latest completed result per pacing mode in server memory (at most two results). Starting a run in a mode replaces that mode’s result; reset regenerates the baseline and clears both; restart also clears both. Failed computation leaves the previous successful pair unchanged. See `docs/live-demo-api.md` for endpoint and pagination semantics.

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

- [x] Seed the active baseline lazily; start every engine run with fresh balances.
- [x] Validate mode/pagination inputs and return no-store JSON error envelopes.
- [x] Compute server-side through one engine adapter, check invariants, then publish the complete result into its mode slot.
- [x] Preserve the previous successful pair if computation fails; retain no partial or failed output.
- [x] Reset baseline and clear both slots.
- [x] Retrieve current timelines separately from compact paginated request rows and individual current traces.
- [ ] Disable duplicate submission in the UI during live integration.

Gate: focused live-state/input-validation tests, full unit suite, typecheck, lint, build, and paired 4,000-request HTTP smoke all pass. Database and history behavior are outside this scope.

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
- [x] Connect server run creation/reset, fetch current request pages/details on demand, and support matched on/off overlays when input hash and engine version match. There is intentionally no history.
- [ ] Human visual review and later UI/playback testing. Per the latest human request, no playback test suite is added in this chunk; prioritize the usable prototype and polish.

These are preview-only completions. The full milestone tasks/gate below remain pending real integration.

Tasks:

- [x] Add pacing toggle, run button, computation status, and reset-live-demo button.
- [x] Load the latest pacing-on/off pair; no run-history selector.
- [x] Add play/pause, speed, restart, and six-hour simulated clock; no simulation logic in the browser.
- [x] Chart marketplace cumulative revenue and per-campaign spend versus target.
- [x] Show competition and clearing-price time series with units and empty-auction semantics clearly labeled.
- [x] Overlay matching on/off runs only; suppress the overlay when hashes/engine versions differ.
- [x] Fetch a compact current request sample tied to playback cutoff and individual traces on demand for the side sheet.
- [x] Explain retrieval, exclusions, pacing, quality, utility ranking, shortlist, bids, runner-up, quality-adjusted price, and budget changes in the side sheet.
- [x] Include loading, failure, empty-auction, no-run, stale-result, and keyboard-dismissable side-sheet states.

Playback contract: five-minute buckets (72 points), with metrics advancing at bucket boundaries. Do not imply exact request-level interpolation. Fetch detailed traces only when needed. Current metrics and visible request cutoffs must agree with the cursor; label final-run summaries separately. Average clearing price is over filled impressions; distinguish no sales from a zero price.

Gate (prototype): manual browser check that controls, error/empty states, matched overlays, and the side sheet work; playback never mutates results; requests do not leak beyond the cursor; a side sheet agrees with its persisted trace. Changing the pacing toggle affects the next run, never relabels the displayed run. Automated UI tests are deferred.

### Interaction redesign (confirmed, not yet implemented)

Supersedes the pacing toggle and manual Run button above. The human's 2026-09-06 decision, documented in
[docs/ui-design-principles.md](docs/ui-design-principles.md#guided-narrative-interaction-pattern-confirmed-2026-09-06):
both modes compute automatically with no user decision point, a short click-through sequence (intro,
unpaced, paced, comparison, explore) replaces the always-on dashboard, competing-campaign-count and
clearing-price get their own synced-pair charts revealed on request, request inspection becomes two
side-by-side funnel panels instead of a single mode-switched one, and one shared cursor scrubs both runs
from the comparison step onward. This is a presentation redesign only; it does not change the API, the
engine, or the shipped M4 data-fetching behavior above. Implementation is a follow-up chunk, not done here.

## M5 — End-to-end verification and handoff

Tasks:

- [ ] Add short in-context tooltips and a demo guide: run without pacing, inspect early/late behavior, run with pacing, compare matched runs, inspect supporting auctions.
- [ ] Explain session budgets, threshold-only relevance effect, per-impression billing, losing-bid price support, and non-guaranteed revenue improvement.
- [ ] Run the full local flow: seed → unpaced run → paced run → comparison playback → current request inspection → replace one mode → reset both. (Awaiting human manual test.)
- [ ] Verify paired inputs match, all accounting invariants hold, and timelines reconcile with traces.
- [ ] Document setup, migrations, reset behavior, test commands, known limits, and actual diagnostic observations in README.
- [ ] Record checks, remaining limitations, and local commit handoff.

Gate: engine/unit tests and typecheck pass; the documented manual demo flow works from local setup. No claim of deployed readiness or guaranteed pacing uplift.

## Deferred productionization (follow-ups, not in this build)

- Database persistence and history are outside the current live-demo scope.
- Playwright/browser automation for playback controls and error/empty states.
- Job/idempotency handling for run submission; hosting-limit assessment for synchronous run computation on Vercel.
- Optional pacing refinement: probability that also accounts for the fraction of total budget spent.

## Decisions requiring confirmation at M0

| Question | Proposed default | Status |
| --- | --- | --- |
| Package manager, ORM, tests/charts | npm; Drizzle + node-postgres (M3, now cut, see below); Vitest; amCharts 5 | Confirmed 2026-09-06; chart library changed from Recharts to amCharts 5 in the UI branch's refinement chunk, at the human's request |
| Auction mechanism | Rank by utility (effective bid x quality), not by bid. Quality gates participation; utility decides order | Confirmed 2026-09-06, superseding the original bid-only second-price auction |
| Pricing rule | Winner pays `clamp(round(runner_up_utility / winner_quality), reserve, winner_effective_bid)`, so better quality buys the same position for less. The alternative, charging the runner-up's raw bid, was rejected: under utility ranking the runner-up can outbid the winner, so it would charge above the winner's own maximum, and capping there would take the whole surplus whenever quality decided the outcome | Confirmed 2026-09-06 |
| Relevance shape | Per user-campaign pair: user category interest x campaign affinity for the user's segment. Four segments. Chosen because a category-only relevance is common to every candidate in a request and so cancels out of both ranking and price | Confirmed 2026-09-06 |
| Budget delivery target | At least 90% of campaigns spend at least 95% of budget in both pacing modes, measured by spend share rather than by ending below the reserve. Accepted consequence: budgets sized for full delivery leave the unpaced market nearly empty in the final hour | Confirmed 2026-09-06 |
| Engagement definitions | Impression: seeded per-campaign quality prior in (0,1]; click: historical CTR / fixed CTR scale; conversion: per-impression conversion rate / fixed conversion scale; clamp to [0,1], then multiply by pair relevance to give quality | Confirmed 2026-09-06 |
| Rates, budgets, bids, reserve, threshold | Versioned fixture parameters, tuned via M2 diagnostics. Bids span only about 2.7x so quality is not swamped by bid; budgets are calibrated against both modes | Numeric values selected in M2 |
| Quality-qualified coverage target | At least 90% of requests have two quality-qualified, category-matching campaigns before budget/pacing exclusions | Confirmed 2026-09-06 |
| Interaction pattern | Guided narrative, confirmed 2026-09-06, documented in [docs/ui-design-principles.md](docs/ui-design-principles.md#guided-narrative-interaction-pattern-confirmed-2026-09-06). Both pacing modes compute automatically, no toggle or Run button; a short click-through sequence (intro, unpaced, paced, comparison, explore) reveals them; one shared cursor scrubs both once both exist; request inspection is two side-by-side funnel panels. Supersedes the shipped pacing-toggle/Run-button pattern; not yet implemented | Confirmed 2026-09-06 |
| Persistence | No database, Neon/Postgres, or history. Server memory holds only the latest completed result per pacing mode; replacement/reset clears old results. | Confirmed 2026-09-06; live-demo API merged |
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

### Utility auction chunk

- Date / task / owner: 2026-09-06 / replace the bid-only auction with a utility auction / Claude (coordinating assistant).
- Why: with a bid-only auction, quality controlled participation but never the outcome, so a campaign's achievable spend was determined entirely by its rank in the bid ladder. The cheapest bidders could only win once everyone above them was out of budget or paced out.
- Change to the locked contract, approved by the human before implementation: ranking is now by utility, which is effective bid times quality. Quality is engagement times relevance, and relevance is now a property of the user-campaign pair, since campaigns carry an affinity per user segment. The winner pays `clamp(round(runner_up_utility / winner_quality), reserve, winner_effective_bid)`.
- Why the price is quality-adjusted: under utility ranking the runner-up can outbid the winner, so charging the runner-up's raw bid would charge the winner above its own maximum. Capping at the winner's bid would then take the entire surplus every time quality decided the outcome, teaching the opposite of the intended lesson. The quality-adjusted price is the least the winner could have bid and still stayed ahead, and it is automatically at or below the winner's effective bid.
- Supporting changes: bids narrowed to a 2.7x range so the bid term does not swamp quality; a `RankingStage` added to traces so the funnel reads gate, rank, auction; `priceBasis` recorded on each request; budgets recalibrated; `ENGINE_VERSION` bumped to 0.2.0 and scenarios to `baseline-3` and `small-3`.
- Results (baseline-3, input hash `921eb4604bdb22a8`): all 32 campaigns deliver at least 95% of budget in both modes, with unspent budget of $1.38 unpaced and $6.94 paced. Quality decides a large share of outcomes: in 67.7% of contested unpaced auctions the winner was outbid by a losing participant, and 41.4% paced. Coverage rose to 98.6%. Revenue is $2,152.76 unpaced against $2,147.20 paced.
- Known tension: because budgets are now sized to be fully deliverable, the unpaced market exhausts before the session ends and the last hour fills only 129 of 1,168 requests at the reserve price, against 983 at $0.38 paced. Full delivery and a lively unpaced endgame cannot both hold; the human asked for delivery.
- Commands run and outcomes: `npx vitest run` 49/49 passed; `npm run diagnose` rewrote `docs/m2-diagnostics.md`; `npm run typecheck` OK; `npm run lint` OK.

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

### Integration chunk: merge ui-workspace into main

- Date / task / owner: 2026-09-06 / merge the `ui-workspace` branch into `main` / Claude (coordinating assistant).
- Paths: merge touched `AGENTS.md`, `README.md`, `IMPLEMENTATION_PLAN.md`, `package.json`, `package-lock.json`, `src/app/{layout,page}.tsx`, `src/app/globals.css`, plus new `docs/ui-design-principles.md`, `public/licenses/amcharts5-LICENSE.txt`, and `src/components/simulator/**`. Also updated in this chunk to reconcile with main's current contract: `src/components/simulator/{preview-data,request-funnel,request-sheet}.tsx`.
- Why now: `ui-workspace` branched from `a47f34b`, before M1, M2, and the utility-auction rework. It built additive UI (playback, charts, request funnel/side sheet) against contract-shaped types and a hand-authored four-request walkthrough; it never touched `src/lib/**`, so the merge itself was a plain three-way merge with two real conflicts, in `IMPLEMENTATION_PLAN.md` and `README.md` (both branches extended the same narrative sections). `package.json`/`package-lock.json` merged cleanly and correctly adopted `@amcharts/amcharts5`, dropping `recharts`, matching the UI branch's own recorded human decision to switch chart libraries.
- Real breakage after the text merge, all from contract drift, not from the merge itself: `preview-data.ts` hand-built `CandidateTrace`/`ScenarioSummary` objects against the pre-utility-auction shape (missing `segments`, `RankingStage`, `priceBasis`; `scoring.score` instead of `scoring.quality`). `request-funnel.tsx` and `request-sheet.tsx` read `scoring.shortlisted`/`scoring.rank`/`auction.effectiveBidMicros`/`config.scoreThreshold`, all of which moved or were renamed when ranking became a separate utility stage.
- Fix, not a patch-over: rather than re-deriving the hand-authored walkthrough numbers a second time by hand, `preview-data.ts` now calls the real `simulate(tinyScenario, false)` and derives everything from its actual output. This is strictly better than hand-authored numbers: it cannot drift from engine behaviour, and it is real engine output rather than a simulated one, even though it is only the four-request tiny fixture rather than the full baseline. The two components were updated to read `ranking.{rank,shortlisted,effectiveBidMicros,utility}` and `scoring.quality`/`config.qualityThreshold`, and their copy now describes the quality gate and utility ranking instead of a bare score threshold.
- Persistence scope cut (human decision, relayed in this chunk, not separately implemented here): no database, no Neon. The `api-integration` worktree already implements this as an in-memory latest-pair store with no history; that branch is not merged in this chunk. The decisions table and M3 section here are updated to state the cut and point at that branch, without duplicating its detailed rewrite.
- Commands run and outcomes: `npm install` (added `@amcharts/amcharts5`, removed `recharts`); `npm run typecheck` OK; `npm run lint` OK; `npx vitest run` 49/49 passed, unchanged from before the merge; `npm run build` OK (static export, two routes); manual dev-server smoke on `127.0.0.1:3002` returned HTTP 200 and rendered the merged workspace.
- Decisions / deviations: kept both branches' validation-log history rather than rewriting either; appended this entry after them. Updated the UI's "Try the UI preview" README section and the funnel/sheet copy to describe the current quality/utility mechanic rather than delete it, since the UI itself did not need to change, only its data source and field names.
- Remaining blockers / next owner: live API wiring into the UI, then manual end-to-end review. No automated UI/browser tests exist yet, consistent with the project's light-verification preference; only manual review and the checks above were run.

### Integration chunk: merge api-integration into main

- Date / task / owner: 2026-09-06 / merge `api-integration` into `main` / coordinating assistant.
- Result: merged two-slot live-demo endpoints, server-side engine adapter, input/pagination validation, no-store JSON errors, focused API tests, and API documentation. No database/history was introduced.
- Conflict resolution: retained main’s current utility-auction engine documentation and UI direction, then updated it to state that the live API is merged. Replaced obsolete persistence/history tasks with the agreed latest-on/off-pair behavior. Updated `docs/live-demo-api.md` to remove its pre-merge branch/old-engine warning.
- Reconciliation: the API compiled and passed all focused tests against the current quality/utility contracts without changes to engine or shared types; its adapter already isolated engine imports.
- Validation: `npm ci`; `npx next typegen`; `npm run typecheck`; `npm run lint`; `npx vitest run` (55/55); `npm run build`; and `git diff --check` all passed. Build reports all seven expected dynamic API routes.
- Remaining work: replace UI preview loading with current-pair API calls, enable real run/reset controls, show matched pacing comparison, handle replacement/reset/stale result IDs, and perform manual end-to-end validation.

### M4 live API wiring chunk

- Owner: coordinating assistant on `main` after UI/API merges.
- Changed: `src/components/simulator/simulator-preview.tsx`, `timeline-chart.tsx`, `request-funnel.tsx`, UI CSS, README, and this plan. No engine, API route, shared contract, or dependency change.
- Implemented: initial scenario/current-pair load; selected-mode playback; run-with-pacing on/off; reset; current mode replacement; same-hash/version overlay at a shared cursor; stable budget-derived axes; compact request sample fetched with exclusive cursor cutoff; on-demand trace fetch; stale-result/HTTP error message; and no-result/loading states. The controller does not import the engine or preview fixture data.
- Deliberate limits: only the current two server results are addressable, as specified. The request explorer shows the first 30 revealed rows, not a historical browser. UI does not claim a pacing revenue direction. Browser playback only reveals API-recorded outputs.
- Validation: `npx next typegen`, `npm run typecheck`, `npm run lint`, and `npm run build` passed. Automated UI tests remain deferred by scope decision.
- Next: human manual flow on port 3002: run off, run on, inspect shared charts at late cursor, open a request funnel, replace a mode, reset. Report UX/polish findings before further changes.

