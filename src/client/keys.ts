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
