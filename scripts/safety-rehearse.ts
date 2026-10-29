// Screen every command the demo can say through the real kid-safe guard (ADR 0044, bead 82z).
//
// The rehearse harness builds mods, which costs several model calls per command; this one only
// asks the question the guard decides — would this sentence be declined? — so a full pass over
// the demo sets costs one Spark call per sentence (and nothing for a local-list hit).
//
// Usage:
//   npm run safety:rehearse                     # all three sets, live Spark classifier
//   npm run safety:rehearse -- --only "give me a gun"
//   npm run safety:rehearse -- --local-only     # free: exercises the word list with no network
//   npm run safety:rehearse -- --budget 1200    # widen the screen's deadline (default: shipped)
// Exit code is 1 when any command is declined, so this can gate a demo prep.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnv } from "../server/meta";
import {
  lateVerdict,
  MAX_BUDGET_MS,
  screenRequest,
  safetyConfig,
  type Classifier,
  type SafetyDecision,
} from "../server/safety";

/** The command sets every one of which must pass the screen. */
export const SETS: readonly { file: string; label: string }[] = [
  { file: "rehearse.json", label: "demo" },
  { file: "rehearse-aware.json", label: "aware" },
  { file: "rehearse-weapons.json", label: "weapons" },
];

/** How long to wait for the verdict that missed the screen's soft deadline (the build waits for
 *  it too, via `lateVerdict`), capped by the classifier's own hard ceiling. */
export const LATE_WAIT_MS = MAX_BUDGET_MS + 500;
const LOG_FILE = join("logs", "safety-rehearse.jsonl");

/** One screened sentence. `by` is the lane that answered: local, spark, cache, skipped. */
export interface ScreenRow {
  command: string;
  /** Which set(s) the sentence came from. */
  sets: string[];
  unsafe: boolean;
  category: string | null;
  by: SafetyDecision["by"];
  /** Time the guard itself took. */
  ms: number;
  /** Extra time this harness spent waiting for a verdict that missed the deadline. */
  waitedMs: number;
}

export interface ScreenSummary {
  total: number;
  declined: number;
  /** Sentences the word list refused (free). */
  local: number;
  /** Sentences a Spark verdict refused. */
  model: number;
  /** Sentences answered by the memo. */
  cached: number;
  /** Sentences the guard let through with no model verdict at all. */
  skipped: number;
  /** Model calls this pass spent: every sentence that was not a local hit or a memo hit. */
  calls: number;
}

/** Read a rehearse-style list: command strings, or {cmd} objects. Unknown shapes are an error. */
export function commandsOf(parsed: unknown, file = "scripts/rehearse.json"): string[] {
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`${file} must be a non-empty array of command strings or {cmd} objects`);
  }
  return parsed.map((entry) => {
    const cmd = typeof entry === "string" ? entry : (entry as { cmd?: unknown } | null)?.cmd;
    if (typeof cmd !== "string" || cmd.trim().length === 0) {
      throw new Error(`${file} entries must be non-empty strings or {cmd} objects`);
    }
    return cmd.trim();
  });
}

/** Every sentence of every set once, remembering which sets reuse it. */
export function collectCommands(sets: readonly { file: string; label: string }[], read: (file: string) => unknown): {
  commands: string[];
  from: Map<string, string[]>;
} {
  const from = new Map<string, string[]>();
  for (const set of sets) {
    for (const cmd of commandsOf(read(set.file), `scripts/${set.file}`)) {
      const labels = from.get(cmd) ?? [];
      if (!labels.includes(set.label)) labels.push(set.label);
      from.set(cmd, labels);
    }
  }
  return { commands: [...from.keys()], from };
}

/**
 * The verdict the build path would end up honouring: an answer inside the screen's deadline,
 * else the late verdict it reads before the Wonder write, else the fail-open pass.
 */
export async function settle(
  decision: SafetyDecision,
  waitMs = LATE_WAIT_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
  now: () => number = () => Date.now(),
): Promise<{ decision: SafetyDecision; waitedMs: number }> {
  if (!decision.pending) return { decision, waitedMs: 0 };
  const t0 = now();
  for (;;) {
    const late = lateVerdict(decision.pending);
    if (late) return { decision: late, waitedMs: Math.round(now() - t0) };
    if (now() - t0 >= waitMs) return { decision, waitedMs: Math.round(now() - t0) };
    await sleep(50);
  }
}

