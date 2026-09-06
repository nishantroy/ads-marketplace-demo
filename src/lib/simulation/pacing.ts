import type { Micros } from "../contracts";
import { stableRandom } from "./hash";

export interface PacingDecision {
  /** budget * elapsed / duration, fractional micros. */
  targetMicros: number;
  spendSoFarMicros: Micros;
  probability: number;
  draw: number;
  admitted: boolean;
}

export interface PacingInput {
  seed: string;
  requestId: string;
  campaignId: string;
  timestampMs: number;
  sessionDurationMs: number;
  budgetMicros: Micros;
  spendSoFarMicros: Micros;
  bidMicros: Micros;
  pacingEnabled: boolean;
}

/**
 * Linear spend target for the elapsed part of the session. Fractional on purpose: only charges are integers.
 */
export function pacingTarget(budgetMicros: Micros, timestampMs: number, sessionDurationMs: number): number {
  return (budgetMicros * timestampMs) / sessionDurationMs;
}

/**
 * Admission probability: how far behind the linear target the campaign is, measured in bids.
 * Pacing off is probability 1. At t = 0 the target is 0, so nothing is admitted while pacing is on.
 */
export function admissionProbability(
  targetMicros: number,
  spendSoFarMicros: Micros,
  bidMicros: Micros,
  pacingEnabled: boolean,
): number {
  if (!pacingEnabled) return 1;
  if (!(bidMicros > 0)) throw new RangeError("bid must be positive to compute a pacing probability");
  const raw = (targetMicros - spendSoFarMicros) / bidMicros;
  return Math.min(1, Math.max(0, raw));
}

/**
 * Pacing admission for one candidate. The draw is keyed by (seed, request, campaign) so it never depends on
 * evaluation order or on a shared random stream.
 */
export function decidePacing(input: PacingInput): PacingDecision {
  const targetMicros = pacingTarget(input.budgetMicros, input.timestampMs, input.sessionDurationMs);
  const probability = admissionProbability(
    targetMicros,
    input.spendSoFarMicros,
    input.bidMicros,
    input.pacingEnabled,
  );
  const draw = stableRandom(input.seed, input.requestId, input.campaignId, "pacing");
  return {
    targetMicros,
    spendSoFarMicros: input.spendSoFarMicros,
    probability,
    draw,
    admitted: draw < probability,
  };
}
