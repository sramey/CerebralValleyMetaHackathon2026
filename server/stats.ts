// Impact evidence from the permanent creation log (logs/builds.jsonl).
//
// `npm run stats` reads the local log, prints a summary and rewrites
// docs/evidence/build-stats.md. The log itself is gitignored because it holds
// every player command, so the published page must be built from AGGREGATES
// ONLY: no prompts, no file paths, no names. Everything in this module is pure
// (no filesystem, no clock), so tests/stats.test.ts can pin the numbers on a
// fixture without a log on disk.
//
// Line formats are defined in server/createlog.ts: a build line has no `kind`,
// art/learn/mood lines carry one. Only build lines feed the build numbers.
export interface LogRow {
  kind?: string;
  ts?: string;
  command?: string;
  route?: string;
  outcome?: string;
  mood?: string;
  modId?: string;
  knob?: string;
  title?: string;
  timings?: { route?: number; write?: number; compile?: number; verify?: number; total?: number };
  verify?: { ok?: boolean; errors?: string[]; msPerFrame?: number };
  fixAttempted?: boolean;
  agent?: { turns?: number; calls?: number; playtests?: number; rejected?: number; tools?: { name?: string; ok?: boolean }[] };
  batch?: { size?: number; parallel?: number };
  /** Art lines: generation time and whether SAM accepted the sheet. */
  ms?: number;
  samOk?: boolean;
  /** Learn lines: the event kind (rule, autofix-rule, skill, ...). */
  event?: string;
  rule?: string;
  sourceFile?: string;
  sourceFiles?: string[];
}

/** Outcomes that mean "code was written, verified and hot-loaded" (see BuildOutcome in createlog). */
const LANDED: ReadonlySet<string> = new Set(["mod", "edit"]);

export type FailureCategory =
  | "compile error"
  | "playtest assertion"
  | "timeout"
  | "model or API error"
  | "no verifier detail"
  | "other verifier error";

/** Short, generic bucket for a failed build's verifier output (never the raw text). */
export function categorizeFailure(errors: string[] | undefined): FailureCategory {
  const text = (errors ?? []).join("\n").toLowerCase();
  if (!text.trim()) return "no verifier detail";
  if (/compile error|transform failed|syntaxerror|parse error|unexpected end of file|unexpected token/.test(text)) {
    return "compile error";
  }
  if (/timed out|timeout|etimedout|aborted|abort/.test(text)) return "timeout";
  if (/http \d{3}|rate limit|quota|unauthorized|invalid api key|econnrefused|fetch failed/.test(text)) {
    return "model or API error";
  }
  if (/(^|\n)\s*test[:: ]|playtest|assert|expected /.test(text)) return "playtest assertion";
  return "other verifier error";
}

/** Nearest-rank percentile of an ascending list (p in 0..1). */
export function percentile(sortedAscending: number[], p: number): number | null {
  if (sortedAscending.length === 0) return null;
  const idx = Math.min(sortedAscending.length - 1, Math.max(0, Math.ceil(p * sortedAscending.length) - 1));
  return sortedAscending[idx];
}

export interface RouteStats {
  route: string;
  requests: number;
  landed: number;
  failed: number;
  said: number;
  tweaks: number;
  medianMs: number | null;
}

export interface MoodStats {
  requests: number;
  byName: { name: string; count: number }[];
}

export interface BuildStats {
  lines: number;
  malformed: number;
  window: { first: string | null; last: string | null; days: number };
  /** Player requests that reached the server pipeline (build, tweak, question, miss). */
  requests: number;
  /** Requests where Wonder wrote code and the verifier passed: new mods + in-place edits. */
  landed: number;
  /** Builds still unverified after the single auto-fix round. */
  failed: number;
  /** Requests answered without a build (question, router miss, missing key). */
  said: number;
  /** Knob-only changes applied without a rebuild. */
  tweaks: number;
  attempts: number;
  landedPct: number;
  requestsLandedPct: number;
  firstPass: number;
  firstPassPct: number;
  fixAttempts: number;
  fixSaves: number;
  fixFailures: number;
  latency: { count: number; medianMs: number | null; p90Ms: number | null; maxMs: number | null };
  perRoute: RouteStats[];
  outcomes: { outcome: string; count: number }[];
  distinctMods: number;
  edits: number;
  moods: MoodStats;
  failures: { category: FailureCategory; count: number }[];
  art: { count: number; medianMs: number | null; samOkPct: number | null };
  learn: { count: number; byEvent: { event: string; count: number }[] };
  agent: {
    builds: number; medianTurns: number | null; medianCalls: number | null;
    /** Autonomy (ADR 0033). */
    meanCalls: number | null; playtests: number; rejected: number; landed: number; selfCorrected: number;
  };
  perf: { samples: number; medianMsPerFrame: number | null };
  parallelBatches: number;
}

