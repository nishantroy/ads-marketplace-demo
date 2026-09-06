"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { ApiError, RequestTrace, RunListResponse, RunRecord, ScenarioResponse, ScenarioSummary, TimelineBucket, TimelineResponse } from "../../lib/contracts";
import { campaignSpendSeries, money, playbackFrame, sessionTime } from "./playback";
import { Legend } from "./legend";
import { RequestSheet } from "./request-sheet";
import { OFF_COLOR, ON_COLOR } from "./timeline-chart";
import { CampaignStories } from "./campaign-stories";
import { FunnelDiagram, type FunnelStage } from "./funnel-diagram";

const TimelineChart = dynamic(() => import("./timeline-chart").then(module => module.TimelineChart), { ssr: false, loading: () => <div className="timeline-chart chart-loading">Loading chart…</div> });

/** Every guided scene autoplays at this fixed rate; there is no speed control and no pause. */
const AUTOPLAY_MS_PER_BUCKET = 1000 / 15;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json() as T | ApiError;
  if (!response.ok) throw new Error((body as ApiError).error?.message ?? "Unable to reach the live demo.");
  return body as T;
}

type Step = "opening" | "tutorialFunnel" | "briefing" | "unpaced" | "paced" | "compare" | "explore";
/** Only the cold-open landing scene has no rail entry; every stage after it does, for consistent navigation. */
const RAIL: { id: Step; label: string }[] = [
  { id: "tutorialFunnel", label: "How it works" },
  { id: "briefing", label: "Briefing" },
  { id: "unpaced", label: "Pacing off" },
  { id: "paced", label: "Pacing on" },
  { id: "compare", label: "Compare" },
  { id: "explore", label: "Explore" },
];

/** The current stage lives in the URL, so a reload lands back where you were instead of the opening scene. */
const STEP_SLUGS: Record<Step, string> = {
  opening: "/", tutorialFunnel: "/how-it-works", briefing: "/briefing",
  unpaced: "/pacing-off", paced: "/pacing-on", compare: "/compare", explore: "/explore",
};
const SLUG_STEPS: Record<string, Step> = Object.fromEntries(Object.entries(STEP_SLUGS).map(([stepKey, slug]) => [slug, stepKey as Step]));
function stepFromLocation(): Step {
  if (typeof window === "undefined") return "opening";
  return SLUG_STEPS[window.location.pathname] ?? "opening";
}

interface TutorialPoint { term: string; body: string }
interface TutorialStage extends FunnelStage { intro: string; points: TutorialPoint[] }

