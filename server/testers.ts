// Family-test metrics (bead 3hu.1, ADR 0033). With ?tester=N the client reports a handful of anonymous events and the
// server appends them to logs/testers.jsonl (gitignored). `npm run testers` aggregates that file into
// docs/evidence/user-test.md.
//
// PRIVACY: a row holds only an anonymous index (1-99), a random session id, a timestamp, an event name, a small
// per-session command counter (cid) and, for moods, the mood's own slug. Never a name, never what anyone typed or said.
// Everything below except appendTester is pure, so tests/testers.test.ts pins the numbers on a fixture.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export const TESTER_LOG = join(process.cwd(), "logs", "testers.jsonl");

export const TESTER_EVENTS = ["open", "typed", "voice", "landed", "rejected", "failed", "mood", "close"] as const;
export type TesterEvent = (typeof TESTER_EVENTS)[number];

export interface TesterRow {
  /** Epoch ms. */
  ts: number;
  /** Random per-connection id: one page load = one session. */
  sid: string;
  /** Anonymous tester index 1..99. */
  tester: number;
  ev: TesterEvent;
  /** Which command of the session this belongs to (0, 1, 2, ...): pairs a rejection with the later landing. */
  cid?: number;
  /** Mood slug the game itself picked (not the player's words). */
  mood?: string;
}

/** Validate an untrusted client message into a row, keeping only whitelisted fields. */
export function sanitizeTester(m: unknown, sid: string, now: number): TesterRow | null {
  if (!m || typeof m !== "object") return null;
  const o = m as Record<string, unknown>;
  const tester = Number(o.n);
  if (!Number.isInteger(tester) || tester < 1 || tester > 99) return null;
  if (typeof o.ev !== "string" || !(TESTER_EVENTS as readonly string[]).includes(o.ev)) return null;
  const row: TesterRow = { ts: now, sid, tester, ev: o.ev as TesterEvent };
  if (Number.isInteger(o.cid) && (o.cid as number) >= 0 && (o.cid as number) < 10000) row.cid = o.cid as number;
  if (row.ev === "mood" && typeof o.mood === "string" && /^[a-z0-9-]{1,24}$/.test(o.mood)) row.mood = o.mood;
  return row;
}

/** Append one row. Never throws: a logging failure must not break a live session. */
export function appendTester(row: TesterRow, file: string = TESTER_LOG): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(row) + "\n");
  } catch { /* best effort */ }
}

export function parseTesters(text: string): { rows: TesterRow[]; malformed: number } {
  const rows: TesterRow[] = [];
  let malformed = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as Partial<TesterRow>;
      if (typeof r.ts === "number" && typeof r.sid === "string" && Number.isInteger(r.tester) && (TESTER_EVENTS as readonly string[]).includes(r.ev as string)) rows.push(r as TesterRow);
      else malformed++;
    } catch { malformed++; }
  }
  return { rows, malformed };
}

export interface TesterSummary {
  tester: number;
  sessions: number;
  /** Seconds from the first page load to the first landed build; null if none landed. */
  firstBuildS: number | null;
  attempted: number;
  landed: number;
  rejected: number;
  /** Rejected commands that later landed. */
  recovered: number;
  failed: number;
  typed: number;
  voice: number;
  moods: number;
  /** Seconds the page was open, summed over reloads. */
  lengthS: number;
}

