import { describe, expect, it } from "vitest";
import { pickWalkFrame, WALK_PHASE_TICKS } from "../src/client/walk-frame";

const T = WALK_PHASE_TICKS;
const at = (phase: number, over: Partial<Parameters<typeof pickWalkFrame>[0]> = {}) =>
  pickWalkFrame({ frameCount: 4, tick: phase * T, moving: true, onGround: true, ...over });

describe("pickWalkFrame", () => {
  it("cycles idle, stride1, idle, stride2 while walking", () => {
    expect([0, 1, 2, 3, 4].map((p) => at(p).index)).toEqual([0, 1, 0, 2, 0]);
  });
  it("bobs only on stride frames with differentiated step heights", () => {
    expect([0, 1, 2, 3].map((p) => at(p).bob > 0)).toEqual([false, true, false, true]);
    // Contact stride (phase 1) bobs lower than passing stride (phase 3)
    expect(at(1).bob).toBe(1.5);
    expect(at(3).bob).toBe(3);
  });
  it("stands on frame 0 when not moving", () => {
    for (let t = 0; t < 40; t++) expect(pickWalkFrame({ frameCount: 4, tick: t, moving: false, onGround: true })).toEqual({ index: 0, bob: 0 });
  });
  it("shows the jump frame when airborne, moving or not", () => {
    expect(at(1, { onGround: false }).index).toBe(3);
    expect(at(0, { onGround: false, moving: false }).index).toBe(3);
  });
  it("two-frame sheets alternate idle and the one stride", () => {
    expect([0, 1, 2, 3].map((p) => at(p, { frameCount: 2 }).index)).toEqual([0, 1, 0, 1]);
  });
  it("three-frame sheets use both strides and ignore airborne", () => {
    expect([0, 1, 2, 3].map((p) => at(p, { frameCount: 3 }).index)).toEqual([0, 1, 0, 2]);
    expect(at(1, { frameCount: 3, onGround: false }).index).toBe(1);
  });
  it("single frame stays put", () => {
    expect(at(1, { frameCount: 1 })).toEqual({ index: 0, bob: 0 });
  });
});
