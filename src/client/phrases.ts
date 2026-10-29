// Sketch-mode phrases (ADR 0027): "let me draw a level" opens the sketch overlay locally,
// with no AI call and no build slot spent.
//
// The matcher is deliberately narrow. A draw verb only means sketch mode when what it
// draws is the level itself, or nothing at all, so "draw a dragon" still travels to the
// builder and comes back a dragon. Anything the matcher does not recognise falls through
// to the normal command path untouched.

export type SketchIntent = "open" | "close";

/** Words that name the level itself, never an entity inside it. */
const LEVEL_WORDS = "level|map|world|stage|scene";

/** Polite lead-ins a voice transcript or a typed command tends to carry. */
const HEAD_FILLERS: RegExp[] = [
  /^(?:hey|hi|hello|ok|okay|so|now|please|um|uh|alright|right)\s+/,
  /^(?:can|could|would|will)\s+you\s+/,
  /^(?:i\s+want\s+to|i\s+wanna|i\s+need\s+to|i\s+would\s+like\s+to|i'd\s+like\s+to|i'd\s+love\s+to)\s+/,
  /^(?:i'm\s+gonna|i'm\s+going\s+to|i\s+am\s+going\s+to|gonna)\s+/,
  /^(?:let's|lets|let\s+me|let\s+us|allow\s+me\s+to|time\s+to|i'll|i\s+will|i\s+can)\s+/,
];

/** Trailing words that carry no meaning for routing ("sketch mode" is "sketch"). */
const TAIL_FILLERS: RegExp[] = [
  /\s+(?:please|now|thanks|for\s+me|for\s+us|a\s+bit|real\s+quick)$/,
  /\s+(?:here|in\s+here|over\s+here)$/,
  /\s+mode$/,
];

const NEGATION_RE = /^(?:don't|do\s+not|dont|never|no)\b/;

/** "let me draw the level" -> "draw the level" (no fillers left to strip). */
const CLOSE_RE = new RegExp(
  `^(?:cancel|close|exit|quit|stop|leave|end|get\\s+out\\s+of)\\s+(?:the\\s+|this\\s+)?(?:sketch|sketching|drawing|sketchpad|(?:${LEVEL_WORDS})\\s+sketch)$`,
);

/** "open sketch", "start sketching". */
const OPEN_WORD_RE = /^(?:open|start|begin|enter)\s+(?:the\s+|a\s+)?(?:sketch|sketching|sketchpad|drawing)$/;

/** A bare verb, or the sketch itself by name: "sketch", "draw", "paint". */
const BARE_RE = /^(?:sketch|sketchpad|draw|paint|drawing)$/;

/** "draw a level", "sketch the map", "let me paint this world". */
const DRAW_LEVEL_RE = new RegExp(
  `^(?:draw|sketch|paint)(?:\\s+(?:me|us|out))?\\s+(?:(?:a|an|the|this|my|our)\\s+)?(?:${LEVEL_WORDS})$`,
);

/**
 * Lowercase, drop punctuation, and strip the fillers above until nothing changes.
 * Pure and idempotent: the tests use it directly to explain a mismatch.
 */
export function normalizePhrase(text: string): string {
  let t = text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9'\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Bounded: every pass removes at least one word or stops.
  for (let guard = 0; guard < 12; guard++) {
    const before = t;
    for (const re of HEAD_FILLERS) t = t.replace(re, "");
    for (const re of TAIL_FILLERS) t = t.replace(re, "");
    t = t.trim();
    if (t === before) break;
  }
  return t;
}

/** Does this typed or spoken command mean "open/close the sketch overlay"? */
export function matchSketchIntent(text: string): SketchIntent | null {
  if (!text || text.length > 120) return null;
  const n = normalizePhrase(text);
  if (!n || NEGATION_RE.test(n)) return null;
  if (CLOSE_RE.test(n)) return "close";
  if (OPEN_WORD_RE.test(n) || BARE_RE.test(n) || DRAW_LEVEL_RE.test(n)) return "open";
  return null;
}
