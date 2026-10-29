import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aggregateTesters, appendTester, parseTesters, renderTesterConsole, renderTesterMarkdown, sanitizeTester, summarize } from "../server/testers";
import type { TesterEvent, TesterRow } from "../server/testers";
import { createTester, moodSlug, testerIndex } from "../src/client/tester";
import type { ClientMsg } from "../src/contract";

const row = (tester: number, sid: string, tsS: number, ev: TesterEvent, extra: Partial<TesterRow> = {}): TesterRow => ({ ts: tsS * 1000, sid, tester, ev, ...extra });

// Tester 1: opens, types a command that is rejected then lands (recovered), uses a mood; tester 2: speaks one, lands; tester 3: nothing lands.
const FIXTURE: TesterRow[] = [
  row(1, "a", 0, "open"), row(1, "a", 20, "typed", { cid: 0 }), row(1, "a", 31, "rejected", { cid: 0 }), row(1, "a", 45, "landed", { cid: 0 }),
  row(1, "a", 100, "typed", { cid: 1 }), row(1, "a", 110, "mood", { mood: "spooky" }), row(1, "a", 600, "close"),
  row(2, "b", 1000, "open"), row(2, "b", 1010, "voice", { cid: 0 }), row(2, "b", 1030, "landed", { cid: 0 }), row(2, "b", 1300, "close"),
  row(3, "c", 2000, "open"), row(3, "c", 2010, "typed", { cid: 0 }), row(3, "c", 2040, "failed", { cid: 0 }), row(3, "c", 2100, "close"),
];

describe("tester aggregation", () => {
  const sums = summarize(FIXTURE);
  it("summarizes each anonymous tester", () => {
    expect(sums.map((s) => s.tester)).toEqual([1, 2, 3]);
    const [t1, t2, t3] = sums;
    expect(t1).toMatchObject({ firstBuildS: 45, attempted: 2, landed: 1, rejected: 1, recovered: 1, typed: 2, voice: 0, moods: 1, lengthS: 600 });
    expect(t2).toMatchObject({ firstBuildS: 30, attempted: 1, landed: 1, voice: 1, lengthS: 300 });
    expect(t3).toMatchObject({ firstBuildS: null, landed: 0, failed: 1 });
  });
  it("merges a tester's reloads into one person", () => {
    const s = summarize([...FIXTURE, row(2, "b2", 1400, "open"), row(2, "b2", 1460, "close")]);
    expect(s.find((x) => x.tester === 2)).toMatchObject({ sessions: 2, lengthS: 360, firstBuildS: 30 });
  });
  it("measures the first build from the page load that produced it", () => {
    const s = summarize([row(5, "x", 0, "open"), row(5, "x", 10, "close"), row(5, "y", 500, "open"), row(5, "y", 540, "landed", { cid: 0 })]);
    expect(s[0].firstBuildS).toBe(40);
  });
  it("does not count a landing as a recovery unless that command was rejected first", () => {
    const s = summarize([row(1, "a", 0, "open"), row(1, "a", 5, "landed", { cid: 0 }), row(1, "a", 9, "rejected", { cid: 1 })]);
    expect(s[0]).toMatchObject({ rejected: 1, recovered: 0 });
  });
  it("aggregates across testers", () => {
    const a = aggregateTesters(sums);
    expect(a).toMatchObject({ testers: 3, reachedFirstBuild: 2, medianFirstBuildS: 38, fastestFirstBuildS: 30, slowestFirstBuildS: 45, attempted: 4, landed: 2, rejected: 1, recovered: 1, testersUsingVoice: 1, testersUsingMoods: 1 });
    expect(a.voiceShare).toBeCloseTo(0.25);
  });
});

