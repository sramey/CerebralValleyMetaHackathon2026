// Permanent creation log: every AI build lands here as one JSONL line so any
// past build can be reviewed or debugged later.
//
// FILE: logs/builds.jsonl (directory auto-created; gitignored). Append-only —
// nothing here ever rewrites or deletes existing lines. Logging never throws:
// a logging failure must not break a live build. npm run stats aggregates this
// file into docs/evidence/build-stats.md; tests redirect it with setLogFile()
// so a test run never pollutes the real evidence.
//
// LINE FORMATS (one JSON object per line):
//   Build: { kind? (absent = build), ts ISO, command, route: "new"|"tweak"|"edit",
//            outcome: "mod"|"tweak"|"edit"|"failed"|"say"|"cancelled",
//            modId?, title?, knob?, value?,
//            timings { route, write, compile, verify, total } (ms),
//            verify? { ok, errors[], msPerFrame }, fixAttempted, sourceFile?,
//            sourceFiles?: string[] }
//     outcome "mod"  = Wonder's new mod verified and hot-loaded.
//     outcome "edit" = in-place rewrite of a loaded mod verified and hot-loaded.
//     outcome "tweak" = knob change applied locally or forwarded to the client.
//     outcome "failed" = still unverified after the one auto-fix round.
//     outcome "say"  = no build attempted (missing key, router miss/hiccup,
//                      question, writer/fix error). Undo removals are NOT logged
//                      (not builds; no "undo" outcome exists).
//     outcome "cancelled" = the player stopped it from the build chip (ADR 0060): neither
//                      a landed build nor a failure, so the success rate is not skewed.
//     sourceFile = latest saved Wonder source; sourceFiles = all saved
//     versions (initial + fixed) for this build.
//   Art: { kind: "art", ts ISO, subject, file, ms, samOk } (see logArt).
//   Mood: { kind: "mood", ts ISO, mood (resolved slug), ms } (see logMood) — the
//         player's own words are not written, only the mood name the game picked.
//
// MOD SOURCES: every Wonder-written source (initial + fixed versions) is saved
// to logs/mods/<yyyymmdd-hhmmss>-<modId-or-unknown>-v<n>.ts (UTC stamp).
// All versions of one build share the same stamp; v1 = initial, v2 = fix.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const LOG_FILE = join(process.cwd(), "logs", "builds.jsonl");
export const MODS_DIR = join(process.cwd(), "logs", "mods");

// Tests point the log at a temp file so a test run can never write into the real
// evidence log (npm run stats reads it). Production never calls the setter.
let activeLog = LOG_FILE;

/** Point every log*() call at another file (null restores the repo default). */
export function setLogFile(file: string | null): void {
  activeLog = file ?? LOG_FILE;
}

/** Where log*() calls are writing right now. */
export function activeLogFile(): string {
  return activeLog;
}

export interface BuildTimings {
  route: number;
  write: number;
  compile: number;
  verify: number;
  total: number;
}

export type BuildOutcome = "mod" | "tweak" | "edit" | "failed" | "say" | "cancelled";

export interface BuildEntry {
  command: string;
  route: string;
  outcome: BuildOutcome;
  modId?: string;
  title?: string;
  knob?: string;
  value?: unknown;
  timings: BuildTimings;
  verify?: { ok: boolean; errors: string[]; msPerFrame: number };
  fixAttempted: boolean;
  /** Wonder's tool loop for this build (ADR 0016): model turns and each tool call. */
  agent?: { turns: number; calls: number; tools: { name: string; ms: number; ok?: boolean }[] };
  /** Compound command this build belonged to, and how many ran in parallel. */
  batch?: { size: number; parallel: number };
  sourceFile?: string;
  sourceFiles?: string[];
}

function stamp(d = new Date()): string {
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

function safeId(id: string | undefined): string {
  return id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : "unknown";
}

/**
 * Save Wonder-written mod sources for one build. sources[0] is the initial
 * version, sources[1] (if present) the fixed version. Returns saved paths
 * (latest last). Never throws — returns [] on failure.
 */
export function saveModSources(sources: string[], modId?: string): string[] {
  try {
    if (sources.length === 0) return [];
    mkdirSync(MODS_DIR, { recursive: true });
    const base = `${stamp()}-${safeId(modId)}`;
    const out: string[] = [];
    sources.forEach((src, i) => {
      const file = join(MODS_DIR, `${base}-v${i + 1}.ts`);
      writeFileSync(file, src);
      out.push(file);
    });
    return out;
  } catch {
    return [];
  }
}

/** Append one build entry as a single JSON line. Never throws. */
export function logBuild(entry: BuildEntry): void {
  try {
    mkdirSync(dirname(activeLog), { recursive: true });
    appendFileSync(activeLog, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch {
    /* logging must not break builds */
  }
}

/** Append one art-generation record to the same JSONL file. Never throws. */
export function logArt(rec: { subject: string; key?: string; file: string; ms: number; samOk?: boolean }): void {
  try {
    mkdirSync(dirname(activeLog), { recursive: true });
    appendFileSync(
      activeLog,
      JSON.stringify({ kind: "art", ts: new Date().toISOString(), ...rec }) + "\n",
    );
  } catch {
    /* logging must not break anything */
  }
}

/**
 * Append one mood-restyle record (ADR 0017) to the same JSONL file. Only the
 * resolved mood name is written — never the player's sentence. Never throws.
 */
export function logMood(rec: { mood: string; ms?: number }): void {
  try {
    mkdirSync(dirname(activeLog), { recursive: true });
    appendFileSync(activeLog, JSON.stringify({ kind: "mood", ts: new Date().toISOString(), ...rec }) + "\n");
  } catch {
    /* logging must not break anything */
  }
}
