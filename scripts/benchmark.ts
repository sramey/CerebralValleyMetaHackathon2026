// Day-1 latency benchmarks: Spark router (short JSON) + Wonder mod (~80 lines).
// Image / SAM / transcribe rows are marked skipped for spike v0.
import { chat, hasApiKey, SPARK, WONDER } from "../server/meta";
import { buildRouterPrompt, buildWonderPrompt } from "../server/prompt";

interface Row { call: string; p50: string; p95: string; notes: string }

async function timeOnce(model: string, content: string, maxTokens: number): Promise<number> {
  const { ms } = await chat(model, [{ role: "user", content }], maxTokens);
  return ms;
}

async function measure(model: string, content: string, maxTokens: number, runs = 3): Promise<{ p50: number; p95: number }> {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) samples.push(await timeOnce(model, content, maxTokens));
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(samples.length / 2)];
  const p95 = samples[samples.length - 1];
  return { p50, p95 };
}

async function main(): Promise<void> {
  const rows: Row[] = [];
  if (!hasApiKey()) {
    console.log("MODEL_API_KEY is not set — cannot measure live latency.");
  } else {
    const routerPrompt = buildRouterPrompt("add enemies that walk back and forth", "(world is empty — no mods loaded)");
    const r = await measure(SPARK, routerPrompt, 256);
    rows.push({ call: "Spark router (short JSON)", p50: `${r.p50} ms`, p95: `${r.p95} ms`, notes: SPARK });
    const wonderPrompt = buildWonderPrompt(
      "add enemies that walk back and forth",
      "(world is empty — no mods loaded)",
    );
    const w = await measure(WONDER, wonderPrompt, 2048);
    rows.push({ call: "Wonder mod (~80 lines)", p50: `${w.p50} ms`, p95: `${w.p95} ms`, notes: WONDER });
  }
  rows.push({ call: "Muse Image sprite sheet", p50: "skipped", p95: "skipped", notes: "not in spike v0" });
  rows.push({ call: "SAM 3.1 single image", p50: "skipped", p95: "skipped", notes: "not in spike v0" });
  rows.push({ call: "Transcribe: speech → partial", p50: "skipped", p95: "skipped", notes: "not in spike v0" });

  console.log("| Call | p50 | p95 | Notes |");
  console.log("|---|---|---|---|");
  for (const row of rows) console.log(`| ${row.call} | ${row.p50} | ${row.p95} | ${row.notes} |`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
