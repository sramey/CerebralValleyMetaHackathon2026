// "How was this made?" (ADR 0065): the receipt for one creation. Every AI build already
// passes through the whole chain — your words, Spark's route, Wonder's code and its own
// test(), the verifier and the playtest bot, Muse Image's prompt and sheet — but only the
// build log kept it, and only as numbers. A receipt keeps that chain per mod, in this
// session's manifest, so a click can show it. Nothing here calls a model.
import type { BuildReceipt, ReceiptArt, ReceiptRoute, ReceiptTool } from "../src/contract";
import { SIM } from "../src/contract";
import { PLAYTEST } from "../src/sim/playtest";

/** The test(t) method of a mod's source, as written, or null when it has none. */
export function extractTest(source: string): string | null {
  // test(t) { … } · test(t: TestApi) { … } · test: (t) => { … } · test: function (t) { … }
  const head = /\btest\s*(?::\s*(?:async\s+)?(?:function\s*)?)?\(\s*[A-Za-z_$][\w$]*(?:\s*:\s*[\w$.]+)?\s*\)\s*(?:=>\s*)?\{/g;
  const m = head.exec(source);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchBrace(source, open);
  if (close < 0) return null;
  return dedent(source.slice(m.index, close + 1));
}

/** Index of the brace that closes the one at `open`, skipping strings, templates and comments. -1 if unbalanced. */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { const nl = src.indexOf("\n", i); if (nl < 0) return -1; i = nl; continue; }
    if (c === "/" && src[i + 1] === "*") { const end = src.indexOf("*/", i + 2); if (end < 0) return -1; i = end + 1; continue; }
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

function dedent(text: string): string {
  const lines = text.split("\n");
  const indents = lines.slice(1).filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length);
  const cut = indents.length > 0 ? Math.min(...indents) : 0;
  // The first line was cut at `test`, so only the body carries the class/object indent.
  const inner = cut > 0 ? Math.max(0, cut - 2) : 0;
  return [lines[0], ...lines.slice(1).map((l) => l.slice(Math.min(inner, /^\s*/.exec(l)![0].length)))].join("\n");
}

/** What a test claims to check: the message of every expect(cond, "message") call, in order. */
export function testChecks(test: string | null): string[] {
  if (!test) return [];
  const out: string[] = [];
  const re = /\bexpect\(\s*[\s\S]*?,\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1\s*\)/g;
  for (let m = re.exec(test); m; m = re.exec(test)) {
    const msg = m[2].replace(/\\(.)/g, "$1").replace(/\$\{[^}]*\}/g, "…").trim();
    if (msg && !out.includes(msg)) out.push(msg.slice(0, 120));
    if (out.length >= 12) break;
  }
  return out;
}

export interface AiReceiptInput {
  modId: string;
  title: string;
  command: string;
  route: ReceiptRoute;
  /** The live source. */
  source: string;
  /** Drafts the verifier or playtest turned away, in order, with why: inside Wonder's own
   *  tool loop (run_playtest said no) or before the fix round. Empty when it landed first try. */
  rejected: { source: string; errors: string[] }[];
  tools: ReceiptTool[];
  turns: number;
  playtests: number;
  msPerFrame: number;
  timings: BuildReceipt["timings"];
  art?: ReceiptArt;
  at?: string;
}

/** The receipt for a build Wonder wrote and the verifier passed. */
export function aiReceipt(i: AiReceiptInput): BuildReceipt {
  const live = i.source;
  const test = extractTest(live);
  const seen = new Set<string>([live.trim()]);
  const turnedAway = i.rejected.filter((d) => !seen.has(d.source.trim()) && seen.add(d.source.trim())).slice(-4);
  const versions = [...turnedAway.map((d) => ({ source: d.source, rejected: d.errors.slice(0, 4).map((e) => e.slice(0, 700)) })), { source: live }];
  return {
    modId: i.modId,
    title: i.title,
    origin: "ai",
    command: i.command,
    route: i.route,
    agent: { turns: i.turns, tools: i.tools.slice(0, 12) },
    versions,
    test: test ? { source: test, checks: testChecks(test) } : null,
    proof: proof(i.msPerFrame, i.playtests, versions.length > 1),
    ...(i.art ? { art: i.art } : {}),
    timings: i.timings,
    at: i.at ?? new Date().toISOString(),
  };
}

/** A mod with no build record here: a hand-written built-in, or one that arrived with a shared world. */
export function plainReceipt(modId: string, title: string, source: string, origin: "builtin" | "loaded"): BuildReceipt {
  const test = extractTest(source);
  return {
    modId,
    title,
    origin,
    versions: [{ source }],
    test: test ? { source: test, checks: testChecks(test) } : null,
    proof: proof(0, 0, false),
  };
}

function proof(msPerFrame: number, playtests: number, fixed: boolean): BuildReceipt["proof"] {
  return { healthFrames: SIM.healthFrames, msBudget: SIM.msBudget, msPerFrame, playtestSeeds: PLAYTEST.seeds.length, playtests, fixed };
}
