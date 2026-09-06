"use client";

import { useEffect, useRef } from "react";
import type { CandidateTrace, RequestTrace, ScenarioSummary } from "../../lib/contracts";
import { money, sessionTime } from "./playback";

const outcomes: Record<CandidateTrace["outcome"], string> = {
  won: "Won impression", lost: "Lost auction", excluded_budget: "Insufficient budget",
  excluded_pacing: "Skipped by pacing", excluded_threshold: "Below score threshold",
  excluded_shortlist: "Outside top ranks", excluded_reserve: "Below reserve",
};

export function RequestSheet({ trace, scenario, onClose, preview = false }: {
  trace: RequestTrace; scenario: ScenarioSummary; onClose: () => void; preview?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, []);
  const name = (id: string | null) => scenario.campaigns.find(c => c.id === id)?.name ?? id ?? "None";
  return (
    <dialog ref={dialogRef} className="request-sheet" aria-labelledby="request-heading"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sheet-inner">
        <header className="sheet-header">
          <div><p className="eyebrow">Inside one request · {trace.requestId}</p><h2 id="request-heading">{trace.query ?? trace.category}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close request details" autoFocus>✕</button>
        </header>
        <p className="muted">Session {sessionTime(trace.timestampMs)} · {scenario.users.find(u => u.id === trace.userId)?.name ?? trace.userId} · {trace.category}</p>
        {preview && <p className="notice compact">Hand-authored walkthrough, not a recorded engine run.</p>}
        <div className="request-result">
          <span className="eyebrow">{trace.filled ? "Impression awarded" : "No ad served"}</span>
          <h3>{name(trace.winnerCampaignId)}</h3>
          <p>{trace.filled ? <><strong>{money(trace.priceMicros)}</strong> charged for this impression</> : "No eligible auction participant; no charge."}</p>
          <p className="muted">{trace.runnerUpCampaignId ? `${name(trace.runnerUpCampaignId)} was the runner-up and supported the price.` : trace.filled ? `Only one bidder participated, so the ${money(scenario.config.reserveMicros)} reserve set the price.` : "An empty auction is a valid outcome."}</p>
        </div>
        <ol className="funnel-summary">
          <li><b>{trace.retrievedCount}</b><span>Category matches</span></li>
          <li><b>{trace.shortlist.length}</b><span>Ranked finalists</span></li>
          <li><b>{trace.participantCount}</b><span>Auction bidders</span></li>
        </ol>
        <p className="muted small">Score threshold ≥ {scenario.config.scoreThreshold} · Top {scenario.config.shortlistSize} qualify · Bids and prices are per impression.</p>
        <h3 className="section-title">Follow each campaign</h3>
        {trace.candidates.map(candidate => (
          <details className="candidate-card" key={candidate.campaignId} open={candidate.outcome === "won"}>
            <summary><span><strong>{name(candidate.campaignId)}</strong><small>{candidate.objective} objective</small></span>
              <span className={`badge ${candidate.outcome === "won" ? "green" : "neutral"}`}>{outcomes[candidate.outcome]}</span></summary>
            <dl className="trace-facts">
              <div><dt>1. Budget eligibility</dt><dd>{money(candidate.budgetBeforeMicros)} available · reserve {money(candidate.eligibility.reserveMicros)} · {candidate.eligibility.passed ? "passed" : "excluded"}</dd></div>
              <div><dt>2. Pacing</dt><dd>{candidate.pacing.evaluated ? <>
                {candidate.pacing.pacingEnabled ? `${Math.round(candidate.pacing.probability * 100)}% admission chance` : "Off · 100% admission chance"} · {candidate.pacing.admitted ? "admitted" : "skipped"}
                <small>Spend {money(candidate.pacing.spendSoFarMicros)} / target {money(candidate.pacing.targetMicros)}{!preview && ` · draw ${candidate.pacing.draw.toFixed(4)}`}</small>
              </> : "Not evaluated: excluded earlier"}</dd></div>
              <div><dt>3. Ranking score</dt><dd>{candidate.scoring.evaluated ? <>
                {candidate.scoring.base.toFixed(2)} objective base × {candidate.scoring.relevance.toFixed(2)} user relevance = <strong>{candidate.scoring.score.toFixed(3)}</strong>
                <small>{!candidate.scoring.passedThreshold ? "Below threshold" : candidate.scoring.shortlisted ? `Rank ${candidate.scoring.rank} · shortlisted` : `Rank ${candidate.scoring.rank} · outside shortlist`}</small>
              </> : "Not evaluated: excluded earlier"}</dd></div>
              <div><dt>4. Auction</dt><dd>{candidate.auction.evaluated ? <>
                Bid {money(candidate.bidMicros)} · effective bid {money(candidate.auction.effectiveBidMicros)}
                <small>{candidate.auction.participates ? candidate.auction.role === "runner_up" ? "Runner-up · supports the clearing price" : candidate.auction.role === "winner" ? "Highest effective bid · winner" : "Participated · did not set price" : "Below reserve · did not participate"}</small>
              </> : "Not evaluated: did not reach the auction"}</dd></div>
              <div><dt>5. Budget update</dt><dd>{money(candidate.budgetBeforeMicros)} → {money(candidate.budgetAfterMicros)}<small>{money(candidate.budgetBeforeMicros - candidate.budgetAfterMicros)} charged</small></dd></div>
            </dl>
          </details>
        ))}
        <p className="sheet-footnote">Ranking decides who reaches the auction. Bids decide who wins. Only campaigns eligible to win can support the price.</p>
      </div>
    </dialog>
  );
}
