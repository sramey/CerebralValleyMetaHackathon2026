import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspectTool, playtestTool, runAgent, summarizeArgs, summarizeResult } from "../server/agent";
import type { AgentStep } from "../server/agent";
import { statsFeed } from "../server/stats-feed";
import { chain, stepLine } from "../src/client/agent-steps";
import type { AgentStepMsg } from "../src/client/agent-steps";

describe("tool-loop steps (ADR 0034)", () => {
  beforeEach(() => { process.env.MODEL_API_KEY = "test-key-not-real"; });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("summarizes args and results in one line", () => {
    expect(summarizeArgs("inspect_world", {})).toBe("no arguments");
    expect(summarizeArgs("run_playtest", { source: "export default {\n  id: 'x',\n}\n" })).toBe("3 lines of mod source");
    expect(summarizeResult("run_playtest", { ok: true, message: "passed: it works" })).toBe("passed");
    expect(summarizeResult("run_playtest", { ok: false, message: "playtest: the player can't fit under the overhang (detail x)" })).toBe("rejected: the player can't fit under the overhang");
    expect(summarizeResult("inspect_world", { ok: true, message: JSON.stringify({ mods: [{}, {}], entities: { player: {} } }) })).toBe("2 mods, 1 entity type");
  });

  it("runAgent reports each finished call through onStep", async () => {
    const call = (name: string, args: unknown, id: string) => ({ content: "", tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
    const replies = [call("inspect_world", {}, "a"), call("run_playtest", { source: "export default { a: 1 }" }, "b"), call("run_playtest", { source: "export default { a: 2 }" }, "c")];
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: replies.shift()! }] }), text: async () => "" })));
    let n = 0;
    const steps: AgentStep[] = [];
    await runAgent({
      system: "s", user: "u", maxCalls: 3,
      tools: [inspectTool(async () => ({ mods: [], entities: {} })), playtestTool(async () => (n++ === 0 ? { ok: false, message: "playtest: too tall" } : { ok: true, message: "passed" }))],
      onStep: (s) => steps.push(s),
    });
    expect(steps.map((s) => [s.n, s.tool, s.ok, s.result])).toEqual([
      [1, "inspect_world", true, "0 mods, 0 entity types"],
      [2, "run_playtest", false, "rejected: too tall"],
      [3, "run_playtest", true, "passed"],
    ]);
  });

  it("reads inspect -> write -> playtest -> rejected -> fix -> write -> playtest -> pass", () => {
    const m = (n: number, tool: string, ok: boolean, phase: "write" | "fix"): AgentStepMsg => ({ kind: "agentStep", command: "make me huge", phase, n, tool, args: "", result: ok ? "passed" : "rejected: x", ok, ms: 5 });
    const c = chain([m(1, "inspect_world", true, "write"), m(2, "run_playtest", false, "write"), m(3, "run_playtest", true, "fix")]);
    expect(c.map((x) => x.label)).toEqual(["inspect", "write", "playtest", "rejected", "fix", "write", "playtest", "pass"]);
    // The same retry inside one loop (no phase change) still reads as a fix.
    const inLoop = chain([m(1, "inspect_world", true, "write"), m(2, "run_playtest", false, "write"), m(3, "run_playtest", true, "write")]);
    expect(inLoop.map((x) => x.label)).toEqual(["inspect", "write", "playtest", "rejected", "fix", "write", "playtest", "pass"]);
    expect(stepLine(m(2, "run_playtest", false, "write"))).toBe("2. run_playtest() → rejected: x");
  });
});

describe("autonomy numbers in the stats feed", () => {
  const build = (outcome: string, agent: unknown, fixAttempted = false) => ({ ts: "2026-10-29T10:00:00.000Z", command: "c", route: "new", outcome, timings: { route: 1, write: 1, compile: 1, verify: 1, total: 4 }, fixAttempted, ...(agent ? { agent } : {}) });
  it("counts calls per build, playtests, and builds that corrected themselves", () => {
    const f = statsFeed([
      build("mod", { turns: 2, calls: 1, playtests: 1, rejected: 0, tools: [{ name: "run_playtest", ok: true }] }),
      build("mod", { turns: 4, calls: 3, playtests: 2, rejected: 1, tools: [{ name: "inspect_world", ok: true }, { name: "run_playtest", ok: false }, { name: "run_playtest", ok: true }] }),
      build("mod", { turns: 3, calls: 2, tools: [{ name: "run_playtest", ok: false }, { name: "run_playtest", ok: true }] }), // older log line: derived from tools
      build("failed", { turns: 2, calls: 1, playtests: 1, rejected: 1 }, true),
      build("say", undefined),
    ]);
    expect(f.agent).toEqual({ builds: 4, callsPerBuild: 1.8, playtests: 6, rejected: 3, selfCorrected: 2, selfCorrectedPct: 0.667 });
  });
  it("is null, not NaN, with no agent builds", () => {
    expect(statsFeed([]).agent).toEqual({ builds: 0, callsPerBuild: null, playtests: 0, rejected: 0, selfCorrected: 0, selfCorrectedPct: null });
  });
});
