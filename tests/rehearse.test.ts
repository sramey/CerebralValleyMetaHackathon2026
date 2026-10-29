import { describe, expect, it } from "vitest";
import { awareMiss, formatTable, metExpectation, parseCommandList, percentile, summarize, summarizeAll } from "../scripts/rehearse";
import type { RehearsalRow } from "../scripts/rehearse";

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
