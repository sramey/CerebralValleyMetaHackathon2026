// npm run testers: turn the local family-test session log into docs/evidence/user-test.md.
//
//   npx tsx scripts/testers.ts            # read logs/testers.jsonl, print a table, write the evidence page
//   npx tsx scripts/testers.ts --dry-run  # print only, leave the page alone
//
// The log (gitignored) has anonymous tester numbers and timestamps only. The printed table has one row per tester
// number and stays on this machine; the committed page holds aggregates only. Missing log -> friendly message, exit 0.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { aggregateTesters, parseTesters, renderTesterConsole, renderTesterMarkdown, summarize, TESTER_LOG } from "../server/testers";

const OUT_FILE = join(process.cwd(), "docs", "evidence", "user-test.md");
const dryRun = process.argv.includes("--dry-run");

if (!existsSync(TESTER_LOG)) {
  console.log("no tester sessions logged yet (logs/testers.jsonl not found). Open the game with ?tester=1 and build something.");
  process.exit(0);
}
const { rows, malformed } = parseTesters(readFileSync(TESTER_LOG, "utf8"));
if (rows.length === 0) {
  console.log("no tester events in logs/testers.jsonl, nothing to summarise");
  process.exit(0);
}
const sums = summarize(rows);
console.log(renderTesterConsole(sums));
const agg = aggregateTesters(sums);
if (dryRun) {
  console.log("\n(dry run: docs/evidence/user-test.md not touched)");
} else {
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, renderTesterMarkdown(agg, malformed));
  console.log(`\nwrote docs/evidence/user-test.md (${agg.testers} tester(s), aggregates only)`);
}
