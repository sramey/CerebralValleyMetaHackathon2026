import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPool } from "../server/pool";
import { forget, newRecent, noteCommand, noteTouched, recentText, resolvePronoun } from "../server/context";
import { inspectTool, playtestTool, runAgent } from "../server/agent";

describe("runPool", () => {
  it("runs everything, never more than `limit` at once, and survives a failing item", async () => {
    let active = 0;
    let peak = 0;
    const done: number[] = [];
    const r = await runPool([1, 2, 3, 4, 5], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((res) => setTimeout(res, 15));
      active--;
      if (n === 2) throw new Error("boom");
      done.push(n);
    });
    expect(peak).toBe(3);
    expect(done.sort()).toEqual([1, 3, 4, 5]);
    expect(r.failed).toBe(1);
  });

  it("is genuinely parallel: three 40 ms jobs finish in well under 120 ms", async () => {
    const t0 = performance.now();
    await runPool([1, 2, 3], 3, () => new Promise((res) => setTimeout(res, 40)));
    expect(performance.now() - t0).toBeLessThan(100);
  });

  it("with limit 1 it is sequential", async () => {
    const order: number[] = [];
    await runPool([1, 2, 3], 1, async (n) => { order.push(n); await new Promise((res) => setTimeout(res, 5)); order.push(-n); });
    expect(order).toEqual([1, -1, 2, -2, 3, -3]);
  });
});

describe("pronoun memory", () => {
  it("resolves it/them to the mod touched last", () => {
    const r = newRecent();
    noteTouched(r, "enemies");
    noteTouched(r, "rain");
    expect(resolvePronoun("make them faster", r)).toBe("rain");
    noteTouched(r, "enemies");
    expect(resolvePronoun("make it huge", r)).toBe("enemies");
    expect(resolvePronoun("add a tree", r)).toBeUndefined();
  });
  it("forgets removed mods and tells the router what it knows", () => {
    const r = newRecent();
    expect(recentText(r)).toBe("");
    noteTouched(r, "a");
    noteTouched(r, "b");
    noteCommand(r, "add a thing");
    forget(r, "b");
    expect(resolvePronoun("remove it", r)).toBe("a");
    expect(recentText(r)).toContain("a");
    expect(recentText(r)).toContain("add a thing");
  });
});

