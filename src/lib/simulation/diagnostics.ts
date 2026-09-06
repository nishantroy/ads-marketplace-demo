import {
  formatMicros,
  type CandidateOutcome,
  type RunOutput,
  type ScenarioSnapshot,
} from "../contracts";
import { checkInvariants } from "./invariants";
import { inputHash } from "./snapshot";
import { ENGINE_VERSION } from "./version";

/**
 * Paired-run diagnostics. Pure: builds a report object and formats it as Markdown, writing nothing.
 * Both modes must come from the same snapshot, which is what makes them comparable.
 */

export interface WindowStats {
  label: string;
  requests: number;
  filled: number;
  /** Mean participants per request, counting empty auctions as zero participants. */
  avgParticipants: number | null;
  avgClearingPriceMicros: number | null;
  revenueMicros: number;
}

export interface ModeReport {
  pacingEnabled: boolean;
  filledRequests: number;
  fillRate: number;
  emptyAuctions: number;
  multiBidderAuctions: number;
  multiBidderShareOfFilled: number;
  /**
   * Share of contested auctions in which a losing participant bid more than the winner. This is the utility
   * auction doing its job: ranking on bid alone would make it zero by construction.
   */
  winnerOutbidShare: number;
  revenueMicros: number;
  avgClearingPriceMicros: number | null;
  unspentBudgetMicros: number;
  /**
   * Campaigns that spent at least 95% and at least 99% of their budget. This is the honest measure of
   * "completed its spend". The `exhaustedCampaigns` count below is knife-edge: it only counts a campaign
   * once its remaining budget falls under the reserve, so a paced campaign sitting at 99.5% of budget with
   * a few cents left is not counted even though it has effectively delivered its whole budget.
   */
  campaignsSpent95: number;
  campaignsSpent99: number;
  exhaustedCampaigns: number;
  /** Median simulated time at which a campaign fell below the reserve; null when none did. */
  medianExhaustionMs: number | null;
  /** Candidate-level attrition, so threshold qualification is separated from pacing and shortlist losses. */
  attrition: Record<CandidateOutcome, number>;
  windows: WindowStats[];
  /** Cumulative spend per campaign at each hour boundary. */
  spendTrajectory: Array<{ campaignId: string; budgetMicros: number; byHour: number[] }>;
  invariantViolations: string[];
}

export interface DiagnosticReport {
  scenarioId: string;
  scenarioVersion: string;
  seed: string;
  engineVersion: string;
  inputHash: string;
  totalRequests: number;
  campaignCount: number;
  userCount: number;
  categories: string[];
  /** Share of requests with at least one, and at least two, score-qualified campaigns before budget and pacing. */
  qualifiedCoverage: number;
  pairCoverage: number;
  unpaced: ModeReport;
  paced: ModeReport;
}

const HOUR = 60 * 60 * 1000;

function emptyAttrition(): Record<CandidateOutcome, number> {
  return {
    won: 0,
    lost: 0,
    excluded_budget: 0,
    excluded_pacing: 0,
    excluded_threshold: 0,
    excluded_shortlist: 0,
    excluded_reserve: 0,
  };
}

function countSpentAtLeast(
  campaigns: Array<{ budgetMicros: number; spendMicros: number }>,
  fraction: number,
): number {
  return campaigns.filter((c) => c.budgetMicros > 0 && c.spendMicros / c.budgetMicros >= fraction).length;
}

function windowStats(label: string, snapshot: ScenarioSnapshot, output: RunOutput, from: number, to: number): WindowStats {
  const traces = output.traces.filter((t) => t.timestampMs >= from && t.timestampMs < to);
  const filled = traces.filter((t) => t.filled);
  const revenue = filled.reduce((total, t) => total + t.priceMicros, 0);
  return {
    label,
    requests: traces.length,
    filled: filled.length,
    avgParticipants: traces.length === 0 ? null : traces.reduce((n, t) => n + t.participantCount, 0) / traces.length,
    avgClearingPriceMicros: filled.length === 0 ? null : revenue / filled.length,
    revenueMicros: revenue,
  };
}