describe("tester output holds no personal data", () => {
  it("the committed page is aggregates only", () => {
    const md = renderTesterMarkdown(aggregateTesters(summarize(FIXTURE)));
    expect(md).toContain("Reached a first landed build | 2 of 3");
    expect(md).not.toMatch(/#\d|tester 1|spooky/i);
    expect(md).not.toMatch(/\|\s*#/);
  });
  it("renders an empty log without crashing", () => {
    expect(renderTesterMarkdown(aggregateTesters([]))).toContain("No sessions recorded yet");
  });
  it("the console table is one anonymous row per number", () => {
    expect(renderTesterConsole(summarize(FIXTURE)).split("\n")).toHaveLength(5);
  });
});

describe("server intake", () => {
  it("keeps only whitelisted fields and ignores free text", () => {
    const r = sanitizeTester({ kind: "tester", n: 3, ev: "mood", mood: "spooky", cid: 2, text: "my name is Bob", prompt: "secret" }, "sid1", 5);
    expect(r).toEqual({ ts: 5, sid: "sid1", tester: 3, ev: "mood", cid: 2, mood: "spooky" });
    expect(JSON.stringify(r)).not.toMatch(/Bob|secret/);
  });
  it("rejects bad indexes, unknown events and non-slug moods", () => {
    expect(sanitizeTester({ n: 0, ev: "open" }, "s", 1)).toBeNull();
    expect(sanitizeTester({ n: 100, ev: "open" }, "s", 1)).toBeNull();
    expect(sanitizeTester({ n: "Sam", ev: "open" }, "s", 1)).toBeNull();
    expect(sanitizeTester({ n: 1, ev: "typed-text" }, "s", 1)).toBeNull();
    expect(sanitizeTester({ n: 1, ev: "mood", mood: "Make it spooky please!" }, "s", 1)?.mood).toBeUndefined();
  });
  it("appends rows that parse back, skipping junk lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "testers-"));
    try {
      const file = join(dir, "t.jsonl");
      appendTester(FIXTURE[0], file);
      appendTester(FIXTURE[1], file);
      const { rows, malformed } = parseTesters(readFileSync(file, "utf8") + "not json\n");
      expect(rows).toHaveLength(2);
      expect(malformed).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("client flag", () => {
  it("reads ?tester=N as an anonymous index only", () => {
    expect(testerIndex(new URLSearchParams("tester=2"))).toBe(2);
    expect(testerIndex(new URLSearchParams("tester=Sam"))).toBeNull();
    expect(testerIndex(new URLSearchParams(""))).toBeNull();
    expect(moodSlug("Neon City!")).toBe("neon-city");
  });
  it("sends nothing without the flag, and never any command text with it", () => {
    const off: ClientMsg[] = [];
    const a = createTester(new URLSearchParams(""), (m) => { off.push(m); return true; });
    a.onOpen(); a.attempt("typed", "add a dragon");
    expect(off).toEqual([]);

    const sent: ClientMsg[] = [];
    const t = createTester(new URLSearchParams("tester=4"), (m) => { sent.push(m); return true; });
    t.onOpen();
    t.attempt("voice", "add a dragon");
    t.stage("rejected", "add a dragon");
    t.stage("done", "add a dragon");
    t.stage("writing", "add a dragon");
    t.mood("Spooky");
    expect(sent.map((m) => (m as { ev: string }).ev)).toEqual(["open", "voice", "rejected", "landed", "mood"]);
    expect(JSON.stringify(sent)).not.toMatch(/dragon/);
    expect(sent.filter((m) => (m as { cid?: number }).cid !== undefined).map((m) => (m as { cid: number }).cid)).toEqual([0, 0, 0]);
  });
  it("queues events while the socket is down and flushes them after open", () => {
    let up = false;
    const sent: string[] = [];
    const t = createTester(new URLSearchParams("tester=1"), (m) => { if (!up) return false; sent.push((m as { ev: string }).ev); return true; });
    t.attempt("typed", "x");
    up = true;
    t.onOpen();
    expect(sent).toEqual(["open", "typed"]);
  });
});
