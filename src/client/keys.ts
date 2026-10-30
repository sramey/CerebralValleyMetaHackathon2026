// Keyboard -> InputState (ADR 0046). The client owns the key set; the sim only ever sees InputState,
// so this mapping lives in one pure, testable place instead of inside main.ts's event handlers.
// B is an ACTION key: a prompt that says "pick it up and shoot with B" has to work out of the box.
import { emptyInput } from "../contract";
import type { InputState } from "../contract";

/** Movement. */
export const LEFT_KEYS = ["ArrowLeft", "KeyA"] as const;
export const RIGHT_KEYS = ["ArrowRight", "KeyD"] as const;
export const JUMP_KEYS = ["ArrowUp", "KeyW", "Space"] as const;
/** Primary action: shoot / throw / fire. B joins X, J and F so "shoot with B" works. */
export const ACTION_KEYS = ["KeyB", "KeyX", "KeyJ", "KeyF"] as const;
/** Use / pick up / interact: everything the action keys do, plus E. */
export const USE_KEYS = ["KeyB", "KeyF", "KeyE", "KeyX", "KeyJ"] as const;

/** Every code any of the above lists mentions (for help text and tests). */
export const GAME_KEYS: readonly string[] = [...new Set([...LEFT_KEYS, ...RIGHT_KEYS, ...JUMP_KEYS, ...ACTION_KEYS, ...USE_KEYS])];

/** Hotkeys that are not movement: mute (M) and volume ([/]), plus the pipeline panel (P). */
export const HOTKEY_CODES = ["KeyM", "BracketLeft", "BracketRight", "KeyP"] as const;

// --- text fields vs the game (bead wgt) --------------------------------------
// Typing a command used to leak into the game: an "M" in the build box muted the sound, letters
// moved or shot, and a held key left over from before the box took focus kept the player running
// while the person typed. One predicate now decides which side an event belongs to, so every
// handler (movement, mute, volume, pipeline) agrees instead of each keeping its own tag check.

/** What a key event's `target` has to look like: the bits of an element this needs. */
export interface KeyTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
}

/** The key-event fields the game looks at. A real `KeyboardEvent` satisfies this. */
export interface KeyEventLike {
  code?: string;
  key?: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: unknown;
}

/** True when the event came from a text field, where every key is the person's text, not a command. */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as KeyTargetLike;
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable === true;
}

/**
 * True when this key event belongs to the game. False for anything typed into a text field, and
 * false for modifier chords (Ctrl/Cmd/Alt + key), so Cmd+V in a box is a paste and not "fire".
 * The reverse also holds: an event the game takes has a non-text target, so it can never be
 * routed into a box.
 */
export function isGameKeyEvent(e: KeyEventLike): boolean {
  if (isTypingTarget(e.target)) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return true;
}

const any = (held: ReadonlySet<string>, codes: readonly string[]): boolean => codes.some((c) => held.has(c));

/** The input state for the set of key codes held down right now. */
export function inputFromKeys(held: ReadonlySet<string>): InputState {
  const input = emptyInput();
  input.left = any(held, LEFT_KEYS);
  input.right = any(held, RIGHT_KEYS);
  input.jump = any(held, JUMP_KEYS);
  input.shoot = any(held, ACTION_KEYS);
  input.use = any(held, USE_KEYS);
  return input;
}
