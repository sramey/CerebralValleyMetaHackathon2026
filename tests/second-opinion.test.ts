// ADR 0078: the open-weights second opinion made visible: review messages, the
// "double-check my world" command and sweep, and the card the client paints.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLogFile } from "../server/createlog";
import { setLearnedDir } from "../server/learn";
import { resetReviewTracking, reviewBuild, type BuildReviewInput, type ReviewableMod } from "../server/reviewer";
import { detectReviewSweep, runReviewSweep, sweepBlocked, sweepOffReply, sweepSummary } from "../server/review-sweep";
import { trimIssue, viewOf } from "../src/client/second-opinion";
import { ranNode } from "../src/client/pipeline-ran";
import type { ServerMsg } from "../src/contract";

const SRC = `export default {
  id: "test-slime",
  title: "Test Slime",
  knobs: { speed: { type: "number", min: 0, max: 200, default: 50 } },
  setup(api) { api.spawn({ type: "slime", x: 100, y: 350, w: 20, h: 20, solid: false }); },
  dispose(api) { for (const e of api.byType("slime")) api.despawn(e); },
  test(t) {
    t.api.spawn({ type: "ground", x: 0, y: 390, w: 500, h: 30, solid: true, gravityScale: 0 });
    t.expect(t.api.byType("slime").length === 1, "slime spawned");
  },
};
`;
const FIXED = SRC.replace("max: 200", "max: 300");

