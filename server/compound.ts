// Compound request splitting (ADR 0053). A command is split into several independent
// builds ONLY when it names genuinely separate things ("add a castle and add a dragon").
// One subject with traits or behaviors ("add a superhero cat that flies around dropping
// coins") is ONE build: splitting it made four mods fight over one id while the player
// watched a cat flicker through four half-states (bead 2yt).
//
// Pure and deterministic: regexes in, string array out. No model call, no I/O, so the
// same command always takes the same path and a unit test can pin it.
import { detectMoodCommand } from "../src/ontology";

/** Verbs that open a standalone build request. */
const BUILD_VERB =
  /^(?:add|create|spawn|build|make|put|place|give|summon|drop|draw|paint|let|throw|sprinkle|fill)\b/i;
/** A bare noun phrase continuation ("add a castle and a dragon") implies another add. */
const DETERMINER =
  /^(?:a|an|the|some|another|more|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i;
/** Words that introduce a trait, a relative clause or a behavior of the subject before them. */
const RELATIVE =
  /\b(?:that|which|who|whom|whose|with|wearing|holds?|holding|carrying|having|to|so|when|while|where|if|but)\b/i;
/** A part whose subject is a pronoun hangs off the part before it ("and make it fly"). */
const PRONOUN_SUBJECT =
  /^(?:it|its|it's|they|them|their|he|him|his|she|her|this|that|those|these)\b/i;
/** A personal pronoun anywhere in a later clause points back at what the earlier part built. */
const PERSONAL_PRONOUN = /\b(?:it|its|it's|they|them|their|he|him|his|she|her)\b/i;
/** "make it rain / snow / night / spooky": a weather or mood idiom whose "it" is the world, not an earlier subject. */
const DUMMY_IT = /\b(?:make|turn|let)\s+it\s+(?:rain|snow|storm|thunder|hail|pour|drizzle|night|day|dark|darker|bright|brighter|foggy|misty|windy|sunny|cloudy|stormy|spooky|cozy|cold|hot|winter|summer|autumn|fall|spring)\b/gi;
const withoutDummyIt = (seg: string): string => seg.replace(DUMMY_IT, "");

/** Clause separators: a comma, a semicolon, or a joining word with spaces around it. */
const SEPARATOR = /(?:\s*,\s*(?:and|plus|then|also)\s+|\s*,\s*|\s*;\s*|\s+and\s+|\s+plus\s+|\s+then\s+|\s+also\s+)/i;
/** Words too common to identify "the thing the earlier part was about". */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "with", "to", "that", "this", "these", "those",
  "it", "its", "them", "their", "my", "me", "for", "from", "into", "some", "more", "very",
  "big", "small", "little", "new", "super", "all", "add", "make", "create", "spawn", "build",
]);

export const MAX_PARTS = 4;

/** The content words of a clause, used to spot a later part referring back to it. */
function nounsOf(part: string): Set<string> {
  const words = part.toLowerCase().replace(/[^a-z0-9\s-]+/g, " ").split(/\s+/);
  return new Set(words.filter((w) => w.length >= 3 && !STOP_WORDS.has(w)));
}

/** True when the clause says "the <thing>" / "that <thing>" and an earlier part named that thing. */
function refersBack(part: string, earlier: Set<string>): boolean {
  const definite = /\b(?:the|that|those|these|his|her|its|their)\s+([a-z0-9-]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = definite.exec(part)) !== null) {
    if (earlier.has(m[1].toLowerCase())) return true;
  }
  return false;
}

/** A clause that can be built on its own: a build verb, a bare noun phrase, or a mood. */
function isStandalone(part: string): boolean {
  return BUILD_VERB.test(part) || DETERMINER.test(part) || detectMoodCommand(part) !== null;
}

/**
 * True when `seg` belongs to the part before it rather than starting a new build:
 * a behavior ("drops coins"), a relative clause ("that flies"), a pronoun subject
 * ("make it fly"), or an attribute after a "with ..." list ("wearing a cape and a mask").
 */
