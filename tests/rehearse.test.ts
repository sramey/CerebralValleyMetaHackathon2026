import { describe, expect, it } from "vitest";
import { applyServerMsg, awareMiss, emptyCommandState, formatTable, metExpectation, parseCommandList, percentile, summarize, summarizeAll } from "../scripts/rehearse";
import type { RehearsalRow } from "../scripts/rehearse";
import type { MoodSpec, ServerMsg } from "../src/contract";

function row(command: string, outcome: RehearsalRow["outcome"], totalMs: number, extra: Partial<RehearsalRow> = {}): RehearsalRow {
  return { run: 1, command, outcome, totalMs, autoFixRounds: 0, rejectedThenFixed: false, ...extra };
}

describe("rehearsal summarizer", () => {
  it("groups commands in script order and computes pass rate and latency percentiles", () => {
    const rows = [
      row("make it rain", "landed", 400),
      row("add trees", "landed", 900),
      row("make it rain", "failed", 800, { run: 2 }),
      row("add trees", "landed", 100, { run: 2 }),
      row("make it rain", "landed", 200, { run: 3 }),
      row("add trees", "rejected", 500, { run: 3 }),
    ];

    expect(summarize(rows)).toEqual([
      { command: "make it rain", runs: 3, passed: 2, passPct: 66.7, p50Ms: 400, p90Ms: 800, autoFixRounds: 0, rejectedThenFixed: 0 },
      { command: "add trees", runs: 3, passed: 2, passPct: 66.7, p50Ms: 500, p90Ms: 900, autoFixRounds: 0, rejectedThenFixed: 0 },
    ]);
  });

  it("counts auto-fix rounds and rejected-then-fixed landings", () => {
    const rows = [
      row("make me huge", "landed", 1200, { autoFixRounds: 1, rejectedThenFixed: true }),
      row("make me huge", "rejected", 1500, { run: 2, autoFixRounds: 1 }),
    ];
    expect(summarize(rows)[0]).toMatchObject({ passPct: 50, autoFixRounds: 2, rejectedThenFixed: 1 });
  });

  it("summarizes the whole invocation without making live calls", () => {
    const rows = [row("undo", "landed", 20), row("undo", "failed", 40, { run: 2 })];
    expect(summarizeAll(rows)).toEqual({ command: "ALL", runs: 2, passed: 1, passPct: 50, p50Ms: 20, p90Ms: 40, autoFixRounds: 0, rejectedThenFixed: 0 });
    expect(summarize([])).toEqual([]);
    expect(summarizeAll([])).toMatchObject({ runs: 0, passPct: 0, p50Ms: 0, p90Ms: 0 });
  });

  it("uses nearest-rank percentiles without mutating the input", () => {
    const values = [50, 10, 40, 20, 30];
    expect(percentile(values, 50)).toBe(30);
    expect(percentile(values, 90)).toBe(50);
    expect(percentile(values, 0)).toBe(10);
    expect(percentile([], 90)).toBe(0);
    expect(values).toEqual([50, 10, 40, 20, 30]);
  });

  it("parses plain string commands and {cmd, expect} objects", () => {
    const list = parseCommandList([
      "add a bouncing green slime",
      { cmd: "make me huge", expect: "rejected-then-fixed" },
      "undo",
    ]);
    expect(list).toEqual([
      { cmd: "add a bouncing green slime" },
      { cmd: "make me huge", expect: "rejected-then-fixed" },
      { cmd: "undo" },
    ]);
    expect(parseCommandList(list, "make me huge")).toEqual([{ cmd: "make me huge", expect: "rejected-then-fixed" }]);
    expect(() => parseCommandList([{ cmd: "x", expect: "nope" }])).toThrow();
  });

  it("evaluates per-command expectations and formats the expect column", () => {
    expect(metExpectation({ outcome: "landed", rejectedThenFixed: true }, "rejected-then-fixed")).toBe(true);
    expect(metExpectation({ outcome: "landed", rejectedThenFixed: false }, "rejected-then-fixed")).toBe(false);
    expect(metExpectation({ outcome: "landed", rejectedThenFixed: false }, "landed")).toBe(true);

    const rows: RehearsalRow[] = [
      row("make it rain", "landed", 400),
      row("make me huge", "landed", 1400, { autoFixRounds: 1, rejectedThenFixed: true, expect: "rejected-then-fixed" }),
      row("make me huge", "landed", 900, { run: 2, rejectedThenFixed: false, expect: "rejected-then-fixed" }),
    ];
    const [rain, huge] = summarize(rows);
    expect(rain.expect).toBeUndefined();
    expect(huge).toMatchObject({
      command: "make me huge",
      passed: 2,
      passPct: 100,
      expect: "rejected-then-fixed",
      expected: 1,
      expectPct: 50,
    });
    expect(summarizeAll(rows)).toMatchObject({
      command: "ALL",
      runs: 3,
      passed: 3,
      expected: 2,
      expectPct: 66.7,
    });
    const table = formatTable(rows);
    expect(table).toContain("expect");
    expect(table).toContain("1/2 (50.0%) rejected-then-fixed");
    expect(table).toContain("2/3 (66.7%)");
  });
});