function buildModeReport(snapshot: ScenarioSnapshot, output: RunOutput, pacingEnabled: boolean): ModeReport {
  const { summary } = output;
  const attrition = emptyAttrition();
  let contested = 0;
  let winnerOutbid = 0;
  for (const trace of output.traces) {
    for (const candidate of trace.candidates) attrition[candidate.outcome] += 1;
    if (!trace.winnerCampaignId || trace.participantCount < 2) continue;
    contested += 1;
    const winnerBid = trace.candidates.find((c) => c.campaignId === trace.winnerCampaignId)?.bidMicros ?? 0;
    const outbid = trace.candidates.some(
      (c) =>
        c.auction.evaluated &&
        c.auction.participates &&
        c.campaignId !== trace.winnerCampaignId &&
        c.bidMicros > winnerBid,
    );
    if (outbid) winnerOutbid += 1;
  }

  const exhaustions = summary.campaigns
    .map((c) => c.exhaustedAtMs)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);

  const sessionEnd = snapshot.config.sessionDurationMs;
  const hours = Math.ceil(sessionEnd / HOUR);

  return {
    pacingEnabled,
    filledRequests: summary.filledRequests,
    fillRate: summary.totalRequests === 0 ? 0 : summary.filledRequests / summary.totalRequests,
    emptyAuctions: summary.emptyAuctions,
    multiBidderAuctions: summary.multiBidderAuctions,
    multiBidderShareOfFilled:
      summary.filledRequests === 0 ? 0 : summary.multiBidderAuctions / summary.filledRequests,
    winnerOutbidShare: contested === 0 ? 0 : winnerOutbid / contested,
    revenueMicros: summary.revenueMicros,
    avgClearingPriceMicros: summary.avgClearingPriceMicros,
    unspentBudgetMicros: summary.campaigns.reduce((total, c) => total + (c.budgetMicros - c.spendMicros), 0),
    campaignsSpent95: countSpentAtLeast(summary.campaigns, 0.95),
    campaignsSpent99: countSpentAtLeast(summary.campaigns, 0.99),
    exhaustedCampaigns: exhaustions.length,
    medianExhaustionMs: exhaustions.length === 0 ? null : exhaustions[Math.floor((exhaustions.length - 1) / 2)],
    attrition,
    windows: [
      windowStats("first hour", snapshot, output, 0, HOUR),
      windowStats("middle", snapshot, output, HOUR, sessionEnd - HOUR),
      windowStats("last hour", snapshot, output, sessionEnd - HOUR, sessionEnd),
    ],
    spendTrajectory: snapshot.campaigns.map((campaign) => {
      const byHour: number[] = [];
      for (let hour = 1; hour <= hours; hour += 1) {
        const bucket = output.timeline.filter((b) => b.endMs <= hour * HOUR).pop();
        const metrics = bucket?.campaigns.find((c) => c.campaignId === campaign.id);
        byHour.push(metrics?.cumulativeSpendMicros ?? 0);
      }
      return { campaignId: campaign.id, budgetMicros: campaign.budgetMicros, byHour };
    }),
    invariantViolations: checkInvariants(snapshot, output),
  };
}