describe("runAgent (native tool-calling loop)", () => {
  beforeEach(() => { process.env.MODEL_API_KEY = "test-key-not-real"; });
  afterEach(() => { vi.unstubAllGlobals(); });

  const reply = (message: Record<string, unknown>) => ({ ok: true, json: async () => ({ choices: [{ message }] }), text: async () => "" });
  const call = (name: string, args: unknown, id = "c1") => ({ content: "", tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });

  it("feeds tool results back, ends on the first passing playtest, and traces every call", async () => {
    const bodies: any[] = [];
    const replies = [call("inspect_world", {}), call("run_playtest", { source: "export default { v: 1 }" }, "c2")];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => { bodies.push(JSON.parse(init.body)); return reply(replies.shift()!); }));
    const r = await runAgent({
      system: "s", user: "u", maxCalls: 3,
      tools: [inspectTool(async () => ({ mods: [] })), playtestTool(async () => ({ ok: true, message: "passed" }))],
    });
    expect(r.text).toBe("export default { v: 1 }");
    expect(r.calls).toBe(2);
    expect(r.turns).toBe(2);
    expect(r.trace.map((t) => t.name)).toEqual(["inspect_world", "run_playtest"]);
    expect(bodies[0].reasoning_effort).toBe("minimal");
    expect(bodies[0].tools.map((t: any) => t.function.name)).toEqual(["inspect_world", "run_playtest"]);
    expect(bodies[1].messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "c1" });
  });

  it("is bounded: after maxCalls tool calls the model must answer without tools", async () => {
    const bodies: any[] = [];
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return reply(bodies.at(-1).tools ? call("run_playtest", { source: `export default { n: ${n++} }` }, `c${n}`) : { content: "export default { final: true }" });
    }));
    const r = await runAgent({ system: "s", user: "u", maxCalls: 2, tools: [playtestTool(async () => ({ ok: false, message: "nope" }))] });
    expect(r.calls).toBe(2);
    expect(bodies.length).toBe(3);
    expect(bodies[2].tools).toBeUndefined();
    expect(r.text).toBe("export default { final: true }");
  });

  it("falls back to the last tested source when the final answer has no module", async () => {
    const replies = [call("run_playtest", { source: "export default { x: 1 }" }), { content: "Sorry, here you go." }];
    vi.stubGlobal("fetch", vi.fn(async () => reply(replies.shift()!)));
    const r = await runAgent({ system: "s", user: "u", maxCalls: 1, tools: [playtestTool(async () => ({ ok: false, message: "nope" }))] });
    expect(r.text).toBe("export default { x: 1 }");
  });

  it("turns a throwing tool into an error message instead of crashing", async () => {
    const replies = [call("inspect_world", {}), { content: "export default {}" }];
    const seen: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => { seen.push(JSON.parse(init.body)); return reply(replies.shift()!); }));
    const r = await runAgent({ system: "s", user: "u", tools: [inspectTool(async () => { throw new Error("kaput"); })] });
    expect(r.trace[0].ok).toBe(false);
    expect(seen[1].messages.at(-1).content).toContain("kaput");
  });

  it("prefetch runs a tool before the first turn, so the model starts already holding its result (ADR 0054)", async () => {
    const bodies: any[] = [];
    const steps: any[] = [];
    const replies = [call("run_playtest", { source: "export default { v: 2 }" }, "c9")];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => { bodies.push(JSON.parse(init.body)); return reply(replies.shift()!); }));
    const r = await runAgent({
      system: "s", user: "u", maxCalls: 3, prefetch: ["inspect_world", "no_such_tool"], onStep: (st) => steps.push(st),
      tools: [inspectTool(async () => ({ mods: [{ id: "player" }], entityTypes: [] })), playtestTool(async () => ({ ok: true, message: "passed" }))],
    });
    expect(r.text).toBe("export default { v: 2 }");
    expect(r.turns).toBe(1);
    expect(r.calls).toBe(2);
    expect(r.trace.map((t) => t.name)).toEqual(["inspect_world", "run_playtest"]);
    expect(steps.map((st) => [st.n, st.tool])).toEqual([[1, "inspect_world"], [2, "run_playtest"]]);
    const msgs = bodies[0].messages;
    expect(msgs[2]).toMatchObject({ role: "assistant", tool_calls: [{ function: { name: "inspect_world", arguments: "{}" } }] });
    expect(msgs[3]).toMatchObject({ role: "tool", tool_call_id: msgs[2].tool_calls[0].id });
    expect(msgs[3].content).toContain("player");
    expect(bodies[0].tools).toBeDefined();
  });
});

describe("streaming (ADR 0022)", () => {
  beforeEach(() => { process.env.MODEL_API_KEY = "test-key-not-real"; });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("sourcePreview decodes a half-received tool argument and never emits a torn escape", async () => {
    const { sourcePreview } = await import("../server/agent");
    expect(sourcePreview('{"source":"export default {\\n  id: \\"a\\"')).toBe('export default {\n  id: "a"');
    expect(sourcePreview('{"source":"abc\\')).toBe("abc");
    expect(sourcePreview('{"sou')).toBe("");
  });

  const sse = (events: unknown[]) => {
    const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
    return { ok: true, body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } }) };
  };

  it("streams content and tool-call source to onText and still returns the assembled answer", async () => {
    const chunks: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => {
      expect(JSON.parse(init.body).stream).toBe(true);
      return sse([
        { choices: [{ delta: { content: "export default " } }] },
        { choices: [{ delta: { content: "{ id: \"x\" }" } }] },
      ]);
    }));
    const r = await runAgent({ system: "s", user: "u", tools: [], onText: (c) => chunks.push(c) });
    expect(chunks.join("")).toBe('export default { id: "x" }');
    expect(r.text).toBe('export default { id: "x" }');
  });

  it("falls back to a plain request and still reports the finished code when streaming is refused", async () => {
    const chunks: string[] = [];
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (): Promise<any> => {
      if (n++ === 0) return { ok: false, status: 400, text: async () => "no stream", body: null };
      return { ok: true, json: async () => ({ choices: [{ message: { content: "export default { id: \"y\" }" } }] }), text: async () => "" };
    }));
    const r = await runAgent({ system: "s", user: "u", tools: [], onText: (c) => chunks.push(c) });
    expect(r.text).toBe('export default { id: "y" }');
    expect(chunks.join("")).toBe('export default { id: "y" }');
  });
});
