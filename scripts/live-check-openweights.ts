// Live check for the open-weights reviewer (ADR 0068).
// Runs the 3 commands against the live server:
// 1. "add a bouncing green slime"
// 2. "build a volcano"
// 3. "add a dragon"
// Waits for both the Wonder build and the open-weights review, reporting the results.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { WebSocket } from "ws";
import type { ClientMsg, ServerMsg, BuildReceipt } from "../src/contract";
import { loadEnv } from "../server/meta";

loadEnv();
const PORT = Number(process.env.PORT || 8786);
const WS_URL = `ws://127.0.0.1:${PORT}`;
const LOG_FILE = join(process.cwd(), "logs", "builds.jsonl");

const COMMANDS = [
  "add a bouncing green slime",
  "build a volcano",
  "add a dragon",
];

interface ReviewReport {
  command: string;
  modId: string;
  buildMs: number;
  reviewMs: number;
  verdict: string;
  issues: string[];
  accepted: boolean;
  say?: string;
}

function getLatestReview(modId: string): any {
  if (!existsSync(LOG_FILE)) return null;
  const lines = readFileSync(LOG_FILE, "utf8").trim().split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj.kind === "review" && obj.modId === modId) return obj;
    } catch {}
  }
  return null;
}

async function runLiveCheck(): Promise<void> {
  console.log(`Connecting to ${WS_URL}...`);
  const ws = new WebSocket(WS_URL);

  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", (e) => reject(e));
  });
  console.log("Connected to server.");

  const results: ReviewReport[] = [];

  for (const cmd of COMMANDS) {
    console.log(`\n========================================`);
    console.log(`Sending command: "${cmd}"`);
    console.log(`========================================`);
    const t0 = performance.now();

    let modId = "";
    let buildDone = false;
    let buildMs = 0;
    let reviewerSay = "";

    const messageHandler = (data: unknown) => {
      try {
        const msg = JSON.parse(String(data)) as ServerMsg;
        if (msg.kind === "stage") {
          console.log(`  [stage] ${msg.stage}: ${msg.detail}`);
        } else if (msg.kind === "mod" && !buildDone) {
          modId = msg.mod.id;
          buildDone = true;
          buildMs = Math.round(performance.now() - t0);
          console.log(`  [built] mod ${modId} landed in ${buildMs} ms`);
        } else if (msg.kind === "say") {
          console.log(`  [say] ${msg.text}`);
          if (msg.text.includes("Reviewed by Muse Spark Open")) {
            reviewerSay = msg.text;
          }
        }
      } catch {}
    };

    ws.on("message", messageHandler);
    ws.send(JSON.stringify({ kind: "command", text: cmd } as ClientMsg));

    // 1. Wait for build to land (up to 90s for Wonder)
    const buildDeadline = Date.now() + 90000;
    while (!buildDone && Date.now() < buildDeadline) {
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!buildDone || !modId) {
      console.log(`  Timed out waiting for mod to build for "${cmd}"`);
      ws.off("message", messageHandler);
      continue;
    }

    // 2. Wait for reviewer to run (up to 45s after build lands)
    console.log(`  Waiting for Muse Spark Open review for mod ${modId}...`);
    const reviewDeadline = Date.now() + 45000;
    let revLog: any = null;
    while (Date.now() < reviewDeadline) {
      revLog = getLatestReview(modId);
      if (revLog) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    ws.off("message", messageHandler);

    if (revLog) {
      console.log(`  [review completed] verdict=${revLog.verdict}, ms=${revLog.ms}, accepted=${revLog.accepted}`);
      if (revLog.issues?.length > 0) {
        console.log(`  [issues] ${revLog.issues.join("; ")}`);
      }
      results.push({
        command: cmd,
        modId,
        buildMs,
        reviewMs: revLog.ms,
        verdict: revLog.verdict,
        issues: revLog.issues ?? [],
        accepted: revLog.accepted ?? false,
        say: reviewerSay,
      });
    } else {
      console.log(`  Timed out waiting for review log for mod ${modId}`);
      results.push({
        command: cmd,
        modId,
        buildMs,
        reviewMs: 0,
        verdict: "timeout",
        issues: [],
        accepted: false,
      });
    }
  }

  ws.close();

  console.log("\n========================================");
  console.log("LIVE CHECK SUMMARY (ADR 0068)");
  console.log("========================================");
  console.log("| Command | Mod ID | Review Latency | Verdict | Fix Accepted | Issues / Notes |");
  console.log("|---|---|---|---|---|---|");
  for (const r of results) {
    const issuesText = r.issues.length > 0 ? r.issues.join(", ") : (r.verdict === "ok" ? "Clean mod (no bugs)" : "None");
    console.log(`| ${r.command} | ${r.modId} | ${r.reviewMs} ms | ${r.verdict} | ${r.accepted ? "Yes (hot-swapped)" : "No"} | ${issuesText} |`);
  }
}

runLiveCheck().catch((err) => {
  console.error("Live check failed:", err);
  process.exit(1);
});
