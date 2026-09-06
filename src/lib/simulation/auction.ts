import type { Micros } from "../contracts";
import { compareByUtilityDesc, utilityOf } from "./scoring";

export interface Finalist {
  campaignId: string;
  bidMicros: Micros;
  remainingMicros: Micros;
  /** Quality of this campaign for this request, in [0, 1]. */
  quality: number;
}

export interface AuctionEntrant extends Finalist {
  /** min(bid, remaining budget): a campaign can never be charged more than it can pay. */
  effectiveBidMicros: Micros;
  utility: number;
  participates: boolean;
}

export interface AuctionResult {
  /** Every finalist, ordered by utility descending then campaign id. */
  entrants: AuctionEntrant[];
  participants: AuctionEntrant[];
  winnerCampaignId: string | null;
  runnerUpCampaignId: string | null;
  /** Clearing price charged to the winner; 0 when there is no winner. */
  priceMicros: Micros;
  /** How the price was derived; null when the winner had no runner-up and paid the reserve. */
  priceBasis: { runnerUpUtility: number; winnerQuality: number } | null;
}

export function effectiveBid(bidMicros: Micros, remainingMicros: Micros): Micros {
  return Math.min(bidMicros, remainingMicros);
}

/**
 * Single-slot auction ranked by utility, priced by a quality-adjusted second price.
 *
 * The winner is the highest utility, not the highest bid, so a cheaper campaign that matches the user well
 * can beat an expensive one that does not. It pays the smallest bid that would still have kept it in front
 * of the runner-up:
 *
 *   price = max(reserve, runner_up_utility / winner_quality)
 *
 * That is what makes quality worth having. Charging the runner-up's raw bid instead would break here: the
 * runner-up may bid more than the winner, so the winner would be asked to pay above its own maximum, and
 * capping it there would hand the entire surplus to the platform every time quality decided the outcome.
 *
 * Because the winner's utility is at least the runner-up's, `runner_up_utility / winner_quality` never
 * exceeds the winner's effective bid, so a charge can never exceed a campaign's remaining budget. The
 * result is clamped to that bound anyway, since the division is floating point.
 *
 * A sole participant pays the reserve; no participants means no winner and zero spend.
 */
export function runAuction(finalists: Finalist[], reserveMicros: Micros): AuctionResult {
  if (!(reserveMicros > 0)) throw new RangeError("reserve must be positive");

  const entrants: AuctionEntrant[] = finalists
    .map((finalist) => {
      const bid = effectiveBid(finalist.bidMicros, finalist.remainingMicros);
      return {
        ...finalist,
        effectiveBidMicros: bid,
        utility: utilityOf(bid, finalist.quality),
        participates: bid >= reserveMicros,
      };
    })
    .sort(compareByUtilityDesc);

  const participants = entrants.filter((entrant) => entrant.participates);
  if (participants.length === 0) {
    return {
      entrants,
      participants,
      winnerCampaignId: null,
      runnerUpCampaignId: null,
      priceMicros: 0,
      priceBasis: null,
    };
  }

  const winner = participants[0];
  const runnerUp = participants[1] ?? null;

  if (!runnerUp) {
    return {
      entrants,
      participants,
      winnerCampaignId: winner.campaignId,
      runnerUpCampaignId: null,
      priceMicros: reserveMicros,
      priceBasis: null,
    };
  }

  const raw = winner.quality > 0 ? runnerUp.utility / winner.quality : winner.effectiveBidMicros;
  const priceMicros = Math.min(
    winner.effectiveBidMicros,
    Math.max(reserveMicros, Math.round(raw)),
  );

  return {
    entrants,
    participants,
    winnerCampaignId: winner.campaignId,
    runnerUpCampaignId: runnerUp.campaignId,
    priceMicros,
    priceBasis: { runnerUpUtility: runnerUp.utility, winnerQuality: winner.quality },
  };
}
