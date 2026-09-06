import { assertMicros, type ScenarioSnapshot, type ScenarioSummary, type SimRequest } from "../contracts";
import { digestHex, stableStringify } from "./hash";

/** Stable request order: timestamp ascending, then request id ascending. */
export function compareRequests(a: SimRequest, b: SimRequest): number {
  if (a.timestampMs !== b.timestampMs) return a.timestampMs - b.timestampMs;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Hash of the full input snapshot. Pacing mode is not part of the input. */
export function inputHash(snapshot: ScenarioSnapshot): string {
  return digestHex(stableStringify(snapshot));
}

export function summarizeScenario(snapshot: ScenarioSnapshot): ScenarioSummary {
  const { requests, ...rest } = snapshot;
  return { ...rest, requestCount: requests.length, inputHash: inputHash(snapshot) };
}

/** Throws on any contract violation so an invalid scenario never reaches the engine. */
export function validateSnapshot(snapshot: ScenarioSnapshot): void {
  const { config } = snapshot;
  if (!(config.sessionDurationMs > 0)) throw new RangeError("sessionDurationMs must be positive");
  if (!(config.bucketDurationMs > 0)) throw new RangeError("bucketDurationMs must be positive");
  if (config.sessionDurationMs % config.bucketDurationMs !== 0) {
    throw new RangeError("sessionDurationMs must be a whole number of buckets");
  }
  assertMicros(config.reserveMicros, "reserveMicros");
  if (config.reserveMicros <= 0) throw new RangeError("reserveMicros must be positive");
  if (!(config.scoreThreshold >= 0 && config.scoreThreshold <= 1)) {
    throw new RangeError("scoreThreshold must be in [0, 1]");
  }
  if (!Number.isInteger(config.shortlistSize) || config.shortlistSize < 1) {
    throw new RangeError("shortlistSize must be at least 1");
  }
  if (!(config.ctrScale > 0) || !(config.cvrScale > 0)) throw new RangeError("ctrScale and cvrScale must be positive");

  const categories = new Set(snapshot.categories);
  const userIds = new Set<string>();
  for (const user of snapshot.users) {
    if (userIds.has(user.id)) throw new RangeError(`duplicate user id ${user.id}`);
    userIds.add(user.id);
    for (const [category, relevance] of Object.entries(user.relevance)) {
      if (!categories.has(category)) throw new RangeError(`user ${user.id} references unknown category ${category}`);
      if (!(relevance >= 0 && relevance <= 1)) {
        throw new RangeError(`user ${user.id} relevance for ${category} must be in [0, 1]`);
      }
    }
  }

  const campaignIds = new Set<string>();
  for (const campaign of snapshot.campaigns) {
    if (campaignIds.has(campaign.id)) throw new RangeError(`duplicate campaign id ${campaign.id}`);
    campaignIds.add(campaign.id);
    if (!categories.has(campaign.category)) throw new RangeError(`campaign ${campaign.id} has unknown category`);
    assertMicros(campaign.bidMicros, `campaign ${campaign.id} bidMicros`);
    assertMicros(campaign.budgetMicros, `campaign ${campaign.id} budgetMicros`);
    if (campaign.bidMicros <= 0) throw new RangeError(`campaign ${campaign.id} bid must be positive`);
    if (campaign.budgetMicros <= 0) throw new RangeError(`campaign ${campaign.id} budget must be positive`);
    switch (campaign.objective) {
      case "impression":
        if (!(campaign.qualityPrior > 0 && campaign.qualityPrior <= 1)) {
          throw new RangeError(`campaign ${campaign.id} qualityPrior must be in (0, 1]`);
        }
        break;
      case "click":
        if (!(campaign.historicalCtr >= 0 && campaign.historicalCtr <= 1)) {
          throw new RangeError(`campaign ${campaign.id} historicalCtr must be in [0, 1]`);
        }
        break;
      case "conversion":
        if (!(campaign.historicalCvr >= 0 && campaign.historicalCvr <= 1)) {
          throw new RangeError(`campaign ${campaign.id} historicalCvr must be in [0, 1]`);
        }
        break;
    }
  }

  const requestIds = new Set<string>();
  for (let i = 0; i < snapshot.requests.length; i += 1) {
    const request = snapshot.requests[i];
    if (requestIds.has(request.id)) throw new RangeError(`duplicate request id ${request.id}`);
    requestIds.add(request.id);
    if (!userIds.has(request.userId)) throw new RangeError(`request ${request.id} has unknown user`);
    if (!categories.has(request.category)) throw new RangeError(`request ${request.id} has unknown category`);
    if (!(request.timestampMs >= 0 && request.timestampMs < config.sessionDurationMs)) {
      throw new RangeError(`request ${request.id} timestamp must be in [0, sessionDurationMs)`);
    }
    if (i > 0 && compareRequests(snapshot.requests[i - 1], request) > 0) {
      throw new RangeError(`requests must be ordered by timestamp then id (violation at ${request.id})`);
    }
  }
}
