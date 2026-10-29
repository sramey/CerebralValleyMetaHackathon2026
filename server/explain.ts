// "How does this work?" (ADR 0043). The player clicks something they built and asks what it
// is, so this lane turns one mod's source into three short sentences a kid can read plus the
// three lines that matter. Three jobs, all in this file and all headless-testable:
//
//   1. the prompt (source with line numbers, so the model can point at real lines);
//   2. the reply parser, which never trusts the model: sentences are cut to three, line
//      numbers are clamped to the source, and a reply that names no real line still gets a
//      useful code view from a deterministic heuristic;
//   3. the cache, keyed by a hash of the source, so clicking the same object again is free
//      (and a rebuilt mod, whose source changed, is explained fresh).
//
// Only Meta's Muse Spark is called, and the caller spends one budget unit before a miss.
import { createHash } from "node:crypto";
import { chat, SPARK, type ChatMessage } from "./meta";

/** Longer than any Wonder mod we ship; a bound on what one explanation may cost. */
export const MAX_SOURCE_CHARS = 14_000;
/** Three sentences is the product rule: one idea per sentence, no wall of text. */
export const MAX_SENTENCES = 3;
/** Key lines are shown in a small view, so one absurdly long line is cut. */
export const MAX_LINE_CHARS = 180;
export const MAX_CACHED = 128;

export interface ExplainLine { n: number; code: string }

export interface Explanation {
  /** Three short, plain sentences. */
  text: string;
  /** Up to three key lines of the mod, in source order. */
  lines: ExplainLine[];
  /** Model time in ms (0 for a cache hit). */
  ms: number;
  cached: boolean;
}

/** Same instruction shape as every other Spark call: JSON only, no markdown (ADR 0001). */
export const EXPLAIN_SYSTEM = [
  "You explain game code to a curious nine-year-old.",
  "The player clicked one object in a game they are building by talking, and asked: how does this work?",
  "You get that object's mod source, with the line number at the start of every line.",
  'Answer with JSON only: {"say": "...", "lines": [12, 18, 31]}',
  'Rules for "say": exactly three sentences, at most 20 words each, plain everyday words, no jargon, no markdown, no line numbers.',
  "Sentence 1: what this thing does in the game.",
  "Sentence 2: how it does it, in one idea a kid can picture.",
  'Sentence 3: one thing to try changing to see what happens.',
  'Rules for "lines": exactly three line numbers, copied from the source, that matter most for how it works.',
  "Never invent a line number and never use 0.",
].join("\n");

/** A short, stable fingerprint of a source: the cache key, and what a rebuild changes. */
export function sourceHash(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex").slice(0, 16);
}

/**
 * The source with 1-based line numbers in front, cut at MAX_SOURCE_CHARS. Numbers are always
 * the real ones, so the model's answer can point into the file we hold.
 */
export function numberedSource(source: string, max = MAX_SOURCE_CHARS): string {
  const lines = source.split(/\r?\n/);
  const out: string[] = [];
  let used = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.length > MAX_LINE_CHARS ? `${raw.slice(0, MAX_LINE_CHARS)}…` : raw;
    if (used + line.length + 8 > max) {
      out.push(`${i + 1}: ... (${lines.length - i} more lines not shown)`);
      break;
    }
    out.push(`${i + 1}: ${line}`);
    used += line.length + 8;
  }
  return out.join("\n");
}

/** The message pair one explanation is asked with. Pure: the prompt a test can read. */
export function explainMessages(title: string, source: string): ChatMessage[] {
  const name = title.trim().slice(0, 80) || "this mod";
  return [
    { role: "system", content: EXPLAIN_SYSTEM },
    { role: "user", content: `Mod: ${name}\nSource (line numbers first):\n${numberedSource(source)}` },
  ];
}

/**
 * Lines that explain how a mod works when the model names none we can use: what it creates,
 * what it does every tick, what it cleans up, what the player can tune. Deterministic.
 */
