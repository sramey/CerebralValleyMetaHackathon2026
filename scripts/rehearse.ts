// Repeat the demo script against a live server, one fresh starter world per run.
// Usage: npm run rehearse -- [--runs N] [--only "make me huge"] [--port 8796] [--file rehearse-aware.json]
// The default set (rehearse.json) is exactly the demo commands from docs/DEMO.md; rehearse-aware.json is the world-awareness set.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocket } from "ws";
import type { ClientMsg, KnobValue, ServerMsg } from "../src/contract";
import { loadEnv } from "../server/meta";

const TIMEOUT_MS = 180_000;
const LOG_FILE = join("logs", "rehearse.jsonl");

export type Outcome = "landed" | "rejected" | "failed";
export type Expectation = "landed" | "rejected-then-fixed" | "rejected";

/** World-awareness checks (bead 4fa): what the router should have understood, not just that something landed. */
export interface AwareChecks {
  /** The command must restyle the world with this mood (and build no mod). */
  mood?: string;
  /** A regex (case-insensitive) the built mod's source must match, e.g. "api\.player\(" for a player ability. */
  source?: string;
  /** A regex the built mod's source must NOT match, e.g. an NPC edit when the player was meant. */
  notSource?: string;
  /** The built mod must not get a sprite sheet (terrain, effects, projectiles): art stays code-drawn. */
  noArt?: boolean;
}

export interface RehearsalSpec extends AwareChecks {
  cmd: string;
  expect?: Expectation;
}

export interface RehearsalRow {
  run: number;
  command: string;
  outcome: Outcome;
  totalMs: number;
  autoFixRounds: number;
  rejectedThenFixed: boolean;
  expect?: Expectation;
  metExpect?: boolean;
  /** Why an aware check failed, when one did. */
  awareMiss?: string;
}

export interface CommandSummary {
  command: string;
  runs: number;
  passed: number;
  passPct: number;
  p50Ms: number;
  p90Ms: number;
  autoFixRounds: number;
  rejectedThenFixed: number;
  expect?: Expectation;
  expected?: number;
  expectPct?: number;
}

const EXPECTATIONS: readonly Expectation[] = ["landed", "rejected-then-fixed", "rejected"];

/** What one command did to the world, as seen on the wire. */
export interface Observed { moods: string[]; sources: string[]; arts: string[] }

/** Pure: the first aware check this command's observed effects fail, or undefined when all hold. */
export function awareMiss(checks: AwareChecks, seen: Observed): string | undefined {
  if (checks.mood !== undefined && !seen.moods.includes(checks.mood)) return `expected mood "${checks.mood}", saw ${seen.moods.join(",") || "none"}${seen.sources.length ? " + a mod build" : ""}`;
  if (checks.mood !== undefined && seen.sources.length > 0) return "a mood command also built a mod";
  if (checks.source !== undefined && !seen.sources.some((src) => new RegExp(checks.source!, "i").test(src))) return `mod source did not match /${checks.source}/`;
  if (checks.notSource !== undefined && seen.sources.some((src) => new RegExp(checks.notSource!, "i").test(src))) return `mod source matched forbidden /${checks.notSource}/`;
  if (checks.noArt && seen.arts.length > 0) return `got sprite art: ${seen.arts.join(",")}`;
  return undefined;
}

export function metExpectation(row: Pick<RehearsalRow, "outcome" | "rejectedThenFixed"> & { awareMiss?: string }, expect: Expectation = "landed"): boolean {
  if (row.awareMiss) return false;
  if (expect === "rejected-then-fixed") return row.outcome === "landed" && row.rejectedThenFixed;
  if (expect === "rejected") return row.outcome === "rejected";
  return row.outcome === "landed";
}

/** Everything one command's run knows about the world so far, after the messages seen so far. */
export interface CommandState {
  /** The command changed the world: a mod landed, a knob moved, a mod was removed, or a mood came or went. */
  landed: boolean;
  /** The verifier turned a draft away (the "rejected then fixed" demo beat). */
  rejected: boolean;
  autoFixRounds: number;
  /** The server's end-of-command marker for this command, in ms; undefined while it is still running. */
  doneMs?: number;
  seen: Observed;
}

