# Code review — deferred until after design polish

**Status: deferred by human direction.** Complete design polish first, then revisit this checklist.
No fixes were made as part of the review or this documentation task.

The review covered the engine, fixtures, API/state handling, contracts, UI, configuration, tests, and docs.
It included uncommitted UI work on top of commit `ef5a5a0`; concurrent design changes may supersede findings.
Paths and observations below describe that reviewed state. Reproduce each issue before fixing it.

## Assessment

The versioned baseline engine produces deterministic, independently reconciled results. The highest-priority
problems are UI comparison correctness and compatibility, followed by recovery, layout, and validation gaps.
Cleanup should remove stale assumptions and small duplication, not introduce new infrastructure.

## Correctness checklist

### R1 — High: Compare can display incorrect zero-dollar results

- [ ] Fix completed comparison state on direct navigation and browser Back/Forward.
- Path: `src/components/simulator/simulator-preview.tsx` — cursor initialization, `applyStep`, and `popstate` effect.
- Chrome reproduction: opening `/compare` directly shows **$0.00**, “both complete at 00:00,” despite completed runs.
  Clicking Compare explicitly shows **$2,113.68 at 06:00**; navigating away and pressing Back returns to zero.
- Causes: URL restoration sets the step without initializing its cursor; the once-bound `popstate` listener
  captures the initial `timelineLength = 0`.
- Smallest fix: derive the completed comparison frame from loaded timelines rather than relying on a navigation
  side effect. Test direct links, reload, Back/Forward, and navigation before data finishes loading.

### R2 — High: Run compatibility is not checked

- [ ] Require matching inputs and engine versions before displaying paired results.
- Path: `src/components/simulator/simulator-preview.tsx` — `bothReady` and paired chart/story/request projections.
- The reviewed controller checks only that both runs and timelines exist; it does not check `inputHash` or
  `engineVersion`. Hot reload plus one-mode replacement can leave an incompatible pair labeled “same inputs.”
- Smallest fix: gate all paired views on matching hashes and versions, and ensure the displayed scenario matches
  the runs. Show a clear recovery action instead of overlaying incompatible data.

### R3 — Medium: Wide request sheet is overridden

- [ ] Fix the dialog width cascade.
- Path: `src/app/globals.css` — `.request-sheet-wide` and `.request-sheet`.
- The 1100px modifier precedes a 650px base rule with equal specificity, so the base rule wins.
- Chrome confirmed a 650px dialog with two 274px columns on a 1440px viewport.
- Smallest fix: consolidate sizing or put the modifier after the base rule.

### R4 — Medium: Narrow layouts overflow

- [ ] Restore responsive tutorial, navigation, card, chart, and request-column layouts.
- Paths: `src/app/globals.css`, `src/components/simulator/funnel-diagram.tsx`.
- The reviewed CSS has no viewport breakpoints. The funnel rail is fixed at 380px, the tutorial aside has a
  280px minimum, and navigation cannot wrap.
- Chrome at a 390px viewport: document width 556px, navigation content width 636px, tutorial main grid column 0px.
- Smallest fix: one mobile breakpoint to stack columns, scale the funnel rail, and wrap or scroll navigation.
  Verify the centered funnel remains aligned after resizing.

### R5 — Medium: Failed or replaced results lack recovery

- [ ] Add a coherent refresh/retry path for initial loading, partial computation failure, and stale IDs.
- Path: `src/components/simulator/simulator-preview.tsx` — API helper and loading/inspection effects.
- Failures only set dismissible text. A reset in another browser leaves invalid IDs locally; “Start over” changes
  the scene but does not reload server state. `Promise.all` also discards successful run responses when one
  computation request fails.
- Smallest fix: preserve HTTP error codes, reconcile the current pair after a 404 or partial failure, and provide
  explicit retry. Do not add a job system or durable history.

### R6 — Medium: Teaching copy contradicts the model

- [ ] Reconcile tutorial and scene copy with recorded data and the engine contract.
- Path: `src/components/simulator/simulator-preview.tsx` — tutorial definitions and scene copy.
- “Two dozen or more” candidates is incorrect: every baseline request retrieves exactly **eight**.
- Runner-up **bid** adjusted only by winner quality omits runner-up quality. The numerator is runner-up **utility**.
- “Two identical six-hour auctions” should describe two sessions containing 4,000 individual auctions each.
- “Highest bidder wins” is a misleading headline for utility ranking.
- Derive fixture counts from scenario data where practical; preserve the distinction between possible effects
  and guaranteed outcomes. Pacing does not guarantee higher revenue.

### R7 — Medium: Invariant checks miss inconsistent traces

- [ ] Strengthen the validator and add corrupted-output tests.
- Path: `src/lib/simulation/invariants.ts`.
- The checker rejects multiple candidate winners but not a filled request with no candidate winner, and does not
  require the candidate winner to match `winnerCampaignId`.
- An isolated probe removed a filled request's winning candidate outcome and restored its candidate balance;
  `checkInvariants()` still returned `[]`.
- Bucket checks primarily reconcile totals; they do not establish per-bucket agreement with individual traces.
- Add winner count/identity, balance continuity, and per-bucket checks. Test deliberately broken outputs, not
  just valid outputs. The actual baseline passed independent reconciliation during review.

