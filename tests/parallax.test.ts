import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";
import { ModLoader } from "../src/sim/loader";
import { parallaxMod } from "../src/mods/parallax";
import {
  drawFluffyCloud,
  drawParallaxEntities,
  isParallaxOrSkyEntity,
  parallaxFactorOf,
  wrapParallaxX,
} from "../src/client/parallax";
import { compileMod } from "../server/compile";
import { verifyMod } from "../server/verify";
import type { Graphics } from "pixi.js";

function mockGraphics(): { gfx: Graphics; ellipses: number; polys: number; rects: number } {
  const state = { ellipses: 0, polys: 0, rects: 0 };
  const chain = {
    fill() { return chain; },
    stroke() { return chain; },
    moveTo() { return chain; },
    lineTo() { return chain; },
    ellipse() { state.ellipses++; return chain; },
    poly() { state.polys++; return chain; },
    rect() { state.rects++; return chain; },
  };
  return {
    gfx: chain as unknown as Graphics,
    get ellipses() { return state.ellipses; },
    get polys() { return state.polys; },
    get rects() { return state.rects; },
  };
}

describe("parallax background system (bead rm1)", () => {
  it("loads, steps, verifies, and disposes cleanly with zero leftover entities", async () => {
    const world = new World(1337);
    const loader = new ModLoader(world);
    loader.load(parallaxMod);
    expect(world.entities.length).toBeGreaterThanOrEqual(15);
    for (let i = 0; i < 60; i++) world.step();
    loader.unload("parallax");
    expect(world.entities.length).toBe(0);

    const src = readFileSync("src/mods/parallax.ts", "utf8");
    const compiled = compileMod(src);
    expect(compiled.ok).toBe(true);
    const verified = await verifyMod(src, compiled.js);
    expect(verified.ok, verified.errors.join("; ")).toBe(true);
  });

  it("computes fractional camera scroll factors from data fields and semantic types", () => {
    const world = new World(1337);
    const far = world.spawn({ type: "parallax-mountain", x: 0, y: 100, w: 400, h: 200, data: { parallax: 0.14 } }, "p");
    const scroll = world.spawn({ type: "layer", x: 0, y: 100, w: 400, h: 200, data: { scrollFactor: 0.42 } }, "p");
    const cloud = world.spawn({ type: "cloud", x: 0, y: -260, w: 120, h: 44 }, "c");
    const sky = world.spawn({ type: "day-sky", x: -400, y: -260, w: 1800, h: 300 }, "s");
    const player = world.spawn({ type: "player", x: 100, y: 366, w: 26, h: 34 }, "player");
    const ground = world.spawn({ type: "ground", x: 0, y: 400, w: 1000, h: 48, solid: true }, "ground");

    expect(parallaxFactorOf(far)).toBeCloseTo(0.14, 5);
    expect(parallaxFactorOf(scroll)).toBeCloseTo(0.42, 5);
    expect(parallaxFactorOf(cloud)).toBeCloseTo(0.18, 5);
    expect(parallaxFactorOf(player)).toBeNull();
    expect(parallaxFactorOf(ground)).toBeNull();

    expect(isParallaxOrSkyEntity(far)).toBe(true);
    expect(isParallaxOrSkyEntity(cloud)).toBe(true);
    expect(isParallaxOrSkyEntity(sky)).toBe(true);
    expect(isParallaxOrSkyEntity(player)).toBe(false);
    expect(isParallaxOrSkyEntity(ground)).toBe(false);
  });

  it("wraps parallax coordinates seamlessly across positive and negative camera positions", () => {
    const span = 1920;
    const w = 320;
    for (const camX of [-8400, -1250, 0, 940, 14500]) {
      const sx = wrapParallaxX(200, camX, 0.35, span, w);
      expect(sx).toBeGreaterThanOrEqual(-w);
      expect(sx).toBeLessThan(span - w);
    }
  });

  it("renders multi-layer mountains, hills, forest treelines, and fluffy clouds", () => {
    const world = new World(1337);
    const loader = new ModLoader(world);
    loader.load(parallaxMod);
    // Also spawn a day-sky box to ensure it is skipped in the entity pass
    world.spawn({ type: "day-sky", x: -400, y: -260, w: 1800, h: 300, color: 0x87ceeb }, "day");

    const m = mockGraphics();
    const pal = { grass: 0x3fd06a, soil: 0x1d3320, ridgeFar: 0x0a1418, ridgeNear: 0x0d1b20, moon: 0xf2ead0, star: 0x33404f };
    const count = drawParallaxEntities(m.gfx, world.entities, 650, -550, 1920, 1080, pal, 0x0d2229);
    expect(count).toBeGreaterThanOrEqual(15);
    expect(m.polys).toBeGreaterThan(20);
    expect(m.ellipses).toBeGreaterThan(20);

    const cloudGfx = mockGraphics();
    drawFluffyCloud(cloudGfx.gfx, 100, 80, 140, 48, 0xffffff, 0xffe042, 0x9be2ff, 3);
    expect(cloudGfx.ellipses).toBeGreaterThanOrEqual(9);
    expect(cloudGfx.rects).toBe(0); // Fluffy clouds never draw rectangular boxes
  });
});
