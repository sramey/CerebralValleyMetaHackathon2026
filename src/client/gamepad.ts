// Gamepad -> InputState (bead 5p6). Standard-layout pad (a PlayStation pad reports this layout in Chrome):
// the client polls it every frame and merges it with the keyboard, so the sim still only sees InputState.
// Pure and DOM-free: main.ts hands in `navigator.getGamepads()` and acts on what comes back.
import { emptyInput } from "../contract";
import type { InputState } from "../contract";

/** Standard-layout button indices (PlayStation names). */
export const PAD = { CROSS: 0, CIRCLE: 1, SQUARE: 2, TRIANGLE: 3, L1: 4, R1: 5, L2: 6, OPTIONS: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;
/** Hold to talk, same handler as holding Shift. R1 or Triangle. L1 is the item switch now (ADR 0070). */
export const TALK_BUTTONS: readonly number[] = [PAD.TRIANGLE, PAD.R1];
/** Stick travel below this counts as centred. */
export const DEADZONE = 0.25;

export interface PadLike {
  buttons: ReadonlyArray<{ pressed: boolean; value?: number }>;
  axes: ReadonlyArray<number>;
  connected?: boolean;
}

const down = (p: PadLike, i: number): boolean => !!p.buttons[i]?.pressed;

/** The input state one pad asks for: stick or d-pad moves, Cross jumps, Square shoots, Circle uses. */
export function inputFromPad(pad: PadLike | null | undefined): InputState {
  const input = emptyInput();
  if (!pad) return input;
  const x = pad.axes[0] ?? 0;
  input.left = x < -DEADZONE || down(pad, PAD.LEFT);
  input.right = x > DEADZONE || down(pad, PAD.RIGHT);
  if (input.left && input.right) input.left = input.right = false; // stick and d-pad fighting cancel out
  input.jump = down(pad, PAD.CROSS);
  input.shoot = down(pad, PAD.SQUARE);
  input.use = down(pad, PAD.CIRCLE) || input.shoot; // Square is the keyboard's X: shoot and use together
  // Loadout (ADR 0070): L1 next item, d-pad up previous, d-pad down drop, L2 reload.
  if (down(pad, PAD.L1)) input.nextItem = true;
  if (down(pad, PAD.UP)) input.prevItem = true;
  if (down(pad, PAD.DOWN)) input.drop = true;
  if (down(pad, PAD.L2)) input.reload = true;
  return input;
}

/** Keyboard and pad together: any source holding a control holds it. */
export function mergeInputs(a: InputState, b: InputState): InputState {
  return {
    ...a,
    left: a.left || b.left,
    right: a.right || b.right,
    jump: a.jump || b.jump,
    shoot: a.shoot || b.shoot,
    use: !!(a.use || b.use),
    ...(a.nextItem || b.nextItem ? { nextItem: true } : {}),
    ...(a.prevItem || b.prevItem ? { prevItem: true } : {}),
    ...(a.drop || b.drop ? { drop: true } : {}),
    ...(a.reload || b.reload ? { reload: true } : {}),
    ...(a.slot !== undefined || b.slot !== undefined ? { slot: a.slot ?? b.slot } : {}),
  };
}

/** Anything pressed, or a stick pushed past the deadzone: the pad is the one in use. */
export function padTouched(pad: PadLike): boolean {
  return pad.buttons.some((b) => b.pressed) || pad.axes.some((a) => Math.abs(a) > DEADZONE);
}

export type InputMode = "key" | "pad";
/** A pad touch switches to glyphs; a key press switches back. */
export const nextMode = (_mode: InputMode, source: InputMode): InputMode => source;

export interface PadFrame {
  input: InputState;
  /** Talk button held right now. */
  talk: boolean;
  /** Options was pressed this frame (edge, not held). */
  options: boolean;
  /** The pad was touched this frame. */
  touched: boolean;
  events: Array<"connected" | "disconnected">;
}

/** Remembers which pads are connected and the Options edge between frames. */
export class PadTracker {
  private known = new Set<number>();
  private optionsHeld = false;

  poll(pads: ReadonlyArray<PadLike | null | undefined>): PadFrame {
    const live: Array<{ i: number; pad: PadLike }> = [];
    pads.forEach((pad, i) => { if (pad && pad.connected !== false) live.push({ i, pad }); });
    const events: PadFrame["events"] = [];
    const now = new Set(live.map((l) => l.i));
    if (now.size > 0 && this.known.size === 0) events.push("connected");
    if (now.size === 0 && this.known.size > 0) events.push("disconnected");
    this.known = now;
    let input = emptyInput();
    let talk = false;
    let opt = false;
    let touched = false;
    for (const { pad } of live) {
      input = mergeInputs(input, inputFromPad(pad));
      talk = talk || TALK_BUTTONS.some((b) => down(pad, b));
      opt = opt || down(pad, PAD.OPTIONS);
      touched = touched || padTouched(pad);
    }
    const options = opt && !this.optionsHeld;
    this.optionsHeld = opt;
    return { input, talk, options, touched, events };
  }
}

// --- words on screen --------------------------------------------------------------------------

export const HINT_TEXT: Record<InputMode, string> = {
  key: "Move: A/D or arrows   Jump: W / Space   Shoot: X / B   Talk: hold Shift",
  pad: "Move: stick / d-pad   Jump: ✕   Shoot: □   Use: ○   Talk: hold △ or R1   Panel: Options",
};

/** The coach card's wording for the steps that name controls (1 talks, 3 plays). Other steps are input-neutral. */
export function coachBody(step: 1 | 2 | 3, base: string, mode: InputMode): string {
  if (mode === "key") return base;
  if (step === 1) return "Type an idea in the box at the top, or hold △ (or R1) and say it out loud.";
  if (step === 3) return "Move: stick or d-pad. Jump: ✕. Shoot: □. Use: ○. Ask for anything else and it keeps building.";
  return base;
}
