import { describe, expect, it } from "vitest";
import { PICKUP_PAD, reachBox, touches } from "../src/sim/reach";
import { World } from "../src/sim/world";
import { ModLoader } from "../src/sim/loader";
import coinsMod from "../src/mods/coins";
import playerMod from "../src/mods/player";
import type { Entity } from "../src/contract";

const player = (): Entity => ({ id: 1, type: "player", x: 100, y: 366, w: 26, h: 34, vx: 0, vy: 0 } as Entity);
const coin = (x: number, y: number): Entity => ({ id: 2, type: "coin", x, y, w: 16, h: 16, vx: 0, vy: 0 } as Entity);

describe("pickup reach (bug cxl)", () => {
  it("covers the 56 px drawn ninja, not just the 34 px box", () => {
    const r = reachBox(player());
    // Drawn head top is 56 px above the feet at y=400 -> y=344. A coin whose bottom edge is there must count.
    expect(r.y).toBeLessThanOrEqual(344);
    expect(r.y + r.h).toBe(400 + PICKUP_PAD);
  });
  it("collects a coin overlapping the head and shoulders, which the physics box misses", () => {
    const p = player();
    const c = coin(105, 336); // spans y 336..352: above the 366 box top, inside the drawn head
    expect(c.y + c.h).toBeLessThan(p.y); // the old 34 px box test misses
    expect(touches(p, c)).toBe(true);
  });
  it("still ignores a coin that is clearly out of reach", () => {
    expect(touches(player(), coin(100, 280))).toBe(false);
    expect(touches(player(), coin(220, 370))).toBe(false);
  });
  it("is generous but only for a few px sideways for non-players", () => {
    const e = { ...player(), type: "enemy" } as Entity;
    expect(touches(e, coin(100 + 26 + 6, 370))).toBe(true);
    expect(touches(e, coin(100 + 26 + 12, 370))).toBe(false);
    expect(reachBox(e).y).toBe(e.y - PICKUP_PAD);
  });
  it("the coins mod collects through the sim, deterministically", () => {
    const run = (): number => {
      const w = new World(7);
      const loader = new ModLoader(w);
      loader.load(playerMod);
      loader.load(coinsMod);
      const p = w.entities.find((e) => e.type === "player")!;
      const c = w.entities.find((e) => e.type === "coin")!;
      p.x = c.x - 10; p.y = c.y + c.h + 6; // coin sits over the head, clear of the 34 px box
      for (let i = 0; i < 3; i++) w.step();
      return w.entities.filter((e) => e.type === "coin").length;
    };
    expect(run()).toBe(5);
    expect(run()).toBe(5);
  });
});
