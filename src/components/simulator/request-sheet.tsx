"use client";

import { useEffect, useRef } from "react";
import type { CandidateTrace, RequestTrace, ScenarioSummary } from "../../lib/contracts";
import { money, sessionTime } from "./playback";
import { RequestFunnel } from "./request-funnel";

const outcomes: Record<CandidateTrace["outcome"], string> = {
  won: "Won impression", lost: "Lost auction", excluded_budget: "Insufficient budget",
  excluded_pacing: "Skipped by pacing", excluded_threshold: "Below minimum quality",
  excluded_shortlist: "Outside top ranks", excluded_reserve: "Below reserve",
};

/** One mode's funnel plus its optional implementation-detail arithmetic. */
function RequestColumn({ trace, scenario, label }: { trace: RequestTrace; scenario: ScenarioSummary; label: string }) {
  const name = (id: string | null) => scenario.campaigns.find(c => c.id === id)?.name ?? id ?? "None";
  return (
    <div className="request-column">
      <p className="eyebrow">{label}</p>
      <RequestFunnel trace={trace} scenario={scenario} />
      <details className="implementation-details">
        <summary>Curious about the implementation?</summary>
        <p className="small muted">Expand a campaign for its quality, pacing decision, ranking, and budget arithmetic. Minimum quality ≥ {scenario.config.qualityThreshold}. Bids and prices are per impression.</p>
        {trace.candidates.map(candidate => (
          <details className="candidate-card" key={candidate.campaignId}>
            <summary><span><strong>{name(candidate.campaignId)}</strong><small>{candidate.objective} objective</small></span>
              <span className={`badge ${candidate.outcome === "won" ? "green" : "neutral"}`}>{outcomes[candidate.outcome]}</span></summary>
            <dl className="trace-facts">
              <div><dt>1. Budget eligibility</dt><dd>{money(candidate.budgetBeforeMicros)} available · reserve {money(candidate.eligibility.reserveMicros)} · {candidate.eligibility.passed ? "passed" : "excluded"}</dd></div>
              <div><dt>2. Pacing</dt><dd>{candidate.pacing.evaluated ? <>
                {candidate.pacing.pacingEnabled ? `${Math.round(candidate.pacing.probability * 100)}% admission chance` : "Off · 100% admission chance"} · {candidate.pacing.admitted ? "admitted" : "skipped"}
                <small>Spend {money(candidate.pacing.spendSoFarMicros)} / target {money(candidate.pacing.targetMicros)} · draw {candidate.pacing.draw.toFixed(4)}</small>
              </> : "Not evaluated: excluded earlier"}</dd></div>
              <div><dt>3. Quality</dt><dd>{candidate.scoring.evaluated ? <>
                {candidate.scoring.base.toFixed(2)} engagement × {candidate.scoring.relevance.toFixed(2)} relevance (user × segment fit) = <strong>{candidate.scoring.quality.toFixed(3)}</strong>
                <small>{candidate.scoring.passedThreshold ? "Passed the minimum quality gate" : "Below the minimum quality gate"}</small>
              </> : "Not evaluated: excluded earlier"}</dd></div>
              <div><dt>4. Ranking (utility)</dt><dd>{candidate.ranking.evaluated ? <>
                effective bid {money(candidate.ranking.effectiveBidMicros)} × {candidate.scoring.evaluated ? candidate.scoring.quality.toFixed(3) : "—"} quality = utility {candidate.ranking.utility.toFixed(0)}
                <small>{candidate.ranking.shortlisted ? `Rank ${candidate.ranking.rank} by utility · shortlisted` : `Rank ${candidate.ranking.rank} by utility · outside shortlist`}</small>
              </> : "Not evaluated: excluded before ranking"}</dd></div>
              <div><dt>5. Auction</dt><dd>{candidate.auction.evaluated ? <>
                Bid {money(candidate.bidMicros)}{candidate.ranking.evaluated && <> · effective bid {money(candidate.ranking.effectiveBidMicros)}</>}
                <small>{candidate.auction.participates ? candidate.auction.role === "runner_up" ? "Runner-up · sets the winner's price via utility" : candidate.auction.role === "winner" ? "Highest utility · winner" : "Participated · did not set price" : "Below reserve · did not participate"}</small>
              </> : "Not evaluated: did not reach the auction"}</dd></div>
              <div><dt>6. Budget update</dt><dd>{money(candidate.budgetBeforeMicros)} → {money(candidate.budgetAfterMicros)}<small>{money(candidate.budgetBeforeMicros - candidate.budgetAfterMicros)} charged</small></dd></div>
            </dl>
          </details>
        ))}
      </details>
      <p className="sheet-footnote">Quality decides who reaches the auction. Utility — bid times quality — decides who wins, and the winner is charged a price that reflects its own quality. Only campaigns eligible to win can support the price.</p>
    </div>
  );
}

/** Side-by-side comparison: one column per pacing mode, at the same request. */
export function RequestSheet({ off, on, scenario, onClose }: {
  off: RequestTrace | null; on: RequestTrace | null; scenario: ScenarioSummary; onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const trace = off ?? on;
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
  if (!trace) return null;
  return (
    <dialog ref={dialogRef} className="request-sheet request-sheet-wide" aria-labelledby="request-heading"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sheet-inner">
        <header className="sheet-header">
          <div><p className="eyebrow">Inside one request · {trace.requestId}</p><h2 id="request-heading">{trace.query ?? trace.category}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close request details" autoFocus>✕</button>
        </header>
        <p className="muted">Session {sessionTime(trace.timestampMs)} · {scenario.users.find(u => u.id === trace.userId)?.name ?? trace.userId} · {trace.category}</p>
        <p className="small muted">Same request, both pacing modes. Compare which campaign wins and why.</p>
        <div className="request-columns">
          {off && <RequestColumn trace={off} scenario={scenario} label="Pacing off" />}
          {on && <RequestColumn trace={on} scenario={scenario} label="Pacing on" />}
        </div>
      </div>
    </dialog>
  );
}
