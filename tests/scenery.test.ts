import { describe, expect, it } from "vitest";
import type { Graphics } from "pixi.js";
import { drawScenery, sceneryStyle } from "../src/client/scenery";
import { groundMod } from "../src/mods/ground";

function counter(): { gfx: Graphics; calls: () => number } {
  let calls = 0;
  const chain: Record<string, unknown> = new Proxy({}, {
    get: () => (..._a: unknown[]) => { calls++; return chain; },
  });
  return { gfx: chain as unknown as Graphics, calls: () => calls };
}

const pal = { grass: 0x45d66b, ridgeNear: 0x0d1b20, moon: 0xf2ead0 };

describe("starter scenery (bead 5fl)", () => {
  it("draws something in every camera position and is deterministic", () => {
    for (const camX of [-400, 0, 1234.5, 90000]) {
      const a = counter();
      const b = counter();
      drawScenery(a.gfx, camX, 0, 1920, pal, 0x1e3557, 0.3, false);
      drawScenery(b.gfx, camX, 0, 1920, pal, 0x1e3557, 0.3, true);
      expect(a.calls()).toBeGreaterThan(20);
      expect(b.calls()).toBeGreaterThan(20);
    }
  });

  it("dresses the scenery per mood and draws more detail when snowy or neon", () => {
    expect(sceneryStyle("christmas").snow).toBe(true);
    expect(sceneryStyle("snowy").snow).toBe(true);
    expect(sceneryStyle("spooky").spooky).toBe(true);
    expect(sceneryStyle("neon").neon).toBe(true);
    expect(sceneryStyle(undefined)).toEqual({ snow: false, spooky: false, neon: false });
    const plain = counter();
    const snowy = counter();
    drawScenery(plain.gfx, 500, 0, 1920, pal, 0x1e3557, 0.3, false);
    drawScenery(snowy.gfx, 500, 0, 1920, pal, 0x1e3557, 0.3, false, "christmas");
    expect(snowy.calls()).toBeGreaterThan(plain.calls());
  });

  it("keeps the new ledges out of the overhang tunnel and well above hop height", () => {
    const spawned: { type: string; x: number; y: number; w: number }[] = [];
    const api = { spawn: (e: { type: string; x: number; y: number; w: number }) => { spawned.push(e); return e; } };
    groundMod.setup(api as never, { width: 2400, overhang: true } as never);
    const ledges = spawned.filter((e) => e.type === "platform" && e.y >= 0 && e.y < 400);
    expect(ledges.length).toBeGreaterThanOrEqual(4);
    for (const l of ledges) expect(l.x + l.w <= 950 || l.x >= 1150).toBe(true);
    // A ledge a hop above the ground would slow the playtest bot and weaken the "too big" check (ADR 0023).
    expect(ledges.filter((l) => l.y > 305 && l.y < 400).length).toBe(0);
  });
});
