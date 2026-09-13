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
import { SessionResults } from "./session-results";
import { FunnelDiagram, type FunnelStage } from "./funnel-diagram";
import { ScrollCue } from "./scroll-cue";

const TimelineChart = dynamic(() => import("./timeline-chart").then(module => module.TimelineChart), { ssr: false, loading: () => <div className="timeline-chart chart-loading">Loading chart…</div> });

/** Every guided scene autoplays at this fixed rate; there is no speed control and no pause. */
const AUTOPLAY_MS_PER_BUCKET = 1000 / 15;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json() as T | ApiError;
  if (!response.ok) throw new Error((body as ApiError).error?.message ?? "Unable to reach the live demo.");
  return body as T;
}

type Step = "opening" | "marketplace" | "tutorialFunnel" | "briefing" | "unpaced" | "paced" | "compare" | "explore" | "requests";
/** Only the cold-open landing scene has no rail entry; every stage after it does, for consistent navigation. */
const RAIL: { id: Step; label: string }[] = [
  { id: "marketplace", label: "The marketplace" },
  { id: "tutorialFunnel", label: "How it works" },
  { id: "briefing", label: "Experiment setup" },
  { id: "unpaced", label: "Pacing off" },
  { id: "paced", label: "Pacing on" },
  { id: "compare", label: "Compare" },
  { id: "explore", label: "Explore campaigns" },
  { id: "requests", label: "Explore individual requests" },
];

