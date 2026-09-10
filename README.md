# ads-marketplace-demo

An educational simulator of a search-ads marketplace. It replays a fixed six-hour session of 4,000 search
requests through the full ads funnel — candidate retrieval, budget and pacing eligibility, a quality gate,
utility ranking, and a quality-adjusted second-price auction — twice: once with budget pacing off and once
with it on. A guided, full-screen walkthrough then reveals what changed and lets you dig into any campaign
or any single request.

It is built for someone unfamiliar with both ads and recommendation systems. The one question it answers
is: *what changes when advertisers spread their spending over time?*

## What it teaches

- Ranking is **utility** (bid × quality), not bid alone. A cheap, well-matched ad can beat an expensive,
  poorly matched one.
- **Quality gates participation; utility decides order.** Below a minimum quality, a campaign is dropped no
  matter what it would pay.
- **Better quality buys the same position for less.** The winner pays a price implied by the runner-up's
  utility, adjusted for the winner's own quality.
- All billing is **per impression**, whatever the campaign's objective.
- Only eligible auction participants support prices: a campaign that sat out (paced, out of budget, or below
  the gate) cannot set anyone's price.
- **Pacing changes *when* budget is spent, not necessarily how much revenue there is.** In the baseline,
  revenue is $2,126 unpaced and $2,114 paced — but unpaced, the market fills none of the last hour's 658
  requests, while paced it fills 631 of them.

## Using it

Requires Node 22+ and npm. The app listens on `127.0.0.1:3002`.

```bash
npm install
npm run dev          # http://127.0.0.1:3002
npm run typecheck    # tsc --noEmit (run `npx next typegen` first on a fresh clone)
npm test             # vitest run
npm run lint
npm run build
npm run diagnose     # regenerate docs/m2-diagnostics.md, the paired-run report for the baseline
```

There is nothing to configure: opening the app computes both runs and starts the guide. Each stage has its
own URL (`/marketplace`, `/how-it-works`, `/briefing`, `/pacing-off`, `/pacing-on`, `/compare`, `/explore`, `/explore-requests`), so a reload
lands back where you were and the browser's back/forward buttons move through the guide. A rail on the
right jumps to any stage; nothing is locked behind watching a stage play out.

1. **Opening** — the question the demo answers.
2. **The marketplace** — why users search, why advertisers pay for attention, and why the platform balances
   relevance, advertiser value, and short- and long-term revenue rather than just taking the highest bid.
   Defines campaigns, objectives, bids, and budgets, and distinguishes the working auction simulation from
   unmodelled purchases, profit, and satisfaction.
3. **How it works** — one request walked through the seven funnel stages (arrive → retrieve → budget &
   pacing → quality gate → rank by utility → auction → winner), with each stage's vocabulary defined as you
   reach it.
4. **Experiment setup** (still at `/briefing`) — live scenario counts and an explicit explanation of the
   working end-to-end auction engine: simulated inputs, per-request budget deductions, identical starting
   conditions, and recorded results rather than invented chart curves. Predict the revenue effect before watching.
5. **Pacing off** — the marketplace revenue curve animates in alone. After playback, recorded results show
   whole-session and hourly requests, impressions filled, fill rate, average impression price, and revenue,
   with a final-hour callout.
6. **Pacing on** — the same requests, with pacing holding budget back against a straight-line target;
   its own completed results appear after playback. Once a mode finishes, revisiting it during the same
   page visit shows the completed result without replaying. Reloading starts a fresh page visit.
7. **Compare** — both revenue curves and one hourly table with shared Window/Requests columns and grouped
   Pacing off/on columns for fill rate, average impression price, and revenue; plus the competition and impression-price
   charts. The lesson is budget timing and late availability, not guaranteed revenue growth.
   Counts and charges are summed from live timeline buckets; prices are total charges divided by filled requests,
   never averages of bucket averages. With no impressions sold, average price is undefined (a gap / “No impressions”),
   while revenue is $0. Early unfilled requests under pacing remain visible as a trade-off.
8. **Explore campaigns** (`/explore`) — three teaching stories use live paired-run values; explore any
   campaign's spend curve against its budget in both modes.
9. **Explore individual requests** (`/explore-requests`) — the first 30 request rows are immediately visible,
   with both modes' winners side by side. “See what happened in one auction” samples from the entire recorded
   session through the existing sequence cursor API, not just these rows. The inspector's “See another” samples
   a different request. This random navigation never changes simulation inputs or outcomes.
   The full-page inspector leads with metadata and reading guidance, then prominent pacing-mode headings,
   winners, charges, and before/after budgets above the paired funnels. “Inside this auction” exposes each
   retrieved campaign's quality, pacing, ranking, and accounting details.

