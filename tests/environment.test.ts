import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";
import { Fx } from "../src/client/fx";
import {
  drawSkyAndCelestials,
  drawSunEntity,
  isDaytimeSky,
} from "../src/client/depth";
import {
  drawFluffyCloud,
  isParallaxOrSkyEntity,
  isSkyOrBackgroundEntity,
} from "../src/client/parallax";
import { PRESETS } from "../server/mood";
import { Container, type Graphics } from "pixi.js";

function mockGraphics(): {
  gfx: Graphics;
  circles: { x: number; y: number; r: number; color?: number; alpha?: number }[];
  ellipses: { x: number; y: number; rx: number; ry: number }[];
  rects: { x: number; y: number; w: number; h: number; color?: number }[];
  lines: { x1: number; y1: number; x2: number; y2: number }[];
} {
  const circles: { x: number; y: number; r: number; color?: number; alpha?: number }[] = [];
  const ellipses: { x: number; y: number; rx: number; ry: number }[] = [];
  const rects: { x: number; y: number; w: number; h: number; color?: number }[] = [];
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  let curX = 0, curY = 0;

  const chain = {
    fill(opts?: any) {
      const last = rects[rects.length - 1];
      if (last && opts) last.color = typeof opts === "number" ? opts : opts.color;
      return chain;
    },
    stroke() { return chain; },
    moveTo(x: number, y: number) { curX = x; curY = y; return chain; },
    lineTo(x: number, y: number) {
      lines.push({ x1: curX, y1: curY, x2: x, y2: y });
      curX = x; curY = y;
      return chain;
    },
    ellipse(x: number, y: number, rx: number, ry: number) {
      ellipses.push({ x, y, rx, ry });
      return chain;
    },
    circle(x: number, y: number, r: number) {
      circles.push({ x, y, r });
      return chain;
    },
    rect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h });
      return chain;
    },
    poly() { return chain; },
  };

  return {
    gfx: chain as unknown as Graphics,
    circles,
    ellipses,
    rects,
    lines,
  };
}

