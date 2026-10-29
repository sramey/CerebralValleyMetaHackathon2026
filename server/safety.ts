// Kid-safe guard (ADR 0044). Families are the audience, so every build request and every
// art prompt passes a two-lane screen before it can reach a model that acts on it:
//
//   1. a deterministic local lane (word lists in this file). It is instant, free, and catches
//      only phrases that have no playful reading ("bloody corpse", "nude", "kill myself"),
//      because a false positive costs a family the thing they asked for;
//   2. a Muse Spark classification lane that reads the whole sentence and covers what word
//      lists cannot (nuance, euphemisms, hate and real names). It runs with a hard time
//      budget: a slow classifier must not stall the game, so a verdict that misses the
//      budget is dropped and the local lane's answer stands (fail-open — documented in 0044).
//
// Nothing here writes to the wire. A decline is one short kind sentence that offers a
// playful alternative and never repeats what the player typed.
import { chat, SPARK, type ChatMessage } from "./meta";

/** Why a request was declined. Five buckets, each with its own kind sentence. */
export type SafetyCategory = "violence" | "sexual" | "hate" | "self-harm" | "personal-info";

export const CATEGORIES: readonly SafetyCategory[] = ["violence", "sexual", "hate", "self-harm", "personal-info"];

/** Who made the call, for logs and stats. "skipped" = no local hit and the model missed the budget. */
export type SafetyBy = "off" | "local" | "spark" | "cache" | "skipped";

export interface SafetyDecision {
  unsafe: boolean;
  category: SafetyCategory | null;
  /** What the orb says. Empty when the request is fine. */
  reply: string;
  by: SafetyBy;
  /** Screen cost in ms (0 when the guard is off). */
  ms: number;
  /**
   * A verdict that missed the budget, for a caller that is still running (a build takes
   * seconds): read it with `lateVerdict()` before the expensive step. Absent when there is
   * nothing left to wait for.
   */
  pending?: PendingVerdict;
}

/** A verdict the classifier has not produced yet. `read()` never waits and never throws. */
export interface PendingVerdict {
  read: () => SafetyDecision | null;
}

/** What the classifier decided in the end, or null when it still has not answered. Free. */
export function lateVerdict(pending: PendingVerdict | null | undefined): SafetyDecision | null {
  return pending ? pending.read() : null;
}

export interface SafetyConfig {
  enabled: boolean;
  /** Budget for a build command's classification call (ms). */
  budgetMs: number;
  /** Budget for an art prompt: art is async and already multi-second, so it can wait longer. */
  artBudgetMs: number;
}

export const DEFAULT_BUDGET_MS = 350;
export const DEFAULT_ART_BUDGET_MS = 2000;
/** More than this cannot be called "kid safety at no visible cost"; clamp whatever the env says. */
export const MAX_BUDGET_MS = 6000;
export const MAX_REPLY = 240;
export const MAX_SCREEN_TEXT = 500;

/** SAFETY=off turns the guard off; unset (or on/1/true/yes) leaves it on. */
export function safetyConfig(env: Record<string, string | undefined> = process.env): SafetyConfig {
  const raw = (env.SAFETY ?? "").trim().toLowerCase();
  const enabled = !["off", "0", "false", "no", "disable", "disabled"].includes(raw);
  return {
    enabled,
    budgetMs: budget(env.SAFETY_BUDGET_MS, DEFAULT_BUDGET_MS),
    artBudgetMs: budget(env.SAFETY_ART_BUDGET_MS, DEFAULT_ART_BUDGET_MS),
  };
}

function budget(raw: string | undefined, dflt: number): number {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) && n > 0 ? Math.min(MAX_BUDGET_MS, Math.round(n)) : dflt;
}

/**
 * Kind refusals: one sentence, an alternative the player can actually say next, and never a
 * quiz about what they meant. Fixed text per category, so a model cannot invent a longer one.
 */
export const DECLINE: Record<SafetyCategory, string> = {
  violence: "That one is a bit too rough for this game. Want something exciting instead? Say 'add a friendly dragon' or 'add a trampoline'.",
  sexual: "That is not something I build here. Want to make something fun instead? Say 'add a rocket' or 'make it rain'.",
  hate: "I won't build that. Want to make something silly instead? Say 'add a giant rubber duck'.",
  "self-harm": "That sounds heavy, and this game is not the right place for it. If you are feeling bad, please tell a grown-up you trust. Want to build something gentle? Say 'add a sunny meadow'.",
  "personal-info": "I keep real names, addresses and phone numbers out of the game. Want to build something instead? Say 'add a kite'.",
};

/**
 * The fast lane. Two kinds of phrase are normalised away first, because each has an obvious
 * innocent reading: a "blood moon" is weather, a "water gun" is a toy.
 */
