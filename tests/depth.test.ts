import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";
import {
  castsContactShadow,
  colorLuminance,
  computeDesiredCamY,
  drawContactShadows,
  drawDistantMountains,
  drawDynamicLighting,
  drawGround25D,
  findSurfaceBelow,
  isDaytimeSky,
  mixColor,
  scaleColor,
} from "../src/client/depth";
import { drawCliff } from "../src/client/shapes";
import type { Graphics } from "pixi.js";

function mockGraphics(): { gfx: Graphics; ellipses: number; rects: number; polys: number } {
  const state = { ellipses: 0, rects: 0, polys: 0 };
  const chain = {
    fill() { return chain; },
    stroke() { return chain; },
    moveTo() { return chain; },
    lineTo() { return chain; },
    ellipse() { state.ellipses++; return chain; },
    rect() { state.rects++; return chain; },
    roundRect() { state.rects++; return chain; },
    poly() { state.polys++; return chain; },
    circle() { return chain; },
  };
  return { gfx: chain as unknown as Graphics, get ellipses() { return state.ellipses; }, get rects() { return state.rects; }, get polys() { return state.polys; } };
}

describe("2.5D visual depth & lighting (bead 1z7)", () => {
  it("raycasts to the nearest solid surface below grounded and airborne entities", () => {
    const world = new World(1337);
    const ground = world.spawn({ type: "ground", x: -400, y: 400, w: 2000, h: 48, solid: true, gravityScale: 0 }, "ground");
    const plat = world.spawn({ type: "platform", x: 300, y: 280, w: 150, h: 20, solid: true, gravityScale: 0 }, "ground");
    // Tall cliff overhang should be ignored as a floor shadow receiver when below its top
    world.spawn({ type: "platform", x: 300, y: -600, w: 200, h: 900, solid: true, gravityScale: 0 }, "ground");

    const groundedPlayer = world.spawn({ type: "player", x: 100, y: 366, w: 26, h: 34, gravityScale: 1 }, "player");
    const hitGround = findSurfaceBelow(world.entities, groundedPlayer, 220);
    expect(hitGround).not.toBeNull();
    expect(hitGround?.surface.id).toBe(ground.id);
    expect(hitGround?.height).toBe(0);
    expect(hitGround?.factor).toBeCloseTo(1, 5);

    const jumpingAbovePlatform = world.spawn({ type: "enemy", x: 350, y: 195, w: 28, h: 28, gravityScale: 1 }, "enemies");
    const hitPlat = findSurfaceBelow(world.entities, jumpingAbovePlatform, 220);
    expect(hitPlat).not.toBeNull();
    expect(hitPlat?.surface.id).toBe(plat.id);
    expect(hitPlat?.height).toBe(57);
    expect(hitPlat!.factor).toBeGreaterThan(0.7);
    expect(hitPlat!.factor).toBeLessThan(0.8);

    const tooHigh = world.spawn({ type: "bird", x: 100, y: 50, w: 24, h: 24, gravityScale: 0 }, "birds");
    expect(findSurfaceBelow(world.entities, tooHigh, 220)).toBeNull();
  });

  it("filters terrain, effects, and parallax layers out of contact shadow casting", () => {
    const world = new World(1337);
    const p = world.spawn({ type: "player", x: 100, y: 366, w: 26, h: 34 }, "player");
    const g = world.spawn({ type: "ground", x: 0, y: 400, w: 800, h: 48, solid: true }, "ground");
    const rain = world.spawn({ type: "raindrop", x: 120, y: 200, w: 3, h: 14 }, "rain");
    const bg = world.spawn({ type: "mountain", x: 0, y: 100, w: 300, h: 200, data: { parallax: 0.25 } }, "bg");

    const isEff = (t: string) => t.includes("rain");
    expect(castsContactShadow(p, isEff)).toBe(true);
    expect(castsContactShadow(g, isEff)).toBe(false);
    expect(castsContactShadow(rain, isEff)).toBe(false);
    expect(castsContactShadow(bg, isEff)).toBe(false);

    const m = mockGraphics();
    const drawn = drawContactShadows(m.gfx, world.entities, 0, 0, 1920, 1080, isEff);
    expect(drawn).toBe(1);
    expect(m.ellipses).toBe(2); // outer penumbra + inner contact AO core
  });

  it("draws 2.5D volume for both main ground and floating platforms and emits dynamic point lights + surface bounce", () => {
    const world = new World(1337);
    const g = world.spawn({ type: "ground", x: -400, y: 400, w: 1600, h: 48, color: 0x3f9e4d, solid: true, gravityScale: 0 }, "ground");
    const pl = world.spawn({ type: "platform", x: 400, y: 300, w: 150, h: 20, color: 0x8a6b46, solid: true, gravityScale: 0 }, "ground");
    world.spawn({ type: "player", x: 120, y: 366, w: 26, h: 34 }, "player");
    world.spawn({ type: "coin", x: 300, y: 340, w: 16, h: 16, color: 0xffd94d }, "coins");
    world.spawn({ type: "fire-arrow", x: 420, y: 270, w: 12, h: 6, color: 0xff6a00 }, "fire");

    const m = mockGraphics();
    const pal = { grass: 0x3fd06a, soil: 0x1d3320, ridgeFar: 0x0a1418, ridgeNear: 0x0d1b20, moon: 0xf2ead0, star: 0x33404f };
    drawDistantMountains(m.gfx, 0, 0, 1920, 1080, pal, 0x0d2229);
    drawGround25D(m.gfx, g, g.x, g.y, pal, 1920, 1080);
    drawGround25D(m.gfx, pl, pl.x, pl.y, pal, 1920, 1080);
    expect(m.rects).toBeGreaterThan(20);
    expect(m.polys).toBe(8); // 3 volumetric sky shafts + 1 distant mountain ridge + 2 top faces (outline + face) on each of the ground and the platform

    const puffs: { x: number; y: number; r: number; color: number; alpha: number; add?: boolean }[] = [];
    drawDynamicLighting(
      m.gfx,
      (x, y, r, color, alpha, add) => puffs.push({ x, y, r, color, alpha, add }),
      world,
      0,
      0,
      1920,
      1080,
      1.5,
      null,
      pal.moon,
    );
    // Celestial bloom (2) + player presence & ground bounce (2) + coin halo & bounce (2) + fire-arrow halo & bounce (2)
    expect(puffs.length).toBeGreaterThanOrEqual(8);
    expect(puffs.every((p) => p.add === true && p.alpha > 0 && p.alpha < 0.35)).toBe(true);
  });

  it("computes color helpers and daytime detection accurately", () => {
    expect(mixColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(scaleColor(0x4080ff, 0.5)).toBe(0x204080);
    expect(colorLuminance(0xffffff)).toBeCloseTo(1, 3);
    expect(colorLuminance(0x000000)).toBeCloseTo(0, 3);
    expect(isDaytimeSky(null, [], 0x05070a)).toBe(false);
    expect(isDaytimeSky(null, [], 0x2f80ed)).toBe(true);
  });

  it("keeps ground visible on normal jumps/platforms and draws cliff masonry past y=760 (bead 98v)", () => {
    const H = 1080;
    const camGround = computeDesiredCamY({ y: 366, h: 34 }, H);
    const camPlat1 = computeDesiredCamY({ y: 266, h: 34 }, H);
    const camPlat2 = computeDesiredCamY({ y: 186, h: 34 }, H);
    // Ground (y=400) stays anchored at the exact same screen Y during normal platforming
    expect(camPlat1).toBeCloseTo(camGround, 5);
    expect(camPlat2).toBeCloseTo(camGround, 5);
    expect(400 - camPlat2).toBeLessThan(H - 80); // Ground top is well above bottom of screen

    // Climbing high above topDeadzone pans the camera upward
    const camSky = computeDesiredCamY({ y: -400, h: 34 }, H);
    expect(camSky).toBeLessThan(camGround);

    // drawCliff draws brick rows all the way down past ry > 760 when bottom is at 860
    const world = new World(1337);
    const cliff = world.spawn({ type: "platform", x: 950, y: -600, w: 200, h: 900, solid: true, gravityScale: 0 }, "ground");
    const rectYs: number[] = [];
    const chain = {
      fill() { return chain; },
      stroke() { return chain; },
      moveTo() { return chain; },
      lineTo() { return chain; },
      poly() { return chain; },
      rect(_x: number, ry: number, _w: number, rh: number) {
        if (rh <= 30 && rh >= 15) rectYs.push(ry);
        return chain;
      },
    };
    drawCliff(chain as unknown as Graphics, cliff, 500, -40); // bottom = 860 (> 760)
    expect(Math.max(...rectYs)).toBeGreaterThan(760);
  });
});
