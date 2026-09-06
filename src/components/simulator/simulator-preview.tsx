"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { RequestTrace } from "../../lib/contracts";
import { previewRun, previewScenario as scenario, previewTimeline, previewTraces } from "./preview-data";
import { money, playbackFrame, sessionTime } from "./playback";
import { TimelineChart } from "./timeline-chart";
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
          <p className="lede">Follow one auction. Then zoom out to see what happens over six hours.</p></div><span className="badge neutral">Local prototype</span></div>
        <div className="notice" role="note"><strong>UI preview</strong><span>Four hand-authored requests from the tiny fixture—not a live simulation. The engine is being built separately. No pacing comparison or revenue uplift is implied.</span></div>

        <div className="workspace-grid">
          <aside className="sidebar">
            <section className="panel session-panel" aria-labelledby="session-title">
              <p className="eyebrow">01 / Set the scene</p><h2 id="session-title">The marketplace</h2>
              <dl className="scenario-facts"><div><dt>Session window</dt><dd>6 hours</dd></div><div><dt>Search requests</dt><dd>{scenario.requestCount} <span className="muted">(preview)</span></dd></div><div><dt>Campaigns / users</dt><dd>{scenario.campaigns.length} / {scenario.users.length}</dd></div><div><dt>Category</dt><dd>Shoes</dd></div><div><dt>Ad slots per request</dt><dd>1</dd></div><div><dt>Minimum price</dt><dd>{money(scenario.config.reserveMicros)}</dd></div></dl>
              <div className="pacing-setting"><label className="switch-row" htmlFor="pacing-switch"><span><strong>Budget pacing</strong><small>For the next simulation</small></span><input id="pacing-switch" type="checkbox" role="switch" checked={nextPacing} onChange={e => setNextPacing(e.target.checked)} /></label>
                <p>Skip some opportunities when spend is ahead of a straight-line budget target.</p>
                <details className="formula"><summary>How is the chance calculated?</summary><code>target = budget × elapsed / duration<br />p = clamp((target − spent) / bid, 0, 1)</code><p>A fixed draw below p admits the campaign. Skipped campaigns cannot win or support prices.</p></details>
              </div>
              <button className="button primary full-width" disabled aria-describedby="engine-pending">Run simulation <span aria-hidden="true">→</span></button>
              <p id="engine-pending" className="small muted">Server execution is not connected yet. This setting does not change the preview.</p>
              <button className="button secondary full-width" onClick={loadExample}>Load unpaced walkthrough</button>
              <button className="text-button full-width" onClick={resetPreview}>Reset UI preview</button>
            </section>
            <section className="guide-card" id="demo-guide" aria-labelledby="guide-title"><p className="eyebrow">A quick field guide</p><h2 id="guide-title">Three things to watch</h2>
              <ol><li><strong>Who reaches the auction?</strong><p>Category match, budget, pacing, and ranking narrow the field.</p></li><li><strong>Who sets the price?</strong><p>The runner-up can support the price without winning an impression.</p></li><li><strong>Who is still spending later?</strong><p>Pacing can preserve competition. Smoother spending does not guarantee more revenue.</p></li></ol>
              <p className="small">All objectives are billed per impression. No clicks or conversions are simulated.</p>
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
              <div className="playback-caption"><span>00:00</span><span>Five-minute steps · playback never changes results</span><span>06:00</span></div>
            </section>

            {!loaded ? <section className="panel empty-state"><div className="empty-symbol" aria-hidden="true">↗</div><h2>Your marketplace, in motion.</h2><p>Load the four-request walkthrough to explore charts and inspect an auction while the simulation engine is under construction.</p><button className="button secondary" onClick={loadExample}>Explore the walkthrough →</button></section> : <>
              <div className="stat-grid"><Metric title="Marketplace revenue" value={money(frame.revenueMicros)} detail="Cumulative through the cursor" /><Metric title="Requests replayed" value={`${frame.requests} / ${scenario.requestCount}`} detail={`${frame.filled} impressions served`} /><Metric title="Bidders per request" value={frame.latest?.avgParticipants?.toFixed(1) ?? "—"} detail="Latest bucket · — means no requests" /></div>
              <div className="chart-grid">
                <section className="panel chart-panel"><div className="section-heading"><div><h3>Marketplace revenue</h3><p className="small muted">Total campaign spend, accumulated</p></div><span className="legend"><i />Pacing off</span></div><TimelineChart points={revenuePoints} durationMs={duration} label="Cumulative revenue" /><p className="chart-caption">A charge to an advertiser is revenue for the marketplace.</p></section>
                <section className="panel chart-panel"><div className="section-heading"><div><h3>Campaign spend</h3><label className="sr-only" htmlFor="campaign-select">Campaign to chart</label><select id="campaign-select" className="campaign-select" value={campaignId} onChange={e => setCampaignId(e.target.value)}>{scenario.campaigns.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></div><span className="badge neutral">{campaign.objective}</span></div><TimelineChart points={campaignPoints} durationMs={duration} label="Campaign spend" target /><p className="chart-caption">{money(campaignMetrics?.cumulativeSpendMicros ?? 0)} of {money(campaign.budgetMicros)} budget · Dashed line: linear target</p></section>
              </div>
              <div className="chart-grid small-charts"><section className="panel chart-panel"><h3>Auction competition</h3><p className="small muted">Average participants per request · each bucket</p><TimelineChart points={frame.visible.map(b => ({ time: b.endMs, value: b.avgParticipants }))} durationMs={duration} label="Auction participants" monetary={false} /></section><section className="panel chart-panel"><h3>Price of an impression</h3><p className="small muted">Average clearing price over filled slots · each bucket</p><TimelineChart points={frame.visible.map(b => ({ time: b.endMs, value: b.avgClearingPriceMicros }))} durationMs={duration} label="Clearing price" /></section></div>
              <p className="small muted chart-note">Gaps mean no observations—not a zero price. This sparse walkthrough tests the UI; the seeded marketplace will contain thousands of requests.</p>
              <section className="panel requests-panel" aria-labelledby="requests-title"><div className="section-heading"><div><p className="eyebrow">03 / Look inside an auction</p><h2 id="requests-title">Request explorer</h2></div><span className="small muted">Before {sessionTime(frame.cutoffMs)}</span></div>
                {rows.length === 0 ? <p className="table-empty">No requests revealed yet. Play or move the timeline forward.</p> : <div className="table-scroll"><table><thead><tr><th>Time / request</th><th>Search</th><th>Bidders</th><th>Winner / price</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{rows.map(trace => <tr key={trace.requestId}><td><strong className="mono">{sessionTime(trace.timestampMs)}</strong><small>{trace.requestId}</small></td><td><strong>{trace.query ?? trace.category}</strong><small>{trace.category} · {trace.userId}</small></td><td><span className="bidder-count">{trace.participantCount}</span></td><td><strong>{campaignName(trace.winnerCampaignId)}</strong><small>{trace.filled ? money(trace.priceMicros) : "No charge"}</small></td><td><button className="inspect-button" onClick={() => { setPlaying(false); setSelectedTrace(trace); }} aria-label={`Inspect request ${trace.requestId}`}>Inspect ↗</button></td></tr>)}</tbody></table></div>}
                <div className="table-footer"><span>{visibleRequests.length} requests revealed · {rows.length ? `page ${currentPage + 1} of ${Math.ceil(visibleRequests.length / pageSize)}` : "none yet"}</span><div><button className="text-button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><button className="text-button" disabled={(currentPage + 1) * pageSize >= visibleRequests.length} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
              </section>
              <details className="run-metadata"><summary>Preview provenance & full-session totals</summary><p>Hand-authored M0 walkthrough · {previewRun.scenarioVersion} · not persisted</p><p>Full session (not current playback): {money(previewRun.summary!.revenueMicros)} revenue, {previewRun.summary!.filledRequests} filled requests. Pacing-on comparison becomes available after engine/API integration.</p><code>{previewRun.inputHash}</code></details>
            </>}
          </div>
        </div>
        <footer className="app-footer"><span>Ad Market Lab · Learn the mechanism, not a revenue promise.</span><span>One slot. Impression billing. Replayable inputs.</span></footer>
      </main>
      {selectedTrace && <RequestSheet trace={selectedTrace} scenario={scenario} onClose={() => setSelectedTrace(null)} preview />}
    </div>
  );
}

function Metric({ title, value, detail }: { title: string; value: string; detail: string }) {
  return <section className="panel metric"><p>{title}</p><strong>{value}</strong><span>{detail}</span></section>;
}