### R8 — Medium: Generated scenarios share mutable configuration

- [ ] Copy configuration when generating a snapshot.
- Path: `src/lib/simulation/generate.ts` — `config: preset.config`.
- Confirmed in an isolated process: mutating one generated scenario's reserve changes the next baseline's reserve.
- Server cloning protects ordinary API consumers, but fixture callers/tests can contaminate later generation.
- Smallest fix: copy the flat config and test isolation between generated snapshots and presets.

### R9 — Low: Accessibility identifiers and roles

- [ ] Give paired funnels unique heading IDs and preserve native button semantics.
- Paths: `src/components/simulator/request-funnel.tsx`, `src/components/simulator/funnel-diagram.tsx`.
- Both request funnels render `id="funnel-heading"`; Chrome confirmed duplicate IDs in the paired sheet.
- Use `useId()`. For tutorial list semantics, put buttons inside list items rather than replacing the button role
  with `role="listitem"`.

## Engine edge cases — not baseline failures

Resolve these explicitly rather than silently changing simulation semantics:

- [ ] Reject non-finite normalization scales; `validateSnapshot()` currently accepts `Infinity`.
- [ ] Decide/document zero-quality auction behavior. The permitted zero quality threshold allows zero-quality
  contestants; a probe recorded a `0 / 0` price basis while pricing fell back to the winner's effective bid.
- [ ] Qualify the “least winning bid” explanation for integer rounding. The approved `Math.round()` formula can
  round below the exact critical bid: 533333 micros at quality 0.9 yields utility 479999.7 against runner-up
  utility 480000. This is consistent with the frozen rounding rule, not a reason to change it without approval.

## Optional simplicity checklist

Reassess against the polished design; these are candidates, not a mandate for a broad refactor.

- [ ] Extract static tutorial content and one focused loading hook from the controller. Avoid a generic state framework.
- [ ] Replace repeated inline request response types with existing `RequestListResponse` / `RequestListItem` contracts.
- [ ] Remove unused playback `requests`/`filled` aggregation and calculate each needed frame once per render.
- [ ] Remove unused `OBJECTIVES`, the unused `windowStats(snapshot)` parameter, and the ignored
  `trafficWeight(bucketCount)` parameter; prune orphan CSS such as `.scene-wide` after checking current markup.
- [ ] Consider completed-only run records with required summary/completion time. The synchronous API does not publish
  `running` or `failed` records; optional summaries and unused `"conflict"` errors retain obsolete states.
  Coordinate shared-contract changes.
- [ ] Move chart color constants outside `timeline-chart.tsx`, so the controller does not statically import the
  chart module it also dynamically loads.
- [ ] Make diagnostic report regeneration explicit rather than writing tracked documentation during every `npm test`.
- [ ] Reconcile README, API docs, design principles, and plan with the final polished flow. Remove obsolete
  preview/database/history instructions and current-state claims about removed reset/playback controls.
  Correct baseline figures: contested unpaced wins despite a higher losing bid are **63.1%**, not 67.7%;
  **31**, not all 32, paced campaigns spend at least 95% of budget. Preserve useful historical log entries as history.

Keep the pure engine modules, tiny/small fixtures, trace contracts, invariant checker, and two-slot store.
They have concrete responsibilities and test value. No broad module deletion or dependency churn was justified.

## Review validation evidence

These checks ran during the preceding review, not during the documentation-only follow-up:

- `npm test`: **55/55 passed** across five files.
- `npm run lint`, `npx next typegen`, `npm run typecheck`, `npm run build`, `git diff --check`: passed.
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`: flagged the unused `snapshot` parameter in diagnostics.
- Read-only HTTP checks on `127.0.0.1:3002`: current run metadata, 72-bucket timelines, request pages, traces,
  exclusive cutoff behavior, no-store headers, and 400/404 responses passed. No live results were replaced/reset.
- Independent baseline checks: candidate balance continuity and per-bucket campaign/revenue totals reconciled.
- Two separate processes produced identical output SHA-256 hashes for both modes:
  - Off: `fa28ffdff60f078f0982d4ff7393d3d70476f3065ba63b1e421684a08b527af4`
  - On: `5c73c0086cd77b6899d86c9d46dde55c2e48895d06f76ff3b59a6a19f8d30334`
- Baseline input hash: `1852e8c66db501c3`; revenue: **$2,126.01 off / $2,113.68 on**.
- Temporary headless Chrome checks confirmed R1, R3, R4, and duplicate heading IDs in R9.
- Isolated engine probes confirmed R7, R8, and the listed edge cases.

The temporary scripts were `/tmp/ads-review-browser.cjs` and `/tmp/ads-review-engine.cjs`; they are not a committed
regression suite and may disappear. Recreate focused checks when addressing the items. Passing build/unit checks
alone does not establish that the polished UI is correct.

## Resumption order

After design polish:

1. Reproduce findings against the final UI; close items already resolved by polish with evidence.
2. Fix comparison state and compatibility (R1–R2).
3. Fix recovery and remaining layout/copy/accessibility problems (R3–R6, R9).
4. Strengthen invariants and snapshot isolation (R7–R8); confirm edge-case semantics before changes.
5. Perform the small cleanup and documentation reconciliation, then rerun validation.