export const emptyCommandState = (): CommandState => ({ landed: false, rejected: false, autoFixRounds: 0, seen: { moods: [], sources: [], arts: [] } });

/**
 * Pure step from a server message to the command's state. Only messages for this command move the
 * stages or finish it, so a sub-build's own timing in a compound command cannot end the whole one.
 * A mood message counts as a landing whether it applies a mood or clears one: clearing is what
 * "undo" sends (demo beat 6), and the world visibly changed.
 */
export function applyServerMsg(state: CommandState, msg: ServerMsg, command: string): CommandState {
  switch (msg.kind) {
    case "mood": {
      const moods = msg.mood ? [...state.seen.moods, msg.mood.name] : state.seen.moods;
      return { ...state, landed: true, seen: { ...state.seen, moods } };
    }
    case "art":
      return { ...state, seen: { ...state.seen, arts: [...state.seen.arts, msg.art.key] } };
    case "mod": {
      const arts = msg.mod.art ? [...state.seen.arts, msg.mod.art.key] : state.seen.arts;
      return { ...state, landed: true, seen: { sources: [...state.seen.sources, msg.mod.source], moods: state.seen.moods, arts } };
    }
    case "tweak":
    case "removed":
      return { ...state, landed: true };
    case "stage":
      if (msg.command !== command) return state;
      if (msg.stage === "rejected") return { ...state, rejected: true };
      if (msg.stage === "fixing") return { ...state, autoFixRounds: state.autoFixRounds + 1 };
      return state;
    case "timing":
      return msg.command === command ? { ...state, doneMs: msg.ms.total } : state;
    default:
      return state;
  }
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarizeGroup(command: string, rows: readonly RehearsalRow[]): CommandSummary {
  const passed = rows.filter((row) => row.outcome === "landed").length;
  const hasExpect = rows.some((row) => row.expect !== undefined);
  const groupExpect = command === "ALL" ? undefined : rows.find((row) => row.expect !== undefined)?.expect;
  const expected = rows.filter((row) => row.metExpect ?? metExpectation(row, row.expect)).length;
  const expectPct = rows.length === 0 ? 0 : Math.round((expected / rows.length) * 1000) / 10;
  return {
    command,
    runs: rows.length,
    passed,
    passPct: rows.length === 0 ? 0 : Math.round((passed / rows.length) * 1000) / 10,
    p50Ms: percentile(rows.map((row) => row.totalMs), 50),
    p90Ms: percentile(rows.map((row) => row.totalMs), 90),
    autoFixRounds: rows.reduce((sum, row) => sum + row.autoFixRounds, 0),
    rejectedThenFixed: rows.filter((row) => row.rejectedThenFixed).length,
    ...(hasExpect ? { ...(groupExpect ? { expect: groupExpect } : {}), expected, expectPct } : {}),
  };
}

/** Pure summarizer: latency percentiles include both passing and failing attempts. */
export function summarize(rows: readonly RehearsalRow[]): CommandSummary[] {
  const groups = new Map<string, RehearsalRow[]>();
  for (const row of rows) {
    const group = groups.get(row.command) ?? [];
    group.push(row);
    groups.set(row.command, group);
  }
  return [...groups].map(([command, commandRows]) => summarizeGroup(command, commandRows));
}

export function summarizeAll(rows: readonly RehearsalRow[]): CommandSummary {
  return summarizeGroup("ALL", rows);
}

interface Options {
  runs: number;
  only?: string;
  port: number;
  file: string;
}

function integerArg(value: string | undefined, flag: string, min: number, max: number): number {
  const n = Number(value);
  if (!value || !Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${flag} needs an integer from ${min} to ${max}`);
  }
  return n;
}

function parseArgs(argv: readonly string[], defaultPort: number): Options {
  const options: Options = { runs: 1, port: defaultPort, file: "rehearse.json" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--runs") options.runs = integerArg(argv[++i], flag, 1, 1000);
    else if (flag === "--port") options.port = integerArg(argv[++i], flag, 1, 65535);
    else if (flag === "--file") {
      const file = argv[++i]?.trim();
      if (!file || !/^[\w.-]+\.json$/.test(file)) throw new Error("--file needs a .json file name inside scripts/");
      options.file = file;
    } else if (flag === "--only") {
      const only = argv[++i]?.trim();
      if (!only) throw new Error("--only needs a command from scripts/rehearse.json");
      options.only = only;
    } else throw new Error(`Unknown argument: ${flag}`);
  }
  return options;
}

export function parseCommandList(parsed: unknown, only?: string): RehearsalSpec[] {
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("scripts/rehearse.json must be a non-empty array of command strings or {cmd, expect} objects");
  }
  const specs: RehearsalSpec[] = parsed.map((entry) => {
    if (typeof entry === "string" && entry.trim().length > 0) {
      return { cmd: entry };
    }
    if (entry && typeof entry === "object") {
      const obj = entry as { cmd?: unknown; expect?: unknown };
      if (typeof obj.cmd === "string" && obj.cmd.trim().length > 0) {
        const checks: AwareChecks = {};
        for (const key of ["mood", "source", "notSource"] as const) {
          const v = (entry as Record<string, unknown>)[key];
          if (v !== undefined) { if (typeof v !== "string" || !v) throw new Error(`rehearse.json "${key}" must be a non-empty string`); checks[key] = v; }
        }
        if ((entry as Record<string, unknown>).noArt === true) checks.noArt = true;
        if (obj.expect === undefined) return { cmd: obj.cmd, ...checks };
        if (typeof obj.expect === "string" && EXPECTATIONS.includes(obj.expect as Expectation)) {
          return { cmd: obj.cmd, expect: obj.expect as Expectation, ...checks };
        }
      }
    }
    throw new Error("scripts/rehearse.json entries must be non-empty strings or {cmd, expect} objects");
  });
  if (only === undefined) return specs;
  const selected = specs.filter((spec) => spec.cmd === only);
  if (selected.length === 0) throw new Error(`--only did not match a command: ${only}`);
  return selected;
}

function readCommands(file: string, only?: string): RehearsalSpec[] {
  const parsed: unknown = JSON.parse(readFileSync(new URL(`./${file}`, import.meta.url), "utf8"));
  return parseCommandList(parsed, only);
}

async function connect(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolveOpen, reject) => {
    ws.once("open", () => resolveOpen());
    ws.once("error", reject);
  });
  return ws;
}

type WorldMod = { id: string; values: Record<string, KnobValue> };

function runCommand(ws: WebSocket, world: WorldMod[], spec: RehearsalSpec, run: number): Promise<RehearsalRow> {
  const command = spec.cmd;
  return new Promise((resolveCommand) => {
    const started = performance.now();
    let cmdState = emptyCommandState();

    const done = (totalMs: number): void => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      const outcome: Outcome = cmdState.landed ? "landed" : cmdState.rejected ? "rejected" : "failed";
      const rejectedThenFixed = cmdState.rejected && cmdState.landed;
      const miss = awareMiss(spec, cmdState.seen);
      const hasChecks = spec.mood !== undefined || spec.source !== undefined || spec.notSource !== undefined || spec.noArt === true;
      const base: RehearsalRow = {
        run,
        command,
        outcome,
        totalMs,
        autoFixRounds: cmdState.autoFixRounds,
        rejectedThenFixed,
        ...(spec.expect || hasChecks ? { expect: spec.expect ?? "landed", metExpect: metExpectation({ outcome, rejectedThenFixed, awareMiss: miss }, spec.expect ?? "landed") } : {}),
        ...(miss ? { awareMiss: miss } : {}),
      };
      resolveCommand(base);
    };

    const timer = setTimeout(() => {
      done(Math.round(performance.now() - started));
    }, TIMEOUT_MS);

    const onMessage = (data: unknown): void => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(data)) as ServerMsg;
      } catch {
        return;
      }
      cmdState = applyServerMsg(cmdState, msg, command);
      if (msg.kind === "mod") {
        const values = Object.fromEntries(Object.entries(msg.mod.knobs).map(([knob, def]) => [knob, def.value]));
        const index = world.findIndex((mod) => mod.id === msg.mod.id);
        if (index < 0) world.push({ id: msg.mod.id, values });
        else world[index] = { id: msg.mod.id, values };
      } else if (msg.kind === "tweak") {
        const mod = world.find((candidate) => candidate.id === msg.modId);
        if (mod) mod.values[msg.knob] = msg.value;
      } else if (msg.kind === "removed") {
        const index = world.findIndex((mod) => mod.id === msg.modId);
        if (index >= 0) world.splice(index, 1);
      }
      // Timing is the server's end-of-command marker. Its total excludes
      // harness overhead and matches logs/builds.jsonl.
      if (cmdState.doneMs !== undefined) done(cmdState.doneMs);
    };

    ws.on("message", onMessage);
    const state: ClientMsg = { kind: "worldState", mods: world.map((mod) => ({ id: mod.id, values: { ...mod.values } })) };
    ws.send(JSON.stringify(state));
    ws.send(JSON.stringify({ kind: "command", text: command } satisfies ClientMsg));
  });
}

function formatExpectCell(row: CommandSummary): string {
  if (row.expect) {
    return `${row.expected ?? 0}/${row.runs} (${(row.expectPct ?? 0).toFixed(1)}%) ${row.expect}`;
  }
  if (row.command === "ALL" && row.expected !== undefined) {
    return `${row.expected}/${row.runs} (${(row.expectPct ?? 0).toFixed(1)}%)`;
  }
  return "-";
}

export function formatTable(rows: readonly RehearsalRow[]): string {
  const summaries = [...summarize(rows), summarizeAll(rows)];
  const commandWidth = Math.max(...summaries.map((row) => row.command.length), "command".length);
  const expectCells = summaries.map((row) => formatExpectCell(row));
  const expectWidth = Math.max(...expectCells.map((cell) => cell.length), "expect".length);
  const pad = (value: string, width: number): string => value.padEnd(width, " ");
  const lines = [
    `${pad("command", commandWidth)}  ${pad("pass", 12)} ${pad("expect", expectWidth)} ${pad("p50 ms", 8)} ${pad("p90 ms", 8)} ${pad("fixes", 5)} rescued`,
  ];
  for (let i = 0; i < summaries.length; i++) {
    const row = summaries[i];
    const pass = `${row.passed}/${row.runs} (${row.passPct.toFixed(1)}%)`;
    lines.push(`${pad(row.command, commandWidth)}  ${pad(pass, 12)} ${pad(expectCells[i], expectWidth)} ${pad(String(row.p50Ms), 8)} ${pad(String(row.p90Ms), 8)} ${pad(String(row.autoFixRounds), 5)} ${row.rejectedThenFixed}`);
  }
  return lines.join("\n");
}

function printTable(rows: readonly RehearsalRow[]): void {
  console.log(`\n${formatTable(rows)}`);
}

async function main(): Promise<void> {
  loadEnv();
  const options = parseArgs(process.argv.slice(2), integerArg(process.env.PORT ?? "8787", "PORT", 1, 65535));
  const commands = readCommands(options.file, options.only);
  const rows: RehearsalRow[] = [];
  mkdirSync(join(process.cwd(), "logs"), { recursive: true });
  console.log(`Rehearsing ${commands.length} command(s), ${options.runs} run(s), ws://127.0.0.1:${options.port}`);

  for (let run = 1; run <= options.runs; run++) {
    const ws = await connect(options.port);
    const world: WorldMod[] = [{ id: "player", values: {} }, { id: "ground", values: {} }];
    try {
      for (const spec of commands) {
        const row = await runCommand(ws, world, spec, run);
        rows.push(row);
        appendFileSync(join(process.cwd(), LOG_FILE), `${JSON.stringify({ ...row, at: new Date().toISOString() })}\n`);
        const expectNote = row.expect ? `  [expect ${row.expect}: ${row.metExpect ? "pass" : "miss"}${row.awareMiss ? ` - ${row.awareMiss}` : ""}]` : "";
        console.log(`run ${run}/${options.runs}  ${row.outcome.padEnd(8)} ${String(row.totalMs).padStart(7)} ms  ${spec.cmd}${expectNote}`);
      }
    } finally {
      ws.close();
    }
  }

  printTable(rows);
  console.log(`\nRaw rows appended to ${LOG_FILE}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(`rehearse failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
