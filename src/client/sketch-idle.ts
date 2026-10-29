// Sketch idle guard (ADR 0028 follow-up): the world is frozen while the overlay is up, so a
// sketch the player walks away from would leave the game paused forever. This module is the
// pure half: how long a sketch may sit untouched, the chip line that says the world is
// paused, and the countdown that says when it will let go. The overlay in sketch.ts owns
// the clock and the DOM; everything decidable lives here so it can be tested without one.

/** How long the player may sit in sketch mode without touching it before it cancels itself. */
export const SKETCH_IDLE_MS = 3 * 60_000;

/** The chip's headline. The world is genuinely frozen, so say it plainly. */
export const SKETCH_PAUSED_LABEL = "Paused — drawing";

/** While the builder reads the sketch the world also stays paused, but the clock does not run. */
export const SKETCH_BUILDING_LABEL = "Paused — reading your sketch";

/** Milliseconds left before the idle guard cancels the sketch. Never negative. */
export function idleLeft(lastActivity: number, now: number, idleMs: number = SKETCH_IDLE_MS): number {
  return Math.max(0, lastActivity + idleMs - now);
}

/** Has the sketch sat untouched past the idle limit? */
export function idleExpired(lastActivity: number, now: number, idleMs: number = SKETCH_IDLE_MS): boolean {
  return idleLeft(lastActivity, now, idleMs) <= 0;
}

/** `2:41` style countdown: minutes and zero-padded seconds, clamped at `0:00`. */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** The chip's second line: what the idle guard will do, and how soon. */
export function idleNote(leftMs: number): string {
  return leftMs <= 0 ? "closing now" : `auto-cancels in ${countdown(leftMs)}`;
}

/** Should the chip switch to its warning colour? */
export function idleUrgent(leftMs: number, warnMs = 20_000): boolean {
  return leftMs <= warnMs;
}
