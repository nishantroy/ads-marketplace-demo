"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { ApiError, RequestTrace, RunListResponse, RunRecord, ScenarioResponse, ScenarioSummary, TimelineBucket, TimelineResponse } from "../../lib/contracts";
import { money, playbackFrame, sessionTime } from "./playback";
import { RequestSheet } from "./request-sheet";

const TimelineChart = dynamic(() => import("./timeline-chart").then(module => module.TimelineChart), { ssr: false, loading: () => <div className="timeline-chart chart-loading">Loading chart…</div> });

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json() as T | ApiError;
  if (!response.ok) throw new Error((body as ApiError).error?.message ?? "Unable to reach the live demo.");
  return body as T;
}

type Step = "intro" | "unpaced" | "paced" | "compare" | "explore";
const STEPS: { id: Step; label: string }[] = [
  { id: "intro", label: "Start" },
  { id: "unpaced", label: "Pacing off" },
  { id: "paced", label: "Pacing on" },
  { id: "compare", label: "Compare" },
  { id: "explore", label: "Explore" },
];

interface MergedRequestRow {
  requestId: string; timestampMs: number; category: string; query?: string; userId: string;
  off?: { participantCount: number; winnerCampaignId: string | null; priceMicros: number; filled: boolean };
  on?: { participantCount: number; winnerCampaignId: string | null; priceMicros: number; filled: boolean };
}

