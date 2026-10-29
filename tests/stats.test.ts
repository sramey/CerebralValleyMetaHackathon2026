import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { aggregate, categorizeFailure, parseLog, percentile, renderConsole, renderMarkdown } from "../server/stats";
import type { LogRow } from "../server/stats";

/** A fixture in the shape server/createlog.ts writes, plus the bait for the leak test. */
const fixture: unknown[] = [
  // 1. New mod, first pass.
  { ts: "2026-10-28T10:00:00.000Z", command: "add a windmill", route: "new", outcome: "mod", modId: "windmill", title: "Windmill", timings: { route: 200, write: 7000, compile: 300, verify: 500, total: 8000 }, verify: { ok: true, errors: [], msPerFrame: 0.002 }, fixAttempted: false, sourceFile: "C:\\Users\\alice\\metabuild\\logs\\mods\\20261028-100000-windmill-v1.ts" },
  // 2. New mod saved by the single auto-fix round.
  { ts: "2026-10-28T10:10:00.000Z", command: "add a signal flare Alice asked for", route: "new", outcome: "mod", modId: "signal-flare", title: "Signal Flare", timings: { route: 300, write: 22000, compile: 400, verify: 1300, total: 24000 }, verify: { ok: true, errors: [], msPerFrame: 0.003 }, fixAttempted: true, sourceFiles: ["C:\\Users\\alice\\metabuild\\logs\\mods\\v1.ts", "C:\\Users\\alice\\metabuild\\logs\\mods\\v2.ts"] },
  // 3. In-place edit, first pass.
  { ts: "2026-10-28T11:00:00.000Z", command: "make the player jump higher", route: "edit", outcome: "edit", modId: "player", timings: { route: 400, write: 29000, compile: 200, verify: 400, total: 30000 }, verify: { ok: true, errors: [], msPerFrame: 0.004 }, fixAttempted: false },
  // 4. Edit that never compiled, even after the fix round.
  { ts: "2026-10-28T12:00:00.000Z", command: "edit horse with Alice's notes", route: "edit", outcome: "failed", timings: { route: 500, write: 9000, compile: 100, verify: 0, total: 10000 }, verify: { ok: false, errors: ["compile error: Transform failed with 1 error:\nC:\\Users\\alice\\src\\mod.ts:9:1: ERROR: Unexpected token"], msPerFrame: 0 }, fixAttempted: true, sourceFile: "C:\\Users\\alice\\metabuild\\logs\\mods\\v2.ts" },
  // 5. New mod whose own test() failed.
  { ts: "2026-10-28T13:00:00.000Z", command: "add a horse Alice rides", route: "new", outcome: "failed", timings: { route: 300, write: 40000, compile: 200, verify: 1800, total: 42300 }, verify: { ok: false, errors: ["test: horse gallops", "test: rider stays on", "test: reins exist"], msPerFrame: 0.0009 }, fixAttempted: false },
  // 6. Router miss: no build attempted.
  { ts: "2026-10-28T14:00:00.000Z", command: "hmm", route: "new", outcome: "say", timings: { route: 120, write: 0, compile: 0, verify: 0, total: 120 }, fixAttempted: false },
  // 7. Question answered in words.
  { ts: "2026-10-28T14:01:00.000Z", command: "what can you do", route: "question", outcome: "say", timings: { route: 300, write: 0, compile: 0, verify: 0, total: 300 }, fixAttempted: false },
  // 8. Knob change, no rebuild.
  { ts: "2026-10-28T14:02:00.000Z", command: "faster", route: "tweak", outcome: "tweak", modId: "player", knob: "speed", value: 260, timings: { route: 250, write: 0, compile: 0, verify: 0, total: 250 }, fixAttempted: false },
  // 9. A parallel batch using Wonder's tool loop.
  { ts: "2026-10-29T09:00:00.000Z", command: "add a torch and a tent", route: "new", outcome: "mod", modId: "torch", title: "Torch", timings: { route: 200, write: 11000, compile: 300, verify: 500, total: 12000 }, verify: { ok: true, errors: [], msPerFrame: 0.005 }, fixAttempted: false, agent: { turns: 3, calls: 2, tools: [] }, batch: { size: 2, parallel: 2 } },
  // 10-11. Art each mod build triggers (Muse Image sheet + SAM check).
  { kind: "art", ts: "2026-10-28T10:00:05.000Z", subject: "windmill", file: "C:\\Users\\alice\\metabuild\\public\\art\\gen\\windmill.webp", ms: 22000, samOk: true },
  { kind: "art", ts: "2026-10-28T10:00:06.000Z", subject: "horse", file: "C:\\Users\\alice\\metabuild\\public\\art\\gen\\horse.webp", ms: 18000, samOk: false },
  // 12-13. Learned rules and skills.
  { kind: "learn", ts: "2026-10-28T15:00:00.000Z", event: "rule", subsystem: "router", rule: "Balls are shapes, not creature art." },
  { kind: "learn", ts: "2026-10-28T15:05:00.000Z", event: "autofix-rule", rule: "Never spawn solids across the player spawn." },
  // 14-16. Mood restyles.
  { kind: "mood", ts: "2026-10-28T16:00:00.000Z", mood: "Spooky", command: "make it spooky" },
  { kind: "mood", ts: "2026-10-28T16:10:00.000Z", mood: "spooky", command: "spooky again" },
  { kind: "mood", ts: "2026-10-28T16:20:00.000Z", mood: "neon", command: "make it neon" },
];