export function buildDiagnosticReport(
  snapshot: ScenarioSnapshot,
  unpaced: RunOutput,
  paced: RunOutput,
): DiagnosticReport {
  const total = unpaced.summary.totalRequests;
  return {
    scenarioId: snapshot.scenarioId,
    scenarioVersion: snapshot.version,
    seed: snapshot.seed,
    engineVersion: ENGINE_VERSION,
    inputHash: inputHash(snapshot),
    totalRequests: total,
    campaignCount: snapshot.campaigns.length,
    userCount: snapshot.users.length,
    categories: snapshot.categories,
    qualifiedCoverage: total === 0 ? 0 : unpaced.summary.thresholdQualifiedRequests / total,
    pairCoverage: total === 0 ? 0 : unpaced.summary.thresholdQualifiedPairRequests / total,
    unpaced: buildModeReport(snapshot, unpaced, false),
    paced: buildModeReport(snapshot, paced, true),
  };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function money(value: number | null): string {
  return value === null ? "n/a" : formatMicros(Math.round(value));
}

function clock(ms: number | null): string {
  if (ms === null) return "never";
  const minutes = Math.floor(ms / 60000);
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
}

function modeSection(report: ModeReport): string[] {
  const label = report.pacingEnabled ? "Pacing on" : "Pacing off";
  const lines = [
    `### ${label}`,
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Filled requests | ${report.filledRequests} (${pct(report.fillRate)}) |`,
    `| Empty auctions | ${report.emptyAuctions} |`,
    `| Multi-bidder share of filled | ${pct(report.multiBidderShareOfFilled)} |`,
    `| Contested auctions won despite a higher losing bid | ${pct(report.winnerOutbidShare)} |`,
    `| Revenue | ${money(report.revenueMicros)} |`,
    `| Average clearing price | ${money(report.avgClearingPriceMicros)} |`,
    `| Unspent budget | ${money(report.unspentBudgetMicros)} |`,
    `| Campaigns that spent 95% of budget | ${report.campaignsSpent95} |`,
    `| Campaigns that spent 99% of budget | ${report.campaignsSpent99} |`,
    `| Campaigns with less than the reserve left | ${report.exhaustedCampaigns} (median ${clock(report.medianExhaustionMs)}) |`,
    `| Invariant violations | ${report.invariantViolations.length === 0 ? "none" : report.invariantViolations.join("; ")} |`,
    "",
    "| Window | Requests | Filled | Avg participants | Avg clearing price |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const w of report.windows) {
    lines.push(
      `| ${w.label} | ${w.requests} | ${w.filled} | ${w.avgParticipants === null ? "n/a" : w.avgParticipants.toFixed(2)} | ${money(w.avgClearingPriceMicros)} |`,
    );
  }
  lines.push("", "Candidate attrition (every retrieved campaign on every request):", "");
  lines.push("| Outcome | Candidates |", "| --- | ---: |");
  for (const [outcome, count] of Object.entries(report.attrition)) {
    lines.push(`| ${outcome} | ${count} |`);
  }
  return lines;
}

/** Deterministic Markdown rendering of a report, so the committed file only changes when results change. */
export function formatDiagnosticReport(report: DiagnosticReport): string {
  const lines = [
    `# ${report.scenarioId} diagnostics`,
    "",
    "Generated by `npm run diagnose`. Both modes use the identical input snapshot, so they are comparable;",
    "pacing is the only difference. Higher paced revenue is not expected or asserted.",
    "",
    "Read budget delivery from the 95% and 99% rows, not from the reserve row. A campaign holding a few",
    "cents is done delivering; the reserve row is knife-edge and understates paced delivery.",
    "",
    "| Input | Value |",
    "| --- | --- |",
    `| Scenario version | ${report.scenarioVersion} |`,
    `| Seed | ${report.seed} |`,
    `| Engine version | ${report.engineVersion} |`,
    `| Input hash | ${report.inputHash} |`,
    `| Requests / campaigns / users | ${report.totalRequests} / ${report.campaignCount} / ${report.userCount} |`,
    `| Categories | ${report.categories.join(", ")} |`,
    "",
    "## Quality qualification",
    "",
    "Measured before budget and pacing exclusions, so it isolates the quality gate.",
    "",
    `- At least one quality-qualified campaign: ${pct(report.qualifiedCoverage)} of requests.`,
    `- At least two quality-qualified campaigns: ${pct(report.pairCoverage)} of requests (target 90%).`,
    "",
    "## Paired runs",
    "",
    ...modeSection(report.unpaced),
    "",
    ...modeSection(report.paced),
    "",
    "## Spend trajectory",
    "",
    "Cumulative spend per campaign at each hour, unpaced then paced.",
    "",
    "| Campaign | Budget | " + hourHeaders(report.unpaced) + " | " + hourHeaders(report.paced, true) + " |",
    "| --- | ---: | " + report.unpaced.spendTrajectory[0]?.byHour.map(() => "---: ").join("| ") + "| " +
      report.paced.spendTrajectory[0]?.byHour.map(() => "---: ").join("| ") + "|",
  ];

  for (let i = 0; i < report.unpaced.spendTrajectory.length; i += 1) {
    const off = report.unpaced.spendTrajectory[i];
    const on = report.paced.spendTrajectory[i];
    lines.push(
      `| ${off.campaignId} | ${money(off.budgetMicros)} | ${off.byHour.map(money).join(" | ")} | ${on.byHour.map(money).join(" | ")} |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

function hourHeaders(report: ModeReport, paced = false): string {
  const hours = report.spendTrajectory[0]?.byHour.length ?? 0;
  const suffix = paced ? " on" : " off";
  return Array.from({ length: hours }, (_, i) => `${i + 1}h${suffix}`).join(" | ");
}
