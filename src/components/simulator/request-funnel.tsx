import type { CandidateTrace, RequestTrace, ScenarioSummary } from "../../lib/contracts";
import { money } from "./playback";

interface StageRow { id: string; name: string; decision: string; passed: boolean }
interface Stage {
  title: string;
  explanation: string;
  entered?: number;
  survived: number;
  attrition: string;
  rows: StageRow[];
  auction?: boolean;
}

/** Presentation-only projection. Never rerun eligibility, scoring, pacing, or the auction here. */
export function RequestFunnel({ trace, scenario }: { trace: RequestTrace; scenario: ScenarioSummary }) {
  const name = (id: string | null) => scenario.campaigns.find(c => c.id === id)?.name ?? id ?? "None";
  const eligible = trace.candidates.filter(c => c.eligibility.passed);
  const pacingEvaluated = trace.candidates.filter(c => c.pacing.evaluated);
  const admitted = pacingEvaluated.filter(c => c.pacing.evaluated && c.pacing.admitted);
  const scored = trace.candidates.filter(c => c.scoring.evaluated);
  const finalists = trace.candidates.filter(c => c.scoring.evaluated && c.scoring.shortlisted);
  const participants = trace.candidates.filter(c => c.auction.evaluated && c.auction.participates);
  const belowThreshold = scored.filter(c => c.scoring.evaluated && !c.scoring.passedThreshold).length;
  const outsideShortlist = scored.filter(c => c.scoring.evaluated && c.scoring.passedThreshold && !c.scoring.shortlisted).length;
  const pacingOff = pacingEvaluated.length > 0 && pacingEvaluated.every(c => c.pacing.evaluated && !c.pacing.pacingEnabled);
  const row = (c: CandidateTrace, passed: boolean, decision: string): StageRow => ({ id: c.campaignId, name: name(c.campaignId), passed, decision });
  const noEntrants = "No campaigns reached this stage.";
  const stages: Stage[] = [
    {
      title: "Category matches", explanation: `Retrieve campaigns in “${trace.category},” the request's search category.`,
      survived: trace.retrievedCount, attrition: "Campaigns in other categories never enter this funnel.",
      rows: trace.candidates.map(c => row(c, true, "Retrieved · category match")),
    },
    {
      title: "Budget eligibility", explanation: "Keep campaigns that can still afford the minimum impression price.",
      entered: trace.candidates.length, survived: eligible.length,
      attrition: trace.candidates.length === 0 ? noEntrants : eligible.length === trace.candidates.length ? "All have enough budget to continue." : `${trace.candidates.length - eligible.length} removed · not enough budget.`,
      rows: trace.candidates.map(c => row(c, c.eligibility.passed, c.eligibility.passed ? "Continues · enough budget" : "Removed · cannot afford the minimum price")),
    },
    {
      title: "Pacing admission", explanation: pacingOff ? "Pacing is off, so it does not hold any campaign back." : "Pacing may skip this opportunity to preserve budget for later.",
      entered: pacingEvaluated.length, survived: admitted.length,
      attrition: pacingEvaluated.length === 0 ? noEntrants : admitted.length === pacingEvaluated.length ? "All admitted to ranking." : `${pacingEvaluated.length - admitted.length} skipped · no role in this auction or its price.`,
      rows: pacingEvaluated.map(c => row(c, c.pacing.evaluated && c.pacing.admitted, c.pacing.evaluated && c.pacing.admitted ? "Continues · admitted" : "Skipped to preserve budget")),
    },
    {
      title: "Ranking finalists", explanation: `Keep campaigns above the minimum score, then take the top ${scenario.config.shortlistSize}. A score is not a bid.`,
      entered: scored.length, survived: finalists.length,
      attrition: scored.length === 0 ? noEntrants : `${belowThreshold} below the minimum score · ${outsideShortlist} outside the top ${scenario.config.shortlistSize}.`,
      rows: scored.map(c => row(c, c.scoring.evaluated && c.scoring.shortlisted,
        c.scoring.evaluated && !c.scoring.passedThreshold ? "Removed · below the minimum score" : c.scoring.evaluated && c.scoring.shortlisted ? `Continues · rank ${c.scoring.rank}` : "Removed · outside the top ranks")),
    },
    {
      title: "Auction", explanation: "Highest effective bid wins. Every bidder shown here is eligible to win and support the price.",
      entered: finalists.length, survived: trace.participantCount, auction: true,
      attrition: finalists.length === 0 ? noEntrants : finalists.length === trace.participantCount ? "All finalists meet the minimum price." : `${finalists.length - trace.participantCount} removed · effective bid below the minimum price.`,
      rows: [],
    },
  ];
  const runnerUp = participants.find(c => c.campaignId === trace.runnerUpCampaignId);
  const runnerBid = runnerUp?.auction.evaluated ? runnerUp.auction.effectiveBidMicros : null;
  const orderedBidders = [...participants].sort((a, b) => {
    // Display the recorded winner/runner-up first, not a newly computed auction result.
    const roleOrder = (c: CandidateTrace) => c.campaignId === trace.winnerCampaignId ? 0 : c.campaignId === trace.runnerUpCampaignId ? 1 : 2;
    return roleOrder(a) - roleOrder(b);
  });
  const reserveExcluded = finalists.filter(c => c.auction.evaluated && !c.auction.participates);

  return <section className="request-journey" aria-labelledby="funnel-heading">
    <h3 id="funnel-heading">From search to one ad</h3>
    <p className="small muted">Follow the survivors. Expand any stage to see campaign decisions.</p>
    <ol className="funnel-stages">
      {stages.map((stage, index) => <li className="funnel-stage" key={stage.title}>
        <span className="stage-number" aria-hidden="true">{index + 1}</span>
        <details className="stage-card" open={stage.auction}>
          <summary>
            <span className="stage-heading"><strong>{stage.title}</strong><span className="stage-count">{stage.entered === undefined ? `${stage.survived} retrieved` : `${stage.entered} → ${stage.survived}`}</span></span>
            <span className="stage-description">{stage.explanation}</span>
            <span className="survivor-track" aria-hidden="true"><span style={{ width: `${trace.retrievedCount ? stage.survived / trace.retrievedCount * 100 : 0}%` }} /></span>
            <span className="stage-attrition">{stage.attrition}</span>
            <span className="stage-expand"><span className="when-closed">Show</span><span className="when-open">Hide</span> campaign decisions</span>
          </summary>
          {stage.auction ? <div className="stage-decisions">
            {orderedBidders.length === 0 ? <p className="small muted">No bids compete. No impression will be charged.</p> : <ul className="auction-bids">{orderedBidders.map(c => <li key={c.campaignId} className={c.campaignId === trace.winnerCampaignId ? "winning-bid" : ""}>
              <span><strong>{name(c.campaignId)}</strong><small>{c.campaignId === trace.winnerCampaignId ? "Winner · highest effective bid" : c.campaignId === trace.runnerUpCampaignId ? "Runner-up · price support" : "Eligible bidder · did not set price"}</small></span>
              <span className="auction-bid-value">{c.auction.evaluated ? money(c.auction.effectiveBidMicros) : "—"}<small>effective bid</small></span>
            </li>)}</ul>}
            {reserveExcluded.map(c => <p className="small muted" key={c.campaignId}>{name(c.campaignId)}: removed · effective bid below minimum price.</p>)}
            <p className="small muted">Effective bid is the smaller of the campaign’s bid and remaining budget. Losing bidders pay nothing.</p>
          </div> : <ul className="stage-decisions">{stage.rows.length === 0 ? <li className="small muted">{index === 0 ? "No matching campaigns retrieved." : "Not evaluated: all campaigns were excluded earlier."}</li> : stage.rows.map(c => <li className="stage-decision" key={c.id}>
            <strong>{c.name}</strong><span className={c.passed ? "decision-pass" : "decision-drop"}>{c.decision}</span>
          </li>)}</ul>}
        </details>
      </li>)}
      <li className="funnel-stage final-stage">
        <span className="stage-number" aria-hidden="true">6</span>
        <div className="request-result">
          <div className="stage-heading"><span className="eyebrow">{trace.filled ? "One impression awarded" : "No ad served"}</span><span className="stage-count">{trace.participantCount} → {trace.filled ? 1 : 0}</span></div>
          <h3>{name(trace.winnerCampaignId)}</h3>
          <p>{trace.filled ? <><strong>{money(trace.priceMicros)}</strong> charged for this impression</> : "No eligible auction participant; no charge."}</p>
          <p className="muted">{runnerBid !== null ? `${name(trace.runnerUpCampaignId)} supplied the runner-up bid of ${money(runnerBid)}. ${runnerBid > scenario.config.reserveMicros ? "That bid sets the price." : `The ${money(scenario.config.reserveMicros)} minimum price applies.`}` : trace.filled ? `Only one bidder participated, so the ${money(scenario.config.reserveMicros)} minimum price applies.` : "An empty auction is a valid outcome."}</p>
          {trace.filled && <p className="small muted">Only the winner’s budget is charged. The same amount becomes marketplace revenue.</p>}
        </div>
      </li>
    </ol>
    <p className="small muted">Counts show who entered and survived each stage; bars show survivors relative to category matches. Earlier exclusions do not count as failures again.</p>
  </section>;
}