/** One summary per anonymous tester index, merging that tester's sessions (a reload is not a new person). */
export function summarize(rows: readonly TesterRow[]): TesterSummary[] {
  const byTester = new Map<number, TesterRow[]>();
  for (const r of rows) (byTester.get(r.tester) ?? byTester.set(r.tester, []).get(r.tester)!).push(r);
  const out: TesterSummary[] = [];
  for (const [tester, rs] of [...byTester].sort((a, b) => a[0] - b[0])) {
    rs.sort((a, b) => a.ts - b.ts);
    const sids = new Map<string, TesterRow[]>();
    for (const r of rs) (sids.get(r.sid) ?? sids.set(r.sid, []).get(r.sid)!).push(r);
    let lengthMs = 0;
    for (const sr of sids.values()) lengthMs += sr[sr.length - 1].ts - sr[0].ts;
    const firstLanded = rs.find((r) => r.ev === "landed");
    // Measured from the page load that produced it, so an earlier reload before they started does not inflate it.
    const opened = firstLanded ? sids.get(firstLanded.sid)![0] : rs[0];
    const rejectedCids = new Set<string>();
    const recoveredCids = new Set<string>();
    for (const r of rs) {
      if (r.cid === undefined) continue;
      const k = `${r.sid}:${r.cid}`;
      if (r.ev === "rejected") rejectedCids.add(k);
      else if (r.ev === "landed" && rejectedCids.has(k)) recoveredCids.add(k);
    }
    const count = (ev: TesterEvent): number => rs.filter((r) => r.ev === ev).length;
    out.push({
      tester,
      sessions: sids.size,
      firstBuildS: firstLanded ? Math.max(0, Math.round((firstLanded.ts - opened.ts) / 1000)) : null,
      attempted: count("typed") + count("voice"),
      landed: count("landed"),
      rejected: rejectedCids.size,
      recovered: recoveredCids.size,
      failed: count("failed"),
      typed: count("typed"),
      voice: count("voice"),
      moods: new Set(rs.filter((r) => r.ev === "mood" && r.mood).map((r) => r.mood)).size,
      lengthS: Math.round(lengthMs / 1000),
    });
  }
  return out;
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

export interface TesterAggregate {
  testers: number;
  reachedFirstBuild: number;
  medianFirstBuildS: number | null;
  fastestFirstBuildS: number | null;
  slowestFirstBuildS: number | null;
  attempted: number;
  landed: number;
  rejected: number;
  recovered: number;
  voiceShare: number | null;
  testersUsingVoice: number;
  testersUsingMoods: number;
  medianLengthS: number | null;
}

export function aggregateTesters(sums: readonly TesterSummary[]): TesterAggregate {
  const first = sums.flatMap((s) => (s.firstBuildS === null ? [] : [s.firstBuildS]));
  const attempted = sums.reduce((a, s) => a + s.attempted, 0);
  const voice = sums.reduce((a, s) => a + s.voice, 0);
  return {
    testers: sums.length,
    reachedFirstBuild: first.length,
    medianFirstBuildS: median(first),
    fastestFirstBuildS: first.length ? Math.min(...first) : null,
    slowestFirstBuildS: first.length ? Math.max(...first) : null,
    attempted,
    landed: sums.reduce((a, s) => a + s.landed, 0),
    rejected: sums.reduce((a, s) => a + s.rejected, 0),
    recovered: sums.reduce((a, s) => a + s.recovered, 0),
    voiceShare: attempted ? voice / attempted : null,
    testersUsingVoice: sums.filter((s) => s.voice > 0).length,
    testersUsingMoods: sums.filter((s) => s.moods > 0).length,
    medianLengthS: median(sums.map((s) => s.lengthS)),
  };
}

const mmss = (s: number | null): string => (s === null ? "n/a" : s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);
const pct = (n: number, d: number): string => (d ? `${Math.round((100 * n) / d)}%` : "n/a");

/** Console table: one anonymous row per tester index plus the aggregate. Stays on the owner's machine. */
export function renderTesterConsole(sums: readonly TesterSummary[]): string {
  const head = ["tester", "first build", "tried", "landed", "rejected", "recovered", "voice", "typed", "moods", "length"];
  const rows = sums.map((s) => [`#${s.tester}`, mmss(s.firstBuildS), s.attempted, s.landed, s.rejected, s.recovered, s.voice, s.typed, s.moods, mmss(s.lengthS)].map(String));
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (c: string[]): string => c.map((x, i) => x.padEnd(w[i])).join("  ");
  return [line(head), line(w.map((n) => "-".repeat(n))), ...rows.map(line)].join("\n");
}

/** The committed evidence page: aggregates only, no per-person rows, no names, no prompts. */
export function renderTesterMarkdown(a: TesterAggregate, malformed = 0): string {
  const L: string[] = [];
  L.push("# Family test: results");
  L.push("");
  L.push("Generated by `npm run testers` from this machine's local session log (`logs/testers.jsonl`). " +
    "The log is gitignored and holds only anonymous tester numbers, event names and timestamps: no names and nothing anyone typed or said. " +
    "This page holds aggregates only.");
  L.push("");
  if (a.testers === 0) {
    L.push("No sessions recorded yet.");
    L.push("");
    return L.join("\n");
  }
  L.push("| Measure | Result |");
  L.push("| --- | --- |");
  L.push(`| Testers | ${a.testers} |`);
  L.push(`| Reached a first landed build | ${a.reachedFirstBuild} of ${a.testers} (${pct(a.reachedFirstBuild, a.testers)}) |`);
  L.push(`| Time to first landed build, median | ${mmss(a.medianFirstBuildS)} |`);
  L.push(`| Time to first landed build, fastest to slowest | ${mmss(a.fastestFirstBuildS)} to ${mmss(a.slowestFirstBuildS)} |`);
  L.push(`| Builds attempted / landed | ${a.attempted} / ${a.landed} |`);
  L.push(`| Rejections recovered | ${a.recovered} of ${a.rejected} |`);
  L.push(`| Spoken share of commands | ${a.voiceShare === null ? "n/a" : `${Math.round(a.voiceShare * 100)}%`} (${a.testersUsingVoice} of ${a.testers} used voice) |`);
  L.push(`| Testers who changed the mood | ${a.testersUsingMoods} of ${a.testers} |`);
  L.push(`| Session length, median | ${mmss(a.medianLengthS)} |`);
  L.push("");
  if (malformed) L.push(`${malformed} unreadable log line(s) were skipped.`, "");
  return L.join("\n");
}
