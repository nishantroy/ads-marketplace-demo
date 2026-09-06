"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { ApiError, RequestListItem, RequestListResponse, RequestTrace, RunListResponse, RunRecord, ScenarioResponse, ScenarioSummary, TimelineBucket, TimelineResponse } from "../../lib/contracts";
import { money, playbackFrame, sessionTime } from "./playback";
import { RequestSheet } from "./request-sheet";

const TimelineChart = dynamic(() => import("./timeline-chart").then(module => module.TimelineChart), { ssr: false, loading: () => <div className="timeline-chart chart-loading">Loading chart…</div> });

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json() as T | ApiError;
  if (!response.ok) throw new Error((body as ApiError).error?.message ?? "Unable to reach the live demo.");
  return body as T;
}

export function SimulatorPreview() {
  const [scenario, setScenario] = useState<ScenarioSummary | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedMode, setSelectedMode] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [nextPacing, setNextPacing] = useState(false);
  const [timelines, setTimelines] = useState<Record<string, TimelineBucket[]>>({});
  const [requestPage, setRequestPage] = useState<RequestListResponse | null>(null);
  const [selectedTrace, setSelectedTrace] = useState<RequestTrace | null>(null);
  const [loading, setLoading] = useState<"initial" | "run" | "reset" | null>("initial");
  const [requestLoading, setRequestLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedRun = runs.find(run => run.pacingEnabled === selectedMode);
  const comparisonRun = runs.find(run => run.pacingEnabled !== selectedMode);
  const isComparable = Boolean(selectedRun && comparisonRun && selectedRun.inputHash === comparisonRun.inputHash && selectedRun.engineVersion === comparisonRun.engineVersion);
  const timeline = selectedRun ? timelines[selectedRun.id] ?? [] : [];
  const comparisonTimeline = isComparable && comparisonRun ? timelines[comparisonRun.id] ?? [] : undefined;
  const isPlaying = playing && cursor < timeline.length;
  const frame = playbackFrame(timeline, cursor);
  const duration = scenario?.config.sessionDurationMs ?? 0;
  const campaignId = scenario?.campaigns[0]?.id;
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | undefined>();
  const activeCampaignId = selectedCampaignId && scenario?.campaigns.some(c => c.id === selectedCampaignId) ? selectedCampaignId : campaignId;
  const campaign = scenario?.campaigns.find(c => c.id === activeCampaignId);
  const campaignMetrics = frame.latest?.campaigns.find(c => c.campaignId === activeCampaignId);

  const refresh = async () => {
    const [scenarioResponse, runResponse] = await Promise.all([api<ScenarioResponse>("/api/scenario"), api<RunListResponse>("/api/runs")]);
    setScenario(scenarioResponse.scenario); setRuns(runResponse.runs);
    const current = runResponse.runs.find(run => run.pacingEnabled === selectedMode) ?? runResponse.runs[0];
    if (current) setSelectedMode(current.pacingEnabled);
  };

  useEffect(() => { void refresh().catch(error => { setError(error.message); setLoading(null); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (loading === "initial" && scenario) setLoading(null); }, [loading, scenario]);
  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => setCursor(value => Math.min(value + 1, timeline.length)), 1000 / speed);
    return () => window.clearInterval(timer);
  }, [isPlaying, speed, timeline.length]);
  useEffect(() => { setCursor(0); setPlaying(false); setSelectedTrace(null); setRequestPage(null); }, [selectedRun?.id]);
  useEffect(() => {
    const targets = [selectedRun, isComparable ? comparisonRun : undefined].filter((run): run is RunRecord => Boolean(run && !timelines[run.id]));
    if (!targets.length) return;
    void Promise.all(targets.map(run => api<TimelineResponse>(`/api/runs/${run.id}/timeline`))).then(responses => {
      setTimelines(previous => ({ ...previous, ...Object.fromEntries(responses.map(response => [response.runId, response.buckets])) }));
    }).catch(error => setError(error.message));
  }, [selectedRun, comparisonRun, isComparable, timelines]);
  useEffect(() => {
    if (!selectedRun || frame.cutoffMs === 0) { setRequestPage(null); return; }
    let cancelled = false;
    setRequestLoading(true);
    void api<RequestListResponse>(`/api/runs/${selectedRun.id}/requests?limit=30&beforeMs=${frame.cutoffMs}`).then(page => {
      if (!cancelled) setRequestPage(page);
    }).catch(error => { if (!cancelled) setError(error.message); }).finally(() => { if (!cancelled) setRequestLoading(false); });
    return () => { cancelled = true; };
  }, [selectedRun, frame.cutoffMs]);

  const revenuePoints = [{ time: 0, value: 0 }, ...frame.visible.map(bucket => ({ time: bucket.endMs, value: bucket.cumulativeRevenueMicros }))];
  const comparisonRevenuePoints = comparisonTimeline ? [{ time: 0, value: 0 }, ...comparisonTimeline.slice(0, cursor).map(bucket => ({ time: bucket.endMs, value: bucket.cumulativeRevenueMicros }))] : undefined;
  const campaignPoints = [{ time: 0, value: 0, target: 0 }, ...frame.visible.map(bucket => {
    const metrics = bucket.campaigns.find(item => item.campaignId === activeCampaignId);
    return { time: bucket.endMs, value: metrics?.cumulativeSpendMicros ?? 0, target: metrics?.targetMicros ?? 0 };
  })];
  const comparisonCampaignPoints = comparisonTimeline ? [{ time: 0, value: 0 }, ...comparisonTimeline.slice(0, cursor).map(bucket => ({ time: bucket.endMs, value: bucket.campaigns.find(item => item.campaignId === activeCampaignId)?.cumulativeSpendMicros ?? 0 }))] : undefined;

  function seek(value: number) { setCursor(value); setPlaying(false); setSelectedTrace(null); }
  async function run(mode: boolean) {
    setLoading("run"); setError(null); setPlaying(false);
    try {
      const response = await api<{ run: RunRecord }>("/api/runs", { method: "POST", body: JSON.stringify({ pacingEnabled: mode }) });
      setRuns(previous => [...previous.filter(item => item.pacingEnabled !== mode), response.run].sort((a, b) => Number(a.pacingEnabled) - Number(b.pacingEnabled)));
      setTimelines(previous => { const next = { ...previous }; delete next[response.run.id]; return next; });
      setSelectedMode(mode); setNextPacing(mode);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to run the simulation."); }
    finally { setLoading(null); }
  }
  async function reset() {
    setLoading("reset"); setError(null); setPlaying(false);
    try {
      const response = await api<{ scenario: ScenarioSummary }>("/api/scenario/reset", { method: "POST", body: "{}" });
      setScenario(response.scenario); setRuns([]); setTimelines({}); setCursor(0); setRequestPage(null); setSelectedTrace(null);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to reset the demo."); }
    finally { setLoading(null); }
  }
  async function inspect(item: RequestListItem) {
    if (!selectedRun) return;
    setPlaying(false); setError(null);
    try { setSelectedTrace((await api<{ trace: RequestTrace }>(`/api/runs/${selectedRun.id}/requests/${item.requestId}`)).trace); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to load that request."); }
  }
  const campaignName = (id: string | null) => scenario?.campaigns.find(c => c.id === id)?.name ?? "No ad served";
  const modeName = (mode: boolean) => mode ? "Pacing on" : "Pacing off";
  const busy = loading !== null;

  return <div className="simulator-app">
    <a href="#workspace" className="skip-link">Skip to simulator</a>
    <header className="app-header"><Link className="brand" href="/" aria-label="Ad Market Lab home"><span className="brand-mark" aria-hidden="true">▥</span><span>Ad Market <b>Lab</b></span></Link><span className="header-divider" /><span className="header-description">A small marketplace. A closer look.</span><a href="#demo-guide" className="guide-link">How to explore <span aria-hidden="true">↗</span></a></header>
    <main id="workspace" className="workspace">
      <div className="page-heading"><div><p className="eyebrow">Search ads · marketplace simulator</p><h1>See where the ad dollars go.</h1><p className="lede">What changes when advertisers spread their spending over time?</p></div><span className="badge neutral">Live local demo</span></div>
      {error && <div className="notice error-notice" role="alert"><strong>Something needs attention</strong><span>{error}</span><button className="text-button" onClick={() => setError(null)}>Dismiss</button></div>}
      <div className="workspace-grid"><aside className="sidebar"><section className="panel session-panel" aria-labelledby="session-title"><div className="experiment-bar"><div><h2 id="session-title">Run the same marketplace twice</h2><p className="small muted">{scenario ? `${scenario.requestCount.toLocaleString()} requests · ${scenario.campaigns.length} campaigns · 6 hours` : "Loading scenario…"}</p></div><button className="button primary" disabled={busy || !scenario} onClick={() => run(nextPacing)}>{loading === "run" ? "Running…" : `Run with pacing ${nextPacing ? "on" : "off"} →`}</button></div>
        <details className="settings-disclosure"><summary>Scenario & next-run settings</summary><div className="settings-content"><dl className="scenario-facts"><div><dt>Campaigns / users</dt><dd>{scenario ? `${scenario.campaigns.length} / ${scenario.users.length}` : "—"}</dd></div><div><dt>Categories / segments</dt><dd>{scenario ? `${scenario.categories.length} / ${scenario.segments.length}` : "—"}</dd></div><div><dt>Minimum price</dt><dd>{scenario ? `${money(scenario.config.reserveMicros)} per impression` : "—"}</dd></div></dl><div className="pacing-setting"><label className="switch-row" htmlFor="pacing-switch"><span><strong>Budget pacing</strong><small>For the next run</small></span><input id="pacing-switch" type="checkbox" role="switch" checked={nextPacing} onChange={event => setNextPacing(event.target.checked)} /></label><p>Preserve some budget for later by skipping opportunities while ahead of target.</p></div><div><button className="button secondary" disabled={busy} onClick={() => void reset()}>{loading === "reset" ? "Resetting…" : "Reset live demo"}</button><p className="small muted">Reset clears both current results. A server restart also clears them.</p></div></div></details>
      </section></aside><div className="main-column"><section className="panel playback-panel" aria-labelledby="playback-title"><div className="section-heading"><div><p className="eyebrow">Replay the session</p><h2 id="playback-title">Marketplace over time</h2></div><span className={`badge ${selectedRun ? "green" : "neutral"}`}>{selectedRun ? modeName(selectedRun.pacingEnabled) : "No result yet"}</span></div>
        <div className="mode-switch" aria-label="Result to view"><button className={selectedMode === false ? "active" : ""} disabled={!runs.some(run => !run.pacingEnabled)} onClick={() => setSelectedMode(false)}>Pacing off</button><button className={selectedMode === true ? "active" : ""} disabled={!runs.some(run => run.pacingEnabled)} onClick={() => setSelectedMode(true)}>Pacing on</button>{isComparable && <span>Same inputs · shared cursor</span>}</div>
        <div className="playback-controls"><button className="button primary" disabled={!selectedRun || !timeline.length} onClick={() => { if (cursor === timeline.length) setCursor(0); setPlaying(value => !value); }}>{isPlaying ? "Ⅱ Pause" : "▶ Play"}</button><button className="icon-button" disabled={!selectedRun} onClick={() => seek(0)} aria-label="Restart playback">↺</button><div className="clock"><strong>{sessionTime(frame.cutoffMs)}</strong><span> / 06:00 elapsed</span></div><label className="speed-label">Speed <select value={speed} onChange={event => setSpeed(Number(event.target.value))}><option value={1}>1×</option><option value={4}>4×</option><option value={12}>12×</option></select></label></div>
        <input aria-label="Completed five-minute playback buckets" className="time-slider" type="range" min={0} max={timeline.length} value={cursor} disabled={!selectedRun} onChange={event => seek(Number(event.target.value))} /><div className="playback-caption"><span>00:00</span><span>{frame.requests.toLocaleString()} / {scenario?.requestCount.toLocaleString() ?? "—"} requests replayed · five-minute steps</span><span>06:00</span></div>
      </section>
      {!selectedRun ? <section className="panel empty-state"><div className="empty-symbol" aria-hidden="true">↗</div><h2>Run without pacing first.</h2><p>Then switch pacing on and run the identical marketplace again. The charts will compare the two current results at the same simulated time.</p><button className="button secondary" disabled={busy || !scenario} onClick={() => void run(false)}>Run without pacing →</button></section> : <>
        <section className="panel chart-panel hero-chart"><div className="section-heading"><div><h3>How much has the marketplace earned?</h3><p className="revenue-total">{money(frame.revenueMicros)}</p><p className="small muted">{modeName(selectedMode)} · cumulative through {sessionTime(frame.cutoffMs)}</p></div><span className="legend"><i />Solid: {modeName(selectedMode)}{isComparable && " · dashed: other mode"}</span></div><TimelineChart points={revenuePoints} comparisonPoints={comparisonRevenuePoints} durationMs={duration} label={modeName(selectedMode)} comparisonLabel={isComparable ? modeName(!selectedMode) : undefined} maxValue={scenario!.campaigns.reduce((sum, campaign) => sum + campaign.budgetMicros, 0)} cumulative /><p className="chart-caption">Every advertiser charge adds to marketplace revenue. Both modes use the same request stream; pacing does not promise more revenue.</p></section>
        <Disclosure title="Follow one campaign" description="See how its spend tracks the same budget in each mode."><section className="chart-panel"><div className="section-heading"><div><h3>Campaign spend</h3><select aria-label="Campaign to chart" className="campaign-select" value={activeCampaignId} onChange={event => setSelectedCampaignId(event.target.value)}>{scenario!.campaigns.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></div><span className="badge neutral">{campaign?.objective}</span></div><TimelineChart points={campaignPoints} comparisonPoints={comparisonCampaignPoints} durationMs={duration} label={modeName(selectedMode)} comparisonLabel={isComparable ? modeName(!selectedMode) : undefined} target maxValue={campaign?.budgetMicros} cumulative /><p className="chart-caption">{money(campaignMetrics?.cumulativeSpendMicros ?? 0)} of {money(campaign?.budgetMicros ?? 0)} budget · dotted: linear target</p></section></Disclosure>
        <Disclosure title="Why do impression prices change?" description="Explore auction competition and the price paid for an ad slot."><p className="disclosure-intro">When bidders leave, the remaining winner may pay less. Pacing can preserve later competition, but does not guarantee higher revenue.</p><div className="chart-grid small-charts"><section className="chart-panel"><h3>How many campaigns compete?</h3><p className="small muted">Average participants per request · each bucket</p><TimelineChart points={frame.visible.map(bucket => ({ time: bucket.endMs, value: bucket.avgParticipants }))} durationMs={duration} label="Auction participants" monetary={false} maxValue={scenario!.config.shortlistSize} /></section><section className="chart-panel"><h3>What does an impression cost?</h3><p className="small muted">Average price over filled slots · each bucket</p><TimelineChart points={frame.visible.map(bucket => ({ time: bucket.endMs, value: bucket.avgClearingPriceMicros }))} durationMs={duration} label="Clearing price" maxValue={Math.max(...scenario!.campaigns.map(c => c.bidMicros))} /></section></div><p className="disclosure-intro small muted">Gaps mean no observations—not a zero price.</p></Disclosure>
        <Disclosure title="Inspect a request" description={requestPage ? `${requestPage.total.toLocaleString()} revealed requests · follow one from category match to auction winner.` : "Move the playback cursor forward to reveal current requests."}><section className="requests-panel" aria-label="Request explorer"><div className="section-heading"><h3>Request explorer</h3><span className="small muted">Before {sessionTime(frame.cutoffMs)}</span></div>{requestLoading ? <p className="table-empty">Loading current requests…</p> : !requestPage?.items.length ? <p className="table-empty">No requests revealed yet. Play or move the timeline forward.</p> : <div className="table-scroll"><table><thead><tr><th>Time / request</th><th>Search</th><th>Bidders</th><th>Winner / price</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{requestPage.items.map(item => <tr key={item.requestId}><td><strong className="mono">{sessionTime(item.timestampMs)}</strong><small>{item.requestId}</small></td><td><strong>{item.query ?? item.category}</strong><small>{item.category} · {item.userId}</small></td><td><span className="bidder-count">{item.participantCount}</span></td><td><strong>{campaignName(item.winnerCampaignId)}</strong><small>{item.filled ? money(item.priceMicros) : "No charge"}</small></td><td><button className="inspect-button" onClick={() => void inspect(item)}>Inspect ↗</button></td></tr>)}</tbody></table></div>}<div className="table-footer"><span>{requestPage ? `Showing first ${requestPage.items.length} of ${requestPage.total.toLocaleString()} revealed requests` : "No current requests"}</span></div></section></Disclosure>
        <details className="run-metadata"><summary>Current-result provenance</summary><p>{selectedRun.scenarioVersion} · engine {selectedRun.engineVersion} · current live result only</p><code>{selectedRun.inputHash}</code></details>
      </>}</div></div>
      <Disclosure title="How to explore this experiment" description="The high-level story, plus optional implementation details." id="demo-guide"><div className="guide-content"><ol><li><strong>Run without pacing.</strong> Watch budgets spend, then inspect a request.</li><li><strong>Turn pacing on and run again.</strong> The paired charts share requests, budget inputs, and cursor.</li><li><strong>Ask why.</strong> Open a request funnel to see quality gating, utility ranking, and the auction.</li></ol><p>Quality determines who reaches the auction. Utility—effective bid × quality—determines the winner. All objectives pay per impression.</p><details className="formula"><summary>Implementation detail: the pacing formula</summary><code>target = budget × elapsed / duration<br />p = clamp((target − spent) / bid, 0, 1)</code><p>A fixed draw below p admits the campaign. Skipped campaigns cannot win or support prices.</p></details></div></Disclosure>
      <footer className="app-footer"><span>Ad Market Lab · Learn the mechanism, not a revenue promise.</span><span>One slot. Impression billing. Replayable inputs.</span></footer>
    </main>
    {selectedTrace && scenario && <RequestSheet trace={selectedTrace} scenario={scenario} onClose={() => setSelectedTrace(null)} />}
  </div>;
}

function Disclosure({ title, description, children, id }: { title: string; description: string; children: ReactNode; id?: string }) {
  const [open, setOpen] = useState(false);
  return <details className="panel explore-panel" id={id} onToggle={event => setOpen(event.currentTarget.open)}><summary><strong>{title}</strong><span>{description}</span></summary>{open && children}</details>;
}