/** Parse JSONL, skipping blank lines and counting lines we could not read. */
export function parseLog(text: string): { rows: LogRow[]; malformed: number } {
  const rows: LogRow[] = [];
  let malformed = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj: unknown = JSON.parse(line);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) rows.push(obj as LogRow);
      else malformed++;
    } catch {
      malformed++;
    }
  }
  return { rows, malformed };
}

/** A build line is one with no `kind` (see server/createlog.ts). */
function isBuildRow(row: LogRow): boolean {
  return !row.kind;
}

function isMoodRow(row: LogRow): boolean {
  return row.kind === "mood" || row.route === "mood" || row.outcome === "mood";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function sortCounts(counts: Map<string, number>): { key: string; count: number }[] {
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function moodName(row: LogRow): string {
  const raw = typeof row.mood === "string" ? row.mood : "";
  const clean = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  return clean || "unnamed";
}

export function aggregate(rows: LogRow[], malformed = 0): BuildStats {
  const builds = rows.filter(isBuildRow);
  const landedRows = builds.filter((r) => typeof r.outcome === "string" && LANDED.has(r.outcome));
  const failedRows = builds.filter((r) => r.outcome === "failed");
  const saidRows = builds.filter((r) => r.outcome === "say");
  const tweakRows = builds.filter((r) => r.outcome === "tweak");

  const landed = landedRows.length;
  const failed = failedRows.length;
  const attempts = landed + failed;

  // End-to-end build time as the player waits for it (route + write + compile +
  // verify). Zero totals are rows that never reached a timed stage.
  const landedMs = landedRows
    .map((r) => num(r.timings?.total))
    .filter((v): v is number => v !== null && v > 0)
    .sort((a, b) => a - b);

  const stamps = rows
    .map((r) => r.ts)
    .filter((ts): ts is string => typeof ts === "string" && /^\d{4}-\d{2}-\d{2}/.test(ts))
    .sort();

  const routeCounts = new Map<string, RouteStats>();
  for (const row of builds) {
    const route = typeof row.route === "string" && row.route ? row.route : "unknown";
    const rec = routeCounts.get(route) ?? { route, requests: 0, landed: 0, failed: 0, said: 0, tweaks: 0, medianMs: null };
    rec.requests++;
    if (typeof row.outcome === "string" && LANDED.has(row.outcome)) rec.landed++;
    else if (row.outcome === "failed") rec.failed++;
    else if (row.outcome === "say") rec.said++;
    else if (row.outcome === "tweak") rec.tweaks++;
    routeCounts.set(route, rec);
  }
  const perRoute = [...routeCounts.values()]
    .map((rec) => {
      const ms = builds
        .filter((row) => (row.route || "unknown") === rec.route && typeof row.outcome === "string" && LANDED.has(row.outcome))
        .map((row) => num(row.timings?.total))
        .filter((v): v is number => v !== null && v > 0)
        .sort((a, b) => a - b);
      return { ...rec, medianMs: percentile(ms, 0.5) };
    })
    .sort((a, b) => b.requests - a.requests || a.route.localeCompare(b.route));

  const outcomeCounts = new Map<string, number>();
  for (const row of builds) outcomeCounts.set(String(row.outcome ?? "unknown"), (outcomeCounts.get(String(row.outcome ?? "unknown")) ?? 0) + 1);

  const modIds = new Set(landedRows.map((r) => r.modId).filter((id): id is string => typeof id === "string" && id.length > 0));

  const moodRows = rows.filter(isMoodRow);
  const moodNames = new Map<string, number>();
  for (const row of moodRows) moodNames.set(moodName(row), (moodNames.get(moodName(row)) ?? 0) + 1);

  // One failed build can trip several assertions; count each category once per build.
  const failureCounts = new Map<FailureCategory, number>();
  for (const row of failedRows) {
    const categories = new Set<FailureCategory>([categorizeFailure(row.verify?.errors)]);
    for (const c of categories) failureCounts.set(c, (failureCounts.get(c) ?? 0) + 1);
  }

  const artRows = rows.filter((r) => r.kind === "art");
  const artMs = artRows
    .map((r) => num(r.ms))
    .filter((v): v is number => v !== null && v > 0)
    .sort((a, b) => a - b);
  const samChecked = artRows.filter((r) => typeof r.samOk === "boolean");

  const learnRows = rows.filter((r) => r.kind === "learn");
  const learnEvents = new Map<string, number>();
  for (const row of learnRows) {
    const event = typeof row.event === "string" && row.event ? row.event : "other";
    learnEvents.set(event, (learnEvents.get(event) ?? 0) + 1);
  }

  const agentRows = builds.filter((r) => r.agent);
  const turns = agentRows
    .map((r) => num(r.agent?.turns))
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const calls = agentRows
    .map((r) => num(r.agent?.calls))
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);

  // Autonomy: playtests Wonder ran on its own drafts, and landed builds that needed a correction.
  let playtests = 0, rejected = 0, agentLanded = 0, selfCorrected = 0, callSum = 0;
  for (const r of agentRows) {
    const tools = Array.isArray(r.agent?.tools) ? r.agent!.tools! : [];
    const pt = num(r.agent?.playtests) ?? tools.filter((t) => t.name === "run_playtest").length;
    const rej = num(r.agent?.rejected) ?? tools.filter((t) => t.name === "run_playtest" && t.ok === false).length;
    playtests += pt;
    rejected += rej;
    callSum += num(r.agent?.calls) ?? tools.length;
    if (LANDED.has(String(r.outcome))) {
      agentLanded++;
      if (rej > 0 || r.fixAttempted === true) selfCorrected++;
    }
  }

  const frames = builds
    .map((r) => num(r.verify?.msPerFrame))
    .filter((v): v is number => v !== null && v > 0)
    .sort((a, b) => a - b);

  const fixAttempts = builds.filter((r) => r.fixAttempted === true).length;
  const fixSaves = landedRows.filter((r) => r.fixAttempted === true).length;
  const fixFailures = failedRows.filter((r) => r.fixAttempted === true).length;
  const firstPass = landedRows.filter((r) => r.fixAttempted !== true).length;

  const first = stamps[0] ?? null;
  const last = stamps[stamps.length - 1] ?? null;
  const days = first && last
    ? Math.max(1, Math.round((Date.parse(last.slice(0, 10)) - Date.parse(first.slice(0, 10))) / 86_400_000) + 1)
    : 0;

  return {
    lines: rows.length,
    malformed,
    window: { first, last, days },
    requests: builds.length,
    landed,
    failed,
    said: saidRows.length,
    tweaks: tweakRows.length,
    attempts,
    landedPct: attempts === 0 ? 0 : landed / attempts,
    requestsLandedPct: builds.length === 0 ? 0 : landed / builds.length,
    firstPass,
    firstPassPct: landed === 0 ? 0 : firstPass / landed,
    fixAttempts,
    fixSaves,
    fixFailures,
    latency: {
      count: landedMs.length,
      medianMs: percentile(landedMs, 0.5),
      p90Ms: percentile(landedMs, 0.9),
      maxMs: landedMs.length ? landedMs[landedMs.length - 1] : null,
    },
    perRoute,
    outcomes: sortCounts(outcomeCounts).map(({ key, count }) => ({ outcome: key, count })),
    distinctMods: modIds.size,
    edits: landedRows.filter((r) => r.outcome === "edit").length,
    moods: { requests: moodRows.length, byName: sortCounts(moodNames).map(({ key, count }) => ({ name: key, count })) },
    failures: [...failureCounts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
    art: {
      count: artRows.length,
      medianMs: percentile(artMs, 0.5),
      samOkPct: samChecked.length === 0 ? null : samChecked.filter((r) => r.samOk === true).length / samChecked.length,
    },
    learn: { count: learnRows.length, byEvent: sortCounts(learnEvents).map(({ key, count }) => ({ event: key, count })) },
    agent: {
      builds: agentRows.length,
      medianTurns: percentile(turns, 0.5),
      medianCalls: percentile(calls, 0.5),
      meanCalls: agentRows.length === 0 ? null : callSum / agentRows.length,
      playtests, rejected, landed: agentLanded, selfCorrected,
    },
    perf: { samples: frames.length, medianMsPerFrame: percentile(frames, 0.5) },
    parallelBatches: builds.filter((r) => (num(r.batch?.parallel) ?? 1) > 1).length,
  };
}

// ---------------------------------------------------------------- rendering

function pct(n: number, d: number): string {
  return d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—";
}

function secs(ms: number | null): string {
  return ms === null ? "—" : `${(ms / 1000).toFixed(1)} s`;
}

function msText(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 0.01) return `${(ms * 1000).toFixed(1)} µs`;
  return `${ms.toFixed(2)} ms`;
}

function day(ts: string | null): string {
  return ts === null ? "—" : ts.slice(0, 10);
}

/**
 * Render the published evidence page. Only numbers, counts and fixed labels —
 * never a prompt, a mod title, an error body or a file path — so the page can be
 * committed to the public repo.
 */
export function renderMarkdown(stats: BuildStats): string {
  const s = stats;
  const out: string[] = [];

  out.push("# Build stats: impact evidence");
  out.push("");
  out.push(
    "Generated by `npm run stats` from this machine's local creation log (`logs/builds.jsonl`). " +
      "The log holds every player command, so it stays local and gitignored: this page keeps " +
      "**aggregate numbers only** — no prompts, no file paths, no names.",
  );
  out.push("");
  out.push(
    `- **Log window:** ${day(s.window.first)} → ${day(s.window.last)} (${s.window.days} day${s.window.days === 1 ? "" : "s"}), ${s.lines} JSONL lines` +
      (s.malformed > 0 ? `, ${s.malformed} unreadable` : ""),
  );
  out.push("- **Regenerate:** `npm run stats` (rewrites this file; `npm test` pins the maths)");
  out.push(
    "- **Source:** the game's own append-only creation log, written line by line at build time by " +
      "`server/createlog.ts` — not a hand-written spreadsheet.",
  );
  out.push("");
  out.push("## Headline");
  out.push("");
  out.push("| Metric | Value |");
  out.push("| --- | --- |");
  out.push(`| Player requests that reached the pipeline | ${s.requests} |`);
  out.push(`| Build attempts (AI wrote code) | ${s.attempts} |`);
  out.push(`| Landed (verified + hot-loaded) | ${s.landed} (${pct(s.landed, s.attempts)} of attempts, ${pct(s.landed, s.requests)} of requests) |`);
  out.push(`| Landed on the first attempt (no auto-fix round) | ${s.firstPass} (${pct(s.firstPass, s.landed)} of landed) |`);
  out.push(
    `| Auto-fix round: saves / attempts | ${s.fixSaves} of ${s.fixAttempts} (${pct(s.fixSaves, s.fixAttempts)}) |`,
  );
  out.push(`| Builds still unverified after the fix round | ${s.failed} |`);
  out.push(`| Verified-knob tweaks (no rebuild) | ${s.tweaks} |`);
  out.push(`| Replies with no build (questions, router miss) | ${s.said} |`);
  out.push(`| Distinct mod ids that landed (new mods + edited mods) | ${s.distinctMods} |`);
  out.push(`| In-place edits of a loaded mod | ${s.edits} |`);
  out.push("");
  out.push(
    "**Landed** = Wonder wrote code, it compiled, passed its own `test()` in the headless verifier, " +
      "and hot-loaded into the running world without a page reload. A landed build is therefore a " +
      "working playable change, not a suggestion.",
  );
  out.push("");
  out.push("## Time to a playable change");
  out.push("");
  out.push("| Build latency (route + write + compile + verify) | Value |");
  out.push("| --- | --- |");
  out.push(`| Landed builds measured | ${s.latency.count} |`);
  out.push(`| Median | ${secs(s.latency.medianMs)} |`);
  out.push(`| p90 | ${secs(s.latency.p90Ms)} |`);
  out.push(`| Slowest | ${secs(s.latency.maxMs)} |`);
  out.push("");
  out.push("## Per-route breakdown");
  out.push("");
  out.push("| Route | Requests | Landed | Failed | No build | Tweaks | Median landed time |");
  out.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of s.perRoute) {
    out.push(`| ${r.route} | ${r.requests} | ${r.landed} | ${r.failed} | ${r.said} | ${r.tweaks} | ${secs(r.medianMs)} |`);
  }
  out.push("");
  out.push(
    "Routes: `new` = a fresh mod from a sentence, `edit` = rewrite a loaded mod in place, " +
      "`tweak` = knob change with no rebuild, `mood` = whole-world restyle, `question` = answered in words.",
  );
  out.push("");
  out.push("## Failure reasons (bucketed)");
  out.push("");
  if (s.failures.length === 0) {
    out.push("No failed builds in this window.");
  } else {
    out.push("| Category | Failed builds |");
    out.push("| --- | --- |");
    for (const f of s.failures) out.push(`| ${f.category} | ${f.count} |`);
  }
  out.push("");
  out.push("## Mood restyles");
  out.push("");
  if (s.moods.requests === 0) {
    out.push("No mood events in this log window (mood restyles are logged as their own `kind: \"mood\"` lines).");
  } else {
    out.push(`| Mood | Requests |`);
    out.push("| --- | --- |");
    for (const m of s.moods.byName) out.push(`| ${m.name} | ${m.count} |`);
  }
  out.push("");
  out.push("## Other Meta calls logged alongside the builds");
  out.push("");
  out.push("| Activity | Value |");
  out.push("| --- | --- |");
  out.push(`| Art sheets generated (Muse Image) | ${s.art.count} |`);
  out.push(`| Median art generation time | ${secs(s.art.medianMs)} |`);
  out.push(`| Sheets accepted by the SAM check | ${s.art.samOkPct === null ? "— (not recorded in this window)" : `${(s.art.samOkPct * 100).toFixed(0)}%`} |`);
  out.push(`| Rules / skills learned from fixes and feedback | ${s.learn.count} |`);
  if (s.learn.byEvent.length > 0) {
    out.push(`| &nbsp;&nbsp;by event | ${s.learn.byEvent.map((e) => `${e.event} ${e.count}`).join(", ")} |`);
  }
  out.push(`| Builds that used Wonder's tool loop | ${s.agent.builds} |`);
  out.push(`| Median tool-loop turns / calls per build | ${s.agent.medianTurns ?? "—"} / ${s.agent.medianCalls ?? "—"} |`);
  out.push(`| Mean tool calls per agent build | ${s.agent.meanCalls === null ? "—" : s.agent.meanCalls.toFixed(1)} |`);
  out.push(`| Playtests Wonder ran on its own drafts (rejected) | ${s.agent.playtests} (${s.agent.rejected}) |`);
  out.push(`| Landed agent builds that self-corrected | ${s.agent.landed === 0 ? "—" : `${s.agent.selfCorrected} of ${s.agent.landed}`} |`);
  out.push(`| Builds that ran inside a parallel batch | ${s.parallelBatches} |`);
  out.push(`| Median per-frame simulation cost in the verifier | ${msText(s.perf.medianMsPerFrame)} |`);
  out.push("");
  out.push("## What this does not measure");
  out.push("");
  out.push(
    "- Only this machine's log window. Earlier sessions are in the same file; nothing was " +
      "hand-tuned or removed.",
  );
  out.push("- Prompt quality, art quality, or how a person felt about the result: those need a human watching the demo.");
  out.push("- Live-demo timings on the judge's network; latency here is a local build loop against the real API.");
  out.push("");
  return out.join("\n");
}