const INTERESTING: readonly RegExp[] = [
  /\bapi\.spawn\(/,
  /\.onTick\(/,
  /\bknobs\s*:/,
  /\bdispose\s*\(/,
  /\bsetup\s*\(/,
  /export\s+default/,
];

export function keyLines(source: string, max = MAX_SENTENCES): number[] {
  const lines = source.split(/\r?\n/);
  const picked: number[] = [];
  for (const re of INTERESTING) {
    if (picked.length >= max) break;
    for (let i = 0; i < lines.length; i++) {
      const n = i + 1;
      if (picked.includes(n) || !lines[i].trim()) continue;
      if (re.test(lines[i])) { picked.push(n); break; }
    }
  }
  // Still short: take the first lines that carry code, skipping imports, comments and blanks.
  for (let i = 0; i < lines.length && picked.length < max; i++) {
    const n = i + 1;
    const line = lines[i];
    if (picked.includes(n) || !line.trim() || /^\s*(import|export\s+\{|export\s+type|\/\/|\/\*|\*)/.test(line)) continue;
    picked.push(n);
  }
  return picked.sort((a, b) => a - b);
}

/** The line's text, trimmed of indentation, ready to show in a small code view. */
export function lineText(source: string, n: number): string {
  const lines = source.split(/\r?\n/);
  const line = lines[n - 1] ?? "";
  const trimmed = line.trim();
  return trimmed.length > MAX_LINE_CHARS ? `${trimmed.slice(0, MAX_LINE_CHARS)}…` : trimmed;
}

/**
 * Cut a model reply down to three sentences. Markdown, code fences and list markers go,
 * because the panel renders plain text; an unterminated last sentence still counts.
 */
export function normaliseSay(raw: string): string {
  const flat = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`#>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!flat) return "";
  const parts = flat.match(/[^.!?]+[.!?]*/g) ?? [];
  const sentences = parts.map((s) => s.trim()).filter((s) => s.length > 0).slice(0, MAX_SENTENCES);
  const joined = sentences.join(" ").replace(/\s+([.!?])/g, "$1").trim();
  // A sentence the model left open still reads as a sentence here.
  return joined && !/[.!?]$/.test(joined) ? `${joined}.` : joined;
}

export interface ParsedExplanation { text: string; lines: ExplainLine[] }

/**
 * The `say` value out of a reply whose JSON did not parse (usually a truncated one). Stops at
 * the closing quote and never returns the surrounding braces.
 */
export function looseSay(raw: string): string {
  const m = /"say"\s*:\s*"([\s\S]*)/.exec(raw);
  const body = m ? m[1] : raw;
  const cut = m ? body.search(/(?<!\\)"/) : -1;
  const kept = cut >= 0 ? body.slice(0, cut) : body;
  try {
    return JSON.parse(`"${kept.replace(/\\?$/, "")}"`) as string;
  } catch {
    return kept.replace(/\\"/g, '"').replace(/\\n/g, " ");
  }
}

/**
 * Parse one Spark reply into an explanation of THIS source. Never throws and never trusts a
 * line number: anything outside the file is dropped, and a reply with no usable numbers
 * falls back to the deterministic key lines. Null only when there is nothing to say.
 */
export function parseExplanation(raw: string, source: string): ParsedExplanation | null {
  const lineCount = source.split(/\r?\n/).length;
  const wanted: number[] = [];
  let say: string;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  let parsed: Record<string, unknown> | null = null;
  if (start >= 0 && end > start) {
    try { parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>; } catch { parsed = null; }
  }
  if (parsed) {
    // Models sometimes rename the prose field; take the words wherever they are.
    const sayField = parsed.say ?? parsed.text ?? parsed.explanation;
    if (typeof sayField !== "string") return null;
    say = sayField;
    if (Array.isArray(parsed.lines)) {
      for (const v of parsed.lines) {
        const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
        if (Number.isInteger(n) && n >= 1 && n <= lineCount) wanted.push(n);
      }
    }
  } else {
    // No usable JSON: keep whatever prose it answered with (a demo must not show an error).
    say = looseSay(raw);
  }
  const text = normaliseSay(say);
  if (!text) return null;

  const numbers: number[] = [];
  for (const n of wanted) if (!numbers.includes(n) && numbers.length < MAX_SENTENCES) numbers.push(n);
  for (const n of keyLines(source)) if (!numbers.includes(n) && numbers.length < MAX_SENTENCES) numbers.push(n);
  const lines = numbers.sort((a, b) => a - b).map((n) => ({ n, code: lineText(source, n) }));
  return { text, lines };
}

/** Bounded cache, least-recently-used out. Keyed by source hash, so a rebuilt mod misses. */
export class ExplainCache {
  private map = new Map<string, Explanation>();
  constructor(private readonly max = MAX_CACHED) {}

  get(hash: string): Explanation | undefined {
    const hit = this.map.get(hash);
    if (!hit) return undefined;
    this.map.delete(hash);
    this.map.set(hash, hit); // freshen the LRU order
    return hit;
  }

  set(hash: string, explanation: Explanation): void {
    this.map.delete(hash);
    this.map.set(hash, explanation);
    while (this.map.size > Math.max(1, this.max)) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  size(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
}

/** The cache every live session shares: one source is explained once, whoever asks. */
export const explainCache = new ExplainCache();

export type Ask = (messages: ChatMessage[], maxTokens: number) => Promise<{ text: string; ms: number }>;

/** Muse Spark, minimal reasoning, short answer: measured p95 ~3.2s for a reply this size. */
const askSpark: Ask = (messages, maxTokens) => chat(SPARK, messages, maxTokens);

export interface ExplainOptions {
  source: string;
  title: string;
  /** Tests pass a mock so the suite never touches the network. */
  ask?: Ask;
  cache?: ExplainCache;
}

export type ExplainOutcome =
  | { ok: true; explanation: Explanation }
  | { ok: false; why: "empty" | "error"; message?: string };

/** A ready explanation for this exact source, free, or undefined. */
export function cachedExplanation(source: string, cache: ExplainCache = explainCache): Explanation | undefined {
  const hit = cache.get(sourceHash(source));
  return hit ? { ...hit, cached: true, ms: 0 } : undefined;
}

/** Explain one mod source. A cache hit costs nothing; a miss calls Spark once. */
export async function explainMod(opts: ExplainOptions): Promise<ExplainOutcome> {
  const cache = opts.cache ?? explainCache;
  const hit = cachedExplanation(opts.source, cache);
  if (hit) return { ok: true, explanation: hit };
  let res: { text: string; ms: number };
  try {
    res = await (opts.ask ?? askSpark)(explainMessages(opts.title, opts.source), 512);
  } catch (err) {
    return { ok: false, why: "error", message: err instanceof Error ? err.message : String(err) };
  }
  const parsed = parseExplanation(res.text, opts.source);
  if (!parsed) return { ok: false, why: "empty" };
  const explanation: Explanation = { ...parsed, ms: res.ms, cached: false };
  cache.set(sourceHash(opts.source), explanation);
  return { ok: true, explanation };
}
