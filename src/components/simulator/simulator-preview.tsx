"use client";

import { useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { RequestTrace } from "../../lib/contracts";
import { previewRun, previewScenario as scenario, previewTimeline, previewTraces } from "./preview-data";
import { money, playbackFrame, sessionTime } from "./playback";
const TimelineChart = dynamic(() => import("./timeline-chart").then(module => module.TimelineChart), {
  ssr: false,
  loading: () => <div className="timeline-chart chart-loading">Loading chart…</div>,
});
import { RequestSheet } from "./request-sheet";

/** Temporary UI entry point. Replace preview loading with API responses during integration. */
export function SimulatorPreview() {
  const [loaded, setLoaded] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [nextPacing, setNextPacing] = useState(false);
  const [campaignId, setCampaignId] = useState(scenario.campaigns[0].id);
  const [selectedTrace, setSelectedTrace] = useState<RequestTrace | null>(null);
  const [page, setPage] = useState(0);
  const timeline = loaded ? previewTimeline : [];
  const isPlaying = playing && cursor < timeline.length;

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => setCursor(value => Math.min(value + 1, timeline.length)), 1000 / speed);
    return () => window.clearInterval(timer);
  }, [isPlaying, speed, timeline.length]);

  const frame = playbackFrame(timeline, cursor);
  const campaign = scenario.campaigns.find(c => c.id === campaignId)!;
  const campaignMetrics = frame.latest?.campaigns.find(c => c.campaignId === campaignId);
  const visibleRequests = loaded ? previewTraces.filter(t => t.timestampMs < frame.cutoffMs) : [];
  const pageSize = 3;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(visibleRequests.length / pageSize) - 1));
  const rows = visibleRequests.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const campaignName = (id: string | null) => scenario.campaigns.find(c => c.id === id)?.name ?? "No ad served";
  const duration = scenario.config.sessionDurationMs;
  const revenuePoints = [{ time: 0, value: 0 }, ...frame.visible.map(b => ({ time: b.endMs, value: b.cumulativeRevenueMicros }))];
  const campaignPoints = [{ time: 0, value: 0, target: 0 }, ...frame.visible.map(b => {
    const metrics = b.campaigns.find(c => c.campaignId === campaignId);
    return { time: b.endMs, value: metrics?.cumulativeSpendMicros ?? 0, target: metrics?.targetMicros ?? 0 };
  })];

  function seek(value: number) {
    setCursor(value); setPlaying(false); setPage(0); setSelectedTrace(null);
  }

  function loadExample() {
    setLoaded(true); setCursor(1); setPlaying(false); setPage(0); setSelectedTrace(null);
  }

  function resetPreview() {
    setLoaded(false); setCursor(0); setPlaying(false); setNextPacing(false);
    setCampaignId(scenario.campaigns[0].id); setPage(0); setSelectedTrace(null);
  }

  return (
    <div className="simulator-app">
      <a href="#workspace" className="skip-link">Skip to simulator</a>
      <header className="app-header">
        <Link className="brand" href="/" aria-label="Ad Market Lab home"><span className="brand-mark" aria-hidden="true">▥</span><span>Ad Market <b>Lab</b></span></Link>
        <span className="header-divider" />
        <span className="header-description">A small marketplace. A closer look.</span>
        <a href="#demo-guide" className="guide-link">How to explore <span aria-hidden="true">↗</span></a>
      </header>
      <main id="workspace" className="workspace">
        <div className="page-heading"><div><p className="eyebrow">Search ads · marketplace simulator</p><h1>See where the ad dollars go.</h1>
          <p className="lede">What changes when advertisers spread their spending over time?</p></div><span className="badge neutral">Local prototype</span></div>
        <div className="notice" role="note"><strong>UI preview</strong><span>Four hand-authored requests from the tiny fixture—not a live simulation. The engine is being built separately. No pacing comparison or revenue uplift is implied.</span></div>

        <div className="workspace-grid">
          <aside className="sidebar">
            <section className="panel session-panel" aria-labelledby="session-title">
              <div className="experiment-bar">
                <div><h2 id="session-title">Explore the marketplace</h2><p className="small muted">6 hours · {scenario.requestCount} preview requests · one ad slot</p></div>
                <button className="button primary" onClick={loadExample}>Load unpaced walkthrough →</button>
              </div>
              <details className="settings-disclosure"><summary>Scenario & next-run settings</summary>
                <div className="settings-content">
                  <dl className="scenario-facts"><div><dt>Campaigns / users</dt><dd>{scenario.campaigns.length} / {scenario.users.length}</dd></div><div><dt>Category</dt><dd>Shoes</dd></div><div><dt>Minimum price</dt><dd>{money(scenario.config.reserveMicros)} per impression</dd></div></dl>
                  <div className="pacing-setting"><label className="switch-row" htmlFor="pacing-switch"><span><strong>Budget pacing</strong><small>For the next simulation</small></span><input id="pacing-switch" type="checkbox" role="switch" checked={nextPacing} onChange={e => setNextPacing(e.target.checked)} /></label><p>Preserve some budget for later by skipping opportunities.</p></div>
                  <div><button className="button secondary" disabled aria-describedby="engine-pending">Run simulation →</button><p id="engine-pending" className="small muted">Server execution is not connected. This setting does not change the preview.</p><button className="text-button" onClick={resetPreview}>Reset UI preview</button></div>
                </div>
              </details>
            </section>
          </aside>

          <div className="main-column">
            <section className="panel playback-panel" aria-labelledby="playback-title">
              <div className="section-heading"><div><p className="eyebrow">02 / Replay the session</p><h2 id="playback-title">Marketplace over time</h2></div><span className={`badge ${loaded ? "green" : "neutral"}`}>{loaded ? "Preview · pacing OFF" : "No run loaded"}</span></div>
              <div className="playback-controls"><button className="button primary" disabled={!loaded} onClick={() => { if (cursor === timeline.length) setCursor(0); setPlaying(!isPlaying); }} aria-label={isPlaying ? "Pause playback" : "Play playback"}>{isPlaying ? "Ⅱ Pause" : "▶ Play"}</button>
                <button className="icon-button" disabled={!loaded} onClick={() => seek(0)} aria-label="Restart playback">↺</button>
                <div className="clock"><strong>{sessionTime(frame.cutoffMs)}</strong><span> / 06:00 elapsed</span></div>
                <label className="speed-label">Speed <select value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={1}>1×</option><option value={4}>4×</option><option value={12}>12×</option></select></label>
              </div>
              <label className="sr-only" htmlFor="session-cursor">Completed five-minute playback buckets</label><input id="session-cursor" className="time-slider" type="range" min={0} max={previewTimeline.length} value={cursor} disabled={!loaded} onChange={e => seek(Number(e.target.value))} aria-valuetext={`${sessionTime(frame.cutoffMs)} elapsed`} />
              <div className="playback-caption"><span>00:00</span><span>{frame.requests} / {scenario.requestCount} requests replayed · five-minute steps</span><span>06:00</span></div>
            </section>

            {!loaded ? <section className="panel empty-state"><div className="empty-symbol" aria-hidden="true">↗</div><h2>Your marketplace, in motion.</h2><p>Load the four-request walkthrough to explore charts and inspect an auction while the simulation engine is under construction.</p><button className="button secondary" onClick={loadExample}>Explore the walkthrough →</button></section> : <>
              <section className="panel chart-panel hero-chart"><div className="section-heading"><div><h3>How much has the marketplace earned?</h3><p className="revenue-total">{money(frame.revenueMicros)}</p><p className="small muted">Cumulative revenue through {sessionTime(frame.cutoffMs)}</p></div><span className="legend"><i />Pacing off</span></div><TimelineChart points={revenuePoints} durationMs={duration} label="Cumulative revenue" maxValue={scenario.campaigns.reduce((sum, c) => sum + c.budgetMicros, 0)} cumulative /><p className="chart-caption">Every advertiser charge adds to marketplace revenue. Axis ceiling: total session budgets, not a forecast.</p></section>
              <Disclosure title="Follow one campaign" description="See how its spending tracks the session budget.">
                <section className="chart-panel"><div className="section-heading"><div><h3>Campaign spend</h3><label className="sr-only" htmlFor="campaign-select">Campaign to chart</label><select id="campaign-select" className="campaign-select" value={campaignId} onChange={e => setCampaignId(e.target.value)}>{scenario.campaigns.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></div><span className="badge neutral">{campaign.objective}</span></div><TimelineChart points={campaignPoints} durationMs={duration} label="Campaign spend" target maxValue={campaign.budgetMicros} cumulative /><p className="chart-caption">{money(campaignMetrics?.cumulativeSpendMicros ?? 0)} of {money(campaign.budgetMicros)} budget · Dashed line: linear target</p></section>
              </Disclosure>
              <Disclosure title="Why do impression prices change?" description="Explore auction competition and the price paid for an ad slot.">
                <p className="disclosure-intro">When bidders leave, the remaining winner may pay less. Pacing can preserve later competition, but does not guarantee higher revenue.</p>
                <div className="chart-grid small-charts"><section className="chart-panel"><h3>How many campaigns compete?</h3><p className="small muted">Average participants per request · each bucket</p><TimelineChart points={frame.visible.map(b => ({ time: b.endMs, value: b.avgParticipants }))} durationMs={duration} label="Auction participants" monetary={false} maxValue={scenario.config.shortlistSize} /></section><section className="chart-panel"><h3>What does an impression cost?</h3><p className="small muted">Average price over filled slots · each bucket</p><TimelineChart points={frame.visible.map(b => ({ time: b.endMs, value: b.avgClearingPriceMicros }))} durationMs={duration} label="Clearing price" maxValue={Math.max(...scenario.campaigns.map(c => c.bidMicros))} /></section></div>
                <p className="disclosure-intro small muted">Gaps mean no observations—not a zero price. This sparse walkthrough is not evidence of pacing effects.</p>
              </Disclosure>
              <Disclosure title="Inspect a request" description={`${visibleRequests.length} revealed requests · follow an ad from category match to auction winner.`}>
              <section className="requests-panel" aria-label="Request explorer"><div className="section-heading"><h3>Request explorer</h3><span className="small muted">Before {sessionTime(frame.cutoffMs)}</span></div>
                {rows.length === 0 ? <p className="table-empty">No requests revealed yet. Play or move the timeline forward.</p> : <div className="table-scroll"><table><thead><tr><th>Time / request</th><th>Search</th><th>Bidders</th><th>Winner / price</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{rows.map(trace => <tr key={trace.requestId}><td><strong className="mono">{sessionTime(trace.timestampMs)}</strong><small>{trace.requestId}</small></td><td><strong>{trace.query ?? trace.category}</strong><small>{trace.category} · {trace.userId}</small></td><td><span className="bidder-count">{trace.participantCount}</span></td><td><strong>{campaignName(trace.winnerCampaignId)}</strong><small>{trace.filled ? money(trace.priceMicros) : "No charge"}</small></td><td><button className="inspect-button" onClick={() => { setPlaying(false); setSelectedTrace(trace); }} aria-label={`Inspect request ${trace.requestId}`}>Inspect ↗</button></td></tr>)}</tbody></table></div>}
                <div className="table-footer"><span>{visibleRequests.length} requests revealed · {rows.length ? `page ${currentPage + 1} of ${Math.ceil(visibleRequests.length / pageSize)}` : "none yet"}</span><div><button className="text-button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><button className="text-button" disabled={(currentPage + 1) * pageSize >= visibleRequests.length} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
              </section>
              </Disclosure>
              <details className="run-metadata"><summary>Preview provenance & full-session totals</summary><p>Hand-authored M0 walkthrough · {previewRun.scenarioVersion} · not persisted</p><p>Full session (not current playback): {money(previewRun.summary!.revenueMicros)} revenue, {previewRun.summary!.filledRequests} filled requests. Pacing-on comparison becomes available after engine/API integration.</p><code>{previewRun.inputHash}</code></details>
            </>}
          </div>
        </div>
        <Disclosure title="How to explore this experiment" description="The high-level story, plus optional implementation details." id="demo-guide">
          <div className="guide-content"><ol><li><strong>Start without pacing.</strong> Watch spending build up, then inspect who wins and who sets the price.</li><li><strong>Replay with pacing once server runs are connected.</strong> Compare the same requests and budgets. Look for different spending patterns, not a guaranteed revenue increase.</li><li><strong>Ask why.</strong> Open the competition charts or a request to see how category matching, ranking, and the auction narrow the field.</li></ol><p>All objectives pay per impression. Ranking determines who reaches the auction; bids determine who wins.</p>
            <details className="formula"><summary>Implementation detail: the pacing formula</summary><code>target = budget × elapsed / duration<br />p = clamp((target − spent) / bid, 0, 1)</code><p>A fixed draw below p admits the campaign. Skipped campaigns cannot win or support prices.</p></details>
          </div>
        </Disclosure>
        <footer className="app-footer"><span>Ad Market Lab · Learn the mechanism, not a revenue promise.</span><span>One slot. Impression billing. Replayable inputs.</span></footer>
      </main>
      {selectedTrace && <RequestSheet trace={selectedTrace} scenario={scenario} onClose={() => setSelectedTrace(null)} preview />}
    </div>
  );
}

function Disclosure({ title, description, children, id }: { title: string; description: string; children: ReactNode; id?: string }) {
  const [open, setOpen] = useState(false);
  return <details className="panel explore-panel" id={id} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><strong>{title}</strong><span>{description}</span></summary>
    {open && children}
  </details>;
}
