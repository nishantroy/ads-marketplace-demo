import { describe, expect, it, vi } from "vitest";
import { tinyScenario } from "../fixtures/tiny";
import { engineAdapter } from "./engine-adapter";
import { LiveDemoStore } from "./live-demo-store";
import { SimulatorService } from "./service";
import { parseCreateRun, parseRequestQuery } from "./validation";
import { jsonBody, respond } from "./http";

function demo() {
  const adapter = { ...engineAdapter, baseline: () => structuredClone(tinyScenario) };
  return { service: new SimulatorService(new LiveDemoStore(), adapter), adapter };
}

describe("two-result live demo", () => {
  it("keeps only the latest result per mode, with comparable inputs and fresh budgets", () => {
    const { service } = demo();
    const off = service.createRun({ pacingEnabled: false }).run;
    const on = service.createRun({ pacingEnabled: true }).run;
    const replacement = service.createRun({ pacingEnabled: false }).run;
    expect(service.runs().runs.map(r => r.id)).toEqual([replacement.id, on.id]);
    expect(() => service.run(off.id)).toThrow("Result not available");
    expect(replacement.summary).toEqual(off.summary);
    expect(on.inputHash).toBe(off.inputHash);
    expect(on.engineVersion).toBe(off.engineVersion);
  });

  it("reset clears both results and regenerates the same defaults", () => {
    const { service } = demo();
    const original = service.scenario();
    const run = service.createRun({ pacingEnabled: true }).run;
    expect(service.reset().reseeded).toBe(true);
    expect(service.scenario()).toEqual(original);
    expect(service.runs().runs).toEqual([]);
    expect(() => service.timeline(run.id)).toThrow("Result not available");
  });

  it("returns compact pages strictly before the playback cutoff, without duplicate cursors", () => {
    const { service } = demo();
    const { run } = service.createRun({ pacingEnabled: false });
    const page = service.requests(run.id, { cursor: 0, limit: 1, beforeMs: 7_200_000 });
    expect(page.total).toBe(2);
    expect(page.items.map(r => r.requestId)).toEqual(["r1"]);
    expect(page.items[0]).not.toHaveProperty("candidates");
    expect(page.nextCursor).toBe(1);
    expect(service.requests(run.id, { cursor: page.nextCursor!, limit: 1, beforeMs: 7_200_000 }).items[0].requestId).toBe("r2");
    expect(service.requests(run.id, { cursor: 0, limit: 10, beforeMs: 0 }).total).toBe(0);
    const trace = service.trace(run.id, "r1").trace;
    trace.candidates.length = 0;
    expect(service.trace(run.id, "r1").trace.candidates.length).toBe(3);
  });

  it("does not replace a good comparison result when execution fails", () => {
    const { service, adapter } = demo();
    const original = service.createRun({ pacingEnabled: false });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      adapter.run = () => { throw new Error("test failure"); };
      expect(() => service.createRun({ pacingEnabled: false })).toThrow("previous comparison results are unchanged");
      expect(service.runs().runs).toEqual([original.run]);
    } finally { log.mockRestore(); }
  });

  it("validates the mode and bounded integer pagination inputs", () => {
    expect(parseCreateRun({ pacingEnabled: false })).toEqual({ pacingEnabled: false });
    for (const body of [null, [], {}, { pacingEnabled: "false" }, { pacingEnabled: true, seed: "other" }]) {
      expect(() => parseCreateRun(body)).toThrow();
    }
    for (const query of ["limit=0", "limit=201", "cursor=-1", "beforeMs=NaN", "cursor=1.5", "limit=2&limit=3", "unknown=1"]) {
      expect(() => parseRequestQuery(new URLSearchParams(query))).toThrow();
    }
    expect(parseRequestQuery(new URLSearchParams())).toEqual({ cursor: 0, limit: 50, beforeMs: undefined });
  });

  it("returns uncached JSON error envelopes for malformed bodies", async () => {
    const request = new Request("http://localhost/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
    const response = await respond(() => jsonBody(request));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { code: "bad_request", message: "Request body must be valid JSON." } });
  });
});
