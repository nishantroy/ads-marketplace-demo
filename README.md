# ads-marketplace-demo

Educational search-ads marketplace simulator: candidate generation, quality gating, utility ranking,
quality-adjusted second-price auctions, and budget pacing over a replayable six-hour session.

- [Implementation plan and progress](IMPLEMENTATION_PLAN.md)
- [Engine specification](docs/engine-spec.md)
- [Project agent rules](AGENTS.md)
- [UI design principles](docs/ui-design-principles.md)
- [Live-demo API](docs/live-demo-api.md)
- [Code-review follow-up — deferred until after design polish](docs/code-review-follow-up.md)

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

Persistence is out of scope: there is no database or run history. The live-demo API keeps only the
latest completed result per pacing mode in server memory. Re-running a mode replaces its result; reset
or a server restart clears both. Current-result requests remain available for funnel drill-down.

## How it works

The simulator replays a fixed six-hour session of search requests through an ads funnel and records
everything, so the browser can play the result back without recomputing anything.

1. **Scenario** (immutable input): users who belong to a segment and have a relevance score per category,
   campaigns with a category, objective (impression, click, or conversion), a max bid, a session budget, and
   an affinity for each user segment, plus a pre-generated, timestamp-ordered stream of requests. The whole
   snapshot is hashed so runs can be compared.
2. **Funnel per request** (engine, runs server-side): retrieve campaigns in the request's category, drop any
   whose remaining budget is below the reserve, apply pacing admission, apply the quality gate, rank the
   survivors by utility and keep the top four, then run a single-slot auction and charge the winner.
3. **Pacing** is the only switch between two comparable runs. With pacing on, a campaign is admitted only
   when its spend is behind a straight-line target for the elapsed session time.
4. **Outputs**: one full trace per request (every candidate and why it was excluded, quality, utility,
   winner, price), 72 five-minute timeline buckets, and a run summary. Revenue always equals total spend.

### Quality, utility, and price

The auction is not decided by bid alone. Three values matter, and they come from different parties:

```text
relevance = user's category interest x campaign's affinity for the user's segment   (user value)
quality   = engagement prediction x relevance                                       (advertiser value)
utility   = effective bid x quality                                                 (platform value)
```

Quality decides who takes part, through a fixed gate. Utility decides the order. That split matters: because
affinity differs by segment, relevance is a property of the user-campaign pair, so the ranking genuinely
changes from request to request rather than being a fixed leaderboard per category.

The winner pays the integer-rounded critical price implied by the runner-up:

```text
price = round(runner-up utility / winner quality), floored at the reserve and capped by the winner's effective bid
```

So better quality buys the same position for less. This is also why the price cannot simply be the
runner-up's bid: under utility ranking the runner-up often bids more than the winner, so charging its bid
would charge the winner above its own maximum, and capping there would take the whole surplus every time
quality decided the outcome.

Exact formulas, bounds and tie-breaking rules are in [docs/engine-spec.md](docs/engine-spec.md).

### Using the engine

`simulate(snapshot, pacingEnabled)` in `src/lib/simulation/engine.ts` is the whole simulation. It is pure:
no I/O, no clock, no randomness beyond a hash keyed by request and campaign, so the same snapshot and mode
always give the same output. It returns a run summary, 72 timeline buckets, and one trace per request.

```ts
import { simulate } from "@/lib/simulation/engine";
import { checkInvariants } from "@/lib/simulation/invariants";
import { baselineScenario } from "@/lib/fixtures/presets";

const scenario = baselineScenario();
const run = simulate(scenario, /* pacingEnabled */ false);
run.summary.revenueMicros;            // total revenue, in microdollars
run.traces[0].candidates;             // every retrieved campaign and why it was excluded
run.traces[0].priceBasis;             // runner-up utility and winner quality behind the price
checkInvariants(scenario, run);       // [] when the run is self-consistent
```

Each candidate records the stage that stopped it (`excluded_budget`, `excluded_pacing`,
`excluded_threshold`, `excluded_shortlist`, `excluded_reserve`, `lost`, or `won`), and stages after that
point are marked not evaluated rather than failed. `checkInvariants` is the shared accounting check: revenue
equals total spend and the sum of clearing prices, no campaign overspends, the winner really did hold the
highest utility, and buckets reconcile with traces.

### The seeded marketplace

`baselineScenario()` in `src/lib/fixtures/presets.ts` generates the versioned six-hour marketplace: 4
categories, 4 segments, 20 users, 32 campaigns, and 4,000 requests. Generation is deterministic from the
preset seed and runs before the simulation, so it is the one place a seeded random stream is allowed.

Each category holds eight campaigns whose bids span only about 2.7x. That narrow range is deliberate: if
bids spanned an order of magnitude the bid term would decide every auction and quality would be decorative.
Every campaign targets one segment well and others poorly, so which campaign wins depends on who is asking.

`smallScenario()` is the same generator at reduced size for fast unit tests. It is a test fixture, not a
second baseline: only the baseline is versioned and used for tuning judgments.

Run `npm run diagnose` to regenerate [docs/m2-diagnostics.md](docs/m2-diagnostics.md), the paired-run report
for both pacing modes. The report is deterministic, so a change to that file means behaviour actually changed.

### What the baseline shows

