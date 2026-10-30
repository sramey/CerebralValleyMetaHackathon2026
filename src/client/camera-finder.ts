// The camera panel's status strip, for the part that is about finding the object (bead q4u).
//
// "Couldn't find it" is an answer about one photo, but it used to be written straight to the
// strip and never taken back: it stayed up after the next attempt found its object, and it was
// still there after the panel was closed and reopened. Here every attempt, every answer, a hand
// cut and a close move one tiny state machine, and the line is *derived* from that state, so a
// stale line has nowhere to live. The panel's other rows (background hint, paper notice, the
// diff/wand "click yours" line) still write their own text; the finder just stands down while
// they own the strip.
//
// Pure on purpose (no DOM), so `tests/camera-finder.test.ts` can walk whole sessions.

/** What the last look at the photo produced. */
export type Look = "idle" | "waiting" | "found" | "missed";

export interface FinderState {
  look: Look;
  /**
   * A usable cut is already on screen (a background diff or a wand highlight), or another row
   * (the background hint, the paper notice) is saying something more useful than anything the
   * finder knows. A late answer must not cover it.
   */
  covered: boolean;
  /** No builder to ask, so there is no box to wait for: say that instead of promising one. */
  offline: boolean;
}

export const FINDER_IDLE: FinderState = { look: "idle", covered: false, offline: false };

export type FinderEvent =
  /** The panel opened, or reopened: nothing has been looked at yet. */
  | { kind: "open" }
  /** The panel closed; the line goes with it. */
  | { kind: "close" }
  /** A photo was captured or picked, or "Find it" was pressed again: a fresh look starts. */
  | { kind: "attempt"; offline: boolean }
  /** The segmenter answered with a box. */
  | { kind: "found" }
  /** The segmenter answered with nothing. */
  | { kind: "missed" }
  /** Another row takes the strip over (a hand cut, the background hint, the paper notice). */
  | { kind: "covered" };

export function finderNext(state: FinderState, ev: FinderEvent): FinderState {
  switch (ev.kind) {
    case "open":
      return FINDER_IDLE;
    case "close":
      return { ...state, look: "idle", covered: false };
    case "attempt":
      return { look: "waiting", covered: false, offline: ev.offline };
    case "covered":
      return state.covered ? state : { ...state, covered: true };
    // A late answer replaces an older answer, but never hides a line that already helps.
    case "found":
    case "missed":
      return state.covered ? state : { ...state, look: ev.kind };
  }
}

/** Every line this module can put on the strip. */
export const FINDER_LINE = {
  idle: "",
  looking: "Looking for it...",
  offline: "The AI is offline — click your object in the photo to cut it out yourself.",
  found: "Found it — the green box is what enters the game.",
  missed: "Couldn't find it. Get closer, use a plain background, or click the object in the photo.",
} as const;

/** What the strip should say now, or `null` when another row owns it and nothing should be written. */
export function finderLine(state: FinderState): string | null {
  if (state.covered) return null;
  if (state.look === "idle") return FINDER_LINE.idle;
  if (state.look === "waiting") return state.offline ? FINDER_LINE.offline : FINDER_LINE.looking;
  return state.look === "found" ? FINDER_LINE.found : FINDER_LINE.missed;
}
