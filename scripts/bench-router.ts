// p50/p95 of the command router on hosted Muse Spark vs Muse Spark Open on Baseten (ADR 0032).
// Usage: npm run bench:router -- [--runs 5]   (needs MODEL_API_KEY and BASETEN_API_KEY in .env)
// Writes nothing; prints a markdown table to paste into the README/ADR.
import { chat, loadEnv, SPARK } from "../server/meta";
import { openChat, openConfig } from "../server/router-model";
import { ROUTER_SYSTEM, buildRouterPrompt } from "../server/prompt";

const COMMANDS = [
  "add a player", "make it rain", "add a bouncing ball", "make the player bigger", "undo that",
  "make it spooky", "add three coins and a fire", "what can I do here?", "give me a double jump", "make the gravity lower",
];

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function measure(label: string, call: (cmd: string) => Promise<string>, runs: number): Promise<string> {
  const ms: number[] = [];
  let bad = 0;
  for (let r = 0; r < runs; r++) {
    for (const cmd of COMMANDS) {
      const t0 = performance.now();
      try {
        const text = await call(cmd);
        if (!/"action"\s*:/.test(text)) bad++;
        ms.push(Math.round(performance.now() - t0));
      } catch { bad++; }
    }
  }
  ms.sort((a, b) => a - b);
  return `| ${label} | ${ms.length} | ${percentile(ms, 50)} ms | ${percentile(ms, 95)} ms | ${bad} |`;
}

async function main(): Promise<void> {
  loadEnv();
  const i = process.argv.indexOf("--runs");
  const runs = i > 0 ? Math.max(1, Number(process.argv[i + 1]) || 3) : 3;
  const cfg = openConfig();
  if (!cfg) { console.error("BASETEN_API_KEY is not set; nothing to compare. Add it to .env and rerun."); process.exit(1); }
  const msgs = (cmd: string) => [
    { role: "system" as const, content: ROUTER_SYSTEM },
    { role: "user" as const, content: buildRouterPrompt(cmd, "(no mods yet)", "") },
  ];
  // Generous timeout so slow answers are measured, not cut off.
  const open = { ...cfg, timeoutMs: 30000 };
  console.log(`Router bench: ${COMMANDS.length} commands x ${runs} runs each\n`);
  console.log("| model | ok | p50 | p95 | bad replies/errors |\n|---|---|---|---|---|");
  console.log(await measure(SPARK + " (hosted)", async (c) => (await chat(SPARK, msgs(c), 1024)).text, runs));
  console.log(await measure(cfg.model + " (Baseten)", async (c) => (await openChat(open, msgs(c), 1024)).text, runs));
}

if (/bench-router[.]ts$/.test(process.argv[1] ?? "")) main().catch((e) => { console.error(e); process.exit(1); });
