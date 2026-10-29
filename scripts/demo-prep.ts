// Recording-day prep (bead 1os). Run `npm run demo:prep` before a take; it fixes what it safely can and says what you must do.
//   1. spend budgets: which env lines to raise (names and suggested numbers only, never current values or keys)
//   2. server/learned/ back to its committed state, and a warning on any player-size-cap rule
//   3. stray public/art/gen files moved into output/
//   4. spooky mood art pre-warmed (<= 6 images) so the sprite redraw on camera is instant
//   5. preflight: one cheap Meta call, ports free, a mic hint
// Flags: --skip-art (no image calls), --dry (report only, change nothing).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chat, loadEnv, SPARK } from "../server/meta";
import { readLimits } from "../server/budget";
import type { Kind, Limits } from "../server/budget";
import { PRESETS, restyleSheet, sheetPath } from "../server/mood";

/** What a recording session needs per visitor (IP) and globally; builds cover ~20 rehearsal commands plus takes. */
export const RECORDING_SESSION: Limits = { build: 60, image: 60, sam: 20, voice: 30 * 60 };
export const RECORDING_GLOBAL: Limits = { build: 400, image: 300, sam: 100, voice: 120 * 60 };
const SESSION_VAR: Record<Kind, string> = { build: "BUDGET_SESSION_BUILDS", image: "BUDGET_SESSION_IMAGES", sam: "BUDGET_SESSION_SAM", voice: "BUDGET_SESSION_VOICE_MIN" };
const GLOBAL_VAR: Record<Kind, string> = { build: "BUDGET_GLOBAL_BUILDS", image: "BUDGET_GLOBAL_IMAGES", sam: "BUDGET_GLOBAL_SAM", voice: "BUDGET_GLOBAL_VOICE_MIN" };
const KINDS: Kind[] = ["build", "image", "sam", "voice"];

/** Sheets worth pre-warming for the demo, in priority order. */
export const PREWARM_KEYS = ["ninja", "dragon", "slime", "chicken", "bird", "cat"];
export const MAX_PREWARM = 6;

const env = (k: Kind, scope: "session" | "global", v: number): string =>
  `${(scope === "session" ? SESSION_VAR : GLOBAL_VAR)[k]}=${k === "voice" ? v / 60 : v}`;

/** Pure: env lines to raise (suggested values only) given the effective limits. Never reads or returns current values. */
export function budgetAdvice(limits: { session: Limits; global: Limits }): string[] {
  const lines: string[] = [];
  for (const k of KINDS) {
    if (limits.session[k] < RECORDING_SESSION[k]) lines.push(env(k, "session", RECORDING_SESSION[k]));
    if (limits.global[k] < RECORDING_GLOBAL[k]) lines.push(env(k, "global", RECORDING_GLOBAL[k]));
  }
  return lines;
}

/** Pure: kinds whose counters for any local visitor today have already reached the effective per-visitor limit. */
export function exhaustedToday(file: string, limits: Limits, today = new Date().toISOString().slice(0, 10)): Kind[] {
  try {
    const p = JSON.parse(readFileSync(file, "utf8")) as { day?: string; sessions?: Record<string, Limits> };
    if (p.day !== today || !p.sessions) return [];
    const out = new Set<Kind>();
    for (const [ip, used] of Object.entries(p.sessions)) {
      if (!/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(ip)) continue;
      for (const k of KINDS) if ((used[k] ?? 0) >= limits[k]) out.add(k);
    }
    return [...out];
  } catch {
    return [];
  }
}

/** Pure: learned rules that cap or clamp the player's size, which silently change "make me huge" (ADR 0023). */
export function sizeCapRules(rules: { id: string; rule: string }[]): string[] {
  return rules.filter((r) => /setPlayerSize/.test(r.rule) || /\b(player|me|hero|character)\b.*\b(size|scale|huge|giant|big)/i.test(r.rule) || /\b(cap|clamp|limit|max(imum)?)\b.*\b(size|scale|height|width)\b/i.test(r.rule)).map((r) => r.id);
}

