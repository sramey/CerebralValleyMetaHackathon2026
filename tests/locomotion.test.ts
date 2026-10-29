import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";

const ground = (w: World) => w.spawn({ type: "ground", x: -500, y: 400, w: 3000, h: 48, solid: true, gravityScale: 0 }, "t");

describe("one-way platforms", () => {
  it("a tall walker passes a low floating platform instead of wedging under or onto it", () => {
    const w = new World(1);
    ground(w);
    w.spawn({ type: "platform", x: 100, y: 300, w: 150, h: 20, solid: true, gravityScale: 0, data: { oneWay: true } }, "t");
    const e = w.spawn({ type: "dragon", x: 0, y: 300, w: 40, h: 100, gravityScale: 1 }, "t");
    for (let i = 0; i < 240; i++) { e.vx = 100; w.step(); }
    expect(e.x).toBeGreaterThan(300);
    expect(e.y + e.h).toBeCloseTo(400, 0);
  });

  it("still lands on a one-way platform when falling from above, and can jump up through it", () => {
    const w = new World(1);
    ground(w);
    w.spawn({ type: "platform", x: 0, y: 300, w: 150, h: 20, solid: true, gravityScale: 0, data: { oneWay: true } }, "t");
    const e = w.spawn({ type: "ball", x: 50, y: 200, w: 20, h: 20, gravityScale: 1 }, "t");
    for (let i = 0; i < 120; i++) w.step();
    expect(e.y + e.h).toBeCloseTo(300, 0);
    e.vy = -700; // jump from the platform's top: goes through it only if it was resting on it, so hop from below instead
    const f = w.spawn({ type: "ball", x: 80, y: 380, w: 20, h: 20, gravityScale: 1 }, "t");
    f.vy = -600;
    for (let i = 0; i < 20; i++) w.step();
    expect(f.y).toBeLessThan(300); // passed up through the platform
  });
});

describe("stuck recovery", () => {
  it("a walker pushing into a tall wall turns around instead of grinding forever", () => {
    const w = new World(1);
    ground(w);
    w.spawn({ type: "wall", x: 200, y: 200, w: 30, h: 200, solid: true, gravityScale: 0 }, "t");
    const e = w.spawn({ type: "walker", x: 100, y: 370, w: 30, h: 30, gravityScale: 1 }, "t");
    e.facing = 1;
    for (let i = 0; i < 120; i++) { e.vx = e.facing * 80; w.step(); }
    expect(e.facing).toBe(-1);
  });

  it("hops a low obstacle it would otherwise be pinned against", () => {
    const w = new World(1);
    ground(w);
    w.spawn({ type: "rock", x: 200, y: 370, w: 30, h: 30, solid: true, gravityScale: 0 }, "t");
    const e = w.spawn({ type: "walker", x: 100, y: 370, w: 30, h: 30, gravityScale: 1 }, "t");
    e.facing = 1;
    for (let i = 0; i < 120; i++) { e.vx = e.facing * 80; w.step(); }
    expect(e.x).toBeGreaterThan(230);
  });
});

describe("casual creatures", () => {
  it("hop over the player instead of walking through them", () => {
    const w = new World(1);
    ground(w);
    w.spawn({ type: "player", x: 300, y: 360, w: 24, h: 40, gravityScale: 1 }, "t");
    const c = w.spawn({ type: "chicken", x: 200, y: 374, w: 26, h: 26, gravityScale: 1, data: { casual: true } }, "t");
    let peakAir = 0;
    for (let i = 0; i < 90; i++) { c.vx = 90; w.step(); peakAir = Math.max(peakAir, 400 - (c.y + c.h)); }
    expect(peakAir).toBeGreaterThan(15);
  });

  it("non-casual creatures do not hop", () => {
    const w = new World(1);
    ground(w);
    w.spawn({ type: "player", x: 300, y: 360, w: 24, h: 40, gravityScale: 1 }, "t");
    const c = w.spawn({ type: "enemy", x: 200, y: 374, w: 26, h: 26, gravityScale: 1 }, "t");
    let peakAir = 0;
    for (let i = 0; i < 90; i++) { c.vx = 90; w.step(); peakAir = Math.max(peakAir, 400 - (c.y + c.h)); }
    expect(peakAir).toBeLessThan(2);
  });
});
