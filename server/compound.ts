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
/** Clause separators: a comma, a semicolon, or a joining word with spaces around it. */
const SEPARATOR = /(?:\s*,\s*|\s*;\s*|\s+and\s+|\s+plus\s+|\s+then\s+|\s+also\s+)/i;
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
  if (PRONOUN_SUBJECT.test(seg)) return true;
  if (PERSONAL_PRONOUN.test(seg)) return true;
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
