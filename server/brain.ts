// "What it has learned" feed (ADR 0069): the open-weights reviewer's scorecard, its fixes,
// and the rules and skills learned over time, for the in-game area.
//
// `GET /api/brain` reads logs/builds.jsonl review rows (ADR 0068), server/learned/rules.json
// and skills/*.md (ADR 0020) and answers with an allow-listed BrainFeed. The player's own
// sentences never leave: rows carry the mod id, the reviewer's issue sentence, the rule it
// taught and the changed lines of mod code. No paths, no keys, no prompts.
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { BrainFeed, BrainFix, BrainRule, BrainSkill } from "../src/contract";
import { loadRules, loadSkills } from "./learn";
import { openConfig } from "./router-model";
import { parseLog } from "./stats";
import type { LogRow } from "./stats";

export const BRAIN_PATH = "/api/brain";

/** Router benchmark from ADR 0032 (`npm run bench:router`, 30 runs each over ten fixed commands). */
export const ROUTER_BENCH = { hostedP50: 1151, openP50: 918, hostedP95: 3487, openP95: 2547, runs: 30 };

const MAX_FIXES = 12;
const str = (v: unknown, n: number): string => (typeof v === "string" ? v.slice(0, n) : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strs = (v: unknown, count: number, n: number): string[] =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string").slice(0, count).map((x) => x.slice(0, n));

function toFix(r: LogRow): BrainFix {
  const diff = Array.isArray(r.diff) ? (r.diff as { at?: unknown; del?: unknown; add?: unknown }[]) : [];
  return {
    ts: str(r.ts, 40),
    modId: str(r.modId, 64),
    issues: strs(r.issues, 4, 240),
    accepted: r.accepted === true,
    ms: num(r.ms) ?? 0,
    diff: diff.slice(0, 5).map((h) => ({ at: num(h?.at) ?? 0, del: strs(h?.del, 8, 120), add: strs(h?.add, 8, 120) })),
    rules: strs(r.rules, 4, 200),
  };
}

function median(v: number[]): number | null {
  if (v.length === 0) return null;
  const s = [...v].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return Math.round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}

export interface OpenState { on: boolean; model: string | null; reviewerOff: boolean }

/** Pure: log rows + learned rules and skills in, feed out. */
export function brainFeed(rows: LogRow[], rules: BrainRule[], skills: BrainSkill[], open: OpenState): BrainFeed {
  const reviews = rows.filter((r) => r.kind === "review");
  const fixesRaw = reviews.filter((r) => r.verdict === "fix");
  const accepted = fixesRaw.filter((r) => r.accepted === true).length;
  const ms = reviews.map((r) => num(r.ms)).filter((v): v is number => v !== null);
  const builds = rows.filter((r) => !r.kind);
  const routes = builds
    .filter((r) => r.route !== "mood")
    .map((r) => num((r.timings as { route?: unknown } | undefined)?.route))
    .filter((v): v is number => v !== null && v > 0);
  const attempts = builds.filter((r) => r.fixAttempted === true);
  const saves = attempts.filter((r) => r.outcome === "mod" || r.outcome === "edit").length;
  const bySource: Record<string, number> = {};
  const bySub: Record<string, number> = {};
  for (const r of rules) {
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    bySub[r.subsystem] = (bySub[r.subsystem] ?? 0) + 1;
  }
  const note = open.on
    ? `Open weights on: ${open.model} reviews every build after it lands.`
    : open.reviewerOff
      ? "Open weights off (reviewer switched off): showing hosted-only history."
      : "Open weights off (no key set): showing hosted-only history.";
  const last = reviews.length ? str(reviews[reviews.length - 1].ts, 40) : "";
  const lastRule = rules.reduce((m, r) => (r.createdAt > m ? r.createdAt : m), "");
  return {
    openWeights: { on: open.on, model: open.on ? open.model : null, note },
    scorecard: {
      reviews: reviews.length,
      clean: reviews.filter((r) => r.verdict === "ok").length,
      fixesFound: fixesRaw.length,
      accepted,
      rejected: fixesRaw.length - accepted,
      avgMs: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null,
      hostedRouteMs: median(routes),
      bench: ROUTER_BENCH,
      autoFixAttempts: attempts.length,
      autoFixSaves: saves,
    },
    fixes: fixesRaw.slice(-MAX_FIXES).reverse().map(toFix),
    rules: [...rules].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    skills,
    counts: { source: bySource, subsystem: bySub },
    version: `${reviews.length}.${rules.length}.${skills.length}.${last}.${lastRule}`,
  };
}

export function readBrainFeed(logFile: string): BrainFeed {
  let rows: LogRow[] = [];
  try {
    if (existsSync(logFile)) rows = parseLog(readFileSync(logFile, "utf8")).rows;
  } catch { /* an unreadable log is an empty history */ }
  let rules: BrainRule[] = [];
  let skills: BrainSkill[] = [];
  try {
    rules = loadRules().map((r) => ({ id: r.id, subsystem: r.subsystem, source: r.source, rule: r.rule.slice(0, 240), ...(r.modId ? { modId: r.modId } : {}), createdAt: r.createdAt }));
    skills = loadSkills().map((s) => ({ slug: s.slug, title: s.title.slice(0, 80), keywords: s.keywords.slice(0, 8), summary: s.summary.slice(0, 260), ...(s.modId ? { modId: s.modId } : {}), ...(s.createdAt ? { learnedAt: s.createdAt } : {}) }));
  } catch { /* no learned dir yet */ }
  const cfg = openConfig();
  const reviewerOff = process.env.REVIEWER === "off";
  return brainFeed(rows, rules, skills, { on: Boolean(cfg) && !reviewerOff, model: cfg?.model ?? null, reviewerOff });
}

/** Handle `GET /api/brain`; returns true when answered. */
export function createBrainHandler(opts: { logFile: () => string }) {
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const path = (req.url ?? "/").split("?")[0];
    if (path !== BRAIN_PATH) return false;
    const headers: Record<string, string> = {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    };
    if (req.method !== "GET") {
      res.writeHead(405, { ...headers, allow: "GET" }).end();
      return true;
    }
    res.writeHead(200, headers).end(JSON.stringify(readBrainFeed(opts.logFile())));
    return true;
  };
}