let mock: Server | undefined;
let tempDir = "";
const reply = (obj: unknown) => (res: import("node:http").ServerResponse) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }] }));
};
async function startMock(handler: (res: import("node:http").ServerResponse) => void): Promise<string> {
  mock = createServer((req, res) => { req.on("data", () => {}); req.on("end", () => handler(res)); });
  await new Promise<void>((r) => mock!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(mock.address() as AddressInfo).port}/v1`;
}
const mkMod = (id: string): ReviewableMod & { receipt: NonNullable<ReviewableMod["receipt"]> } => ({
  id, title: `Mod ${id}`, source: SRC.replace("test-slime", id), compiled: "/* old */", knobs: {},
  receipt: { modId: id, title: `Mod ${id}`, origin: "ai", command: `add ${id}`, versions: [], test: null, proof: { healthFrames: 1, msBudget: 2, msPerFrame: 0, playtestSeeds: 1, playtests: 1, fixed: false } },
});

beforeEach(() => {
  resetReviewTracking();
  tempDir = mkdtempSync(join(tmpdir(), "metabuild-so-test-"));
  setLearnedDir(tempDir);
  setLogFile(join(tempDir, "builds.jsonl"));
  process.env.MODEL_API_KEY = "test-key";
  process.env.BASETEN_API_KEY = "baseten-test-key";
  delete process.env.REVIEWER;
});
afterEach(async () => {
  setLearnedDir(null);
  setLogFile(null);
  vi.unstubAllGlobals();
  if (mock) await new Promise((r) => mock!.close(r));
  mock = undefined;
  if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
});

describe("review messages from the reviewer", () => {
  it("an accepted fix sends running, then the swap, then a fixed message with the issue and the rule", async () => {
    process.env.BASETEN_BASE_URL = await startMock(reply({ verdict: "fix", issues: ["slime speed cap is too low to ever matter"], patchedSource: FIXED }));
    const sent: ServerMsg[] = [];
    const mod = mkMod("test-slime");
    const out = await reviewBuild({ ws: {} as never, command: "add a slime", mod, send: (_w, m) => { sent.push(m); }, worldMods: () => [] });
    expect(out.accepted).toBe(true);
    const kinds = sent.map((m) => (m.kind === "review" ? `review:${m.phase}` : m.kind));
    expect(kinds.indexOf("review:running")).toBeLessThan(kinds.indexOf("mod"));
    expect(kinds.indexOf("mod")).toBeLessThan(kinds.indexOf("review:fixed"));
    const fixed = sent.find((m) => m.kind === "review" && m.phase === "fixed");
    expect(fixed).toMatchObject({ kind: "review", modId: "test-slime", model: "meta-models/muse-spark-open", issue: "slime speed cap is too low to ever matter" });
    expect((fixed as { rule?: string }).rule).toContain("slime speed cap");
  });

  it("a clean review sends running then ok, and never a fix", async () => {
    process.env.BASETEN_BASE_URL = await startMock(reply({ verdict: "ok", issues: [] }));
    const sent: ServerMsg[] = [];
    await reviewBuild({ ws: {} as never, command: "add a slime", mod: mkMod("test-slime"), send: (_w, m) => { sent.push(m); } });
    expect(sent.filter((m) => m.kind === "review").map((m) => (m as { phase: string }).phase)).toEqual(["running", "ok"]);
  });

  it("force skips only the one-review cap", async () => {
    process.env.BASETEN_BASE_URL = await startMock(reply({ verdict: "ok", issues: [] }));
    const mod = mkMod("test-slime");
    expect((await reviewBuild({ ws: {} as never, command: "c", mod, send: () => {} })).verdict).toBe("ok");
    expect((await reviewBuild({ ws: {} as never, command: "c", mod, send: () => {} })).skipped).toBe("already-reviewed");
    expect((await reviewBuild({ ws: {} as never, command: "c", mod, send: () => {}, force: true })).verdict).toBe("ok");
    process.env.REVIEWER = "off";
    expect((await reviewBuild({ ws: {} as never, command: "c", mod, send: () => {}, force: true })).skipped).toBe("off");
  });
});

describe("double-check my world", () => {
  it("routes the command and its close phrasings locally", () => {
    for (const t of ["double-check my world", "Double check my world!", "review my world", "check everything for bugs", "can you double-check the game?", "please recheck my builds", "audit everything", "double-check everything again"]) {
      expect(detectReviewSweep(t), t).toBe(true);
    }
  });

  it("leaves ordinary build commands alone", () => {
    for (const t of ["add a car", "make it rain", "check the weather", "review", "make my world bigger", "add a tank that checks for bugs", "undo", ""]) {
      expect(detectReviewSweep(t), t).toBe(false);
    }
  });

  it("with no Baseten key, or the kill switch, the orb explains how to turn it on", () => {
    delete process.env.BASETEN_API_KEY;
    expect(sweepBlocked()).toBe("no-key");
    expect(sweepOffReply("no-key")).toMatch(/BASETEN_API_KEY/);
    process.env.BASETEN_API_KEY = "k";
    process.env.REVIEWER = "off";
    expect(sweepBlocked()).toBe("off");
    expect(sweepOffReply("off")).toMatch(/REVIEWER=off/);
    delete process.env.REVIEWER;
    expect(sweepBlocked()).toBeNull();
  });

  it("a sweep over 2 mods reviews each (forced, numbered), counts fixes, and summarises", async () => {
    const seen: BuildReviewInput[] = [];
    const review = async (i: BuildReviewInput) => {
      seen.push(i);
      return i.mod.id === "car" ? { verdict: "fix" as const, issues: ["x"], accepted: true } : { verdict: "ok" as const, issues: [], accepted: false };
    };
    const mods = [mkMod("car"), mkMod("tank"), { ...mkMod("builtin-thing"), receipt: { ...mkMod("b").receipt, origin: "builtin" as const } }];
    const res = await runReviewSweep({ ws: {} as never, mods, send: () => {}, review, parallel: 2 });
    expect(res).toMatchObject({ reviewed: 2, fixed: 1, clean: 1, held: 0, failed: 0 });
    expect(seen.map((i) => i.mod.id).sort()).toEqual(["car", "tank"]);
    expect(seen.every((i) => i.force === true && i.sweep?.of === 2)).toBe(true);
    expect(sweepSummary(res)).toBe("Muse Spark Open reviewed 2 builds, fixed 1.");
  });

  it("the spend guard keeps a sweep to the newest builds and says so", async () => {
    const mods = ["a", "b", "c", "d"].map(mkMod);
    const ids: string[] = [];
    const res = await runReviewSweep({ ws: {} as never, mods, send: () => {}, max: 2, review: async (i) => { ids.push(i.mod.id); return { verdict: "ok", issues: [], accepted: false }; } });
    expect(ids.sort()).toEqual(["c", "d"]);
    expect(sweepSummary(res)).toContain("2 older builds skipped");
  });

  it("an end-to-end sweep with the mocked Baseten endpoint fixes one mod and leaves the other", async () => {
    let n = 0;
    process.env.BASETEN_BASE_URL = await startMock((res) => reply(n++ === 0 ? { verdict: "fix", issues: ["first shell has NaN velocity"], patchedSource: FIXED.replace("test-slime", "car") } : { verdict: "ok", issues: [] })(res));
    const sent: ServerMsg[] = [];
    const mods = [mkMod("car"), mkMod("tank")];
    const res = await runReviewSweep({ ws: {} as never, mods, send: (_w, m) => { sent.push(m); }, parallel: 1, worldMods: () => [] });
    expect(res.reviewed).toBe(2);
    expect(res.fixed).toBe(1);
    expect(sent.some((m) => m.kind === "review" && m.phase === "fixed" && m.sweep?.n === 1)).toBe(true);
    expect(sent.some((m) => m.kind === "review" && m.phase === "ok" && m.sweep?.n === 2)).toBe(true);
  });
});

describe("what the client paints", () => {
  it("a fix is a card with the issue trimmed to its first sentence, and a +1 rule pulse when a rule was taught", () => {
    const v = viewOf({ kind: "review", modId: "car", title: "Car", phase: "fixed", model: "m", issue: "The first shell spawns with NaN velocity. It never moves.", rule: "r" });
    expect(v).toMatchObject({ kind: "card", issue: "The first shell spawns with NaN velocity.", foot: "Fixed · re-verified · live · Car", pulse: "+1 rule" });
    expect(viewOf({ kind: "review", modId: "c", title: "C", phase: "fixed", model: "m", issue: "x" }).pulse).toBeUndefined();
  });

  it("a clean review is only a chip, never a card; held-back and background-running show nothing", () => {
    expect(viewOf({ kind: "review", modId: "c", title: "C", phase: "ok", model: "m" }).kind).toBe("chip");
    expect(viewOf({ kind: "review", modId: "c", title: "C", phase: "held", model: "m", issue: "x" }).kind).toBe("none");
    expect(viewOf({ kind: "review", modId: "c", title: "C", phase: "running", model: "m" }).kind).toBe("none");
    expect(viewOf({ kind: "review", modId: "c", title: "Car", phase: "running", model: "m", sweep: { n: 1, of: 2 } }).text).toContain("(1 of 2)");
  });

  it("trims long issues on a word boundary", () => {
    const t = trimIssue("word ".repeat(80));
    expect(t.length).toBeLessThanOrEqual(150);
    expect(t.endsWith("…")).toBe(true);
  });

  it("a running review lights the pipeline's reviewer node", () => {
    expect(ranNode({ kind: "review", modId: "c", title: "C", phase: "running", model: "m" })).toBe("reviewer");
    expect(ranNode({ kind: "review", modId: "c", title: "C", phase: "ok", model: "m" })).toBeNull();
  });
});
