// Relative knob requests ("make them faster", "jump higher", "fewer chickens") are
// knob tweaks, not rewrites (ADR 0058). The router tends to answer "edit" for them,
// which costs a full Wonder build (~18 s median) for what a knob does in under 2 s.
// This is a narrow, deterministic matcher: it only fires when the whole command is
// a relative adjustment and the target mod has a numeric knob for it.
import type { KnobDefs, KnobValue } from "../src/contract";

type Dim = "speed" | "jump" | "count";

/** `noun`: the thing the ask names, if any; it must then name the mod being tweaked. */
interface Ask { dim: Dim; up: boolean; strength: number; noun?: string }

/** Knob names (case-insensitive) that carry each dimension. */
const KNOB_NAMES: Record<Dim, RegExp> = {
  speed: /speed|velocity|^vel|pace/i,
  jump: /jump/i,
  count: /count|number|^num|amount|density/i,
};

const STRONG = /\b(a lot|lots|much|way|super|really|very|twice as|even more|so much)\b/;
const WEAK = /\b(a bit|a little|a little bit|slightly|somewhat|a tad)\b/;
const FILLER = "(?:(?:a lot|lots|much|way|super|really|very|a bit|a little(?: bit)?|slightly|somewhat|a tad|even|bit|little)\\s+)*";
const WHO = "(it|them|me|us|him|her|my\\s+[a-z-]+|the\\s+[a-z -]+?|that|those|these|[a-z-]+s)";

/** The thing a "make X faster" names, when it names one ("the enemies" -> "enemies"); pronouns name nothing. */
function nounOf(who: string): string | undefined {
  const m = /^(?:the|my)\s+([a-z -]+)$/.exec(who) ?? /^([a-z-]+s)$/.exec(who);
  const n = m?.[1].trim().split(" ").at(-1);
  return n && !["it", "them", "me", "us", "him", "her", "that", "those", "these", "character", "player", "guy", "hero"].includes(n) ? n : undefined;
}

/** The relative ask a command makes, or null when it says anything else. */
export function parseRelativeAsk(command: string): Ask | null {
  const c = command.toLowerCase().replace(/[.!?]+\s*$/, "").replace(/\s+/g, " ").trim().replace(/^(please|can you|could you)\s+/, "");
  const strength = STRONG.test(c) ? 2 : WEAK.test(c) ? 1.25 : 1.5;
  let m = new RegExp(`^(?:make|let)\\s+${WHO}\\s+${FILLER}(?:(?:go|move|run|walk|fly|swim)\\s+)?${FILLER}(faster|quicker|slower)(?:\\s+please)?$`).exec(c);
  if (m) return { dim: "speed", up: m[2] !== "slower", strength, noun: nounOf(m[1]) };
  m = /^speed\s+(?:it|them|me|things|everything)\s+up$/.exec(c);
  if (m) return { dim: "speed", up: true, strength };
  m = /^slow\s+(?:it|them|me|things|everything)\s+down$/.exec(c);
  if (m) return { dim: "speed", up: false, strength };
  m = new RegExp(`^(?:make|let)\\s+${WHO}\\s+jump\\s+${FILLER}(higher|lower)(?:\\s+please)?$`).exec(c);
  if (m) return { dim: "jump", up: m[2] === "higher", strength, noun: nounOf(m[1]) };
  m = new RegExp(`^(?:i want to\\s+)?jump\\s+${FILLER}(higher|lower)$`).exec(c);
  if (m) return { dim: "jump", up: m[1] === "higher", strength };
  // "more chickens", "fewer coins", "less rain" (no "add": an add is a build, never a tweak).
  // The noun must name the mod (checked in relativeTweak), so "more spooky" never reads as a count.
  m = /^(?:make\s+(?:it\s+|there\s+)?|i want\s+|give me\s+)?(more|fewer|less)\s+([a-z-]+)$/.exec(c);
  if (m) return { dim: "count", up: m[1] === "more", strength, noun: m[2] };
  return null;
}

/** The numeric knob on a mod that carries a dimension: an exact-name match first, then a partial one. */
function knobFor(knobs: KnobDefs, dim: Dim): string | undefined {
  const numeric = Object.keys(knobs).filter((k) => typeof knobs[k]?.value === "number");
  return numeric.find((k) => k.toLowerCase() === dim) ?? numeric.find((k) => KNOB_NAMES[dim].test(k));
}

/** Singular stem of a plural noun: "enemies" -> "enemy", "boxes" -> "box", "slimes" -> "slime". */
export function stemOf(noun: string): string {
  if (/ies$/.test(noun)) return noun.slice(0, -3) + "y";
  if (/(s|x|z|ch|sh)es$/.test(noun)) return noun.slice(0, -2);
  return noun.replace(/s$/, "");
}

/**
 * A knob tweak that answers a relative command on this mod, or null.
 * `about` is the mod's id and title. When the ask names a thing ("the enemies", "more chickens"),
 * that thing must name this mod, except that a speed or jump ask trusts a target the router
 * (or pronoun memory) already chose (`trustTarget`). A count ask always checks, so "more spooky"
 * never reads as a count.
 * Null when the command is not a pure relative ask, the mod has no matching numeric knob,
 * or the knob is already at its limit (so the caller's rewrite path can do better).
 */
export function relativeTweak(command: string, knobs: KnobDefs, about = "", trustTarget = false): { knob: string; value: KnobValue } | null {
  const ask = parseRelativeAsk(command);
  if (!ask) return null;
  if (ask.noun && (ask.dim === "count" || !trustTarget)) {
    const stem = stemOf(ask.noun);
    const named = `${about} ${Object.values(knobs).map((k) => k.label ?? "").join(" ")}`.toLowerCase();
    if (stem.length < 3 || !named.includes(stem)) return null;
  }
  const knob = knobFor(knobs, ask.dim);
  if (!knob) return null;
  const def = knobs[knob];
  const cur = def.value as number;
  let next = ask.up ? cur * ask.strength : cur / ask.strength;
  if (ask.dim === "count") next = ask.up ? Math.max(cur + 1, Math.round(next)) : Math.min(cur - 1, Math.round(next));
  else next = Math.round(next * 100) / 100;
  if (typeof def.min === "number") next = Math.max(def.min, next);
  if (typeof def.max === "number") next = Math.min(def.max, next);
  if (next === cur) return null;
  return { knob, value: next };
}