const TUTORIAL_STAGES: TutorialStage[] = [
  {
    id: "arrive", label: "Request arrives", width: 1,
    intro: "Someone searches for something online \u2014 say, running shoes.",
    points: [
      { term: "Request", body: "What we call that search. It carries a category and a little about who's searching." },
      { term: "Category", body: "The type of thing being searched for (Shoes). It decides which campaigns even get considered." },
    ],
  },
  {
    id: "retrieve", label: "Retrieve candidates", width: 0.88,
    intro: "Every advertiser running an ad in that category gets pulled in as a possible match.",
    points: [
      { term: "Campaign", body: "One advertiser's ad, along with its budget and targeting." },
      { term: "Candidate", body: "Any campaign considered for this one request. Two dozen or more is typical here." },
    ],
  },
  {
    id: "pacing", label: "Budget & pacing", width: 0.74,
    intro: "Every campaign has money set aside for the whole six-hour session.",
    points: [
      { term: "Budget", body: "The total a campaign can spend across the session \u2014 a spending limit for the whole trip, not just one purchase." },
      { term: "Pacing", body: "An optional setting that compares spend-so-far to how far into the session we are, and deliberately skips some requests to save budget for later." },
    ],
  },
  {
    id: "quality", label: "Quality gate", width: 0.58,
    intro: "Not every candidate is a good match for this particular searcher.",
    points: [
      { term: "Quality", body: "A score for how well an ad fits this searcher, combining the ad's own track record with its relevance to them." },
      { term: "Gate", body: "Campaigns below a minimum quality are dropped right here, no matter how much they'd pay." },
    ],
  },
  {
    id: "rank", label: "Rank by utility", width: 0.42,
    intro: "The remaining candidates are put in order \u2014 not by who pays the most.",
    points: [
      { term: "Bid", body: "The most a campaign is willing to pay for this one impression." },
      { term: "Utility", body: "Bid multiplied by quality. A cheap, well-matched ad can outrank an expensive, poorly matched one." },
    ],
  },
  {
    id: "auction", label: "Auction", width: 0.26,
    intro: "The top-ranked candidates compete head-to-head for the one available slot.",
    points: [
      { term: "Winner", body: "The candidate with the highest utility, not necessarily the highest bid." },
      { term: "Price", body: "What the winner actually pays \u2014 set by the runner-up's bid, adjusted for the winner's own quality." },
    ],
  },
  {
    id: "winner", label: "Winner served", width: 0.14,
    intro: "The auction is over, and the ad is shown.",
    points: [
      { term: "Served", body: "The winning ad is the one the searcher actually sees." },
      { term: "No charge for the rest", body: "Every other candidate pays nothing, even the runner-up." },
    ],
  },
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
  const [step, setStep] = useState<Step>(stepFromLocation);
  const [cursor, setCursor] = useState(0);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | undefined>();
  const [tutorialStageIndex, setTutorialStageIndex] = useState(0);
  const [prediction, setPrediction] = useState<"more" | "less" | "same" | null>(null);
  const [campaignPanelOpen, setCampaignPanelOpen] = useState(false);
  const campaignPanelRef = useRef<HTMLDetailsElement>(null);
  const [requestRows, setRequestRows] = useState<MergedRequestRow[]>([]);
  const [requestTotal, setRequestTotal] = useState(0);
  const [requestLoading, setRequestLoading] = useState(false);
  const [inspecting, setInspecting] = useState<{ off: RequestTrace | null; on: RequestTrace | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  const offRun = runs.find(r => !r.pacingEnabled) ?? null;
  const onRun = runs.find(r => r.pacingEnabled) ?? null;
  const bothReady = Boolean(offRun && onRun && timelines[offRun.id] && timelines[onRun.id]);
  const offTimeline = offRun ? timelines[offRun.id] ?? [] : [];
  const onTimeline = onRun ? timelines[onRun.id] ?? [] : [];
  const timelineLength = Math.max(offTimeline.length, onTimeline.length);
  const duration = scenario?.config.sessionDurationMs ?? 0;

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const listener = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  // Both pacing modes are always available: GET /api/runs computes on demand from the fixed baseline
  // scenario, so there is no run button, no mode to choose, and no separate "computing" wait.
  const refresh = async () => {
    const [scenarioResponse, runResponse] = await Promise.all([api<ScenarioResponse>("/api/scenario"), api<RunListResponse>("/api/runs")]);
    setScenario(scenarioResponse.scenario); setRuns(runResponse.runs);
  };
  useEffect(() => { void refresh().catch(error => setError(error.message)); }, []);

  useEffect(() => {
    const targets = [offRun, onRun].filter((run): run is RunRecord => Boolean(run && !timelines[run.id]));
    if (!targets.length) return;
    void Promise.all(targets.map(run => api<TimelineResponse>(`/api/runs/${run.id}/timeline`))).then(responses => {
      setTimelines(previous => ({ ...previous, ...Object.fromEntries(responses.map(response => [response.runId, response.buckets])) }));
    }).catch(error => setError(error.message));
  }, [offRun, onRun, timelines]);

  // Pacing-off and pacing-on scenes autoplay once, at a fixed rate, with no pause. Reduced motion skips
  // straight to the finished state instead of forcing an animation on someone who asked not to see one.
  useEffect(() => {
    if (step !== "unpaced" && step !== "paced") return;
    const cap = step === "unpaced" ? offTimeline.length : onTimeline.length;
    if (reducedMotion) { setCursor(cap); return; }
    const timer = window.setInterval(() => setCursor(value => Math.min(value + 1, cap)), AUTOPLAY_MS_PER_BUCKET);
    return () => window.clearInterval(timer);
  }, [step, offTimeline.length, onTimeline.length, reducedMotion]);

  function applyStep(next: Step) {
    setStep(next); setInspecting(null);
    // A quick click through unpaced/paced must not leave compare reading a half-finished cursor position:
    // compare and explore always show the complete session, regardless of how fast someone clicked here.
    if (next === "unpaced" || next === "paced") setCursor(0);
    else if (next === "compare" || next === "explore") setCursor(timelineLength);
    else if (next === "tutorialFunnel") setTutorialStageIndex(0);
  }
  function goToStep(next: Step) {
    applyStep(next);
    window.history.pushState(null, "", STEP_SLUGS[next]);
  }
  // Keep the browser's back/forward buttons in sync with the guided sequence.
  useEffect(() => {
    const onPopState = () => applyStep(stepFromLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- applyStep is redefined each render; only bind once

  async function inspect(requestId: string) {
    if (!offRun || !onRun) return;
    setError(null);
    try {
      const [offResponse, onResponse] = await Promise.all([
        api<{ trace: RequestTrace }>(`/api/runs/${offRun.id}/requests/${requestId}`),
        api<{ trace: RequestTrace }>(`/api/runs/${onRun.id}/requests/${requestId}`),
      ]);
      setInspecting({ off: offResponse.trace, on: onResponse.trace });
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to load that request."); }
  }

  // Explore fetches once, independent of any cursor: it is the finished-experiment view, not a playback one.
  useEffect(() => {
    if (step !== "explore" || !offRun || !onRun) { setRequestRows([]); setRequestTotal(0); return; }
    let cancelled = false;
    setRequestLoading(true);
    void Promise.all([
      api<{ items: { requestId: string; timestampMs: number; category: string; query?: string; userId: string; participantCount: number; winnerCampaignId: string | null; priceMicros: number; filled: boolean }[]; total: number }>(`/api/runs/${offRun.id}/requests?limit=30`),
      api<{ items: { requestId: string; timestampMs: number; category: string; query?: string; userId: string; participantCount: number; winnerCampaignId: string | null; priceMicros: number; filled: boolean }[]; total: number }>(`/api/runs/${onRun.id}/requests?limit=30`),
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
  }, [step, offRun, onRun]);

  // --- Chart series -----------------------------------------------------
  const cumulative = (timeline: TimelineBucket[], upto: number) => {
    const frame = playbackFrame(timeline, upto);
    return [{ time: 0, value: 0 }, ...frame.visible.map(bucket => ({ time: bucket.endMs, value: bucket.cumulativeRevenueMicros }))];
  };
  /** Explore is not a playback view: every series here is always the complete curve. */
  const fullSeries = (timeline: TimelineBucket[], pick: (bucket: TimelineBucket) => number | null) =>
    timeline.map(bucket => ({ time: bucket.endMs, value: pick(bucket) }));

  const totalBudget = scenario?.campaigns.reduce((sum, c) => sum + c.budgetMicros, 0);
  const campaignId = selectedCampaignId && scenario?.campaigns.some(c => c.id === selectedCampaignId) ? selectedCampaignId : scenario?.campaigns[0]?.id;
  const campaign = scenario?.campaigns.find(c => c.id === campaignId);
  const cutoffMs = playbackFrame(offTimeline, cursor).cutoffMs;
  const offRevenue = playbackFrame(offTimeline, cursor).revenueMicros;
  const onRevenue = playbackFrame(onTimeline, cursor).revenueMicros;

  // Unpaced and paced each show their own single line, in a color that reads as a verdict: pacing off is
  // the cautionary line (it can spend out and go quiet), pacing on is the sustained, healthy one. Compare
  // is the one place both appear together, so the two can actually be judged against each other.
  const withTargetSpend = (points: { time: number; value: number }[]) =>
    totalBudget === undefined ? points : points.map(point => ({ ...point, target: (totalBudget * point.time) / duration }));
  let heroLabel: string, heroPoints: ReturnType<typeof cumulative>, heroColor: number;
  let heroComparisonLabel: string | undefined, heroComparisonPoints: ReturnType<typeof cumulative> | undefined, heroComparisonColor: number | undefined;
  if (step === "unpaced") {
    heroLabel = "Pacing off"; heroPoints = cumulative(offTimeline, cursor); heroColor = OFF_COLOR;
  } else if (step === "paced") {
    heroLabel = "Pacing on"; heroPoints = withTargetSpend(cumulative(onTimeline, cursor)); heroColor = ON_COLOR;
  } else {
    heroLabel = "Pacing off"; heroPoints = cumulative(offTimeline, cursor); heroColor = OFF_COLOR;
    heroComparisonLabel = "Pacing on"; heroComparisonPoints = cumulative(onTimeline, cursor); heroComparisonColor = ON_COLOR;
  }

  const railIndex = RAIL.findIndex(item => item.id === step);
  const campaignName = (id: string | null) => scenario?.campaigns.find(c => c.id === id)?.name ?? "No ad served";

  return <div className="film">
    {error && <div className="notice error-notice" role="alert"><strong>Something needs attention</strong><span>{error}</span><button className="text-button" onClick={() => setError(null)}>Dismiss</button></div>}

    {step === "opening" && <section className="scene scene-opening">
      <div className="scene-content">
        <h1>How does the internet decide which ad you see?</h1>
        <p className="lede">Every time you search online, a split-second auction decides which ad you see. This is a live
          simulation of that auction — and of what changes when advertisers spread their spending across the day
          instead of spending it all at once.</p>
        <div className="step-actions"><button className="button ghost" onClick={() => goToStep("tutorialFunnel")}>See how it works</button></div>
      </div>
    </section>}

    {step === "tutorialFunnel" && <section className="scene tutorial-scene">
      <div className="scene-content">
        <div className="scene-main">
          <p className="eyebrow">How it works</p>
          <h3>One request, {TUTORIAL_STAGES.length} stages, one winner</h3>
          <div className="hero-chart-wrap">
            <FunnelDiagram stages={TUTORIAL_STAGES} activeIndex={tutorialStageIndex} doneUpTo={tutorialStageIndex}
              onSelect={setTutorialStageIndex} />
          </div>
        </div>
        <aside className="scene-aside">
          <h2>{tutorialStageIndex + 1}. {TUTORIAL_STAGES[tutorialStageIndex].label}</h2>
          <p>{TUTORIAL_STAGES[tutorialStageIndex].intro}</p>
          <ul className="concept-points">
            {TUTORIAL_STAGES[tutorialStageIndex].points.map(point => <li key={point.term}>
              <span className="term">{point.term}</span>{point.body}
            </li>)}
          </ul>
        </aside>
        <div className="step-actions">
          <button className="button secondary" disabled={tutorialStageIndex === 0} onClick={() => setTutorialStageIndex(index => index - 1)}>Back</button>
          {tutorialStageIndex < TUTORIAL_STAGES.length - 1
            ? <button className="button primary" onClick={() => setTutorialStageIndex(index => index + 1)}>Next stage</button>
            : <button className="button primary" onClick={() => goToStep("briefing")}>Continue</button>}
        </div>
      </div>
    </section>}

    {step === "briefing" && <section className="scene">
      <div className="scene-content">
        <p className="eyebrow">The experiment</p>
        <h1>Two identical six-hour auctions. One difference.</h1>
        <p className="lede">The same 4,000 requests, the same campaigns, the same budgets — run once with advertisers free to
          spend as fast as they can win, and once with pacing holding some of that budget back for later. Watch each play
          out, then compare what changed.</p>
        <div className="predict-block">
          <p className="predict-question">Before you watch: what do you expect pacing to do to total marketplace revenue?</p>
          <div className="predict-options">
            {([["more", "Increase it"], ["less", "Decrease it"], ["same", "Little or no change"]] as const).map(([value, label]) => (
              <button key={value} className={`predict-option ${prediction === value ? "selected" : ""}`} onClick={() => setPrediction(value)}
                aria-pressed={prediction === value}>{label}</button>
            ))}
          </div>
        </div>
        {!bothReady && <p className="notice compact">Loading scenario…</p>}
        <div className="step-actions"><button className="button primary" disabled={!bothReady || !prediction} onClick={() => goToStep("unpaced")}>Watch pacing off</button></div>
      </div>
    </section>}

    {(step === "unpaced" || step === "paced" || step === "compare") && <section className="scene hero-chart-scene">
      <div className="scene-content">
        <div className="scene-main">
          <p className="eyebrow">{step === "unpaced" ? "Stage one" : step === "paced" ? "Stage two" : "What changed"}</p>
          <h3>{step === "unpaced" ? "Budgets spend as fast as they can win"
            : step === "paced" ? "Now the same marketplace, with pacing on"
            : "Marketplace revenue, both modes"}</h3>
          <p className="revenue-total">{step === "paced" || step === "compare" ? money(onRevenue) : money(offRevenue)}</p>
          <p className="small muted">
            {step === "unpaced" && "Cumulative through " + sessionTime(cutoffMs) + ". Pacing on has not run yet."}
            {step === "paced" && "Pacing on is animating in against the completed pacing-off line."}
            {step === "compare" && `Same requests, same budgets, both complete at ${sessionTime(cutoffMs)}.`}
          </p>
          <div className="hero-chart-wrap">
            <TimelineChart points={heroPoints} comparisonPoints={heroComparisonPoints} durationMs={duration} label={heroLabel}
              comparisonLabel={heroComparisonLabel} color={heroColor} comparisonColor={heroComparisonColor}
              target={step === "paced"} maxValue={totalBudget} cumulative />
          </div>
          <Legend items={
            step === "unpaced" ? [{ swatch: "off", label: "Pacing off" }]
            : step === "paced" ? [{ swatch: "on", label: "Pacing on" }, { swatch: "target", label: "Target spend" }]
            : [{ swatch: "off", label: "Pacing off" }, { swatch: "on", label: "Pacing on" }]
          } />
        </div>

        <aside className="scene-aside">
          {step === "unpaced" && <>
            <h2>Highest bidder wins, adjusted for fit</h2>
            <p>Every incoming request is a small auction. Whoever wins pays a price shaped by the next-best bid, not
              their own.</p>
            <ul className="concept-points">
              <li><span className="term">No pacing</span>Every campaign bids in every auction it can afford, as fast as it can win.</li>
              <li><span className="term">Cheap late impressions</span>Once the strongest campaigns run out of budget, only weaker bidders remain — so late auctions often clear at a lower price.</li>
            </ul>
          </>}
          {step === "paced" && <>
            <h2>Pacing trades speed for reach</h2>
            <p>Instead of spending as fast as it can win, a paced campaign checks itself against a target before every auction.</p>
            <ul className="concept-points">
              <li><span className="term">Target spend</span>The straight-line pace a campaign would follow if it spent its whole budget evenly across the six hours. The dotted line is the marketplace-wide version of that target.</li>
              <li><span className="term">Admission</span>Behind target, a campaign is admitted to the auction as usual. Ahead of target, it may sit out on purpose — even if it could afford to bid.</li>
            </ul>
          </>}
          {step === "compare" && <>
            <h2>Pacing has real value — just not more revenue</h2>
            {prediction && <p className="predict-recap">You predicted pacing would <strong>{prediction === "more" ? "increase" : prediction === "less" ? "decrease" : "barely change"}</strong> revenue.</p>}
            <p>Pacing off finished with <strong>{money(offRevenue)}</strong>; pacing on finished with <strong>{money(onRevenue)}</strong> —
              close enough that pacing is not, on its own, a lever for making more money.</p>
            <p>What it does instead is spread that spend evenly across the session rather than letting it front-load, and
              that evenness is valuable in its own right:</p>
            <ul className="concept-points">
              <li><span className="term">Users</span>Don&rsquo;t see a surge of ads early in the session and then an emptier marketplace for the rest of the day.</li>
              <li><span className="term">Advertisers</span>Reach people who search throughout the whole session, not just whoever happened to search first.</li>
              <li><span className="term">The platform</span>Keeps clearing prices more stable through the day, instead of them crashing once the biggest spenders run out.</li>
            </ul>
          </>}
        </aside>

        <div className="step-actions">
          <button className="button primary" onClick={() => goToStep(step === "unpaced" ? "paced" : step === "paced" ? "compare" : "explore")}>
            {step === "unpaced" ? "Turn pacing on" : step === "paced" ? "Compare the results" : "Explore freely"}
          </button>
        </div>
      </div>
    </section>}

    {step === "explore" && <div className="explore-page">
      <p className="eyebrow">Explore</p>
      <h1>Look under the hood</h1>
      <p className="lede">Every chart here shows the complete six-hour run for both modes. Dig into a campaign, the auction
        competition, or one request at a time.</p>

      <Disclosure title="How pacing changes the auction" description="Competition and clearing price across the whole session, with pacing on and off, side by side." defaultOpen>
        <p className="disclosure-intro">When bidders leave, the remaining winner may pay less. Pacing can preserve later competition, but does not guarantee higher revenue.</p>
        <div className="chart-grid small-charts">
          <section className="chart-panel"><h3>How many campaigns compete?</h3><p className="small muted">Average participants per request · each bucket</p>
            <TimelineChart points={fullSeries(offTimeline, b => b.avgParticipants)} comparisonPoints={fullSeries(onTimeline, b => b.avgParticipants)}
              durationMs={duration} label="Pacing off" comparisonLabel="Pacing on" monetary={false} maxValue={scenario?.config.shortlistSize} />
            <Legend items={[{ swatch: "off", label: "Pacing off" }, { swatch: "on", label: "Pacing on" }]} /></section>
          <section className="chart-panel"><h3>What does an impression cost?</h3><p className="small muted">Average price over filled slots · each bucket</p>
            <TimelineChart points={fullSeries(offTimeline, b => b.avgClearingPriceMicros)} comparisonPoints={fullSeries(onTimeline, b => b.avgClearingPriceMicros)}
              durationMs={duration} label="Pacing off" comparisonLabel="Pacing on" maxValue={scenario ? Math.max(...scenario.campaigns.map(c => c.bidMicros)) : undefined} />
            <Legend items={[{ swatch: "off", label: "Pacing off" }, { swatch: "on", label: "Pacing on" }]} /></section>
        </div>
        <p className="disclosure-intro small muted">Gaps mean no observations—not a zero price.</p>
      </Disclosure>

      <CampaignStories campaigns={scenario?.campaigns ?? []} offTimeline={offTimeline} onTimeline={onTimeline} duration={duration}
        onExplore={id => {
          setSelectedCampaignId(id); setCampaignPanelOpen(true);
          requestAnimationFrame(() => campaignPanelRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" }));
        }} />

      <Disclosure ref={campaignPanelRef} title="Follow one campaign" description="See its full spend curve against the same budget in each mode."
        open={campaignPanelOpen} onOpenChange={setCampaignPanelOpen}>
        <section className="chart-panel"><div className="section-heading"><div><h3>Campaign spend</h3>
          <select aria-label="Campaign to chart" className="campaign-select" value={campaignId} onChange={event => setSelectedCampaignId(event.target.value)}>
            {scenario?.campaigns.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}
          </select></div><span className="badge neutral">{campaign?.objective}</span></div>
          <TimelineChart points={campaignSpendSeries(offTimeline, campaignId, true)} comparisonPoints={campaignSpendSeries(onTimeline, campaignId, false)}
            durationMs={duration} label="Pacing off" comparisonLabel="Pacing on" target maxValue={campaign?.budgetMicros} cumulative />
          <Legend items={[{ swatch: "off", label: "Pacing off" }, { swatch: "on", label: "Pacing on" }, { swatch: "target", label: "Linear target" }]} />
          <p className="chart-caption">{money(campaign?.budgetMicros ?? 0)} budget</p>
        </section>
      </Disclosure>
      <Disclosure title="Inspect a request" description={requestRows.length ? `${requestTotal.toLocaleString()} requests · compare both modes on the same request.` : "Loading requests…"}>
        <section className="requests-panel" aria-label="Request explorer">
          <div className="section-heading"><h3>Request explorer</h3></div>
          {requestLoading ? <p className="table-empty">Loading requests…</p> : !requestRows.length ? <p className="table-empty">No requests available.</p> : <div className="table-scroll"><table>
            <thead><tr><th>Time / request</th><th>Search</th><th>Pacing off</th><th>Pacing on</th><th><span className="sr-only">Details</span></th></tr></thead>
            <tbody>{requestRows.map(row => <tr key={row.requestId}>
              <td><strong className="mono">{sessionTime(row.timestampMs)}</strong><small>{row.requestId}</small></td>
              <td><strong>{row.query ?? row.category}</strong><small>{row.category} · {row.userId}</small></td>
              <td><strong>{campaignName(row.off?.winnerCampaignId ?? null)}</strong><small>{row.off?.filled ? money(row.off.priceMicros) : "No charge"} · {row.off?.participantCount ?? 0} bidders</small></td>
              <td><strong>{campaignName(row.on?.winnerCampaignId ?? null)}</strong><small>{row.on?.filled ? money(row.on.priceMicros) : "No charge"} · {row.on?.participantCount ?? 0} bidders</small></td>
              <td><button className="inspect-button" onClick={() => void inspect(row.requestId)}>Inspect</button></td>
            </tr>)}</tbody>
          </table></div>}
          <div className="table-footer"><span>{requestRows.length ? `Showing first ${requestRows.length} of ${requestTotal.toLocaleString()} requests` : "No requests"}</span></div>
        </section>
      </Disclosure>
    </div>}

    {railIndex >= 0 && <nav className="rail" aria-label="Guide progress">
      <button className="rail-dot rail-restart" onClick={() => goToStep("opening")}>
        <span className="dot" aria-hidden="true" /><span>Start over</span>
      </button>
      {RAIL.map((item, index) => <button key={item.id} className={`rail-dot ${item.id === step ? "active" : ""} ${index < railIndex ? "done" : ""}`}
        onClick={() => goToStep(item.id)} aria-current={item.id === step ? "step" : undefined}>
        <span className="dot" aria-hidden="true" /><span>{item.label}</span>
      </button>)}
    </nav>}

    {inspecting && scenario && <RequestSheet off={inspecting.off} on={inspecting.on} scenario={scenario} onClose={() => setInspecting(null)} />}
  </div>;
}

const Disclosure = forwardRef<HTMLDetailsElement, {
  title: string; description: string; children: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void; defaultOpen?: boolean;
}>(function Disclosure({ title, description, children, open: controlledOpen, onOpenChange, defaultOpen = false }, ref) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  return <details ref={ref} className="panel explore-panel" open={open}
    onToggle={event => (onOpenChange ?? setUncontrolledOpen)(event.currentTarget.open)}>
    <summary><strong>{title}</strong><span>{description}</span></summary>{open && children}
  </details>;
});