Quality is doing real work, not decorating the ranking. In 67.7% of contested unpaced auctions the winner
was outbid by a campaign that lost, which ranking on bid alone would make impossible by construction.

Traffic is approximately even across the six-hour teaching session (with a small deterministic wobble),
not a claim about a real-world daily traffic curve. Unpaced, the market spends $675 of $2,126 in the first
hour, exhausts campaigns with a median time of 3h40, and fills none of the last hour’s 658 requests. With
pacing on the same campaigns spread their budgets across the session and fill 631 of those last-hour
requests at $0.56. Total revenue remains close—$2,126 unpaced against $2,114 paced—because both modes
deliver essentially every campaign’s budget.

That is the honest lesson: pacing changes when budget is spent and keeps valuable bidders in late auctions,
but it does not promise more revenue. Note the trade-off in the fixture, too. Budgets are sized so that all
32 campaigns deliver at least 95% of budget in both modes, and the price of that is an unpaced endgame with
almost nothing left to sell. Full delivery and a lively unpaced finish cannot both hold.

Two measurement notes that are easy to get wrong. Budget delivery should be read from the share of budget
spent, not from whether a campaign ended below the reserve price, which is knife-edge and understates paced
delivery badly. Late competition likewise shows up in the price the survivors pay, not in how many
candidates were admitted, since pacing throttles admissions by design.

Campaign budgets are not free parameters either. Pacing controls when a campaign is allowed to bid, but it
cannot make that campaign win, so a budget larger than what a campaign can win will underspend however
pacing is configured. Budgets are calibrated against both modes for that reason.

What exists today (after M2): the shared types, the pure engine, the seeded marketplace generator with both
presets, the paired-run diagnostics, and the invariant checker, all covered by unit tests. The API and the
playback UI arrive in later milestones.

### Run the live UI demo

There is nothing to configure or run: opening the app computes both the pacing-off and pacing-on results
over the identical 4,000-request marketplace automatically, and a five-step guide reveals them.

1. **Start** — a short framing card with the question the demo answers, and how big the scenario is.
2. **Pacing off** — the revenue chart animates in alone, so you see the unpaced baseline first.
3. **Pacing on** — pacing off freezes as a dashed reference and the pacing-on line animates in from zero
   on the same chart.
4. **Compare** — both lines shown complete, with a plain-language readout of what changed.
5. **Explore** — the guide steps back and starts with **Three campaign stories**: a fast early spender,
   a campaign still active late with pacing, and a useful exception. Each uses live paired values and opens
   its full campaign curve. Then use play/pause/scrub/speed, **Follow one campaign** for any campaign’s
   spend against the same budget, **Why do impression prices change?** for competing-campaign-count and
   clearing-price as paired off/on charts, and **Inspect a request** for a merged request list.

The step pills at the top are always clickable — nothing is gated behind watching a step play out, and you
can jump to Explore immediately. From Compare onward, one shared cursor scrubs both runs together, so
scrubbing shows how each mode was doing at the same simulated moment.

Inspecting a request opens both modes' funnels side by side for the same request: **Category matches →
Budget eligibility → Pacing admission → Quality gate and utility ranking → Auction → Winner**, so you can
see the same moment play out differently under each mode. Every panel uses a server-recorded trace and
never reruns the engine in the browser.

Only completed five-minute buckets and requests strictly before the cursor are visible. Price-chart gaps
mean no filled impressions, not free ones. The request list intentionally shows the first 30 revealed rows;
this live demo has no historical request browser. **Reset demo**, in the header, clears both current
results and returns to Start; a server restart does too.

Charts use **amCharts 5**. Chart roots are created only in the browser and disposed on unmount; playback
updates data without recreating the chart. Default amCharts attribution is retained, and its original
license is served at [`/licenses/amcharts5-LICENSE.txt`](public/licenses/amcharts5-LICENSE.txt). Review
licensing before public release.

Automated browser testing remains deferred. For now validation is typecheck, lint, build, API tests, and
manual review.

What exists today: shared types, pure engine, seeded marketplace and paired diagnostics, invariant checker,
live-demo API endpoints, and a guided UI wired to the current pacing-on/off pair. The interaction pattern is
documented in [docs/ui-design-principles.md](docs/ui-design-principles.md#guided-narrative-interaction-pattern-confirmed-2026-09-06).

## Layout

- `src/lib/contracts/` shared types: scenario, campaigns, users, requests, traces, run summary, timeline, API shapes.
- `src/lib/simulation/` pure engine code (no React, database, HTTP, or wall-clock).
- `src/lib/fixtures/` the tiny hand-calculable scenario and the baseline/small generator presets.
- `src/app/` Next.js app router pages, layout, styles, and API routes.
- `src/components/simulator/` the guided-narrative controller, amCharts views, and the side-by-side
  request sheet/funnel.
- `src/lib/server/` two-slot live state, input validation, engine adapter, and API service.

## UI design direction

[UI design principles](docs/ui-design-principles.md) are required reading for UI work and are linked from
`AGENTS.md`. Lead with the learning question, reveal complexity progressively, connect outcomes to causes,
compare fairly, make motion useful, and explain decisions before showing formulas. These are
presentation/interaction rules, not changes to the simulation contract.

Status: M2 and the live-demo API are complete; M4's guided-narrative UI is wired to current server results
and awaits manual end-to-end review.
