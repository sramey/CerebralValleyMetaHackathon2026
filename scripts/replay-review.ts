// Replay past mods through the open-weights reviewer and count fixes and gate passes (bead 4t7).
// Usage: npx tsx scripts/replay-review.ts --which before|after [--n 30] [--logs ../metabuild/logs]
// Reads sources from the shared checkout's logs (read-only), calls Muse Spark Open with the
// chosen system prompt, runs any patch through the same compile + verify + playtest gates as
// server/reviewer.ts, and prints a table. Writes output/replay-review-<which>.json (gitignored).
// Needs BASETEN_API_KEY in .env; the key is never printed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { compileMod } from "../server/compile";
import { forceModId } from "../server/modid";
import { playtestMod } from "../server/playtest";
import { openChat, openConfig } from "../server/router-model";
import { REVIEWER_SYSTEM, buildReviewerPrompt, parseReviewJson } from "../server/reviewer";
import { verifyMod } from "../server/verify";

/** The reviewer prompt before bead 4t7, kept here as the "before" baseline. */
const BASELINE_SYSTEM = `You are an automated code reviewer for a 2D pixel-art platformer engine.
Review mods written in pure TypeScript against the mod API.
Look for real bugs and clear improvements:
- Crashes, runtime exceptions, NaN coordinates or velocities
- Entities that never despawn or spawn endlessly (memory leaks / entity cap exhaustion)
- Broken or incomplete dispose() (undo leaving orphaned entities or uncleaned state)
- visual: "shape" erroneously used on nameable creatures/items/characters that should be sprites, or vice versa
- Items or weapons that cannot be used (missing "use" key or pointer input handlers)
- Off-screen spawns (y > 400 or x outside the screen)
- Solid collision issues (trapping the player, missing solid: true on platforms)

Output STRICT JSON ONLY. No markdown fences, no explanatory text outside JSON:
If the mod is clean and has no real bugs or clear improvements:
{"verdict":"ok","issues":[]}

If the mod has real bugs or clear improvements:
{"verdict":"fix","issues":["concise 1-sentence description of the issue fixed"],"patchedSource":"<full valid TypeScript code of the patched mod>"}
`;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

interface Row { command: string; outcome: string; modId?: string; sourceFile?: string }

async function main(): Promise<void> {
  const which = arg("which", "after");
  const n = Number(arg("n", "30"));
  const logs = resolve(arg("logs", "../metabuild/logs"));
  const cfg = openConfig();
  if (!cfg) { console.error("BASETEN_API_KEY is not set"); process.exit(1); }
  const system = which === "before" ? BASELINE_SYSTEM : REVIEWER_SYSTEM;

  const rows: Row[] = readFileSync(join(logs, "builds.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l) as Row; } catch { return {} as Row; } });
  const seen = new Set<string>();
  const picks: { modId: string; command: string; source: string }[] = [];
  for (const r of rows.reverse()) {
    if (r.outcome !== "mod" || !r.sourceFile || !r.modId || seen.has(r.modId)) continue;
    const file = join(logs, "mods", basename(r.sourceFile.replace(/\\/g, "/")));
    if (!existsSync(file)) continue;
    seen.add(r.modId);
    picks.push({ modId: r.modId, command: r.command, source: readFileSync(file, "utf8") });
    if (picks.length >= n) break;
  }

  const results: Record<string, unknown>[] = [];
  let fixes = 0;
  let passed = 0;
  let errors = 0;
  for (const p of picks) {
    let verdict = "error";
    let issue = "";
    let gate = "";
    try {
      const res = await openChat({ ...cfg, timeoutMs: 40000 }, [{ role: "system", content: system }, { role: "user", content: buildReviewerPrompt(p.command, p.source, { ok: true }) }], 5000);
      const parsed = parseReviewJson(res.text);
      if (!parsed) { errors++; verdict = "badjson"; }
      else if (parsed.verdict === "ok" || !parsed.patchedSource || parsed.patchedSource.trim() === p.source.trim()) verdict = "ok";
      else {
        verdict = "fix";
        fixes++;
        issue = parsed.issues[0] ?? "";
        const clean = forceModId(parsed.patchedSource, p.modId);
        const c = compileMod(clean);
        if (!c.ok) gate = "compile-fail";
        else {
          const v = await verifyMod(clean, c.js);
          if (!v.ok || !v.def) gate = "verify-fail";
          else {
            const pt = await playtestMod([], { def: v.def, replaces: p.modId });
            gate = pt.ok ? "PASS" : "playtest-fail";
          }
        }
        if (gate === "PASS") passed++;
      }
    } catch (err) {
      errors++;
      verdict = "error";
      issue = err instanceof Error ? err.message.slice(0, 80) : "error";
    }
    console.log(`${p.modId.padEnd(28)} ${verdict.padEnd(8)} ${gate.padEnd(13)} ${issue.slice(0, 90)}`);
    results.push({ modId: p.modId, verdict, gate, issue });
  }
  console.log(`\n[${which}] mods ${picks.length} · fixes ${fixes} · gate-passed ${passed} · errors ${errors}`);
  mkdirSync("output", { recursive: true });
  writeFileSync(join("output", `replay-review-${which}.json`), JSON.stringify({ which, mods: picks.length, fixes, passed, errors, results }, null, 2));
}

void main();