export function SimulatorPreview() {
  const [scenario, setScenario] = useState<ScenarioSummary | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [timelines, setTimelines] = useState<Record<string, TimelineBucket[]>>({});
  const [step, setStep] = useState<Step>("intro");
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | undefined>();
  const [requestRows, setRequestRows] = useState<MergedRequestRow[]>([]);
  const [requestTotal, setRequestTotal] = useState(0);
  const [requestLoading, setRequestLoading] = useState(false);
  const [inspecting, setInspecting] = useState<{ off: RequestTrace | null; on: RequestTrace | null } | null>(null);
  const [loading, setLoading] = useState<"initial" | "computing" | "reset" | null>("initial");
  const [error, setError] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const computingRef = useRef(false);

  const offRun = runs.find(r => !r.pacingEnabled) ?? null;
  const onRun = runs.find(r => r.pacingEnabled) ?? null;
  const bothReady = Boolean(offRun && onRun && timelines[offRun.id] && timelines[onRun.id]);
  const offTimeline = offRun ? timelines[offRun.id] ?? [] : [];
  const onTimeline = onRun ? timelines[onRun.id] ?? [] : [];
  const timelineLength = Math.max(offTimeline.length, onTimeline.length);
  const duration = scenario?.config.sessionDurationMs ?? 0;
  const busy = loading !== null;

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const listener = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  // Load the scenario and whatever result pair already exists; nothing here requires a user decision.
  const refresh = async () => {
    const [scenarioResponse, runResponse] = await Promise.all([api<ScenarioResponse>("/api/scenario"), api<RunListResponse>("/api/runs")]);
    setScenario(scenarioResponse.scenario); setRuns(runResponse.runs);
  };
  useEffect(() => { void refresh().catch(error => { setError(error.message); setLoading(null); }); }, []);
  useEffect(() => { if (loading === "initial" && scenario) setLoading(null); }, [loading, scenario]);

  // Compute both pacing modes automatically. There is no run button and no mode to choose.
  useEffect(() => {
    if (!scenario || computingRef.current) return;
    const haveOff = runs.some(r => !r.pacingEnabled);
    const haveOn = runs.some(r => r.pacingEnabled);
    if (haveOff && haveOn) return;
    const modesToCompute = [...(haveOff ? [] : [false]), ...(haveOn ? [] : [true])];
    computingRef.current = true;
    setLoading("computing"); setError(null);
    void Promise.all(modesToCompute.map(mode => api<{ run: RunRecord }>("/api/runs", { method: "POST", body: JSON.stringify({ pacingEnabled: mode }) })))
      .then(responses => {
        setRuns(previous => {
          const next = [...previous];
          for (const { run } of responses) {
            const index = next.findIndex(item => item.pacingEnabled === run.pacingEnabled);
            if (index >= 0) next[index] = run; else next.push(run);
          }
          return next;
        });
      })
      .catch(error => setError(error instanceof Error ? error.message : "Unable to compute the comparison."))
      .finally(() => { computingRef.current = false; setLoading(null); });
  }, [scenario, runs]);

  useEffect(() => {
    const targets = [offRun, onRun].filter((run): run is RunRecord => Boolean(run && !timelines[run.id]));
    if (!targets.length) return;
    void Promise.all(targets.map(run => api<TimelineResponse>(`/api/runs/${run.id}/timeline`))).then(responses => {
      setTimelines(previous => ({ ...previous, ...Object.fromEntries(responses.map(response => [response.runId, response.buckets])) }));
    }).catch(error => setError(error.message));
  }, [offRun, onRun, timelines]);

  useEffect(() => {
    if (!playing) return;
    const cap = step === "unpaced" ? offTimeline.length : step === "paced" ? onTimeline.length : timelineLength;
    const timer = window.setInterval(() => setCursor(value => Math.min(value + 1, cap)), 1000 / speed);
    return () => window.clearInterval(timer);
  }, [playing, speed, step, offTimeline.length, onTimeline.length, timelineLength]);

  function goToStep(next: Step) {
    setStep(next); setPlaying(false); setInspecting(null);
    if (next === "unpaced") { setCursor(0); setPlaying(!reducedMotion); }
    else if (next === "paced") { setCursor(0); setPlaying(!reducedMotion); }
    else if (next === "compare" || next === "explore") { setCursor(timelineLength); }
  }
  function seek(value: number) { setCursor(value); setPlaying(false); }

  async function reset() {
    setLoading("reset"); setError(null); setPlaying(false);
    try {
      const response = await api<{ scenario: ScenarioSummary }>("/api/scenario/reset", { method: "POST", body: "{}" });
      setScenario(response.scenario); setRuns([]); setTimelines({}); setCursor(0); setStep("intro"); setInspecting(null); setRequestRows([]);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to reset the demo."); }
    finally { setLoading(null); }
  }

  const cutoffMs = playbackFrame(offTimeline, cursor).cutoffMs;
  useEffect(() => {
    if (step !== "explore" || !offRun || !onRun || cutoffMs === 0) { setRequestRows([]); setRequestTotal(0); return; }
    let cancelled = false;
    setRequestLoading(true);
    const params = `limit=30&beforeMs=${cutoffMs}`;
    void Promise.all([
      api<{ items: MergedRequestRow["off"] extends undefined ? never : { requestId: string; timestampMs: number; category: string; query?: string; userId: string; participantCount: number; winnerCampaignId: string | null; priceMicros: number; filled: boolean }[]; total: number }>(`/api/runs/${offRun.id}/requests?${params}`),
      api<{ items: { requestId: string; timestampMs: number; category: string; query?: string; userId: string; participantCount: number; winnerCampaignId: string | null; priceMicros: number; filled: boolean }[]; total: number }>(`/api/runs/${onRun.id}/requests?${params}`),
    ]).then(([offPage, onPage]) => {
      if (cancelled) return;
      const onById = new Map(onPage.items.map(item => [item.requestId, item]));
      const rows: MergedRequestRow[] = offPage.items.map(item => {
        const match = onById.get(item.requestId);
        return {
          requestId: item.requestId, timestampMs: item.timestampMs, category: item.category, query: item.query, userId: item.userId,
          off: { participantCount: item.participantCount, winnerCampaignId: item.winnerCampaignId, priceMicros: item.priceMicros, filled: item.filled },
          on: match && { participantCount: match.participantCount, winnerCampaignId: match.winnerCampaignId, priceMicros: match.priceMicros, filled: match.filled },
        };
      });
      setRequestRows(rows); setRequestTotal(offPage.total);
    }).catch(error => { if (!cancelled) setError(error.message); }).finally(() => { if (!cancelled) setRequestLoading(false); });
    return () => { cancelled = true; };
  }, [step, offRun, onRun, cutoffMs]);

  async function inspect(requestId: string) {
    if (!offRun || !onRun) return;
    setPlaying(false); setError(null);
    try {
      const [offResponse, onResponse] = await Promise.all([
        api<{ trace: RequestTrace }>(`/api/runs/${offRun.id}/requests/${requestId}`),
        api<{ trace: RequestTrace }>(`/api/runs/${onRun.id}/requests/${requestId}`),
      ]);
      setInspecting({ off: offResponse.trace, on: onResponse.trace });
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to load that request."); }
  }

  // --- Chart series -----------------------------------------------------
  const cumulative = (timeline: TimelineBucket[], upto: number) => {
    const frame = playbackFrame(timeline, upto);
    return [{ time: 0, value: 0 }, ...frame.visible.map(bucket => ({ time: bucket.endMs, value: bucket.cumulativeRevenueMicros }))];
  };
  const metric = (timeline: TimelineBucket[], upto: number, pick: (bucket: TimelineBucket) => number | null) =>
    playbackFrame(timeline, upto).visible.map(bucket => ({ time: bucket.endMs, value: pick(bucket) }));
  const campaignSeries = (timeline: TimelineBucket[], upto: number, campaignId: string | undefined, withTarget: boolean) => {
    const frame = playbackFrame(timeline, upto);
    return [{ time: 0, value: 0, target: withTarget ? 0 : undefined }, ...frame.visible.map(bucket => {
      const metrics = bucket.campaigns.find(item => item.campaignId === campaignId);
      return { time: bucket.endMs, value: metrics?.cumulativeSpendMicros ?? 0, target: withTarget ? metrics?.targetMicros ?? 0 : undefined };
    })];
  };

  const totalBudget = scenario?.campaigns.reduce((sum, c) => sum + c.budgetMicros, 0);
  const campaignId = selectedCampaignId && scenario?.campaigns.some(c => c.id === selectedCampaignId) ? selectedCampaignId : scenario?.campaigns[0]?.id;
  const campaign = scenario?.campaigns.find(c => c.id === campaignId);
  const offRevenue = playbackFrame(offTimeline, cursor).revenueMicros;
  const onRevenue = playbackFrame(onTimeline, cursor).revenueMicros;

  let heroPoints, heroComparisonPoints, heroLabel, heroComparisonLabel;
  if (step === "unpaced") {
    heroPoints = cumulative(offTimeline, cursor); heroLabel = "Pacing off";
  } else if (step === "paced") {
    heroPoints = cumulative(onTimeline, cursor); heroLabel = "Pacing on";
    heroComparisonPoints = cumulative(offTimeline, offTimeline.length); heroComparisonLabel = "Pacing off (complete)";
  } else {
    heroPoints = cumulative(offTimeline, cursor); heroLabel = "Pacing off";
    heroComparisonPoints = cumulative(onTimeline, cursor); heroComparisonLabel = "Pacing on";
  }

  const stepIndex = STEPS.findIndex(item => item.id === step);
  const campaignName = (id: string | null) => scenario?.campaigns.find(c => c.id === id)?.name ?? "No ad served";

  return <div className="simulator-app">
    <a href="#workspace" className="skip-link">Skip to simulator</a>
    <header className="app-header">
      <Link className="brand" href="/" aria-label="Ad Market Lab home"><span className="brand-mark" aria-hidden="true">▥</span><span>Ad Market <b>Lab</b></span></Link>
      <span className="header-divider" /><span className="header-description">A small marketplace. A closer look.</span>
      <button className="text-button reset-link" disabled={busy} onClick={() => void reset()}>{loading === "reset" ? "Resetting…" : "Reset demo"}</button>
    </header>
    <main id="workspace" className="workspace">
      {error && <div className="notice error-notice" role="alert"><strong>Something needs attention</strong><span>{error}</span><button className="text-button" onClick={() => setError(null)}>Dismiss</button></div>}

      <nav className="step-nav" aria-label="Guide progress">
        {STEPS.map((item, index) => <button key={item.id} className={`step-pill ${item.id === step ? "active" : ""} ${index < stepIndex ? "done" : ""}`}
          onClick={() => goToStep(item.id)} disabled={!scenario} aria-current={item.id === step ? "step" : undefined}>
          <span className="step-pill-index">{index + 1}</span><span className="step-pill-label">{item.label}</span>
        </button>)}
      </nav>

      {step === "intro" && <section className="panel intro-card">
        <p className="eyebrow">Search ads · marketplace simulator</p>
        <h1>What changes when advertisers spread their spending over time?</h1>
        <p className="lede">This demo replays the identical six-hour marketplace twice: once with advertiser budgets free to spend
          as fast as they can win, and once with pacing holding some budget back for later. Watch each play out, then compare
          them side by side.</p>
        {!bothReady ? <p className="notice compact">{loading === "computing" ? "Computing both runs…" : "Loading scenario…"}</p> : <p className="small muted">
          {scenario?.requestCount.toLocaleString()} requests · {scenario?.campaigns.length} campaigns · {scenario?.categories.length} categories · 6 simulated hours.
          Both results are already computed — there is nothing to configure or run.
        </p>}
        <div className="step-actions"><button className="button primary" disabled={!bothReady} onClick={() => goToStep("unpaced")}>Begin →</button></div>
      </section>}

      {step !== "intro" && <>
        <section className="panel chart-panel hero-chart" aria-live="polite">
          <div className="section-heading">
            <div>
              <h3>{step === "unpaced" ? "Pacing off: budgets spend as fast as they can win"
                : step === "paced" ? "Now the same marketplace, with pacing on"
                : "Marketplace revenue, both modes"}</h3>
              <p className="revenue-total">{step === "paced" ? money(onRevenue) : money(offRevenue)}</p>
              <p className="small muted">
                {step === "unpaced" && "Pacing off · cumulative through " + sessionTime(cutoffMs)}
                {step === "paced" && "Pacing on · cumulative through " + sessionTime(playbackFrame(onTimeline, cursor).cutoffMs) + " · gray line is the completed pacing-off run"}
                {(step === "compare" || step === "explore") && `Both modes · same requests, same budgets · through ${sessionTime(cutoffMs)}`}
              </p>
            </div>
            <span className="legend"><i />{heroLabel}{heroComparisonLabel && ` · dashed: ${heroComparisonLabel}`}</span>
          </div>
          <TimelineChart points={heroPoints} comparisonPoints={heroComparisonPoints} durationMs={duration} label={heroLabel}
            comparisonLabel={heroComparisonLabel} maxValue={totalBudget} cumulative />
          <p className="chart-caption">Every advertiser charge adds to marketplace revenue. Pacing does not promise more of it.</p>
        </section>

        <div className="playback-controls">
          <button className="button primary" disabled={!bothReady} onClick={() => { const cap = step === "unpaced" ? offTimeline.length : step === "paced" ? onTimeline.length : timelineLength; if (cursor >= cap) setCursor(0); setPlaying(value => !value); }}>
            {playing ? "Ⅱ Pause" : "▶ Play"}
          </button>
          <button className="icon-button" disabled={!bothReady} onClick={() => seek(0)} aria-label="Restart playback">↺</button>
          <div className="clock"><strong>{sessionTime(cutoffMs)}</strong><span> / 06:00 elapsed</span></div>
          <label className="speed-label">Speed <select value={speed} onChange={event => setSpeed(Number(event.target.value))}><option value={1}>1×</option><option value={4}>4×</option><option value={12}>12×</option></select></label>
        </div>
        <input aria-label="Playback position" className="time-slider" type="range" min={0} max={timelineLength} value={cursor} disabled={!bothReady} onChange={event => seek(Number(event.target.value))} />

        {step === "compare" && <section className="panel compare-callout">
          <h3>What changed</h3>
          <p>Pacing off finished with <strong>{money(offRevenue)}</strong> in revenue; pacing on finished with <strong>{money(onRevenue)}</strong>.
            {" "}Both modes spend from the same budgets against the same requests — pacing only changes <em>when</em> that spend happens, which
            is why revenue can end up close either way. Open Explore to see the effect on competition and clearing prices.</p>
        </section>}

        <div className="step-actions">
          {stepIndex > 1 && <button className="button secondary" onClick={() => goToStep(STEPS[stepIndex - 1].id)}>← Back</button>}
          {stepIndex < STEPS.length - 1 && <button className="button primary" disabled={!bothReady} onClick={() => goToStep(STEPS[stepIndex + 1].id)}>
            {step === "unpaced" ? "Next: turn pacing on →" : step === "paced" ? "Next: compare →" : "Next: explore freely →"}
          </button>}
        </div>
      </>}

      {step === "explore" && <>
        <Disclosure title="Follow one campaign" description="See how its spend tracks the same budget in each mode.">
          <section className="chart-panel"><div className="section-heading"><div><h3>Campaign spend</h3>
            <select aria-label="Campaign to chart" className="campaign-select" value={campaignId} onChange={event => setSelectedCampaignId(event.target.value)}>
              {scenario?.campaigns.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}
            </select></div><span className="badge neutral">{campaign?.objective}</span></div>
            <TimelineChart points={campaignSeries(offTimeline, cursor, campaignId, true)} comparisonPoints={campaignSeries(onTimeline, cursor, campaignId, false)}
              durationMs={duration} label="Pacing off" comparisonLabel="Pacing on" target maxValue={campaign?.budgetMicros} cumulative />
            <p className="chart-caption">Solid: pacing off · dashed: pacing on · dotted: linear target · {money(campaign?.budgetMicros ?? 0)} budget</p>
          </section>
        </Disclosure>
        <Disclosure title="Why do impression prices change?" description="Explore auction competition and the price paid for an ad slot.">
          <p className="disclosure-intro">When bidders leave, the remaining winner may pay less. Pacing can preserve later competition, but does not guarantee higher revenue.</p>
          <div className="chart-grid small-charts">
            <section className="chart-panel"><h3>How many campaigns compete?</h3><p className="small muted">Average participants per request · each bucket</p>
              <TimelineChart points={metric(offTimeline, cursor, b => b.avgParticipants)} comparisonPoints={metric(onTimeline, cursor, b => b.avgParticipants)}
                durationMs={duration} label="Pacing off" comparisonLabel="Pacing on" monetary={false} maxValue={scenario?.config.shortlistSize} /></section>
            <section className="chart-panel"><h3>What does an impression cost?</h3><p className="small muted">Average price over filled slots · each bucket</p>
              <TimelineChart points={metric(offTimeline, cursor, b => b.avgClearingPriceMicros)} comparisonPoints={metric(onTimeline, cursor, b => b.avgClearingPriceMicros)}
                durationMs={duration} label="Pacing off" comparisonLabel="Pacing on" maxValue={scenario ? Math.max(...scenario.campaigns.map(c => c.bidMicros)) : undefined} /></section>
          </div>
          <p className="disclosure-intro small muted">Gaps mean no observations—not a zero price.</p>
        </Disclosure>
        <Disclosure title="Inspect a request" description={requestRows.length ? `${requestTotal.toLocaleString()} revealed requests · compare both modes on the same request.` : "Move the playback cursor forward to reveal current requests."}>
          <section className="requests-panel" aria-label="Request explorer">
            <div className="section-heading"><h3>Request explorer</h3><span className="small muted">Before {sessionTime(cutoffMs)}</span></div>
            {requestLoading ? <p className="table-empty">Loading current requests…</p> : !requestRows.length ? <p className="table-empty">No requests revealed yet. Play or move the timeline forward.</p> : <div className="table-scroll"><table>
              <thead><tr><th>Time / request</th><th>Search</th><th>Pacing off</th><th>Pacing on</th><th><span className="sr-only">Details</span></th></tr></thead>
              <tbody>{requestRows.map(row => <tr key={row.requestId}>
                <td><strong className="mono">{sessionTime(row.timestampMs)}</strong><small>{row.requestId}</small></td>
                <td><strong>{row.query ?? row.category}</strong><small>{row.category} · {row.userId}</small></td>
                <td><strong>{campaignName(row.off?.winnerCampaignId ?? null)}</strong><small>{row.off?.filled ? money(row.off.priceMicros) : "No charge"} · {row.off?.participantCount ?? 0} bidders</small></td>
                <td><strong>{campaignName(row.on?.winnerCampaignId ?? null)}</strong><small>{row.on?.filled ? money(row.on.priceMicros) : "No charge"} · {row.on?.participantCount ?? 0} bidders</small></td>
                <td><button className="inspect-button" onClick={() => void inspect(row.requestId)}>Inspect ↗</button></td>
              </tr>)}</tbody>
            </table></div>}
            <div className="table-footer"><span>{requestRows.length ? `Showing first ${requestRows.length} of ${requestTotal.toLocaleString()} revealed requests` : "No current requests"}</span></div>
          </section>
        </Disclosure>
        <Disclosure title="About this scenario" description="Campaigns, users, and the minimum price, for the curious.">
          <dl className="scenario-facts"><div><dt>Campaigns / users</dt><dd>{scenario ? `${scenario.campaigns.length} / ${scenario.users.length}` : "—"}</dd></div>
            <div><dt>Categories / segments</dt><dd>{scenario ? `${scenario.categories.length} / ${scenario.segments.length}` : "—"}</dd></div>
            <div><dt>Minimum price</dt><dd>{scenario ? `${money(scenario.config.reserveMicros)} per impression` : "—"}</dd></div></dl>
          <details className="formula"><summary>Implementation detail: the pacing formula</summary>
            <code>target = budget × elapsed / duration<br />p = clamp((target − spent) / bid, 0, 1)</code>
            <p>A fixed draw below p admits the campaign. Skipped campaigns cannot win or support prices.</p></details>
        </Disclosure>
      </>}

      <Disclosure title="How to explore this experiment" description="The high-level story, plus optional implementation details." id="demo-guide">
        <div className="guide-content"><ol>
          <li><strong>Watch pacing off.</strong> Budgets spend as fast as they can win.</li>
          <li><strong>Watch pacing on.</strong> The same campaigns, budgets, and requests — only pacing differs.</li>
          <li><strong>Compare, then explore.</strong> Open a request funnel to see quality gating, utility ranking, and the auction, side by side for both modes.</li>
        </ol><p>Quality determines who reaches the auction. Utility—effective bid × quality—determines the winner. All objectives pay per impression.</p></div>
      </Disclosure>
      <footer className="app-footer"><span>Ad Market Lab · Learn the mechanism, not a revenue promise.</span><span>One slot. Impression billing. Replayable inputs.</span></footer>
    </main>
    {inspecting && scenario && <RequestSheet off={inspecting.off} on={inspecting.on} scenario={scenario} onClose={() => setInspecting(null)} />}
  </div>;
}

function Disclosure({ title, description, children, id }: { title: string; description: string; children: ReactNode; id?: string }) {
  const [open, setOpen] = useState(false);
  return <details className="panel explore-panel" id={id} onToggle={event => setOpen(event.currentTarget.open)}><summary><strong>{title}</strong><span>{description}</span></summary>{open && children}</details>;
}
