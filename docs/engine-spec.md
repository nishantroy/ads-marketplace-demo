# Engine specification (M0, frozen)

Numeric and ordering details that the plan leaves to M0. Types live in `src/lib/contracts/`; helpers in `src/lib/simulation/`.

## Money and bounds

- Every amount is an integer number of microdollars (`1_000_000` = $1). Amounts must lie in `[0, 1e15]`.
- Bids, budgets, and the reserve must be positive. Pacing targets and probabilities are fractional; charges and balances are integers.

## Time

- Session duration is 6 h (`21_600_000` ms); bucket width is 5 min (`300_000` ms), giving 72 buckets.
- Request timestamps are in `[0, sessionDurationMs)`. Requests are processed in ascending `(timestampMs, id)` order.
- Bucket `i` covers `[i * bucket, (i + 1) * bucket)`. Cumulative series are reported at bucket end, so the 72nd bucket is the 6 h closing point.

## Scores

```text
impression: base = quality_prior                (seeded per campaign, in (0, 1])
click:      base = historical_ctr / ctr_scale
conversion: base = historical_cvr / cvr_scale   (per-impression conversion rate)
score      = clamp(base, 0, 1) * user_relevance[category]
```

Scales are scenario constants. A candidate qualifies when `score >= scoreThreshold`. Qualified candidates are ranked by score descending, ties by campaign id ascending; the top `shortlistSize` (4) proceed.

Because relevance is shared by all candidates in a request, ranking order within a category is identical for every request; only the threshold cut varies by user.

## Pacing

```text
target      = budget * timestampMs / sessionDurationMs
probability = pacingEnabled ? clamp((target - spend) / bid, 0, 1) : 1
draw        = stableRandom(seed, requestId, campaignId, "pacing")
admitted    = draw < probability
```

`stableRandom` = murmur3 fmix32(FNV-1a 32 over `"${seed}|${requestId}|${campaignId}|pacing"`) / 2^32, in `[0, 1)`. At `t = 0` with pacing on, target is 0 so nothing is admitted.

## Eligibility, auction, accounting

1. Retrieve campaigns with `campaign.category === request.category`.
2. Exclude when `remaining < reserve` (outcome `excluded_budget`).
3. Pacing admission (outcome `excluded_pacing`).
4. Score, threshold (`excluded_threshold`), shortlist (`excluded_shortlist`).
5. `effectiveBid = min(bid, remaining)`; finalists with `effectiveBid >= reserve` participate; others `excluded_reserve` (unreachable after step 2 but recorded for completeness).
6. Winner = highest effective bid, ties by campaign id ascending. Price = `max(reserve, second-highest effective bid)`; a sole participant pays the reserve. No participants means no winner and price 0.
7. Deduct the price from the winner's balance. Invariant: price <= winner's effective bid <= remaining budget, so balances never go negative.

## Comparability

`inputHash` = digest of the sorted-key JSON of the full snapshot (mode excluded). Runs are comparable only when `inputHash` and `engineVersion` match.
