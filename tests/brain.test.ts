import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { BRAIN_PATH, ROUTER_BENCH, brainFeed, createBrainHandler } from "../server/brain";
import { diffHunks } from "../server/line-diff";
import type { LogRow } from "../server/stats";
import type { BrainRule } from "../src/contract";
import { acceptedPct, fasterPct, isBrainFeed, newIds, ruleTimeline, speedBars } from "../src/client/brain-model";

const rule = (id: string, createdAt: string, source: BrainRule["source"] = "review"): BrainRule => ({ id, subsystem: "wonder", source, rule: `rule ${id}`, createdAt });
const OFF = { on: false, model: null, reviewerOff: false };
const ON = { on: true, model: "meta-models/muse-spark-open", reviewerOff: false };

const rows: LogRow[] = [
  { ts: "2026-10-30T10:00:00Z", command: "SECRET player sentence", route: "new", outcome: "mod", modId: "volcano", timings: { route: 900 }, fixAttempted: false },
  { ts: "2026-10-30T10:01:00Z", command: "another secret", route: "new", outcome: "mod", modId: "rain", timings: { route: 1300 }, fixAttempted: true },
  { kind: "review", ts: "2026-10-30T10:02:00Z", modId: "volcano", command: "SECRET player sentence", verdict: "ok", issues: [], accepted: false, ms: 2000 },
  { kind: "review", ts: "2026-10-30T10:03:00Z", modId: "rain", command: "another secret", verdict: "fix", issues: ["leaks drops"], accepted: true, ms: 4000, diff: [{ at: 7, del: ["a"], add: ["b"] }], rules: ["Despawn drops"] } as LogRow,
  { kind: "review", ts: "2026-10-30T10:04:00Z", modId: "ball", verdict: "fix", issues: ["bad spawn"], accepted: false, ms: 3000 },
];

describe("brainFeed (ADR 0069)", () => {
  it("builds the scorecard from review rows and the build log", () => {
    const f = brainFeed(rows, [rule("a", "2026-10-29T00:00:00Z")], [], ON);
    expect(f.scorecard).toMatchObject({ reviews: 3, clean: 1, fixesFound: 2, accepted: 1, rejected: 1, avgMs: 3000, hostedRouteMs: 1100, autoFixAttempts: 1, autoFixSaves: 1 });
    expect(f.scorecard.bench).toEqual(ROUTER_BENCH);
    expect(f.fixes.map((x) => x.modId)).toEqual(["ball", "rain"]); // newest first
    expect(f.fixes[1].rules).toEqual(["Despawn drops"]);
    expect(f.openWeights).toMatchObject({ on: true, model: "meta-models/muse-spark-open" });
  });

  it("never carries a player command into the feed", () => {
    const text = JSON.stringify(brainFeed(rows, [], [], ON));
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("another secret");
    expect(text).not.toMatch(/[A-Za-z]:\\/);
  });

  it("works with no open weights: hosted-only history and a one-line note", () => {
    const f = brainFeed(rows.filter((r) => !r.kind), [rule("a", "2026-10-29T00:00:00Z", "seed")], [], OFF);
    expect(f.openWeights.on).toBe(false);
    expect(f.openWeights.model).toBeNull();
    expect(f.openWeights.note).toMatch(/^Open weights off/);
    expect(f.scorecard.reviews).toBe(0);
    expect(f.scorecard.avgMs).toBeNull();
    expect(f.scorecard.hostedRouteMs).toBe(1100);
    expect(f.counts.source).toEqual({ seed: 1 });
  });

  it("changes version when a review or rule lands", () => {
    const a = brainFeed(rows.slice(0, 3), [], [], ON).version;
    expect(brainFeed(rows, [], [], ON).version).not.toBe(a);
    expect(brainFeed(rows.slice(0, 3), [rule("n", "2026-10-30T11:00:00Z")], [], ON).version).not.toBe(a);
  });

  it("handles an empty log", () => {
    const f = brainFeed([], [], [], OFF);
    expect(f.scorecard.reviews).toBe(0);
    expect(isBrainFeed(JSON.parse(JSON.stringify(f)))).toBe(true);
  });
});

describe("GET /api/brain", () => {
  let server: Server | undefined;
  afterEach(() => { server?.close(); server = undefined; });
  it("answers JSON on GET, 405 otherwise, and ignores other paths", async () => {
    const handle = createBrainHandler({ logFile: () => "no-such-file.jsonl" });
    server = createServer((req, res) => { if (!handle(req, res)) res.writeHead(404).end(); });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ok = await fetch(base + BRAIN_PATH);
    expect(ok.status).toBe(200);
    expect(isBrainFeed(await ok.json())).toBe(true);
    expect((await fetch(base + BRAIN_PATH, { method: "POST" })).status).toBe(405);
    expect((await fetch(base + "/other")).status).toBe(404);
  });
});

describe("diffHunks", () => {
  it("reduces a patch to the changed lines", () => {
    const before = "a\nb\nc\nd\ne";
    const after = "a\nB\nc\nd\ne\nf";
    expect(diffHunks(before, after)).toEqual([{ at: 2, del: ["b"], add: ["B"] }, { at: 6, del: [], add: ["f"] }]);
  });
  it("caps hunks and line length", () => {
    const before = Array.from({ length: 40 }, (_, i) => `l${i}`).join("\n");
    const after = Array.from({ length: 40 }, (_, i) => (i % 2 ? `l${i}` : "x".repeat(300))).join("\n");
    const h = diffHunks(before, after);
    expect(h.length).toBeLessThanOrEqual(5);
    expect(h[0].add[0].length).toBeLessThanOrEqual(110);
  });
  it("is empty for identical source", () => expect(diffHunks("x\ny", "x\ny")).toEqual([]));
});

describe("brain-model", () => {
  it("compares speeds and accepted share", () => {
    expect(fasterPct(918, 1151)).toBe(20);
    expect(fasterPct(null, 1151)).toBeNull();
    expect(speedBars(1000, 500)).toEqual({ hosted: 100, open: 50 });
    expect(acceptedPct(brainFeed(rows, [], [], ON))).toBe(50);
    expect(acceptedPct(brainFeed([], [], [], OFF))).toBeNull();
  });
  it("groups rules newest first by day and flashes only ids that arrive later", () => {
    const t = ruleTimeline([rule("a", "2026-10-29T08:00:00Z"), rule("b", "2026-10-30T08:00:00Z"), rule("c", "2026-10-30T09:00:00Z")]);
    expect(t.map((g) => g.rules.map((r) => r.id))).toEqual([["c", "b"], ["a"]]);
    expect(newIds(null, ["a"]).size).toBe(0);
    expect([...newIds(new Set(["a"]), ["a", "b"])]).toEqual(["b"]);
  });
  it("rejects a malformed reply", () => expect(isBrainFeed({ scorecard: {} })).toBe(false));
});