Charts use amCharts 5. Its default attribution is retained and its license is served at
[`/licenses/amcharts5-LICENSE.txt`](public/licenses/amcharts5-LICENSE.txt); review licensing before any
public release beyond this demo.

## How the app works

```text
baselineScenario()  ──►  simulate(snapshot, pacingEnabled)  ──►  { summary, 72 timeline buckets, 4,000 traces }
  fixed seed, versioned        pure TypeScript, ~0.2 s                    served by /api/runs/{off,on}/…
                                                                                    │
                                                        browser plays the recorded result back; never re-runs the auction
```

- **Scenario** (`src/lib/fixtures/presets.ts`): the immutable input. 4 categories, 4 user segments, 20 users
  with a relevance score per category, 32 campaigns (a category, an objective — impression, click, or
  conversion — a max bid, a session budget, and an affinity for each segment), and a timestamp-ordered
  stream of 4,000 requests. Generation is deterministic from the seed `ads-marketplace-2026` and is the one
  place a seeded random stream is allowed. The whole snapshot is hashed so runs can be compared.
- **Engine** (`src/lib/simulation/`): `simulate(snapshot, pacingEnabled)` is the entire simulation. It is
  pure — no I/O, no clock, no global state — so the same snapshot and mode always give byte-identical output.
  `checkInvariants(scenario, run)` is the shared accounting check: revenue equals total spend and the sum of
  clearing prices, no campaign overspends, the winner really held the highest utility, and buckets
  reconcile with traces.
- **API** (`src/lib/server/`, `src/app/api/`): stateless. There are exactly two results, `off` and `on`,
  and any server instance recomputes either on demand from the fixed scenario; a per-instance cache only
  saves the recompute. The store owns those cache references and avoids deep-copying the 4,000-request
  scenario or full traces on each internal lookup; HTTP JSON serialization remains the caller boundary.
  That is what makes it safe on Vercel, where instances share no memory — a cache miss is never an error.
- **UI** (`src/components/simulator/`): a single client component sequences the scenes and reveals
  server-recorded results through a playback cursor. Playback speed is fixed and cannot affect outcomes.

### API

| Method / path | Response | Meaning |
| --- | --- | --- |
| `GET /api/scenario` | `{ scenario }` | Baseline summary without the 4,000 input requests |
| `POST /api/scenario/reset` | `{ scenario, reseeded }` | Regenerate the baseline (same seed, so the same scenario) |
| `GET /api/runs` | `{ runs }` | Both completed results, `off` then `on` |
| `GET /api/runs/:id` | `{ run }` | `id` is `off` or `on`; anything else is 404 |
| `GET /api/runs/:id/timeline` | `{ runId, buckets }` | 72 five-minute buckets |
| `GET /api/runs/:id/requests?cursor=&limit=&beforeMs=` | `{ runId, items, nextCursor, total }` | Compact request rows; `beforeMs` is an exclusive simulated-time cutoff |
| `GET /api/runs/:id/requests/:requestId` | `{ runId, trace }` | One request's full funnel trace |

Errors are `{ error: { code, message } }` with `Cache-Control: no-store`. Compare only opposite modes with
identical `inputHash` and `engineVersion`; wall-clock metadata never feeds the simulation.

## The simulation engine

This is the frozen specification the engine implements. Types live in `src/lib/contracts/`.

**Money and time.** Every amount is an integer number of microdollars (`1_000_000` = $1) in `[0, 1e15]`.
Bids, budgets, and the reserve are positive. Pacing targets and probabilities are fractional; charges and
balances are integers. The session is 6 h (`21_600_000` ms) in 5-minute buckets, giving 72; bucket `i`
covers `[i·300000, (i+1)·300000)` and cumulative series are reported at bucket end. Requests are processed
in ascending `(timestampMs, id)` order.

**Quality, utility, and the gate.** Three values matter, and they come from different parties:

```text
impression: engagement = quality_prior                (seeded per campaign, in (0, 1])
click:      engagement = historical_ctr / ctr_scale
conversion: engagement = historical_cvr / cvr_scale   (per-impression conversion rate)

relevance = user_category_relevance[category] × campaign_affinity[user_segment]   (user value)
quality   = clamp(engagement, 0, 1) × relevance                                    (advertiser value)
utility   = effective_bid × quality                                                (platform value)
```

`ctrScale` and `cvrScale` are scenario constants that normalise historical rates onto a common engagement
axis so objectives are comparable. Because affinity differs by segment, relevance is a property of the
user–campaign pair, so the ranking genuinely changes from request to request rather than being a fixed
leaderboard per category. `quality >= qualityThreshold` (finite, in `(0, 1]`) passes the gate; survivors are
ranked by utility descending, ties by campaign id ascending, and the top `shortlistSize` (4) reach the
auction.

