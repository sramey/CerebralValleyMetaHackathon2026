// Headless spike harness: sends the 10 docs/SPIKE.md test commands to the
// live server over ONE websocket, one at a time, and reports pass/fail.
// Usage: npx tsx scripts/spike-run.ts [wsUrl]  (default ws://127.0.0.1:8787)
// Prints no API keys. Exit 0 always; the PASS line carries the verdict.
import { WebSocket } from "ws";
import type { ClientMsg, ServerMsg } from "../src/contract";

const COMMANDS = [
  "add a player",
  "add some ground",
  "make the player jump higher",
  "add a pit",
  "add enemies that walk back and forth",
  "make enemies die when I stomp them",
  "make it rain",
  "add a parallax background",
  "when I shoot, shoot a fire arrow",
  "add a moving platform",
];

const TIMEOUT_MS = 60_000;

type Outcome = "mod" | "tweak" | "failed" | "say";

interface CmdResult {
  command: string;
  outcome: Outcome;
  ms: number;
  modId: string;
}

function runCommand(ws: WebSocket, command: string): Promise<CmdResult> {
  return new Promise((resolve) => {
    let sawMod = false;
    let sawTweak = false;
    let sawFailed = false;
    let modId = "";
    const done = (outcome: Outcome, ms: number): void => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve({ command, outcome, ms, modId });
    };
    const timer = setTimeout(() => done(sawMod ? "mod" : sawTweak ? "tweak" : "failed", TIMEOUT_MS), TIMEOUT_MS);
    const onMessage = (data: unknown): void => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(data)) as ServerMsg;
      } catch {
        return;
      }
      if (msg.kind === "mod") {
        sawMod = true;
        modId = msg.mod.id;
      } else if (msg.kind === "tweak") {
        sawTweak = true;
        modId = msg.modId;
      } else if (msg.kind === "removed") {
        modId = msg.modId;
      } else if (msg.kind === "stage" && msg.stage === "failed") {
        sawFailed = true;
      } else if (msg.kind === "timing" && msg.command === command) {
        // timing is always the last message of a command: end-of-command marker.
        if (sawMod) done("mod", msg.ms.total);
        else if (sawTweak) done("tweak", msg.ms.total);
        else if (sawFailed) done("failed", msg.ms.total);
        else done("say", msg.ms.total);
      }
    };
    ws.on("message", onMessage);
    const out: ClientMsg = { kind: "command", text: command };
    ws.send(JSON.stringify(out));
  });
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function main(): Promise<void> {
  const url = process.argv[2] ?? "ws://127.0.0.1:8787";
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", (err) => reject(err));
  });
  const results: CmdResult[] = [];
  for (const command of COMMANDS) {
    results.push(await runCommand(ws, command));
  }
  ws.close();

  const cmdWidth = Math.max(...COMMANDS.map((c) => c.length), "command".length);
  const pad = (s: string, n: number): string => s.padEnd(n, " ");
  console.log(`${pad("#", 3)} ${pad("command", cmdWidth)} ${pad("outcome", 7)} ${pad("ms", 8)} modId`);
  results.forEach((r, i) => {
    console.log(`${pad(String(i + 1), 3)} ${pad(r.command, cmdWidth)} ${pad(r.outcome, 7)} ${pad(String(r.ms), 8)} ${r.modId || "-"}`);
  });
  const pass = results.filter((r) => r.outcome === "mod" || r.outcome === "tweak").length;
  const totals = results.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`PASS ${pass}/${results.length} (mod|tweak = pass)`);
  console.log(`median total ${percentile(totals, 50)} ms, p95 total ${percentile(totals, 95)} ms`);
}

main().catch((err) => {
  console.error(`spike-run failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