function continuesPrevious(seg: string, prev: string): boolean {
  const own = withoutDummyIt(seg);
  if (PRONOUN_SUBJECT.test(own)) return true;
  if (PERSONAL_PRONOUN.test(own)) return true;
  if (BUILD_VERB.test(seg)) return false;
  if (detectMoodCommand(seg) !== null) return false;
  if (RELATIVE.test(seg)) return true;
  if (DETERMINER.test(seg)) return RELATIVE.test(prev);
  return true;
}

/**
 * Split a build command into independent parts, or null when the command is ONE build.
 * Null is the answer for every single-subject request, including one with several traits
 * or behaviors, and for anything the splitter is not sure about.
 */
export function splitCompound(text: string): string[] | null {
  const whole = text.trim().replace(/\s+/g, " ");
  if (!whole || whole.length > 400) return null;
  if (!SEPARATOR.test(whole)) return null;

  const segments = whole
    .split(SEPARATOR)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length < 2) return null;

  // Merge every clause that is not an independent command into the part before it.
  const parts: string[] = [];
  for (const seg of segments) {
    const prev = parts[parts.length - 1];
    if (prev !== undefined && continuesPrevious(seg, prev)) {
      parts[parts.length - 1] = `${prev}, ${seg}`;
      continue;
    }
    parts.push(seg);
  }
  if (parts.length < 2) return null;
  if (!parts.every(isStandalone)) return null;

  // Never split when a later part points back at something an earlier part introduced
  // ("add a castle and add a dragon that guards the castle" is one scene, one build).
  const earlier = new Set<string>();
  const independent: string[] = [];
  for (const part of parts) {
    if (refersBack(part, earlier)) return null;
    independent.push(part);
    for (const w of nounsOf(part)) earlier.add(w);
  }

  // A bare noun phrase becomes its own add: "a dragon" -> "add a dragon".
  const named = independent.map((p) => (BUILD_VERB.test(p) || detectMoodCommand(p) !== null ? p : `add ${p}`));

  // Keep the parts distinct without dropping a request: overflow clauses join the last part.
  const unique: string[] = [];
  for (const p of named) if (!unique.includes(p)) unique.push(p);
  if (unique.length < 2) return null;
  if (unique.length <= MAX_PARTS) return unique;
  return [...unique.slice(0, MAX_PARTS - 1), unique.slice(MAX_PARTS - 1).join(", ")];
}

/** True when the command could hold more than one request (worth asking Spark to split). */
export function mightBeCompound(text: string): boolean {
  return SEPARATOR.test(text.trim());
}

/**
 * Guard on a model's split (ADR 0053): a part that points back at an earlier part ("make it
 * fly", "add flying patrol for the superhero cat") is a behavior of that subject, so it joins
 * the part before it. Returns the parts that are genuinely independent (may be one).
 */
export function mergeDependentParts(parts: string[]): string[] {
  const out: string[] = [];
  const earlier = new Set<string>();
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    const own = withoutDummyIt(part);
    const dependent = out.length > 0 && (PRONOUN_SUBJECT.test(own) || PERSONAL_PRONOUN.test(own) || refersBack(own, earlier) || sharesSubject(own, earlier));
    if (dependent) out[out.length - 1] = `${out[out.length - 1]}, ${part}`;
    else out.push(part);
    for (const w of nounsOf(part)) earlier.add(w);
  }
  return out.slice(0, MAX_PARTS);
}

/** "add coin dropping ability to the superhero cat": a later part naming an earlier part's subject noun after for/to/of/on. */
function sharesSubject(part: string, earlier: Set<string>): boolean {
  const m = /\b(?:for|to|of|on|by)\s+(?:the|a|an|my|its|their)?\s*(?:[a-z0-9-]+\s+){0,2}?([a-z0-9-]+)\s*$/i.exec(part.replace(/[.!?]+$/, ""));
  return m !== null && earlier.has(m[1].toLowerCase());
}