/** One-screen console summary, printed by `npm run stats`. */
export function renderConsole(stats: BuildStats): string {
  const s = stats;
  const lines = [
    `log window ${day(s.window.first)} -> ${day(s.window.last)} (${s.lines} lines)`,
    `requests ${s.requests} | landed ${s.landed} (${pct(s.landed, s.requests)}) | failed ${s.failed} | ask-only ${s.said} | tweaks ${s.tweaks}`,
    `first pass ${s.firstPass}/${s.landed} | auto-fix saves ${s.fixSaves}/${s.fixAttempts}`,
    `latency median ${secs(s.latency.medianMs)} | p90 ${secs(s.latency.p90Ms)} (n=${s.latency.count})`,
    `routes ${s.perRoute.map((r) => `${r.route} ${r.requests}/${r.landed}`).join("  ")}`,
    `moods ${s.moods.requests}${s.moods.byName.length ? ` (${s.moods.byName.map((m) => `${m.name} ${m.count}`).join(", ")})` : ""}`,
    `art ${s.art.count} | learned events ${s.learn.count} | agent builds ${s.agent.builds}`,
    `failures ${s.failures.length === 0 ? "none" : s.failures.map((f) => `${f.category} ${f.count}`).join(", ")}`,
  ];
  return lines.join("\n");
}