export function localUnsafe(text: string): SafetyCategory | null {
  const t = ` ${text.toLowerCase().replace(/\s+/g, " ")} `
    .replace(/\bblood moon\b/g, " red moon ")
    .replace(/\b(water|squirt|toy|bubble|paint|laser) ?(gun|balloon|blaster)s?\b/g, " toy blaster ");
  for (const [category, patterns] of LOCAL_PATTERNS) {
    for (const re of patterns) if (re.test(t)) return category;
  }
  return null;
}

/** Checked in this order; each list holds only phrases with no playful reading in a family game. */
const LOCAL_PATTERNS: readonly (readonly [SafetyCategory, readonly RegExp[]])[] = [
  ["self-harm", [
    /\b(kill|killing|hurt|hurting|cut|cutting|starve|starving) (my ?self|myself)\b/,
    /\b(suicide|suicidal|self[- ]harm|end my life|want to die|wanna die)\b/,
  ]],
  ["sexual", [
    /\b(sex|sexy|sexual|porn|porno|pornography|hentai|erotic|nude|nudes|naked|nipples?|penis|vagina|boobs|breasts?|orgasm|striptease|blowjob)\b/,
  ]],
  ["violence", [
    /\b(blood|bloody|bloodbath|gore|gory|guts|entrails|corpse|corpses|dead bod(y|ies)|murder|murdered|massacre|torture|tortured)\b/,
    /\b(decapitat\w*|dismember\w*|mutilat\w*|disembowel\w*|behead\w*|massacr\w*)\b/,
    /\b(stab|stabbed|stabbing|slit (a |the )?throat)\b/,
  ]],
  ["hate", [
    /\bhate speech\b/,
    /\b(kill|hurt|gas|exterminate|wipe out|get rid of) (all |every )?(the )?(jews|muslims|christians|hindus|sikhs|blacks|whites|asians|gays|lesbians|trans people|immigrants|refugees)\b/,
  ]],
  ["personal-info", [
    /\b(my|our) (home |house )?(address|phone number|mobile number|school|password|social security)\b/,
    /\bwhere (i|we) live\b/,
    /\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/,
  ]],
];

/** A model verdict: safe, or unsafe with a category and (optionally) its own kind sentence. */
export interface ClassifierVerdict {
  safe: boolean;
  category?: string | null;
  reply?: string | null;
}

/** Injectable so tests use a mock and never touch the network. */
export type Classifier = (text: string, signal?: AbortSignal) => Promise<ClassifierVerdict | null>;

const CLASSIFIER_SYSTEM = `You are the safety screen for a pixel-art action platformer that families play. Decide whether ONE requested game element is okay to put in it. Be permissive: this is a video game, and the person's idea should be built as asked. Only refuse what is clearly listed under UNSAFE; when in doubt, it is safe.

UNSAFE:
- graphic violence: blood, gore, corpses, wounds, torture, cruelty, or real-world attacks on real people or groups;
- sexual content or nudity of any kind;
- hate: slurs, or content that demeans people for who they are;
- self-harm or suicide;
- personal information: real full names, addresses, phone numbers, schools, passwords.

SAFE: ordinary video-game action — guns, flamethrowers, swords, bombs, rockets, lasers, fireballs, fighting and defeating enemies and bosses, explosions, cartoon heroes and monsters, friendly animals, silly jokes, mild spooky stuff, sports, cars, food, magic, weather, music, tools, family-friendly adventure.

Reply with ONLY one JSON object, no markdown, no prose:
{"safe":true}
or
{"safe":false,"category":"violence"|"sexual"|"hate"|"self-harm"|"personal-info","reply":"one short kind sentence (max 25 words) offering a playful alternative, never repeating the request"}`;

/** The shipped classifier: Muse Spark, minimal reasoning, tiny prompt, aborted when the budget is gone. */
export const sparkClassifier: Classifier = async (text, signal) => {
  const messages: ChatMessage[] = [
    { role: "system", content: CLASSIFIER_SYSTEM },
    { role: "user", content: text.slice(0, MAX_SCREEN_TEXT) },
  ];
  const res = await chat(SPARK, messages, 512, "minimal", signal);
  return parseVerdict(res.text);
};

/** Parse the classifier's JSON. Anything unreadable is "no verdict", never "unsafe". */
export function parseVerdict(text: string): ClassifierVerdict | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof obj.safe !== "boolean") return null;
  if (obj.safe) return { safe: true };
  const category = typeof obj.category === "string" && (CATEGORIES as readonly string[]).includes(obj.category)
    ? (obj.category as SafetyCategory)
    : null;
  return { safe: false, category, reply: typeof obj.reply === "string" ? obj.reply : null };
}

export interface ScreenOptions {
  env?: Record<string, string | undefined>;
  /** Override the time budget for this call. */
  budgetMs?: number;
  classify?: Classifier;
  /** Tests turn the memo off so two identical cases both reach the mock. */
  cache?: boolean;
}

/** Verdict memo: a demo repeats the same sentence, and a repeat costs nothing. */
const memo = new Map<string, SafetyDecision>();
const MEMO_MAX = 256;

