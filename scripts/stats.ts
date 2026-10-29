// npm run stats — turn the local creation log into the impact evidence page.
//
//   npx tsx scripts/stats.ts            # read logs/builds.jsonl, print, write docs/evidence/build-stats.md
//   npx tsx scripts/stats.ts --dry-run  # print only, leave the page alone
//
// The log is gitignored (it holds every player command); the page is committed
// and contains aggregate numbers only. Missing log -> friendly message, exit 0.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { aggregate, parseLog, renderConsole, renderMarkdown } from "../server/stats";

const LOG_FILE = join(process.cwd(), "logs", "builds.jsonl");
const OUT_FILE = join(process.cwd(), "docs", "evidence", "build-stats.md");
const dryRun = process.argv.includes("--dry-run");

if (!existsSync(LOG_FILE)) {
  console.log("no builds logged yet (logs/builds.jsonl not found) — nothing to summarise");
  process.exit(0);
}

const { rows, malformed } = parseLog(readFileSync(LOG_FILE, "utf8"));
if (rows.length === 0) {
  console.log(`no log lines in ${LOG_FILE} — nothing to summarise`);
  process.exit(0);
}

const stats = aggregate(rows, malformed);
console.log(renderConsole(stats));

if (dryRun) {
  console.log("\n(dry run: docs/evidence/build-stats.md not touched)");
} else {
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, renderMarkdown(stats));
  console.log(`\nwrote docs/evidence/build-stats.md (${stats.lines} log lines aggregated)`);
}