/** Screen one command the way the server does, and report what the build would have seen. */
export async function screenCommand(
  command: string,
  opts: { classify?: Classifier; budgetMs?: number; waitMs?: number; sets?: string[] } = {},
): Promise<ScreenRow> {
  const first = await screenRequest(command, { budgetMs: opts.budgetMs, classify: opts.classify });
  const { decision, waitedMs } = await settle(first, opts.waitMs);
  return {
    command,
    sets: opts.sets ?? [],
    unsafe: decision.unsafe,
    category: decision.category,
    by: decision.by,
    ms: decision.ms,
    waitedMs,
  };
}

export function summarizeScreens(rows: readonly ScreenRow[], modeled = true): ScreenSummary {
  const count = (by: SafetyDecision["by"]): number => rows.filter((row) => row.by === by && !row.unsafe).length;
  return {
    total: rows.length,
    declined: rows.filter((row) => row.unsafe).length,
    local: rows.filter((row) => row.by === "local").length,
    model: rows.filter((row) => row.by === "spark" && row.unsafe).length,
    cached: count("cache"),
    skipped: count("skipped"),
    // A skipped row still spent its classifier call in a live run; with the stub classifier
    // (--local-only) nothing left the machine, so the pass costs zero.
    calls: modeled ? rows.filter((row) => row.by !== "local" && row.by !== "cache").length : 0,
  };
}

/** One line per command, then the headline. Pure, so the table can be tested without a network. */
export function formatScreens(rows: readonly ScreenRow[], modeled = true): string {
  const width = Math.max(...rows.map((row) => row.command.length), "command".length);
  const lines = rows.map((row) => {
    const verdict = row.unsafe ? `DECLINED (${row.category ?? "other"})` : "pass";
    const waited = row.waitedMs >= 50 ? ` +${row.waitedMs} ms late` : "";
    return `${row.command.padEnd(width)}  ${verdict.padEnd(22)} ${String(row.by).padEnd(8)} ${String(row.ms).padStart(4)} ms${waited}  [${row.sets.join(",")}]`;
  });
  const s = summarizeScreens(rows, modeled);
  lines.push(
    "",
    `${s.total} commands, ${s.declined} declined (${s.local} local, ${s.model} model); ` +
      `${s.cached} memo hits, ${s.skipped} no verdict; ${s.calls} model call(s)`,
  );
  return lines.join("\n");
}

interface Options {
  only?: string;
  budgetMs?: number;
  localOnly: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { localOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--only") {
      const only = argv[++i]?.trim();
      if (!only) throw new Error("--only needs a command to screen");
      options.only = only;
    } else if (flag === "--budget") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) throw new Error("--budget needs a positive number of ms");
      options.budgetMs = Math.min(MAX_BUDGET_MS, Math.round(n));
    } else if (flag === "--local-only") options.localOnly = true;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  return options;
}

/** The free preflight: a classifier that never answers, so only the word list can decline. */
const noVerdict: Classifier = async () => null;

async function main(): Promise<void> {
  loadEnv();
  const options = parseArgs(process.argv.slice(2));
  const cfg = safetyConfig();
  if (!cfg.enabled) {
    console.error("SAFETY is off in .env — this harness proves nothing with the guard down. Set SAFETY=on (or unset it) and run again.");
    process.exitCode = 2;
    return;
  }
  const { commands, from } = collectCommands(SETS, (file) => JSON.parse(readFileSync(new URL(`./${file}`, import.meta.url), "utf8")));
  const selected = options.only ? commands.filter((cmd) => cmd === options.only) : commands;
  if (selected.length === 0) throw new Error(`--only did not match a command in ${SETS.map((s) => s.file).join(", ")}`);

  const classify = options.localOnly ? noVerdict : undefined;
  console.log(
    `Screening ${selected.length} command(s)${options.localOnly ? " with the word list only (no model calls)" : " with SAFETY on (live Muse Spark)"}` +
      `${options.budgetMs ? `, budget ${options.budgetMs} ms` : ""}`,
  );

  const rows: ScreenRow[] = [];
  for (const command of selected) {
    const row = await screenCommand(command, { classify, budgetMs: options.budgetMs, sets: from.get(command) });
    rows.push(row);
    mkdirSync(join(process.cwd(), "logs"), { recursive: true });
    appendFileSync(join(process.cwd(), LOG_FILE), `${JSON.stringify({ ...row, at: new Date().toISOString() })}\n`);
    console.log(`${row.unsafe ? "DECLINED" : "pass    "} ${String(row.ms).padStart(4)} ms  ${command}`);
  }

  console.log(`\n${formatScreens(rows, !options.localOnly)}`);
  const summary = summarizeScreens(rows, !options.localOnly);
  if (summary.declined > 0) {
    console.error(`\n${summary.declined} demo command(s) were declined — this fails the bead.`);
    process.exitCode = 1;
  }
  console.log(`\nRaw rows appended to ${LOG_FILE}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(`safety:rehearse failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
