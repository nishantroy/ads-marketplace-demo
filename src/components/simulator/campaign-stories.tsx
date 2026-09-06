import dynamic from "next/dynamic";
import type { Campaign, TimelineBucket } from "../../lib/contracts";
import { campaignPriceSeries, campaignSpendSeries, money } from "./playback";
import { Legend } from "./legend";

const TimelineChart = dynamic(() => import("./timeline-chart").then(module => module.TimelineChart), { ssr: false, loading: () => <div className="timeline-chart chart-loading">Loading chart…</div> });

type StoryDefinition = {
  campaignId: string;
  title: string;
  explanation: string;
  checkpointHour: number;
  checkpointLabel: string;
  /** The hour unpaced wins in bulk, verified against the baseline run: barely anything before it, almost nothing after. */
  spikeHour?: number;
};

const STORIES: StoryDefinition[] = [
  {
    campaignId: "travel-c0",
    title: "Spends almost immediately",
    explanation: "A strong campaign can use nearly its full budget before the session has really begun. Paced, the same budget instead reaches shoppers across the full six hours — and by staying in the marketplace late, this advertiser keeps setting competitive prices in other campaigns’ auctions too.",
    checkpointHour: 1,
    checkpointLabel: "spent by 1h",
  },
  {
    campaignId: "electronics-c2",
    title: "Quiet, then a spike, then nothing",
    explanation: "Unpaced, this campaign barely wins early — then, once bigger spenders exhaust their budgets, it wins in bulk for about an hour before its own budget runs out too. Paced, it wins steadily from the first hour instead of waiting for one brief window.",
    checkpointHour: 1,
    checkpointLabel: "spent by 1h",
    spikeHour: 2,
  },
  {
    campaignId: "home-c5",
    title: "An even sharper version of the same pattern",
    explanation: "Unpaced, this lower bidder barely spends anything for three hours, then spends almost its entire remaining budget in a single hour once stronger competitors are gone. Paced, it competes gradually from the start instead of waiting for one narrow window.",
    checkpointHour: 3,
    checkpointLabel: "spent by 3h",
    spikeHour: 4,
  },
];

function cumulativeAtHour(timeline: TimelineBucket[], campaignId: string, hour: number) {
  const boundary = hour * 60 * 60 * 1000;
  const bucket = timeline.find(item => item.endMs === boundary);
  return bucket?.campaigns.find(item => item.campaignId === campaignId)?.cumulativeSpendMicros ?? 0;
}

function spendInHour(timeline: TimelineBucket[], campaignId: string, hour: number) {
  return cumulativeAtHour(timeline, campaignId, hour) - cumulativeAtHour(timeline, campaignId, hour - 1);
}

function percent(value: number, budget: number) {
  return `${Math.round((value / budget) * 100)}%`;
}

/** Fixed teaching examples from the versioned baseline; metrics are always read from live paired output. */
export function CampaignStories({ campaigns, offTimeline, onTimeline, duration, onExplore }: {
  campaigns: Campaign[];
  offTimeline: TimelineBucket[];
  onTimeline: TimelineBucket[];
  duration: number;
  onExplore: (campaignId: string) => void;
}) {
  const stories = STORIES.map(story => ({ story, campaign: campaigns.find(campaign => campaign.id === story.campaignId) }))
    .filter((item): item is { story: StoryDefinition; campaign: Campaign } => Boolean(item.campaign));

  if (!stories.length || !offTimeline.length || !onTimeline.length) return null;
  return <section className="campaign-stories" aria-labelledby="campaign-stories-heading">
    <div className="section-heading"><div><p className="eyebrow">Three campaign stories</p><h2 id="campaign-stories-heading">The same budget can tell different stories</h2></div></div>
    <p className="campaign-stories-intro">These are not “best” or “worst” campaigns. They show why pacing changes timing differently for different bids, quality, and opportunities.</p>
    <p className="campaign-stories-intro">Each pair of charts below shows the same campaign two ways: when it is spending, and what it pays per impression as it wins. That price moves with real-time competition and with how relevant the ad is to each searcher — it is not fixed by the campaign’s own bid. Pacing’s value shows up here as steadier spending across the whole day, rather than one early rush or one late scramble.</p>
    <div className="campaign-story-stack">
      {stories.map(({ story, campaign }) => {
        const offCheckpoint = cumulativeAtHour(offTimeline, campaign.id, story.checkpointHour);
        const onCheckpoint = cumulativeAtHour(onTimeline, campaign.id, story.checkpointHour);
        const offSpike = story.spikeHour ? spendInHour(offTimeline, campaign.id, story.spikeHour) : null;
        return <article className="campaign-story" key={campaign.id}>
          <div className="campaign-story-summary">
            <p className="eyebrow">{campaign.objective} objective</p>
            <h3>{story.title}</h3>
            <p className="campaign-story-name">{campaign.name}</p>
            <p className="campaign-story-copy">{story.explanation}</p>
            <dl className="story-measures">
              <div><dt>Pacing off</dt><dd>{money(offCheckpoint)} <span>{percent(offCheckpoint, campaign.budgetMicros)} {story.checkpointLabel}</span></dd></div>
              <div><dt>Pacing on</dt><dd>{money(onCheckpoint)} <span>{percent(onCheckpoint, campaign.budgetMicros)} {story.checkpointLabel}</span></dd></div>
              {offSpike !== null && <div className="story-late"><dt>Off&rsquo;s big hour</dt><dd>{money(offSpike)} <span>won in hour {story.spikeHour} alone</span></dd></div>}
            </dl>
            <button className="text-button story-explore" onClick={() => onExplore(campaign.id)}>See this campaign’s full curve</button>
          </div>
          <div className="campaign-story-charts">
            <section className="chart-panel"><h3>Cumulative spend</h3>
              <TimelineChart points={campaignSpendSeries(offTimeline, campaign.id, false)} comparisonPoints={campaignSpendSeries(onTimeline, campaign.id, false)}
                durationMs={duration} label="Pacing off" comparisonLabel="Pacing on" maxValue={campaign.budgetMicros} cumulative />
              <Legend items={[{ swatch: "off", label: "Pacing off" }, { swatch: "on", label: "Pacing on" }]} />
            </section>
            <section className="chart-panel"><h3>Price per impression won</h3>
              <TimelineChart points={campaignPriceSeries(offTimeline, campaign.id)} comparisonPoints={campaignPriceSeries(onTimeline, campaign.id)}
                durationMs={duration} label="Pacing off" comparisonLabel="Pacing on" maxValue={campaign.bidMicros} />
              <Legend items={[{ swatch: "off", label: "Pacing off" }, { swatch: "on", label: "Pacing on" }]} />
              <p className="chart-caption">Gaps mean this campaign won nothing that bucket, not a free impression.</p>
            </section>
          </div>
        </article>;
      })}
    </div>
  </section>;
}
