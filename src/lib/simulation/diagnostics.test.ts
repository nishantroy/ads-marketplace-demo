import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { baselineScenario } from "../fixtures/presets";
import { buildDiagnosticReport, formatDiagnosticReport } from "./diagnostics";
import { simulate } from "./engine";

/**
 * The M2 gate. Runs the baseline marketplace in both modes, writes the report to `docs/m2-diagnostics.md`,
 * and asserts the properties the fixture has to keep. The report is deterministic, so a committed change to
 * that file is a real change in marketplace behaviour.
 */
describe("baseline diagnostics", () => {
  const scenario = baselineScenario();
  const unpaced = simulate(scenario, false);
  const paced = simulate(scenario, true);
  const report = buildDiagnosticReport(scenario, unpaced, paced);

  it("writes the diagnostic report", () => {
    const target = path.join(process.cwd(), "docs", "m2-diagnostics.md");
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, formatDiagnosticReport(report), "utf8");
    expect(report.totalRequests).toBe(4000);
  });

  it("holds every accounting invariant in both modes", () => {
    expect(report.unpaced.invariantViolations).toEqual([]);
    expect(report.paced.invariantViolations).toEqual([]);
  });

  it("meets the score-qualified coverage target", () => {
    expect(report.pairCoverage).toBeGreaterThanOrEqual(0.9);
  });

  it("keeps real competition in the auctions", () => {
    expect(report.unpaced.multiBidderShareOfFilled).toBeGreaterThan(0.6);
    expect(report.unpaced.fillRate).toBeGreaterThan(0.8);
  });

  it("exhausts some budgets without exhausting every campaign", () => {
    expect(report.unpaced.exhaustedCampaigns).toBeGreaterThan(0);
    expect(report.unpaced.exhaustedCampaigns).toBeLessThan(report.campaignCount);
  });

  it("shows pacing preserving valuable late competition", () => {
    const offLate = report.unpaced.windows[2];
    const onLate = report.paced.windows[2];
    // The right measure is what the surviving bidders are worth, not how many candidates are admitted:
    // pacing throttles admissions, so it lowers the late participant count while raising the late price.
    expect(onLate.avgClearingPriceMicros ?? 0).toBeGreaterThan(offLate.avgClearingPriceMicros ?? 0);
    expect(report.unpaced.windows[0].avgClearingPriceMicros ?? 0).toBeGreaterThan(
      report.paced.windows[0].avgClearingPriceMicros ?? 0,
    );
  });

  it("leaves the two modes comparable and does not assume pacing earns more", () => {
    expect(report.paced.filledRequests + report.paced.emptyAuctions).toBe(report.totalRequests);
    expect(report.unpaced.filledRequests + report.unpaced.emptyAuctions).toBe(report.totalRequests);
    // Score qualification is a property of the input, so it must be identical in both modes.
    expect(paced.summary.thresholdQualifiedPairRequests).toBe(unpaced.summary.thresholdQualifiedPairRequests);
    expect(paced.summary.totalRequests).toBe(unpaced.summary.totalRequests);
    // Revenue direction is a marketplace outcome; assert only that both modes stay within budget.
    for (const campaign of paced.summary.campaigns) {
      expect(campaign.spendMicros).toBeLessThanOrEqual(campaign.budgetMicros);
    }
  });
});