describe("applyServerMsg (demo rehearsal)", () => {
  const cmd = "undo";
  const mood: MoodSpec = {
    name: "spooky", anchor: "spooky", skyTop: 0, skyBottom: 0, ridgeFar: 0, ridgeNear: 0, moon: 0, star: 0,
    grass: 0, soil: 0, tint: 0, grade: 0, dim: 0, fog: 0, vignette: 0, ambient: "fog",
  };
  const step = (msgs: ServerMsg[], command = cmd) => msgs.reduce((state, msg) => applyServerMsg(state, msg, command), emptyCommandState());

  it("counts a mood being cleared as a landing, which is what \"undo\" sends", () => {
    const cleared = step([{ kind: "mood", mood: null }]);
    expect(cleared.landed).toBe(true);
    expect(cleared.seen.moods).toEqual([]);
  });

  it("records the applied mood name and does not land on a bare art message", () => {
    const applied = step([{ kind: "mood", mood: mood }, { kind: "art", modId: "slime", art: { key: "slime", url: "/x.webp" } }]);
    expect(applied.landed).toBe(true);
    expect(applied.seen.moods).toEqual(["spooky"]);
    expect(applied.seen.arts).toEqual(["slime"]);
    expect(step([{ kind: "art", modId: "slime", art: { key: "slime", url: "/x.webp" } }]).landed).toBe(false);
  });

  it("ignores a sub-build's timing and stages, and finishes on the parent command's timing", () => {
    const sub = step([{ kind: "timing", command: "add a dragon", ms: { route: 0, write: 0, compile: 0, verify: 0, total: 10_000 } }]);
    expect(sub.doneMs).toBeUndefined();
    const parent = step([{ kind: "timing", command: cmd, ms: { route: 0, write: 0, compile: 0, verify: 0, total: 12_000 } }]);
    expect(parent.doneMs).toBe(12_000);
    const otherStage = applyServerMsg(emptyCommandState(), { kind: "stage", stage: "rejected", detail: "too big", command: "add a dragon" }, cmd);
    expect(otherStage.rejected).toBe(false);
  });

  it("marks rejection and each auto-fix round for a 'rejected then fixed' beat", () => {
    const state = step([
      { kind: "stage", stage: "rejected", detail: "cannot fit", command: cmd },
      { kind: "stage", stage: "fixing", detail: "fixing it", command: cmd },
      { kind: "stage", stage: "fixing", detail: "fixing it again", command: cmd },
    ]);
    expect(state).toMatchObject({ rejected: true, autoFixRounds: 2, landed: false });
  });

  it("lands on a new mod, its art, a tweak and a removal, and keeps each mod's source", () => {
    const mod = { kind: "mod" as const, mod: { id: "slime", title: "Slime", source: "api.spawn('slime')", compiled: "x", knobs: {}, art: { key: "slime", url: "/a.webp" } } };
    const state = step([mod, { kind: "tweak", modId: "slime", knob: "speed", value: 3 }, { kind: "removed", modId: "slime" }]);
    expect(state.landed).toBe(true);
    expect(state.seen.sources).toEqual(["api.spawn('slime')"]);
    expect(state.seen.arts).toEqual(["slime"]);
  });
});

describe("awareMiss (bead 4fa)", () => {
  const none = { moods: [], sources: [], arts: [] };
  it("passes when the world effect matches", () => {
    expect(awareMiss({ mood: "christmas" }, { ...none, moods: ["christmas"] })).toBeUndefined();
    expect(awareMiss({ source: "api[.]player[(]", noArt: true }, { ...none, sources: ["api.player().x"] })).toBeUndefined();
  });
  it("flags a mood that built a mod, a wrong mood, and sprite art on terrain", () => {
    expect(awareMiss({ mood: "daytime" }, { ...none, moods: ["daytime"], sources: ["x"] })).toMatch(/also built a mod/);
    expect(awareMiss({ mood: "daytime" }, none)).toMatch(/expected mood/);
    expect(awareMiss({ noArt: true }, { ...none, arts: ["stair"] })).toMatch(/sprite art/);
    expect(awareMiss({ notSource: "ninja" }, { ...none, sources: ["type: 'ninja'"] })).toMatch(/forbidden/);
  });
});