**Pacing.** The only experimental switch between two comparable runs.

```text
target      = budget × timestampMs / sessionDurationMs
probability = pacingEnabled ? clamp((target − spend) / bid, 0, 1) : 1
draw        = stableRandom(seed, requestId, campaignId, "pacing")
admitted    = draw < probability
```

`stableRandom` is murmur3 fmix32 over an FNV-1a hash of `"${seed}|${requestId}|${campaignId}|pacing"`,
scaled to `[0, 1)`. It is a pure function of its inputs — no shared stream — so one candidate's draw never
depends on how many were evaluated before it. At `t = 0` with pacing on, target is 0 and nothing is admitted.

**Funnel, auction, and accounting.** Per request:

1. Retrieve campaigns with `campaign.category === request.category`.
2. Exclude when `remaining < reserve` (`excluded_budget`).
3. Pacing admission (`excluded_pacing`).
4. Quality gate (`excluded_threshold`), then rank by utility and shortlist (`excluded_shortlist`).
5. `effectiveBid = min(bid, remaining)`; finalists with `effectiveBid >= reserve` participate
   (`excluded_reserve` otherwise — unreachable after step 2, recorded for completeness).
6. Winner = highest utility, ties by campaign id ascending. The winner pays the integer-rounded critical
   price implied by the runner-up:

   ```text
   price = clamp(round(runner_up_utility / winner_quality), reserve, winner_effective_bid)
   ```

   A sole participant pays the reserve. No participants means no winner and price 0.
7. Deduct the price from the winner's balance.

Because `winner_utility >= runner_up_utility`, the raw quotient never exceeds the winner's effective bid, so
balances cannot go negative; the clamp guards floating-point division and rounding. Charging the runner-up's
raw bid instead would be incoherent here: under utility ranking the runner-up often bids *more* than the
winner, so the winner would be asked to pay above its own maximum, and capping there would take the whole
surplus every time quality decided the outcome. Higher quality lowering the price for the same position is
what makes quality worth having.

Each candidate's trace records the stage that stopped it (`excluded_budget`, `excluded_pacing`,
`excluded_threshold`, `excluded_shortlist`, `excluded_reserve`, `lost`, or `won`); stages after that point
are marked not evaluated rather than failed.

**Comparability and determinism.** `inputHash` is a digest of the sorted-key JSON of the full snapshot (mode
excluded). Runs are comparable only when `inputHash` and `engineVersion` match. The engine may not use
`Math.random`, any clock, `process.env`, or React/Next/database imports — a guard test in
`src/lib/simulation/engine.test.ts` enforces this — and every emitted collection is explicitly ordered with
ties broken on campaign or request id. Changing any of this changes historical results and requires bumping
`ENGINE_VERSION`.

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

### What the baseline shows

Numbers below come from `docs/m2-diagnostics.md`, which `npm run diagnose` regenerates deterministically —
so a diff in that file means behaviour actually changed.

Quality is doing real work, not decorating the ranking: in 63% of contested unpaced auctions the winner was
outbid by a campaign that lost, which ranking on bid alone would make impossible by construction. Each
category's eight campaigns have bids spanning only about 2.7×, deliberately — a wider spread would let the
bid term decide every auction.

Traffic is roughly even across the six hours. Unpaced, the market fills all 675 first-hour requests at an
average $0.97, exhausts campaigns with a median time of 3h40, and fills none of the last hour's 658. Paced,
the same campaigns spread their budgets across the session and fill 631 of those last-hour requests at
$0.56. Revenue stays close — $2,126 against $2,114 — because both modes deliver essentially every
campaign's budget (all 32 campaigns reach 95% of budget unpaced; 31 do paced).

Whole-session fill is 2,779/4,000 (69.5%) off versus 3,831/4,000 (95.8%) on; average price per
filled impression is $0.77 versus $0.55. Summing the recorded five-minute buckets gives:

| Hour | Requests | Fill off | Fill on | Avg. price off | Avg. price on | Revenue off | Revenue on |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 675 | 100.0% | 92.9% | $0.97 | $0.54 | $654.24 | $341.55 |
| 2 | 666 | 100.0% | 94.9% | $0.75 | $0.56 | $498.32 | $356.73 |
| 3 | 654 | 100.0% | 97.2% | $0.81 | $0.55 | $531.60 | $351.98 |
| 4 | 671 | 98.1% | 97.0% | $0.64 | $0.54 | $420.89 | $354.33 |
| 5 | 676 | 18.6% | 96.7% | $0.17 | $0.54 | $20.96 | $354.46 |
| 6 | 658 | 0.0% | 95.9% | No impressions | $0.56 | $0.00 | $354.63 |

