import type { Campaign, TimelineBucket } from "../../lib/contracts";
import { money } from "./playback";

type StoryDefinition = {
  campaignId: string;
  title: string;
  explanation: string;
  checkpointHour: number;
  checkpointLabel: string;
  lateLabel?: string;
};

const STORIES: StoryDefinition[] = [
  {
    campaignId: "travel-c0",
    title: "Spends almost immediately",
    explanation: "A strong campaign can use nearly its full budget before the session has really begun.",
    checkpointHour: 1,
    checkpointLabel: "spent by 1h",
  },
  {
    campaignId: "electronics-c2",
    title: "Stays in later auctions",
    explanation: "Pacing can leave budget available for impressions after the unpaced version has stopped competing.",
    checkpointHour: 3,
    checkpointLabel: "spent by 3h",
    lateLabel: "spent in final hour",
  },
  {
    campaignId: "home-c5",
    title: "Does not follow the same pattern",
    explanation: "A lower-tier campaign may win later without pacing; pacing changes its timing, not just its speed.",
    checkpointHour: 3,
    checkpointLabel: "spent by 3h",
  },
];

function cumulativeAtHour(timeline: TimelineBucket[], campaignId: string, hour: number) {
  const boundary = hour * 60 * 60 * 1000;
  const bucket = timeline.find(item => item.endMs === boundary);
  return bucket?.campaigns.find(item => item.campaignId === campaignId)?.cumulativeSpendMicros ?? 0;
}

function finalHourSpend(timeline: TimelineBucket[], campaignId: string) {
  const final = timeline.at(-1)?.campaigns.find(item => item.campaignId === campaignId)?.cumulativeSpendMicros ?? 0;
  return final - cumulativeAtHour(timeline, campaignId, 5);
}

function percent(value: number, budget: number) {
  return `${Math.round((value / budget) * 100)}%`;
}

/** Fixed teaching examples from the versioned baseline; metrics are always read from live paired output. */
export function CampaignStories({ campaigns, offTimeline, onTimeline, onExplore }: {
  campaigns: Campaign[];
  offTimeline: TimelineBucket[];
  onTimeline: TimelineBucket[];
  onExplore: (campaignId: string, hour: number) => void;
}) {
  const stories = STORIES.map(story => ({ story, campaign: campaigns.find(campaign => campaign.id === story.campaignId) }))
    .filter((item): item is { story: StoryDefinition; campaign: Campaign } => Boolean(item.campaign));

  if (!stories.length || !offTimeline.length || !onTimeline.length) return null;
  return <section className="campaign-stories" aria-labelledby="campaign-stories-heading">
    <div className="section-heading"><div><p className="eyebrow">Three campaign stories</p><h2 id="campaign-stories-heading">The same budget can tell different stories</h2></div><p className="small muted">Examples from this seeded marketplace</p></div>
    <p className="campaign-stories-intro">These are not “best” or “worst” campaigns. They show why pacing changes timing differently for different bids, quality, and opportunities.</p>
    <div className="campaign-story-grid">
      {stories.map(({ story, campaign }) => {
        const offCheckpoint = cumulativeAtHour(offTimeline, campaign.id, story.checkpointHour);
        const onCheckpoint = cumulativeAtHour(onTimeline, campaign.id, story.checkpointHour);
        const offLate = story.lateLabel ? finalHourSpend(offTimeline, campaign.id) : null;
        const onLate = story.lateLabel ? finalHourSpend(onTimeline, campaign.id) : null;
        return <article className="campaign-story" key={campaign.id}>
          <p className="eyebrow">{campaign.objective} objective</p>
          <h3>{story.title}</h3>
          <p className="campaign-story-name">{campaign.name}</p>
          <p className="campaign-story-copy">{story.explanation}</p>
          <dl className="story-measures">
            <div><dt>Pacing off</dt><dd>{money(offCheckpoint)} <span>{percent(offCheckpoint, campaign.budgetMicros)} {story.checkpointLabel}</span></dd></div>
            <div><dt>Pacing on</dt><dd>{money(onCheckpoint)} <span>{percent(onCheckpoint, campaign.budgetMicros)} {story.checkpointLabel}</span></dd></div>
            {story.lateLabel && <div className="story-late"><dt>Late activity</dt><dd>{money(offLate!)} off / {money(onLate!)} on <span>{story.lateLabel}</span></dd></div>}
          </dl>
          <button className="text-button story-explore" onClick={() => onExplore(campaign.id, story.checkpointHour)}>See this campaign’s full curve →</button>
        </article>;
      })}
    </div>
  </section>;
}
