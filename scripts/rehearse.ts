// Repeat the demo script against a live server, one fresh starter world per run.
// Usage: npm run rehearse -- [--runs N] [--only "make me huge"] [--port 8796]
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

export interface RehearsalSpec {
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

export function metExpectation(row: Pick<RehearsalRow, "outcome" | "rejectedThenFixed">, expect: Expectation = "landed"): boolean {
  if (expect === "rejected-then-fixed") return row.outcome === "landed" && row.rejectedThenFixed;
  if (expect === "rejected") return row.outcome === "rejected";
  return row.outcome === "landed";
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
}

function integerArg(value: string | undefined, flag: string, min: number, max: number): number {
  const n = Number(value);
  if (!value || !Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${flag} needs an integer from ${min} to ${max}`);
  }
  return n;
}

function parseArgs(argv: readonly string[], defaultPort: number): Options {
  const options: Options = { runs: 1, port: defaultPort };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--runs") options.runs = integerArg(argv[++i], flag, 1, 1000);
    else if (flag === "--port") options.port = integerArg(argv[++i], flag, 1, 65535);
    else if (flag === "--only") {
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
        if (obj.expect === undefined) return { cmd: obj.cmd };
        if (typeof obj.expect === "string" && EXPECTATIONS.includes(obj.expect as Expectation)) {
          return { cmd: obj.cmd, expect: obj.expect as Expectation };
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

function readCommands(only?: string): RehearsalSpec[] {
  const parsed: unknown = JSON.parse(readFileSync(new URL("./rehearse.json", import.meta.url), "utf8"));
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
    let landed = false;
    let rejected = false;
    let autoFixRounds = 0;

    const done = (totalMs: number): void => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      const outcome: Outcome = landed ? "landed" : rejected ? "rejected" : "failed";
      const rejectedThenFixed = rejected && landed;
      const base: RehearsalRow = {
        run,
        command,
        outcome,
        totalMs,
        autoFixRounds,
        rejectedThenFixed,
        ...(spec.expect ? { expect: spec.expect, metExpect: metExpectation({ outcome, rejectedThenFixed }, spec.expect) } : {}),
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
      if (msg.kind === "mod") {
        landed = true;
        const values = Object.fromEntries(Object.entries(msg.mod.knobs).map(([knob, def]) => [knob, def.value]));
        const index = world.findIndex((mod) => mod.id === msg.mod.id);
        if (index < 0) world.push({ id: msg.mod.id, values });
        else world[index] = { id: msg.mod.id, values };
      } else if (msg.kind === "tweak") {
        landed = true;
        const mod = world.find((candidate) => candidate.id === msg.modId);
        if (mod) mod.values[msg.knob] = msg.value;
      } else if (msg.kind === "removed") {
        landed = true;
        const index = world.findIndex((mod) => mod.id === msg.modId);
        if (index >= 0) world.splice(index, 1);
      } else if (msg.kind === "stage" && msg.command === command) {
        if (msg.stage === "rejected") rejected = true;
        else if (msg.stage === "fixing") autoFixRounds++;
      } else if (msg.kind === "timing" && msg.command === command) {
        // Timing is the server's end-of-command marker. Its total excludes
        // harness overhead and matches logs/builds.jsonl.
        done(msg.ms.total);
      }
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
  const commands = readCommands(options.only);
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
        const expectNote = row.expect ? `  [expect ${row.expect}: ${row.metExpect ? "pass" : "miss"}]` : "";
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
