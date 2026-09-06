import type { Micros } from "../contracts";
import { compareByBidDesc } from "./scoring";

export interface Finalist {
  campaignId: string;
  bidMicros: Micros;
  remainingMicros: Micros;
}

export interface AuctionEntrant extends Finalist {
  /** min(bid, remaining budget): a campaign can never be charged more than it can pay. */
  effectiveBidMicros: Micros;
  participates: boolean;
}

export interface AuctionResult {
  /** Every finalist with its effective bid, ordered by effective bid descending then campaign id. */
  entrants: AuctionEntrant[];
  participants: AuctionEntrant[];
  winnerCampaignId: string | null;
  runnerUpCampaignId: string | null;
  /** Clearing price charged to the winner; 0 when there is no winner. */
  priceMicros: Micros;
}

export function effectiveBid(bidMicros: Micros, remainingMicros: Micros): Micros {
  return Math.min(bidMicros, remainingMicros);
}

/**
 * Single-slot second-price auction.
 *
 * Only finalists whose effective bid reaches the reserve participate, so a campaign excluded earlier can
 * neither win nor support the price. The winner is the highest effective bid (ties by campaign id) and pays
 * `max(reserve, second-highest effective bid)`. A sole participant pays the reserve; no participants means no
 * winner and zero spend. The price never exceeds the winner's effective bid, so balances stay non-negative.
 */
export function runAuction(finalists: Finalist[], reserveMicros: Micros): AuctionResult {
  if (!(reserveMicros > 0)) throw new RangeError("reserve must be positive");

  const entrants: AuctionEntrant[] = finalists
    .map((finalist) => {
      const bid = effectiveBid(finalist.bidMicros, finalist.remainingMicros);
      return { ...finalist, effectiveBidMicros: bid, participates: bid >= reserveMicros };
    })
    .sort(compareByBidDesc);

  const participants = entrants.filter((entrant) => entrant.participates);
  if (participants.length === 0) {
    return { entrants, participants, winnerCampaignId: null, runnerUpCampaignId: null, priceMicros: 0 };
  }

  const winner = participants[0];
  const runnerUp = participants[1] ?? null;
  const priceMicros = Math.max(reserveMicros, runnerUp ? runnerUp.effectiveBidMicros : 0);

  return {
    entrants,
    participants,
    winnerCampaignId: winner.campaignId,
    runnerUpCampaignId: runnerUp ? runnerUp.campaignId : null,
    priceMicros,
  };
}
