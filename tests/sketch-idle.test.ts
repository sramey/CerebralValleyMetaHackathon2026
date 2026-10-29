// Sketch idle guard (ADR 0030 follow-up to 0028): the world is frozen while the overlay is
// up, so an abandoned sketch cancels itself after three minutes and says so in a chip.
// Pure clock math only — the overlay's timer and DOM call into these.
import { describe, expect, it } from "vitest";
import {
  SKETCH_BUILDING_LABEL,
  SKETCH_IDLE_MS,
  SKETCH_PAUSED_LABEL,
  countdown,
  idleExpired,
  idleLeft,
  idleNote,
  idleUrgent,
} from "../src/client/sketch-idle";

describe("sketch idle guard", () => {
  it("waits three minutes, not longer", () => {
    expect(SKETCH_IDLE_MS).toBe(180_000);
  });

  it("counts down from the last touch and never goes negative", () => {
    const t0 = 1_000_000;
    expect(idleLeft(t0, t0)).toBe(SKETCH_IDLE_MS);
    expect(idleLeft(t0, t0 + 60_000)).toBe(120_000);
    expect(idleLeft(t0, t0 + SKETCH_IDLE_MS - 1)).toBe(1);
    expect(idleLeft(t0, t0 + SKETCH_IDLE_MS)).toBe(0);
    expect(idleLeft(t0, t0 + 10 * SKETCH_IDLE_MS)).toBe(0);
  });

  it("expires exactly at the limit, not a millisecond before", () => {
    const t0 = 5_000;
    expect(idleExpired(t0, t0 + SKETCH_IDLE_MS - 1)).toBe(false);
    expect(idleExpired(t0, t0 + SKETCH_IDLE_MS)).toBe(true);
    expect(idleExpired(t0, t0 + SKETCH_IDLE_MS + 1)).toBe(true);
  });

  it("honours a custom limit (the overlay keeps one number, but the math is shared)", () => {
    expect(idleLeft(0, 4_000, 3_000)).toBe(0);
    expect(idleExpired(0, 3_000, 3_000)).toBe(true);
  });

  it("formats the chip countdown as m:ss and clamps at 0:00", () => {
    expect(countdown(SKETCH_IDLE_MS)).toBe("3:00");
    expect(countdown(61_000)).toBe("1:01");
    expect(countdown(7_400)).toBe("0:08"); // ceil: never show 0:00 while time remains
    expect(countdown(1)).toBe("0:01");
    expect(countdown(0)).toBe("0:00");
    expect(countdown(-50)).toBe("0:00");
  });

  it("says plainly that the world is paused, and when it lets go", () => {
    expect(SKETCH_PAUSED_LABEL).toBe("Paused — drawing");
    expect(SKETCH_PAUSED_LABEL.toLowerCase()).toContain("paused");
    expect(idleNote(120_000)).toBe("auto-cancels in 2:00");
    expect(idleNote(1)).toBe("auto-cancels in 0:01");
    expect(idleNote(0)).toBe("closing now");
    expect(SKETCH_BUILDING_LABEL).toContain("Paused");
  });

  it("turns urgent only in the last twenty seconds", () => {
    expect(idleUrgent(SKETCH_IDLE_MS)).toBe(false);
    expect(idleUrgent(20_001)).toBe(false);
    expect(idleUrgent(20_000)).toBe(true);
    expect(idleUrgent(0)).toBe(true);
  });
});
