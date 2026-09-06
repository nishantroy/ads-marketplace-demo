# ads-marketplace-demo

Educational search-ads marketplace simulator: candidate generation, quality gating, utility ranking,
quality-adjusted second-price auctions, and budget pacing over a replayable six-hour session.

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
npm run diagnose     # regenerate docs/m2-diagnostics.md from the baseline scenario
npm run lint
```

From the parent directory, `make run-ads-marketplace-demo` starts the app on its registered port.

Persistence (Neon Postgres) arrives in milestone M3; until then runs are held in server memory. Copy
`.env.example` to `.env.local` and fill in `DATABASE_URL` once M3 lands.

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

The winner pays the least it could have bid and still stayed ahead of the runner-up:

```text
price = runner-up utility / winner quality, floored at the reserve and capped by the winner's effective bid
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

Unpaced, the market spends its budgets early and then goes quiet: the last hour fills only 129 of 1,168
requests, at the reserve price. With pacing on the same campaigns spread their budgets across the session
and the last hour fills 983 requests at $0.38. Total revenue is nearly identical, $2,153 unpaced against
$2,147 paced, because both modes deliver essentially every campaign's budget.

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

## Layout

- `src/lib/contracts/` shared types: scenario, campaigns, users, requests, traces, run summary, timeline, API shapes.
- `src/lib/simulation/` pure engine code (no React, database, HTTP, or wall-clock).
- `src/lib/fixtures/` the tiny hand-calculable scenario and the baseline/small generator presets.
- `src/app/` Next.js app router pages and API routes.

Status: M2 complete (seeded marketplace, utility auction, paired-run diagnostics). API and playback UI follow.