Prices are charges divided by filled requests, not averages of bucket averages. Unpaced prices do not fall
monotonically (hour three rebounds), but their hourly range is much wider. The final hour has no unpaced
price observation, not a $0 impression price. Pacing sacrifices some early fill while preserving late delivery.
These rounded figures document the baseline; UI metrics are computed from live API results, not this table.

The campaign stories are also fixture-specific: `travel-c0` spends $128.98 in hour one unpaced;
`electronics-c2` spends most of its budget across **hours two and three**, not a single hour;
`home-c5` spends only $0.40 across the first three hours, then $45.05 in hour four. Their paced spend
extends across all six hours. These curves demonstrate timing, not measured advertiser profit or satisfaction.

That is the honest lesson: pacing changes when budget is spent and keeps funded bidders in late auctions,
but it does not promise more revenue. Budgets are calibrated against both modes so that nearly every
campaign delivers, and the price of that is an unpaced endgame with almost nothing left to sell — full
delivery and a lively unpaced finish cannot both hold. Two things are easy to misread: budget delivery
should be judged by share of budget spent, not by whether a campaign ended below the reserve (knife-edge,
and it understates paced delivery), and late competition shows up in the price survivors pay, not in how
many candidates were admitted, since pacing throttles admissions by design.

## Layout

- `src/lib/contracts/` shared types: scenario, campaigns, users, requests, traces, run summary, timeline, API shapes.
- `src/lib/simulation/` the pure engine, invariants, and the diagnostics report.
- `src/lib/fixtures/` the tiny hand-calculable scenario and the baseline/small generator presets.
- `src/lib/server/` the stateless run service, per-instance cache, input validation, and engine adapter.
- `src/app/` Next.js App Router pages, the catch-all route that maps stage URLs to the guide, styles, and API routes.
- `src/components/simulator/` the guided-scene controller, amCharts views, campaign stories, funnel diagram, and the side-by-side request sheet.
- `docs/m2-diagnostics.md` the generated paired-run report for the baseline.

## Design principles

The UI is a guided experiment, not an ad-operations dashboard. Lead with one question and one action per
stage; reveal complexity progressively (overview → explanation → evidence, with formulas and arithmetic
behind disclosures); connect outcomes to causes without asserting anything the recorded data cannot
support; compare fairly (shared cursor, units, and axis bounds, modes labelled explicitly and never by colour
alone); never imply paced results are automatically better; keep gaps as gaps, not zero prices; honour
reduced motion; and say it in plain language before offering the math.

## Ideas for future extensions

- **Let learners tweak the scenario** — bid spread, budgets, quality threshold, pacing target shape, traffic
  curve — and run their own paired comparison, with the input hash keeping runs honest.
- **Larger and longer simulations** — more campaigns, a full day, or multiple slots per request. Runs would
  need a job model instead of compute-on-request.
- **More mature quality scoring** — there are no actual predictions today, so the quality scores are deterministic
   and don't represent how previous behavior impacts future ranking. This is a key part of ad delivery evolution.
- **Richer request inspection** — search and filter requests by campaign, outcome, or time window instead of
  the first 30 rows; "find a request where these two modes disagreed"; jump from a chart point to the requests
  behind it.
- **Alternative pacing strategies** side by side — budget-fraction-aware probability, throttling vs. bid
  shading — as additional comparable runs.
- **Sampled clicks and conversions**, currently deliberately out of scope, so objectives can be compared on
  realised value rather than predicted engagement.
- **Persistence and sharing** — save a tweaked scenario and its results behind a URL. Deliberately not
  built for the demo; the engine and contracts were designed so it can be added without touching them.
  - **Responsible UX** — the current demo was built explicitly for desktop, and doesn't work seamless on mobile devices.

## Status

Complete as a local prototype and deployed as a demo: shared contracts, the pure engine with unit tests and
a determinism guard, the seeded marketplace and paired diagnostics, the invariant checker, the stateless
live-demo API, and the guided UI. Verification is typecheck, lint, unit tests, and build, plus manual
browser review; automated browser tests are intentionally not part of this build.

The education/inspection UI pass changes presentation and navigation only: no simulation-engine, fixture,
contract, or API changes. The full suite has 56 tests (including the 9 diagnostics checks). Random request
selection is browser navigation over recorded results and does not affect engine determinism. New UI flows
still rely on manual UX review; passing unit tests is not a claim of automated browser coverage.

Project rules for agents working in this repository are in [AGENTS.md](AGENTS.md).
