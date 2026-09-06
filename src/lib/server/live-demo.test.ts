import { describe, expect, it, vi } from "vitest";
import { tinyScenario } from "../fixtures/tiny";
import { engineAdapter } from "./engine-adapter";
import { LiveDemoStore } from "./live-demo-store";
import { SimulatorService } from "./service";
import { parseRequestQuery } from "./validation";
import { jsonBody, respond } from "./http";

function demo() {
  const adapter = { ...engineAdapter, baseline: () => structuredClone(tinyScenario) };
  return { service: new SimulatorService(new LiveDemoStore(), adapter), adapter };
}

describe("stateless, recomputable live demo", () => {
  it("always has both fixed results, with comparable inputs and fresh budgets", () => {
    const { service } = demo();
    const off = service.run("off").run;
    const on = service.run("on").run;
    expect(service.runs().runs.map(r => r.id)).toEqual(["off", "on"]);
    expect(on.inputHash).toBe(off.inputHash);
    expect(on.engineVersion).toBe(off.engineVersion);
  });

  it("rejects any id other than the two fixed results", () => {
    const { service } = demo();
    expect(() => service.run("some-uuid")).toThrow("No such result");
  });

  it("reset regenerates the same defaults; results stay available and unchanged", () => {
    const { service } = demo();
    const original = service.scenario();
    const before = service.run("on").run;
    expect(service.reset().reseeded).toBe(true);
    expect(service.scenario()).toEqual(original);
    expect(service.run("on").run.summary).toEqual(before.summary);
  });

  it("returns compact pages strictly before the playback cutoff, without duplicate cursors", () => {
    const { service } = demo();
    const page = service.requests("off", { cursor: 0, limit: 1, beforeMs: 7_200_000 });
    expect(page.total).toBe(2);
    expect(page.items.map(r => r.requestId)).toEqual(["r1"]);
    expect(page.items[0]).not.toHaveProperty("candidates");
    expect(page.nextCursor).toBe(1);
    expect(service.requests("off", { cursor: page.nextCursor!, limit: 1, beforeMs: 7_200_000 }).items[0].requestId).toBe("r2");
    expect(service.requests("off", { cursor: 0, limit: 10, beforeMs: 0 }).total).toBe(0);
    const trace = service.trace("off", "r1").trace;
    trace.candidates.length = 0;
    expect(service.trace("off", "r1").trace.candidates.length).toBe(3);
  });

  it("falls back to this instance's previous result when a recompute fails", () => {
    const { service, adapter } = demo();
    const original = service.run("off");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      adapter.run = () => { throw new Error("test failure"); };
      // A cache hit (same input hash and engine version) never recomputes, so break the cache first.
      adapter.summarize = scenario => ({ ...engineAdapter.summarize(scenario), inputHash: "changed" });
      expect(service.run("off")).toEqual(original);
    } finally { log.mockRestore(); }
  });

  it("validates bounded integer pagination inputs", () => {
    for (const query of ["limit=0", "limit=201", "cursor=-1", "beforeMs=NaN", "cursor=1.5", "limit=2&limit=3", "unknown=1"]) {
      expect(() => parseRequestQuery(new URLSearchParams(query))).toThrow();
    }
    expect(parseRequestQuery(new URLSearchParams())).toEqual({ cursor: 0, limit: 50, beforeMs: undefined });
  });

  it("returns uncached JSON error envelopes for malformed bodies", async () => {
    const request = new Request("http://localhost/api/scenario/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
    const response = await respond(() => jsonBody(request));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { code: "bad_request", message: "Request body must be valid JSON." } });
  });
});
