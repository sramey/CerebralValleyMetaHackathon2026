import { describe, it, expect } from "vitest";
import { emptyInput } from "../src/contract";
import { DEADZONE, HINT_TEXT, PAD, PadTracker, coachBody, inputFromPad, mergeInputs, nextMode, padTouched, type PadLike } from "../src/client/gamepad";
import { STEP_TEXT } from "../src/client/onboard";

function pad(buttons: number[] = [], axes: number[] = [0, 0, 0, 0]): PadLike {
  return { buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: buttons.includes(i), value: buttons.includes(i) ? 1 : 0 })), axes, connected: true };
}

describe("inputFromPad", () => {
  it("is empty for no pad and for a centred one", () => {
    expect(inputFromPad(null)).toEqual(emptyInput());
    expect(inputFromPad(pad())).toEqual(emptyInput());
  });

  it("ignores stick drift inside the deadzone and moves outside it", () => {
    expect(inputFromPad(pad([], [DEADZONE - 0.01, 0])).right).toBe(false);
    expect(inputFromPad(pad([], [-(DEADZONE - 0.01), 0])).left).toBe(false);
    expect(inputFromPad(pad([], [DEADZONE + 0.05, 0])).right).toBe(true);
    expect(inputFromPad(pad([], [-0.9, 0])).left).toBe(true);
  });

  it("maps the d-pad to left and right", () => {
    expect(inputFromPad(pad([PAD.LEFT])).left).toBe(true);
    expect(inputFromPad(pad([PAD.RIGHT])).right).toBe(true);
  });

  it("combines stick and d-pad, and opposing pushes cancel", () => {
    expect(inputFromPad(pad([PAD.RIGHT], [0.1, 0])).right).toBe(true);
    const both = inputFromPad(pad([PAD.LEFT], [0.9, 0]));
    expect(both.left).toBe(false);
    expect(both.right).toBe(false);
  });

  it("maps Cross to jump, Square to shoot and use, Circle to use only", () => {
    expect(inputFromPad(pad([PAD.CROSS])).jump).toBe(true);
    const sq = inputFromPad(pad([PAD.SQUARE]));
    expect([sq.shoot, sq.use]).toEqual([true, true]);
    const ci = inputFromPad(pad([PAD.CIRCLE]));
    expect([ci.shoot, ci.use, ci.jump]).toEqual([false, true, false]);
  });
});

describe("mergeInputs", () => {
  it("keeps the keyboard's aim fields and ORs the controls", () => {
    const kb = { ...emptyInput(), right: true, pointerX: 5, pointerY: 6, pointerDown: true };
    const m = mergeInputs(kb, { ...emptyInput(), jump: true });
    expect([m.right, m.jump, m.left]).toEqual([true, true, false]);
    expect([m.pointerX, m.pointerY, m.pointerDown]).toEqual([5, 6, true]);
  });
});

describe("PadTracker", () => {
  it("reports connect and disconnect once each", () => {
    const t = new PadTracker();
    expect(t.poll([null]).events).toEqual([]);
    expect(t.poll([pad()]).events).toEqual(["connected"]);
    expect(t.poll([pad()]).events).toEqual([]);
    expect(t.poll([null]).events).toEqual(["disconnected"]);
    expect(t.poll([undefined]).events).toEqual([]);
  });

  it("holds talk on R1 and on Triangle", () => {
    const t = new PadTracker();
    expect(t.poll([pad([PAD.R1])]).talk).toBe(true);
    expect(t.poll([pad([PAD.TRIANGLE])]).talk).toBe(true);
    expect(t.poll([pad([PAD.CROSS])]).talk).toBe(false);
  });

  it("fires Options once per press", () => {
    const t = new PadTracker();
    expect(t.poll([pad([PAD.OPTIONS])]).options).toBe(true);
    expect(t.poll([pad([PAD.OPTIONS])]).options).toBe(false);
    expect(t.poll([pad()]).options).toBe(false);
    expect(t.poll([pad([PAD.OPTIONS])]).options).toBe(true);
  });

  it("merges two pads", () => {
    const f = new PadTracker().poll([pad([PAD.CROSS]), pad([], [-1, 0])]);
    expect([f.input.jump, f.input.left]).toEqual([true, true]);
  });
});

describe("glyph switch", () => {
  it("a touched pad is detected, a still one is not", () => {
    expect(padTouched(pad())).toBe(false);
    expect(padTouched(pad([PAD.CROSS]))).toBe(true);
    expect(padTouched(pad([], [0, -0.8]))).toBe(true);
  });

  it("pad use switches to glyphs and a key press switches back", () => {
    expect(nextMode("key", "pad")).toBe("pad");
    expect(nextMode("pad", "key")).toBe("key");
    expect(HINT_TEXT.pad).toContain("✕");
    expect(HINT_TEXT.pad).toContain("□");
    expect(HINT_TEXT.pad).toContain("○");
    expect(HINT_TEXT.pad).toContain("△");
    expect(HINT_TEXT.key).toContain("Shift");
  });

  it("the coach keeps its words for keys and swaps the control steps for glyphs", () => {
    expect(coachBody(3, STEP_TEXT[3].body, "key")).toBe(STEP_TEXT[3].body);
    expect(coachBody(3, STEP_TEXT[3].body, "pad")).toContain("✕");
    expect(coachBody(1, STEP_TEXT[1].body, "pad")).toContain("R1");
    expect(coachBody(2, STEP_TEXT[2].body, "pad")).toBe(STEP_TEXT[2].body);
  });
});
