# UI design principles

These are **UI and interaction design principles**, not changes to the simulation model or engine architecture. All agents changing screens, charts, controls, copy, or interactions must follow them alongside `IMPLEMENTATION_PLAN.md`. Ask the human before making a consequential exception.

## Audience and learning goal

Design for someone unfamiliar with both ads and recommendation systems. Help them understand candidate generation → ranking → auction, then explore how pacing changes spending and auction competition over a six-hour session. The interface is a guided experiment, not an expert ad-operations dashboard.

## 1. Lead with one question

“What changes when advertisers spread their spending over time?”

- Make the intended journey clear: run without pacing → run with pacing → compare → inspect an example.
- Give one action visual priority at each step. Keep configuration secondary.
- Keep preview-only limitations explicit; do not make unavailable actions look functional.

## 2. Reveal complexity progressively

Use three levels, rather than displaying every metric and explanation at once:

1. **Overview:** marketplace revenue, playback, and a secondary individual-campaign spending view.
2. **Explanation:** competition and impression-price charts, revealed when the user asks why.
3. **Evidence:** a request's funnel and campaign decisions; exact scores, draws, formulas, and budget arithmetic only on expansion.

Scenario settings, formulas, run metadata, and long guides start collapsed. Never require opening implementation details to understand the headline lesson. Hide secondary material behind descriptive labels, not cryptic icons. Do not nest essential navigation inside several disclosures.

## 3. Connect outcomes to causes

Explain the chain: budget runs out → campaign leaves → fewer bidders → potentially cheaper impressions.

- A chart title should tell the user what question it answers.
- Separate observed facts from possible effects. Pacing does not guarantee more revenue or stronger competition at every moment.
- Keep an accessible path from aggregate outcomes to concrete request evidence.
- Do not add causal claims or explanatory statistics the recorded data cannot support.

## 4. Make comparisons honest and easy

- Compare only matching input snapshots and engine versions, with opposite pacing modes.
- Use a shared time cursor, selected campaign, units, and axis scales for paired views.
- Label modes explicitly and consistently; never rely on color alone or imply that paced results are automatically better.
- Separate cumulative totals from interval averages and final-run totals from the current playback state.
- Empty observations are gaps, not zero prices. Do not interpolate activity where none was recorded.

## 5. Make motion serve understanding

- Keep clock, play/pause, scrubber, and speed together. Opening request details pauses playback.
- Reveal recorded results only through the cursor; browser animation never reruns auctions.
- Keep the time domain fixed. Prefer stable, input-derived value-axis bounds for cumulative spending; avoid distracting auto-zoom during playback.
- Avoid decorative transitions, honor reduced motion, and keep playback usable without animation.

## 6. Lead with plain language; offer the math

- Say “Skipped to preserve budget,” “Below the minimum score,” or “Runner-up set the price” before exposing fields and formulas.
- Use campaign names, explicit monetary units, and concise contextual help.
- Ranking score is not a bid. All objectives pay per impression. A loser can support a price, but a paced-out campaign cannot.
- User category relevance affects threshold eligibility, not within-request ordering in this model.

## Practical UI defaults

- One dominant marketplace revenue chart; campaign spending is secondary, not a competing dashboard tile.
- Competition charts and the request explorer are collapsed until requested.
- Make request details a connected funnel: category matches → budget eligibility → pacing admission → ranking finalists → auction → winner. Show counts and plain-language attrition at each stage; stage expansion reveals campaign decisions. Distinguish threshold failures from shortlist cuts, and never count an earlier exclusion as a later-stage failure.
- Show the auction's recorded winner, runner-up, and effective bids, then explain the clearing price at the final step. Keep candidate formulas and arithmetic in a separate collapsed implementation section, including the winner's arithmetic.
- Prefer whitespace and clear headings over more cards, badges, borders, or decorative text.
- Keep controls keyboard-operable, focus visible, dialog dismissal predictable, and narrow layouts readable.
- Theme/color polish is secondary to hierarchy and the working prototype; no new product features are implied by these principles.

