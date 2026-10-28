// Review the permanent creation log (logs/builds.jsonl).
// Usage: npx tsx scripts/review-log.ts [n]  (n = last n builds, default 10)
// Prints a compact table + overall stats. Missing log -> friendly message.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const LOG_FILE = join(process.cwd(), "logs", "builds.jsonl");

interface BuildLine {
  kind?: string;
  ts?: string;
  command?: string;
  route?: string;
  outcome?: string;
  modId?: string;
  timings?: { total?: number };
  verify?: { errors?: string[] };
}

const n = Math.max(1, parseInt(process.argv[2] ?? "10", 10) || 10);

if (!existsSync(LOG_FILE)) {
  console.log("no builds logged yet (logs/builds.jsonl not found)");
  process.exit(0);
}

const builds: BuildLine[] = [];
let artCount = 0;
for (const raw of readFileSync(LOG_FILE, "utf8").split("\n")) {
  const line = raw.trim();
  if (!line) continue;
  try {
    const obj = JSON.parse(line) as BuildLine;
    if (obj.kind === "art") {
      artCount++;
      continue;
    }
    builds.push(obj);
  } catch {
    /* skip malformed lines */
  }
}

if (builds.length === 0) {
  console.log("no builds logged yet");
  process.exit(0);
}

const trunc = (s: string, w: number) => (s.length > w ? s.slice(0, w - 1) + "…" : s);
const pad = (s: string, w: number) => s.padEnd(w).slice(0, w);

const last = builds.slice(-n);
console.log(pad("time", 16) + " " + pad("command", 42) + " " + pad("outcome", 7) + " " + pad("modId", 18) + " " + pad("total", 9) + " verr");
for (const b of last) {
  const time = typeof b.ts === "string" ? b.ts.slice(0, 16).replace("T", " ") : "-";
  const total = typeof b.timings?.total === "number" ? `${b.timings.total}ms` : "-";
  const verr = String(b.verify?.errors?.length ?? 0);
  console.log(
    pad(time, 16) + " " + pad(trunc(String(b.command ?? "-"), 42), 42) + " " +
    pad(String(b.outcome ?? "-"), 7) + " " + pad(String(b.modId ?? "-"), 18) + " " +
    pad(total, 9) + " " + verr,
  );
}

// Overall stats.
const ok = builds.filter((b) => b.outcome === "mod" || b.outcome === "tweak" || b.outcome === "edit").length;
const totals = builds
  .map((b) => b.timings?.total)
  .filter((t): t is number => typeof t === "number")
  .sort((a, b) => a - b);
const median = totals.length === 0 ? "-" : String(totals[Math.floor(totals.length / 2)]) + "ms";
const failed = builds.filter((b) => b.outcome === "failed");

console.log("");
console.log(`total builds: ${builds.length}`);
console.log(`success rate: ${((ok / builds.length) * 100).toFixed(1)}% (mod/tweak/edit over all builds)`);
console.log(`median total ms: ${median}`);
console.log(`art generations logged: ${artCount}`);
if (failed.length === 0) {
  console.log("failures: none");
} else {
  console.log(`failures: ${failed.length}`);
  for (const f of failed) {
    const first = f.verify?.errors?.[0] ?? "(no error recorded)";
    console.log(`  - ${String(f.command ?? "-")} :: ${trunc(first, 120)}`);
  }
}