const jsonl = fixture.map((row) => JSON.stringify(row)).join("\n") + "\n{not json\n\n";

function statsOf(text = jsonl) {
  const { rows, malformed } = parseLog(text);
  return aggregate(rows, malformed);
}

describe("build stats (npm run stats)", () => {
  it("parses JSONL, skips blank lines and counts unreadable ones", () => {
    const { rows, malformed } = parseLog(jsonl);
    expect(rows).toHaveLength(fixture.length);
    expect(malformed).toBe(1);
    expect(parseLog("").rows).toHaveLength(0);
    expect(parseLog("[1,2]").malformed).toBe(1);
  });

  it("counts landed, failed, no-build replies and tweaks", () => {
    const s = statsOf();
    expect(s.requests).toBe(9); // build lines, i.e. no `kind`
    expect(s.landed).toBe(4); // 3 x mod, 1 x edit
    expect(s.edits).toBe(1);
    expect(s.failed).toBe(2);
    expect(s.said).toBe(2);
    expect(s.tweaks).toBe(1);
    expect(s.attempts).toBe(6);
    expect(s.landedPct).toBeCloseTo(4 / 6, 6);
    expect(s.requestsLandedPct).toBeCloseTo(4 / 9, 6);
    expect(s.distinctMods).toBe(4);
  });

  it("separates first-pass builds from auto-fix saves", () => {
    const s = statsOf();
    expect(s.firstPass).toBe(3);
    expect(s.firstPassPct).toBeCloseTo(0.75, 6);
    expect(s.fixAttempts).toBe(2);
    expect(s.fixSaves).toBe(1);
    expect(s.fixFailures).toBe(1);
  });

  it("reports median and p90 build time over landed builds only", () => {
    const s = statsOf();
    expect(s.latency.count).toBe(4);
    expect(s.latency.medianMs).toBe(12000);
    expect(s.latency.p90Ms).toBe(30000);
    expect(s.latency.maxMs).toBe(30000);
  });

  it("breaks requests down per route", () => {
    const s = statsOf();
    const route = (name: string) => s.perRoute.find((r) => r.route === name)!;
    expect(route("new")).toMatchObject({ requests: 5, landed: 3, failed: 1, said: 1, medianMs: 12000 });
    expect(route("edit")).toMatchObject({ requests: 2, landed: 1, failed: 1 });
    expect(route("question")).toMatchObject({ requests: 1, said: 1, medianMs: null });
    expect(route("tweak")).toMatchObject({ requests: 1, tweaks: 1 });
  });

  it("buckets failure reasons without keeping the raw text", () => {
    const s = statsOf();
    expect(s.failures).toEqual([
      { category: "compile error", count: 1 },
      { category: "playtest assertion", count: 1 },
    ]);
    expect(categorizeFailure(undefined)).toBe("no verifier detail");
    expect(categorizeFailure(["Transform failed with 1 error"])).toBe("compile error");
    expect(categorizeFailure(["test: rider stays on"])).toBe("playtest assertion");
    expect(categorizeFailure(["request timed out after 75s"])).toBe("timeout");
    expect(categorizeFailure(["HTTP 429 rate limited"])).toBe("model or API error");
    expect(categorizeFailure(["something odd"])).toBe("other verifier error");
  });

  it("counts moods by name", () => {
    const s = statsOf();
    expect(s.moods.requests).toBe(3);
    expect(s.moods.byName).toEqual([
      { name: "spooky", count: 2 },
      { name: "neon", count: 1 },
    ]);
  });

  it("reports art, learn and agent activity", () => {
    const s = statsOf();
    expect(s.art.count).toBe(2);
    expect(s.art.medianMs).toBe(18000);
    expect(s.art.samOkPct).toBe(0.5);
    expect(s.learn.count).toBe(2);
    expect(s.learn.byEvent).toEqual([
      { event: "autofix-rule", count: 1 },
      { event: "rule", count: 1 },
    ]);
    expect(s.agent.builds).toBe(1);
    expect(s.agent.medianTurns).toBe(3);
    expect(s.agent.medianCalls).toBe(2);
    expect(s.parallelBatches).toBe(1);
    expect(s.perf.samples).toBe(5); // every verifier run that reported a frame cost
  });

  it("publishes numbers, not prompts or paths", () => {
    const page = renderMarkdown(statsOf());
    for (const leak of ["alice", "Alice", "C:\\", "/logs/", "windmill", "Windmill", "horse gallops", "reins exist", "signal flare", "sourceFile"]) {
      expect(page).not.toContain(leak);
    }
    expect(page).toContain("| Landed (verified + hot-loaded) | 4 (66.7% of attempts, 44.4% of requests) |");
    expect(page).toContain("| Median | 12.0 s |");
    expect(page).toContain("| p90 | 30.0 s |");
    expect(page).toContain("| new | 5 | 3 | 1 | 1 | 0 | 12.0 s |");
    expect(page).toContain("| playtest assertion | 1 |");
    expect(page).toContain("| spooky | 2 |");
    expect(page).toContain("| Sheets accepted by the SAM check | 50% |");
    expect(page).toContain("| Median art generation time | 18.0 s |");
    expect(page).toContain("2026-10-28 → 2026-10-29 (2 days)");
    expect(page.endsWith("\n")).toBe(true);
  });

  it("stays quiet and finite on an empty log", () => {
    const s = statsOf("");
    expect(s.requests).toBe(0);
    expect(s.landedPct).toBe(0);
    expect(s.latency.medianMs).toBeNull();
    expect(s.moods.requests).toBe(0);
    const page = renderMarkdown(s);
    expect(page).not.toContain("NaN");
    expect(page).not.toContain("Infinity");
    expect(page).toContain("No failed builds in this window.");
    expect(page).toContain("No mood events in this log window");
    expect(renderConsole(s)).toContain("requests 0");
  });

  it("picks nearest-rank percentiles and copes with one sample", () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([7], 0.9)).toBe(7);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4], 0.9)).toBe(4);
  });

  it("keeps the console summary free of prompts", () => {
    const consoleText = renderConsole(statsOf());
    expect(consoleText).not.toContain("alice");
    expect(consoleText).toContain("landed 4 (44.4%)");
    expect(consoleText).toContain("moods 3 (spooky 2, neon 1)");
  });

  it("round-trips a real mood line from server/createlog.ts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "metabuild-stats-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    try {
      vi.resetModules();
      const { logMood } = await import("../server/createlog");
      logMood({ mood: "spooky", ms: 120 });
      const line = readFileSync(join(dir, "logs", "builds.jsonl"), "utf8").trim();
      const row = JSON.parse(line) as Record<string, unknown>;
      // Only the resolved mood name and a duration: the player's words never reach the log.
      expect(Object.keys(row).sort()).toEqual(["kind", "mood", "ms", "ts"]);
      expect(row).toMatchObject({ kind: "mood", mood: "spooky", ms: 120 });
      const s = aggregate(parseLog(line).rows);
      expect(s.moods).toEqual({ requests: 1, byName: [{ name: "spooky", count: 1 }] });
      expect(s.requests).toBe(0); // a mood is not a code build
    } finally {
      cwd.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts rows written before the log grew extra fields", () => {
    const legacy: LogRow[] = [{ command: "add a rock", route: "new", outcome: "mod" }, { command: "undo", route: "undo" }];
    const s = aggregate(legacy, 0);
    expect(s.requests).toBe(2);
    expect(s.landed).toBe(1);
    expect(s.perRoute.map((r) => r.route).sort()).toEqual(["new", "undo"]);
    expect(s.latency.count).toBe(0);
    expect(renderMarkdown(s)).not.toContain("NaN");
  });
});