## UI stack

- Next.js App Router, React, TypeScript, existing CSS/Tailwind setup.
- **amCharts 5** for time-series charts (replaces Recharts at the human's request).
- Create charts only in the browser, update their data without recreating roots on every playback tick, and dispose roots on unmount.
- Keep amCharts branding intact unless an appropriate license is supplied. Review its license before public release; do not hide the logo or invent a license key.
- No new UI framework or component kit is selected by this decision.

## Lightweight review checklist

- Is there an obvious next action and a clear primary chart?
- Can a newcomer follow the high-level explanation without seeing a formula?
- Can a curious user reach the underlying request and arithmetic?
- Are mode, time window, units, and preview status unambiguous?
- Have we avoided asserting that pacing must win?

For this prototype, prioritize functionality and human visual review. Automated UI/playback testing is deferred; continue basic typecheck, lint, and build validation.

## Guided narrative interaction pattern (confirmed 2026-09-06)

This section supersedes the toggle-and-run-button pattern described in "Practical UI defaults" and in M4's
shipped task list. It does not change the simulation model, the API, or what data is available — only how
the workspace sequences and presents it. Brainstormed and confirmed with the human; not yet implemented.

### Remove the run decision point

Do not ask the user to choose a pacing mode and press Run. Both modes are computed automatically together,
with no user action required: on first load, and again after a reset. There is no pacing toggle and no Run
button in the redesigned workspace. This removes the single biggest "which button do I press first" choice
without losing anything, since computing both 4,000-request modes takes a fraction of a second.

### A short guided sequence, not a dashboard

Present the workspace as a small number of steps, advanced by a Next/Back click, not by scroll-hijacking or
auto-advancing animation:

1. **Intro** — one short framing card: the question this demo answers ("what changes when advertisers
   spread their spending over time?") and what to watch for. Skippable and non-blocking; a returning user
   should never have to click through it to reach the workspace.
2. **Unpaced unfolds** — the pacing-off run's primary chart plays out alone, so the learner first sees the
   baseline behavior (budgets front-load, the market can go quiet late) without a second series competing
   for attention.
3. **Paced unfolds** — the pacing-on run is introduced on the same chart, so the learner sees the same
   story with one variable changed.
4. **Comparison** — both series shown together for the full session, with the delta called out in plain
   language (following principle 3, connect outcome to cause).
5. **Explore** — the guided sequence ends here and hands off to free exploration: scrub, change speed,
   select a campaign, inspect a request. Nothing is locked behind the sequence; a user can jump to Explore
   at any time instead of stepping through.

Both runs are computed before step 1 begins; the steps control what is *revealed*, not what is *computed*.
This keeps the pedagogical sequencing (introduce one variable at a time) without reintroducing a decision
point or a wait.

### Charts: one primary, split secondary comparisons

The primary chart (marketplace revenue/spend) shows both modes as two synced lines on one chart, sharing an
axis and cursor, per principle 4 — never two separate panels for this one.

Two more paired time series, each shown as its own synced-pair chart, are needed to explain *why* revenue
differs and are revealed progressively (principle 2's "Explanation" tier, opened on request rather than
shown by default):

- **Competing campaigns** — participant count per bucket, off vs. on, so a learner can see pacing narrowing
  or widening the field over the session.
- **Clearing price** — average price per filled impression per bucket, off vs. on, distinguishing empty
  buckets from a zero price per the existing rule.

All three charts share the same time cursor once both runs exist, so scrubbing moves all of them together.

### Request inspection stays side by side, not overlaid

When a learner inspects a request at a given moment, show two funnel panels at the same cursor position —
one per pacing mode — rather than a single funnel with a mode switch. The interesting content is often "the
same moment played out differently," which reads more clearly as two panels than as one panel toggled.

### Shared cursor in Explore

From the comparison step onward (including Explore), one time cursor scrubs both runs' timelines together.
Scrubbing shows how each mode performs at the same simulated moment side by side, rather than requiring the
user to scrub each mode's timeline separately.