const git = (...args: string[]): string => execFileSync("git", args, { encoding: "utf8" }).trim();
const ok = (m: string): void => console.log(`  ok    ${m}`);
const warn = (m: string): void => console.log(`  WARN  ${m}`);
const fail = (m: string): void => { console.log(`  FAIL  ${m}`); process.exitCode = 1; };

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const skipArt = process.argv.includes("--skip-art");
  loadEnv();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const stash = join("output", `demo-prep-${stamp}`);

  console.log("1. Budgets");
  const limits = readLimits(process.env);
  const advice = budgetAdvice(limits);
  if (advice.length === 0) ok("limits cover a recording session");
  else {
    warn("raise these in .env (suggested values), then restart the server:");
    for (const l of advice) console.log(`          ${l}`);
  }
  const dataDir = join(process.cwd(), process.env.DATA_DIR ?? "data");
  const spent = exhaustedToday(join(dataDir, "budget.json"), limits.session);
  if (spent.length > 0) warn(`today's local counters already hit the per-visitor limit for: ${spent.join(", ")}. Raise the limit (above) or delete ${join(process.env.DATA_DIR ?? "data", "budget.json")} while the server is stopped.`);
  else ok("no local counter exhausted today");
  if (/^(1|true|yes|on)$/i.test(process.env.AI_KILL_SWITCH ?? "")) fail("AI_KILL_SWITCH is on: every AI call will be refused");
  if (process.env.DEMO_FREEZE_LEARNING === "1") ok("DEMO_FREEZE_LEARNING=1 is set: the learner writes nothing");
  else warn("DEMO_FREEZE_LEARNING=1 is not set; set it in .env before recording so rehearsals and takes write no rules");

  console.log("2. Learned rules");
  const dirty = git("status", "--porcelain", "--", "server/learned").split(/\r?\n/).filter(Boolean);
  if (dirty.length === 0) ok("server/learned/ matches the committed state");
  else if (dry) warn(`${dirty.length} change(s) in server/learned/ (dry run, not reset)`);
  else {
    const untracked = dirty.filter((l) => l.startsWith("??")).map((l) => l.slice(3).replace(/^"|"$/g, ""));
    for (const f of untracked) { mkdirSync(join(stash, "learned"), { recursive: true }); renameSync(f, join(stash, "learned", f.split("/").pop()!)); }
    git("checkout", "--", "server/learned");
    ok(`reset ${dirty.length} change(s) in server/learned/${untracked.length ? ` (new files moved to ${stash}/learned)` : ""}`);
  }
  try {
    const rules = JSON.parse(readFileSync("server/learned/rules.json", "utf8")) as { id: string; rule: string }[];
    const caps = sizeCapRules(rules);
    if (caps.length > 0) warn(`size-cap style rule(s) in rules.json: ${caps.join(", ")}. They change how "make me huge" behaves; check them against beat 5 of docs/DEMO.md.`);
    else ok(`${rules.length} committed rules, none cap the player's size`);
  } catch {
    warn("could not read server/learned/rules.json");
  }

  console.log("3. Stray art");
  const stray = git("ls-files", "--others", "--exclude-standard", "--", "public/art/gen").split(/\r?\n/).filter(Boolean);
  if (stray.length === 0) ok("no untracked files in public/art/gen/");
  else if (dry) warn(`${stray.length} untracked file(s) in public/art/gen/ (dry run, not moved): ${stray.map((f) => f.split("/").pop()).join(", ")}`);
  else {
    mkdirSync(join(stash, "art"), { recursive: true });
    for (const f of stray) renameSync(f, join(stash, "art", f.split("/").pop()!));
    ok(`moved ${stray.length} file(s) to ${stash}/art: ${stray.map((f) => f.split("/").pop()).join(", ")} (they regenerate on demand, one image each)`);
  }

  console.log("4. Spooky mood art");
  if (skipArt || dry) warn("skipped (--skip-art or --dry)");
  else if (!process.env.MODEL_API_KEY) warn("no MODEL_API_KEY, cannot pre-warm");
  else {
    const keys = PREWARM_KEYS.filter((k) => sheetPath(k)).slice(0, MAX_PREWARM);
    let made = 0, cached = 0, missed = 0;
    for (const k of keys) {
      const r = await restyleSheet(k, PRESETS.spooky);
      if (!r) missed++; else if (r.cached) cached++; else made++;
    }
    const msg = `spooky sheets: ${made} drawn, ${cached} already cached, ${missed} failed (of ${keys.length}; at most ${MAX_PREWARM} image calls)`;
    if (missed > 0) warn(msg); else ok(msg);
    if (made > 0) console.log("          these count against Meta's image usage, not the game's spend guard");
  }

  console.log("5. Preflight");
  if (!process.env.MODEL_API_KEY) fail("MODEL_API_KEY is not set (put it in .env)");
  else {
    try {
      const t0 = performance.now();
      await chat(SPARK, [{ role: "user", content: "Reply with the single word: ready" }], 16);
      ok(`Meta call answered in ${Math.round(performance.now() - t0)} ms`);
    } catch (e) {
      fail(`Meta call failed: ${e instanceof Error ? e.message.slice(0, 120) : "unknown error"}`);
    }
  }
  const ports: [string, number][] = [["PORT", Number(process.env.PORT ?? 8787)], ["VITE_PORT", Number(process.env.VITE_PORT ?? 5173)]];
  for (const [name, port] of ports) {
    if (await portFree(port)) ok(`${name} ${port} is free`);
    else warn(`${name} ${port} is in use. Fine if the demo server is already running; otherwise stop whatever holds it.`);
  }
  console.log("  mic   Chrome: allow the microphone for the page once and click the game before the first take; hold Shift and speak, release to send. Check the input device in the OS sound settings.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(`demo:prep failed: ${e instanceof Error ? e.message : String(e)}`); process.exitCode = 1; });
}