/** The current stage lives in the URL, so a reload lands back where you were instead of the opening scene. */
const STEP_SLUGS: Record<Step, string> = {
  opening: "/", marketplace: "/marketplace", tutorialFunnel: "/how-it-works", briefing: "/briefing",
  unpaced: "/pacing-off", paced: "/pacing-on", compare: "/compare", explore: "/explore", requests: "/explore-requests",
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
      { term: "Request", body: "One search opportunity. In this demo it carries a category, simulated time, and a user ID linked to a user segment and category relevance scores." },
      { term: "Category", body: "The type of thing being searched for (Shoes). It decides which campaigns even get considered." },
    ],
  },
  {
    id: "retrieve", label: "Retrieve candidates", width: 0.88,
    intro: "Every advertiser running an ad in that category gets pulled in as a possible match.",
    points: [
      { term: "Campaign", body: "In this demo, one advertiser’s ad and its settings: category, objective, bid, budget, and affinity for different user segments." },
      { term: "Candidate", body: "Any campaign running in the matching category and considered for this one request." },
    ],
  },
  {
    id: "pacing", label: "Budget & pacing", width: 0.74,
    intro: "Every campaign has money set aside for the whole six-hour session.",
    points: [
      { term: "Budget", body: "The total a campaign can spend across the session \u2014 a spending limit for the whole trip, not just one purchase." },
      { term: "Pacing", body: "An optional setting that aims to spread spending over time. It compares spending with a target and can skip auctions to preserve budget for later; it does not guarantee delivery." },
    ],
  },
  {
    id: "quality", label: "Quality gate", width: 0.58,
    intro: "Not every candidate is a good match for this particular searcher.",
    points: [
      { term: "Quality", body: "A score combining engagement with relevance to this user. Our demo uses seeded engagement values, user category relevance, and campaign affinity for the user’s segment—not learned predictions or observed purchases." },
      { term: "Gate", body: "Campaigns below a minimum quality score are dropped here, no matter how much they would pay. This enforces a modelled quality floor, not a guarantee of user satisfaction." },
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
      { term: "Price", body: "A quality-adjusted second price: runner-up utility divided by winner quality, rounded to integer microdollars, with a minimum price and a cap at the winner’s available bid. A sole bidder pays the minimum." },
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
  // Presentation-only memory for this page visit; no persistence or simulation state.
  const completedPlayback = useRef<Partial<Record<"unpaced" | "paced", number>>>({});
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | undefined>();
  const [tutorialStageIndex, setTutorialStageIndex] = useState(0);
  const [prediction, setPrediction] = useState<"more" | "less" | "same" | null>(null);
  const [campaignPanelOpen, setCampaignPanelOpen] = useState(false);
  const campaignPanelRef = useRef<HTMLDetailsElement>(null);
  const [requestRows, setRequestRows] = useState<MergedRequestRow[]>([]);
  const [requestTotal, setRequestTotal] = useState(0);
  const [requestLoading, setRequestLoading] = useState(false);
  const [inspectionLoading, setInspectionLoading] = useState(false);
  const inspectionVersion = useRef(0);
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
    if (reducedMotion || completedPlayback.current[step]) { setCursor(cap); return; }
    const timer = window.setInterval(() => setCursor(value => Math.min(value + 1, cap)), AUTOPLAY_MS_PER_BUCKET);
    return () => window.clearInterval(timer);
  }, [step, offTimeline.length, onTimeline.length, reducedMotion]);

  useEffect(() => {
    if (step !== "unpaced" && step !== "paced") return;
    const cap = step === "unpaced" ? offTimeline.length : onTimeline.length;
    if (cap > 0 && cursor >= cap) completedPlayback.current[step] = cap;
  }, [step, cursor, offTimeline.length, onTimeline.length]);

  // Direct links and browser history can choose Compare before timelines finish loading. Once they do,
  // comparison/exploration always begins from the completed experiment, never a stale zero cursor.
  useEffect(() => {
    if ((step === "compare" || step === "explore") && timelineLength > 0) setCursor(timelineLength);
  }, [step, timelineLength]);

  function applyStep(next: Step) {
    setStep(next); closeInspector();
    // A quick click through unpaced/paced must not leave compare reading a half-finished cursor position:
    // compare and explore always show the complete session, regardless of how fast someone clicked here.
    if (next === "unpaced" || next === "paced") setCursor(completedPlayback.current[next] ?? 0);
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

  function closeInspector() {
    inspectionVersion.current += 1;
    setInspecting(null);
    setInspectionLoading(false);
  }

  async function inspect(requestId?: string) {
    if (!offRun || !onRun || !scenario) return;
    const version = ++inspectionVersion.current;
    setError(null); setInspectionLoading(true);
    try {
      if (!requestId) {
        const total = scenario.requestCount;
        if (!total) return;
        const current = (inspecting?.off ?? inspecting?.on)?.sequence;
        // Random navigation only; never changes engine inputs or recorded outcomes.
        let sequence = Math.floor(Math.random() * (current !== undefined && total > 1 ? total - 1 : total));
        if (current !== undefined && total > 1 && sequence >= current) sequence += 1;
        const page = await api<{ items: { requestId: string }[] }>(`/api/runs/${offRun.id}/requests?cursor=${sequence}&limit=1`);
        requestId = page.items[0]?.requestId;
        if (!requestId) throw new Error("No request available at that position.");
      }
      const [offResponse, onResponse] = await Promise.all([
        api<{ trace: RequestTrace }>(`/api/runs/${offRun.id}/requests/${requestId}`),
        api<{ trace: RequestTrace }>(`/api/runs/${onRun.id}/requests/${requestId}`),
      ]);
      if (version === inspectionVersion.current) setInspecting({ off: offResponse.trace, on: onResponse.trace });
    } catch (error) {
      if (version === inspectionVersion.current) setError(error instanceof Error ? error.message : "Unable to load that request.");
    } finally {
      if (version === inspectionVersion.current) setInspectionLoading(false);
    }
  }

  // Explore fetches once, independent of any cursor: it is the finished-experiment view, not a playback one.
  useEffect(() => {
    if (step !== "requests" || !offRun || !onRun) { setRequestRows([]); setRequestTotal(0); return; }
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

  // Both views use the same recorded series and axis bounds. Null prices stay gaps.
  const auctionCharts = <>
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
  </>;

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
        <div className="step-actions"><button className="button ghost" onClick={() => goToStep("marketplace")}>See how it works</button></div>
      </div>
    </section>}

    {step === "marketplace" && <section className="scene marketplace-scene">
      <div className="scene-content">
        <p className="eyebrow">The marketplace</p>
        <h1>One ad slot. Three sides to satisfy.</h1>
        <h2>The challenge:</h2>
        <p className="lede">People come to our example search engine to find something useful. Each results page offers
          one ad slot alongside those results. Advertisers are the ads platform’s paying customers: they buy a chance
          to reach the person behind the search.</p>
        <p className="lede">Advertisers want the right audience at the right time—when someone is likely to be interested in their product—and
          at a price that makes business sense. If the goal is a sale, the cost of attracting customers needs to leave room for profit.</p>
        <p className="lede"> So the platform cannot simply sell every slot to the highest bidder. It needs to balance three goals:</p>
        <ol className="concept-points">
          <li><span className="term">Value for the user</span>Show an ad that is relevant to what this person is looking for, rather than getting in their way.</li>
          <li><span className="term">Value for the advertiser</span>Let an ad win when reaching this person is likely to help the advertiser achieve its goal, at a worthwhile price.</li>
          <li><span className="term">Value for the platform</span>Earn revenue now while keeping users and advertisers satisfied enough to return. The highest payment today is not necessarily the best outcome over time.</li>
        </ol>
        <h2>A real auction simulation.</h2>
        <p className="lede">We built a working auction simulator to make these trade-offs visible. It evaluates matching ads, chooses winners,
          calculates prices, and updates budgets for simulated searches. Relevance and quality scores stand in for expected
          value; we do not simulate actual purchases, advertiser profit, or long-term satisfaction.</p>
        <h2>Four terms before we follow one search</h2>
        <dl className="marketplace-terms">
          <div><dt>Campaign</dt><dd>An advertiser’s ad and its settings: who it aims to reach, what it wants to achieve, and how much it can spend.</dd></div>
          <div><dt>Objective</dt><dd>The campaign’s goal: being seen (an impression), getting a click, or prompting an action such as a purchase (a conversion). In this demo, every objective still pays per impression—not per click or purchase.</dd></div>
          <div><dt>Bid</dt><dd>The most a campaign is willing to pay for one impression. It is a ceiling, not necessarily the price the winner pays.</dd></div>
          <div><dt>Budget</dt><dd>The total a campaign can spend across the session. Every winning charge reduces what is left.</dd></div>
        </dl>
        <div className="step-actions"><button className="button primary" onClick={() => goToStep("tutorialFunnel")}>Follow one search through the auction</button></div>
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
        <p className="eyebrow">Experiment setup</p>
        <h1>A working auction engine. Two ways to spend.</h1>
        {scenario && <p className="lede">{scenario.requestCount.toLocaleString("en-US")} simulated search requests,
          {" "}{scenario.users.length} simulated users, and {scenario.campaigns.length} campaigns over {duration / 3_600_000} hours.
          These are simulated inputs—not real advertising traffic—but every request goes through a working end-to-end ads auction.</p>}
        <ol className="concept-points">
          <li><span className="term">Process every request</span>The engine retrieves matching campaigns, checks budgets and quality, ranks by bid × quality, and runs a quality-adjusted second-price auction. A winner pays for one impression; that charge immediately reduces its remaining budget before the next request.</li>
          <li><span className="term">Change only pacing</span>Both runs start with identical requests, users, campaigns, bids, and fresh budgets. Pacing off lets campaigns compete as fast as they can. Pacing on holds some participation back to spread spending across the session.</li>
          <li><span className="term">Replay the recorded outcomes</span>The following charts reveal results already computed by the engine—first pacing off, then on. No curves or winners are invented for the animation. Explore lets you inspect the candidates, winner, and charge behind an individual request.</li>
        </ol>

        <h2> Why did we choose pacing as the variable for this demo? </h2>
        <p className="lede">Pacing is a simple concept (hold a campaign back when it’s spending too fast) but its effects ripple through the entire marketplace.
        It changes which campaigns are eligible to compete over time, which in turn changes auction outcomes and how opportunities are allocated across the day. 
        These are the dynamics you can watch unfold.—not a measurement of satisfaction or profit.</p>
        <p className="lede">Quality predictions can also affect delivery, but this experiment holds the scores fixed rather than testing prediction improvements.
        Pacing is more distinctly an ads problem: deciding not just which ad should win, but when a campaign should compete at all.  </p>
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
            {step === "unpaced" && "Recorded pacing-off results through " + sessionTime(cutoffMs) + "."}
            {step === "paced" && "Recorded pacing-on results through " + sessionTime(cutoffMs) + "; dotted line: even-spend target."}
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
            <h2>Highest utility wins—not simply the highest bid</h2>
            <p>Every incoming request is a small auction. Whoever wins pays a price shaped by the next-best utility,
              not their own bid.</p>
            <ul className="concept-points">
              <li><span className="term">No pacing</span>Pacing excludes nobody. Matching campaigns still need enough budget, sufficient quality, and a place in the shortlist to compete.</li>
              <li><span className="term">Cheap late impressions</span>Once the strongest campaigns run out of budget, only weaker bidders remain — so late auctions often clear at a lower price.</li>
            </ul>
          </>}
          {step === "paced" && <>
            <h2>Pacing trades speed for reach</h2>
            <p>Instead of spending as fast as it can win, a paced campaign checks itself against a target before every auction.</p>
            <ul className="concept-points">
              <li><span className="term">Target spend</span>The straight-line pace a campaign would follow if it spent its whole budget evenly across the six hours. The dotted line is the marketplace-wide version of that target.</li>
              <li><span className="term">Admission</span>Behind target, a campaign has an admission chance that grows with its spending gap. At or ahead of target, it sits out—even if it could afford to bid.</li>
            </ul>
          </>}
          {step === "compare" && <>
            <h2>Pacing changes the spend pattern, not necessarily total revenue</h2>
            {prediction && <p className="predict-recap">You predicted pacing would <strong>{prediction === "more" ? "increase" : prediction === "less" ? "decrease" : "barely change"}</strong> revenue.</p>}
            <p>Pacing off finished with <strong>{money(offRevenue)}</strong>; pacing on finished with <strong>{money(onRevenue)}</strong> —
              similar revenue, not a revenue lift from pacing in this experiment.</p>
            <p>Budgets are finite in both runs. Spending the same pool more evenly can buy more impressions at lower average prices and leave money available for later searches. More filled requests need not mean more revenue.</p>
            <p>In this recorded session, pacing spreads spend more evenly instead of letting it front-load. </p>
            <p> Scroll down for a side-by-side comparison of the results over time. </p>
          </>}
        </aside>

        {bothReady && (step === "compare" || cursor >= (step === "unpaced" ? offTimeline.length : onTimeline.length)) && <>
          <SessionResults duration={duration} modes={step === "unpaced" ? [{ label: "Pacing off", timeline: offTimeline }]
            : step === "paced" ? [{ label: "Pacing on", timeline: onTimeline }]
            : [{ label: "Pacing off", timeline: offTimeline }, { label: "Pacing on", timeline: onTimeline }]} />
          {step === "compare" && <section className="comparison-evidence">
            <h3>Why timing changes the auction</h3>
            <p>Without pacing, strong bid × quality competitors can spend early. As their budgets run out, they can no longer win or support another winner’s price. Prices can fall as competition thins; when nobody remains, requests go unfilled.</p>
            <p>Pacing deliberately reduces early participation to keep budgets available later. Compare the changing prices and late competition below—not just the revenue total. The hourly table above also reveals the trade-off: holding budget back can leave some early requests unfilled.</p>
            {auctionCharts}
          </section>}
        </>}

        <div className="step-actions">
          <button className="button primary" onClick={() => goToStep(step === "unpaced" ? "paced" : step === "paced" ? "compare" : "explore")}>
            {step === "unpaced" ? "Turn pacing on" : step === "paced" ? "Compare the results" : "Dig deeper"}
          </button>
        </div>
      </div>
    </section>}

    {step === "explore" && <div className="explore-page">
      <p className="eyebrow">Explore campaigns</p>
      <h1>Follow the budget</h1>
      <p className="lede">See when each campaign spends its budget across the complete session, with pacing off and on.</p>

      <CampaignStories campaigns={scenario?.campaigns ?? []} offTimeline={offTimeline} onTimeline={onTimeline} duration={duration}
        onExplore={id => {
          setSelectedCampaignId(id); setCampaignPanelOpen(true);
          requestAnimationFrame(() => campaignPanelRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" }));
        }} />

      <Disclosure ref={campaignPanelRef} title="Explore one campaign" description="See its full spend curve against the same budget in each mode."
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
      <div className="step-actions"><button className="button primary" onClick={() => goToStep("requests")}>Explore individual requests</button></div>
    </div>}

    {step === "requests" && <div className="explore-page">
      <p className="eyebrow">Explore individual requests</p>
      <h1>What happened in one auction?</h1>
      <p className="lede">Inspect the same search with pacing off and on: who entered, who won, what they paid, and how their budget changed.</p>
      <div className="step-actions"><button className="button primary" disabled={!bothReady || inspectionLoading || !scenario?.requestCount} onClick={() => void inspect()}>
        {inspectionLoading ? "Loading auction…" : "See what happened in one auction"}
      </button></div>
      <p className="small muted">Explore a random request, or choose a request below.</p>
        <section className="requests-panel" aria-label="Request explorer">
          <div className="section-heading"><h3>Request explorer</h3></div>
          {requestLoading ? <p className="table-empty">Loading requests…</p> : !requestRows.length ? <p className="table-empty">No requests available.</p> : <div className="table-scroll"><table>
            <thead><tr><th>Time / request</th><th>Search</th><th>Pacing off</th><th>Pacing on</th><th><span className="sr-only">Details</span></th></tr></thead>
            <tbody>{requestRows.map(row => <tr key={row.requestId}>
              <td><strong className="mono">{sessionTime(row.timestampMs)}</strong><small>{row.requestId}</small></td>
              <td><strong>{row.query ?? row.category}</strong><small>{row.category} · {row.userId}</small></td>
              <td><strong>{campaignName(row.off?.winnerCampaignId ?? null)}</strong><small>{row.off?.filled ? money(row.off.priceMicros) : "No charge"} · {row.off?.participantCount ?? 0} bidders</small></td>
              <td><strong>{campaignName(row.on?.winnerCampaignId ?? null)}</strong><small>{row.on?.filled ? money(row.on.priceMicros) : "No charge"} · {row.on?.participantCount ?? 0} bidders</small></td>
              <td><button className="inspect-button" disabled={inspectionLoading} onClick={() => void inspect(row.requestId)}>Inspect</button></td>
            </tr>)}</tbody>
          </table></div>}
          <div className="table-footer"><span>{requestRows.length ? `Showing first ${requestRows.length} of ${requestTotal.toLocaleString()} requests` : "No requests"}</span></div>
        </section>
    </div>}

    <ScrollCue />

    {railIndex >= 0 && <nav className="rail" aria-label="Guide progress">
      <button className="rail-dot rail-restart" onClick={() => goToStep("opening")}>
        <span className="dot" aria-hidden="true" /><span>Start over</span>
      </button>
      {RAIL.map((item, index) => <button key={item.id} className={`rail-dot ${item.id === step ? "active" : ""} ${index < railIndex ? "done" : ""}`}
        onClick={() => goToStep(item.id)} aria-current={item.id === step ? "step" : undefined}>
        <span className="dot" aria-hidden="true" /><span>{item.label}</span>
      </button>)}
    </nav>}

    {inspecting && scenario && <RequestSheet off={inspecting.off} on={inspecting.on} scenario={scenario} onClose={closeInspector}
      onAnother={() => void inspect()} loading={inspectionLoading} error={error} />}
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