describe("environmental awareness & day/night sky (bead 196)", () => {
  it("prevents falling snow and non-solid entities from being pushed underground (y > 400)", () => {
    const world = new World(1337);
    world.spawn({ type: "ground", x: -200, y: 400, w: 1200, h: 48, solid: true, gravityScale: 0 }, "ground");

    // Snowflake spawned inside the ground slab (y = 420)
    const flake1 = world.spawn(
      { type: "snowflake", x: 100, y: 420, w: 4, h: 4, solid: false, gravityScale: 1, vx: 0, vy: 60 },
      "snow",
    );
    // Snowflake spawned right above ground falling fast
    const flake2 = world.spawn(
      { type: "snowflake", x: 140, y: 395, w: 4, h: 4, solid: false, gravityScale: 1, vx: 0, vy: 120 },
      "snow",
    );

    world.step();

    // Both flakes must be clamped to ground top surface y = 400 - h = 396 with onGround = true
    expect(flake1.y).toBe(396);
    expect(flake1.onGround).toBe(true);
    expect(flake1.y + flake1.h).toBeLessThanOrEqual(400);

    expect(flake2.y).toBe(396);
    expect(flake2.onGround).toBe(true);
    expect(flake2.y + flake2.h).toBeLessThanOrEqual(400);
  });

  it("detects daytime sky from presets, luminance, and sun entities", () => {
    const nightSky = 0x05070a;
    const daySky = 0x2f80ed;

    expect(isDaytimeSky(null, [], nightSky)).toBe(false);
    expect(isDaytimeSky(null, [], daySky)).toBe(true);
    expect(isDaytimeSky(PRESETS.daytime, [])).toBe(true);
    expect(isDaytimeSky(PRESETS.sunset, [])).toBe(true);

    const world = new World(1337);
    world.spawn({ type: "sun", x: 600, y: -200, w: 60, h: 60 }, "sky");
    expect(isDaytimeSky(null, world.entities, nightSky)).toBe(true);
  });

  it("draws radiant Sun without crescent cutout during daytime, and Moon + stars at night", () => {
    const pal = { grass: 0x45d66b, soil: 0x7a5230, ridgeFar: 0x4a8c6f, ridgeNear: 0x357a5b, moon: 0xffe042, star: 0xffffff };
    const skyBands = [0x2f80ed, 0x56a0f5, 0x9be2ff];

    // Daytime: radiant Sun (4 concentric glow circles), zero star rects, no crescent shadow cutout
    const dayM = mockGraphics();
    drawSkyAndCelestials(dayM.gfx, 1920, 1080, 0, skyBands.length, skyBands, pal, true, false);
    expect(dayM.circles.length).toBe(4); // 38, 26, 18, 12 glow/disc rings
    expect(dayM.rects.length).toBe(skyBands.length); // sky bands only, NO night stars

    // Nighttime: crescent Moon (3 circles including shadow cutout), plus 14 night stars
    const nightM = mockGraphics();
    const nightBands = [0x05070a, 0x0d1b20, 0x133441];
    drawSkyAndCelestials(nightM.gfx, 1920, 1080, 0, nightBands.length, nightBands, pal, false, false);
    expect(nightM.circles.length).toBe(3); // outer glow + moon disc + crescent cutout
    expect(nightM.rects.length).toBe(nightBands.length + 14); // sky bands + 14 stars

    // When an explicit sun entity exists in the world, fixed top-right celestial body is hidden
    const explicitSunM = mockGraphics();
    drawSkyAndCelestials(explicitSunM.gfx, 1920, 1080, 0, skyBands.length, skyBands, pal, true, true);
    expect(explicitSunM.circles.length).toBe(0); // suppressed
  });

  it("renders sun entities and fluffy clouds procedurally without rectangular black outlines", () => {
    const sunGfx = mockGraphics();
    drawSunEntity(sunGfx.gfx, { id: 1, type: "sun", x: 400, y: 100, w: 48, h: 48 } as any, 400, 100);
    expect(sunGfx.circles.length).toBe(4);
    expect(sunGfx.rects.length).toBe(0); // Zero rectangular outlines

    const cloudGfx = mockGraphics();
    drawFluffyCloud(cloudGfx.gfx, 200, 80, 120, 40, 0xffffff, 0xffe042, 0x9be2ff, 1);
    expect(cloudGfx.ellipses.length).toBeGreaterThanOrEqual(7);
    expect(cloudGfx.rects.length).toBe(0); // Zero rectangular outlines
  });

  it("identifies sky and background entities and filters them out of gameplay rect passes", () => {
    const daySky = { id: 1, type: "day-sky", x: -400, y: -260, w: 1800, h: 300, solid: false } as any;
    const bgBox = { id: 2, type: "background", x: 0, y: 0, w: 1000, h: 500, solid: false } as any;
    const cloud = { id: 3, type: "cloud", x: 100, y: 50, w: 80, h: 30, solid: false } as any;
    const player = { id: 4, type: "player", x: 100, y: 366, w: 26, h: 34, solid: false } as any;

    expect(isSkyOrBackgroundEntity(daySky)).toBe(true);
    expect(isSkyOrBackgroundEntity(bgBox)).toBe(true);
    expect(isSkyOrBackgroundEntity(cloud)).toBe(false);
    expect(isSkyOrBackgroundEntity(player)).toBe(false);

    expect(isParallaxOrSkyEntity(daySky)).toBe(true);
    expect(isParallaxOrSkyEntity(bgBox)).toBe(true);
    expect(isParallaxOrSkyEntity(cloud)).toBe(true);
    expect(isParallaxOrSkyEntity(player)).toBe(false);
  });

  it("renders snow, sparks, and embers in Fx and culls weather entities underground", () => {
    const fx = new Fx(new Container());
    const world = new World(1337);
    world.spawn({ type: "ground", x: -200, y: 400, w: 1200, h: 48, solid: true, gravityScale: 0 }, "ground");

    // Weather above ground
    world.spawn({ type: "snowflake", x: 120, y: 150, w: 4, h: 4, solid: false }, "snow");
    const groundedFlake = world.spawn({ type: "snowflake", x: 200, y: 396, w: 4, h: 4, solid: false }, "snow");
    groundedFlake.onGround = true;
    world.spawn({ type: "spark", x: 300, y: 320, w: 3, h: 3, vx: 50, vy: -20, solid: false }, "spark");
    world.spawn({ type: "firefly", x: 350, y: 280, w: 4, h: 4, solid: false }, "firefly");

    // Weather underground (must be culled)
    world.spawn({ type: "snowflake", x: 120, y: 450, w: 4, h: 4, solid: false }, "snow");
    world.spawn({ type: "raindrop", x: 150, y: 460, w: 2, h: 10, solid: false }, "rain");

    const isEffect = (t: string) => /snow|spark|firefly|rain/.test(t);

    const m = mockGraphics();
    (fx as any).g = m.gfx;
    const activeDrops = (fx as any).entities(world, 1920, 1080, isEffect);

    // Active drops count should count snowflake above ground (150 and 396), but NOT 450 or 460
    expect(activeDrops).toBe(2);

    // Lines drawn: snowflake crystals (2 lines each * 2) + moving spark line (1) = 5
    expect(m.lines.length).toBeGreaterThanOrEqual(4);

    // Flake on ground (y = 396) draws an ellipse accumulation dot
    expect(m.ellipses.length).toBeGreaterThanOrEqual(1);
  });
});

function dayBands(bands: number[]): number[] {
  return [...bands];
}