/** Screen one build command (or any player sentence that will steer a model). */
export function screenRequest(text: string, opts: ScreenOptions = {}): Promise<SafetyDecision> {
  return screen(text, safetyConfig(opts.env).budgetMs, opts);
}

/** Screen one image prompt. Same lanes, longer budget: art is already async and multi-second. */
export function screenArtPrompt(prompt: string, opts: ScreenOptions = {}): Promise<SafetyDecision> {
  return screen(prompt, safetyConfig(opts.env).artBudgetMs, opts);
}

async function screen(text: string, budgetMs: number, opts: ScreenOptions): Promise<SafetyDecision> {
  const cfg = safetyConfig(opts.env);
  if (!cfg.enabled) return { unsafe: false, category: null, reply: "", by: "off", ms: 0 };
  const budget = Math.min(MAX_BUDGET_MS, opts.budgetMs ?? budgetMs);
  const t0 = performance.now();
  const local = localUnsafe(text);
  if (local) return { unsafe: true, category: local, reply: DECLINE[local], by: "local", ms: elapsed(t0) };

  const useMemo = opts.cache !== false;
  const key = `${budget}|${text.trim().toLowerCase().replace(/\s+/g, " ").slice(0, MAX_SCREEN_TEXT)}`;
  const hit = useMemo ? memo.get(key) : undefined;
  if (hit) return { ...hit, by: "cache", ms: elapsed(t0) };

  const classify = opts.classify ?? sparkClassifier;
  const call = classify(text.slice(0, MAX_SCREEN_TEXT), hardCeiling());

  // Keep the verdict, whenever it lands, so a caller still running (the build) can read it
  // before it spends on Wonder. Reading it is free; it is never awaited a second time.
  let settled: SafetyDecision | null = null;
  const pending: PendingVerdict = { read: () => settled };
  call
    .then((v) => { settled = decide(v, text, t0, key, useMemo); })
    .catch(() => { settled = { unsafe: false, category: null, reply: "", by: "skipped", ms: elapsed(t0) }; });

  const verdict = await withBudget(call, budget);
  const decision = decide(verdict, text, t0, key, useMemo);
  if (!verdict) {
    // No verdict inside the budget: the local lane already said this has no obvious red flag,
    // so the game keeps going (blocking here would break the latency promise in ADR 0044).
    // The pending verdict is still checked before the build writes anything.
    return { ...decision, pending };
  }
  return decision;
}

/** Turn a classifier verdict into a decision (and memoise it). A null verdict means "no verdict". */
function decide(
  verdict: ClassifierVerdict | null,
  text: string,
  t0: number,
  key: string,
  useMemo: boolean,
): SafetyDecision {
  if (!verdict) return { unsafe: false, category: null, reply: "", by: "skipped", ms: elapsed(t0) };
  if (verdict.safe) {
    const ok: SafetyDecision = { unsafe: false, category: null, reply: "", by: "spark", ms: elapsed(t0) };
    remember(key, ok, useMemo);
    return ok;
  }
  const category: SafetyCategory =
    verdict.category && (CATEGORIES as readonly string[]).includes(verdict.category)
      ? (verdict.category as SafetyCategory)
      : "violence";
  const decision: SafetyDecision = {
    unsafe: true,
    category,
    reply: cleanReply(verdict.reply, text, category),
    by: "spark",
    ms: elapsed(t0),
  };
  remember(key, decision, useMemo);
  return decision;
}

function remember(key: string, decision: SafetyDecision, useMemo: boolean): void {
  if (!useMemo) return;
  if (memo.size >= MEMO_MAX) {
    const oldest = memo.keys().next();
    if (!oldest.done) memo.delete(oldest.value);
  }
  memo.set(key, decision);
}

/** The model's sentence is a draft: one line, short, and it must not hand the request back. */
function cleanReply(text: unknown, request: string, category: SafetyCategory): string {
  const fallback = DECLINE[category];
  if (typeof text !== "string") return fallback;
  const s = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").replace(/^[\s"'`]+|[\s"'`]+$/g, "").trim();
  if (s.length < 20 || s.length > MAX_REPLY) return fallback;
  const asked = request.trim().toLowerCase();
  if (asked.length >= 12 && s.toLowerCase().includes(asked)) return fallback;
  return s;
}

function elapsed(t0: number): number {
  return Math.round(performance.now() - t0);
}

/**
 * The hard ceiling for the classifier request itself (not the wait): generous, so a verdict
 * that misses the soft deadline still lands and can be read later by the build path.
 */
function hardCeiling(): AbortSignal | undefined {
  try {
    return AbortSignal.timeout(MAX_BUDGET_MS);
  } catch {
    return undefined;
  }
}

/** Resolve with the promise's value, or null when `ms` passes first. Never rejects. */
async function withBudget<T>(p: Promise<T>, ms: number): Promise<T | null> {
  if (!(ms > 0)) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([p.then((value) => value ?? null).catch(() => null), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
