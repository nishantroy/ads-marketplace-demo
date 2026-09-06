# Engine specification (M0, frozen)

Numeric and ordering details that the plan leaves to M0. Types live in `src/lib/contracts/`; helpers in `src/lib/simulation/`.

## Money and bounds

- Every amount is an integer number of microdollars (`1_000_000` = $1). Amounts must lie in `[0, 1e15]`.
- Bids, budgets, and the reserve must be positive. Pacing targets and probabilities are fractional; charges and balances are integers.

## Time

- Session duration is 6 h (`21_600_000` ms); bucket width is 5 min (`300_000` ms), giving 72 buckets.
- Request timestamps are in `[0, sessionDurationMs)`. Requests are processed in ascending `(timestampMs, id)` order.
- Bucket `i` covers `[i * bucket, (i + 1) * bucket)`. Cumulative series are reported at bucket end, so the 72nd bucket is the 6 h closing point.

## Quality, utility, and the gate

```text
impression: engagement = quality_prior                (seeded per campaign, in (0, 1])
click:      engagement = historical_ctr / ctr_scale
conversion: engagement = historical_cvr / cvr_scale   (per-impression conversion rate)

relevance = user_category_relevance[category] * campaign_affinity[user_segment]
quality   = clamp(engagement, 0, 1) * relevance
utility   = effective_bid * quality
```

Relevance is a property of the user-campaign pair, not of the category alone. Because a campaign's affinity
differs by segment, ranking order changes from request to request rather than being a fixed leaderboard.

`quality >= qualityThreshold` passes the gate. Survivors are ranked by utility descending, ties by campaign
id ascending, and the top `shortlistSize` (4) reach the auction. Quality decides participation; utility
decides order.

## Scales

Scales are scenario constants. `ctrScale` and `cvrScale` normalise historical rates onto a common [0, 1]
engagement axis so objectives are comparable.

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
4. Quality gate (`excluded_threshold`), then rank by utility and shortlist (`excluded_shortlist`).
5. `effectiveBid = min(bid, remaining)`; finalists with `effectiveBid >= reserve` participate; others
   `excluded_reserve` (unreachable after step 2 but recorded for completeness).
6. Winner = highest utility, ties by campaign id ascending. The winner pays the least it could have bid and
   still stayed ahead of the runner-up:

```text
price = clamp(round(runner_up_utility / winner_quality), reserve, winner_effective_bid)
```

   A sole participant pays the reserve. No participants means no winner and price 0.
7. Deduct the price from the winner's balance.

Because `winner_utility >= runner_up_utility`, the raw quotient never exceeds the winner's effective bid, so
balances cannot go negative; the clamp guards the floating-point division. Charging the runner-up's raw bid
instead would be incoherent here: the runner-up can outbid the winner, so the winner would be asked to pay
above its own maximum, and capping there would take the whole surplus every time quality decided the result.

Higher quality lowers the price for the same position, which is what makes quality worth having.

## Comparability

`inputHash` = digest of the sorted-key JSON of the full snapshot (mode excluded). Runs are comparable only when `inputHash` and `engineVersion` match.
