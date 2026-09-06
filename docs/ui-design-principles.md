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
