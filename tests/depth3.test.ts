import { describe, expect, it } from "vitest";
import type { Graphics } from "pixi.js";
import { depthFog, drawForegroundLayer } from "../src/client/depth";

/** A Graphics stand-in that records every polygon's lowest-up point (smallest y) and the call count. */
function recorder(): { gfx: Graphics; minY: () => number; calls: () => number } {
  let minY = Infinity;
  let calls = 0;
  const chain: Record<string, unknown> = {
    fill: () => chain,
    stroke: () => chain,
    poly: (pts: number[]) => {
      calls++;
      for (let i = 1; i < pts.length; i += 2) minY = Math.min(minY, pts[i]);
      return chain;
    },
    rect: (_x: number, y: number) => {
      calls++;
      minY = Math.min(minY, y);
      return chain;
    },
  };
  return { gfx: chain as unknown as Graphics, minY: () => minY, calls: () => calls };
}

describe("depth pass 3 (bead bxh)", () => {
  it("keeps the foreground layer below the walking surface so it never covers gameplay", () => {
    const r = recorder();
    const camY = 0;
    const H = 1080;
    drawForegroundLayer(r.gfx, 500, camY, 1920, H, 0x05080c);
    expect(r.calls()).toBeGreaterThan(0);
    // The ground's walking surface is at world y 400; nothing may be drawn above it.
    expect(r.minY()).toBeGreaterThanOrEqual(400 - camY);
  });

  it("draws no foreground when the ground sits at the bottom of the screen", () => {
    const r = recorder();
    drawForegroundLayer(r.gfx, 500, 0, 1920, 405, 0x05080c);
    expect(r.calls()).toBe(0);
  });

  it("is sparse and deterministic for a given camera", () => {
    const a = recorder();
    const b = recorder();
    drawForegroundLayer(a.gfx, 1234, 0, 1920, 600, 0x05080c);
    drawForegroundLayer(b.gfx, 1234, 0, 1920, 600, 0x05080c);
    expect(a.calls()).toBe(b.calls());
  });

  it("hazes far ridges more than near ones, and spooky most", () => {
    for (const name of [undefined, "spooky", "daytime", "christmas", "neon"]) {
      const f = depthFog(name);
      expect(f.far).toBeGreaterThan(f.near);
    }
    expect(depthFog("spooky").far).toBeGreaterThan(depthFog(undefined).far);
  });
});
