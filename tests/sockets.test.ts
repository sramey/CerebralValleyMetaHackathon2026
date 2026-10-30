// ADR 0061 / bead evy: gear sits on the DRAWN body of any character, not the hitbox.
import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";
import { socketFor, visualBox, visualHeight } from "../src/sim/sockets";
import type { Entity } from "../src/contract";

function setup() {
  const w = new World(7);
  const player = w.spawn({ type: "player", x: 100, y: 300, w: 26, h: 34, solid: true, gravityScale: 0 }, "player");
  return { w, player };
}
const gear = (w: World, type: string, data: Record<string, string | number | boolean> = {}, size = 18): Entity =>
  w.spawn({ type, x: 0, y: 0, w: size, h: size, solid: false, gravityScale: 0, data }, "gear");
const centreY = (e: Entity): number => e.y + e.h / 2;

describe("gear sockets on the drawn body", () => {
  it("a gun sits at hand height of the drawn player, both facings", () => {
    const { w, player } = setup();
    const gun = gear(w, "gun");
    for (const facing of [1, -1] as const) {
      player.facing = facing;
      w.step();
      const b = visualBox(player);
      expect(centreY(gun)).toBeCloseTo(b.bottom - b.h * 0.55, 0);
      expect(gun.facing).toBe(facing);
      const frontEdge = facing > 0 ? gun.x + gun.w : gun.x;
      expect(facing > 0 ? frontEdge > player.x + player.w : frontEdge < player.x).toBe(true);
    }
  });

  it("a gun with offsetY 40 still sits in the hands", () => {
    const { w, player } = setup();
    const gun = gear(w, "gun", { offsetY: 40, offsetX: -30 });
    w.step();
    const b = visualBox(player);
    expect(Math.abs(centreY(gun) - (b.bottom - b.h * 0.55))).toBeLessThanOrEqual(b.h * 0.12 + 0.01);
    expect(centreY(gun)).toBeLessThan(b.bottom - b.h * 0.3);
  });

  it("a hat on a dragon sits on the dragon's drawn head, flipping with it", () => {
    const { w } = setup();
    const dragon = w.spawn({ type: "dragon", x: 400, y: 200, w: 80, h: 60, solid: false, gravityScale: 0 }, "dragon");
    const hat = gear(w, "hat", { attachedTo: dragon.id }, 20);
    for (const f of [1, -1] as const) {
      dragon.facing = f;
      w.step();
      const b = visualBox(dragon);
      expect(hat.y + hat.h).toBeGreaterThan(b.y);
      expect(hat.y + hat.h).toBeLessThanOrEqual(b.y + 6);
      expect(Math.sign(hat.x + hat.w / 2 - (dragon.x + dragon.w / 2))).toBe(f); // head is ahead of the body centre
      expect(hat.facing).toBe(f);
    }
    const byType = gear(w, "crown", { attachedTo: "dragon" }, 20);
    w.step();
    expect(byType.y + byType.h).toBeLessThanOrEqual(visualBox(dragon).y + 6);
  });

  it("after 'make me huge' (h x3) the gun follows the new hands", () => {
    const { w, player } = setup();
    const gun = gear(w, "gun");
    w.step();
    const before = visualBox(player).bottom - centreY(gun);
    player.h *= 3;
    player.y -= 34 * 2;
    w.step();
    const b = visualBox(player);
    expect(visualHeight(player)).toBeCloseTo(168, 5);
    expect(centreY(gun)).toBeCloseTo(b.bottom - b.h * 0.55, 0);
    expect(b.bottom - centreY(gun)).toBeGreaterThan(before * 2.5);
  });

  it("jetpack sits behind the back, boots at the feet, unknown socket names are ignored", () => {
    const { w, player } = setup();
    player.facing = 1;
    const jet = gear(w, "jetpack");
    const boots = gear(w, "boots", { equipped: true });
    w.step();
    expect(jet.x + jet.w / 2).toBeLessThan(player.x + player.w / 2);
    expect(boots.y + boots.h).toBeCloseTo(visualBox(player).bottom, 0);
    expect(socketFor({ type: "gun", data: { socket: "toes" } })).toBe("hand");
    expect(socketFor({ type: "gun", data: { socket: "back" } })).toBe("back");
    expect(socketFor({ type: "wings", data: {} })).toBe("back");
    expect(socketFor({ type: "halo", data: {} })).toBe("head");
  });

  it("a pickup still in the level is not mounted", () => {
    const { w } = setup();
    const gun = gear(w, "gun", { pickup: true });
    gun.x = 700; gun.y = 100;
    w.step();
    expect(gun.x).toBe(700);
  });
});

describe("gear follow-ups (bead mz1)", () => {
  it("gear scales with its wearer after 'make me huge' and back again", () => {
    const { w, player } = setup();
    const gun = gear(w, "gun", {}, 16);
    w.step();
    expect(gun.w).toBeCloseTo(16, 5);
    player.h *= 3;
    player.y -= 68;
    w.step();
    expect(gun.w).toBeCloseTo(48, 5);
    expect(gun.h).toBeCloseTo(48, 5);
    player.h /= 3;
    w.step();
    expect(gun.w).toBeCloseTo(16, 5);
  });

  it("a size the item was given by someone else becomes the new base", () => {
    const { w } = setup();
    const gun = gear(w, "gun", {}, 16);
    w.step();
    gun.w = 30; gun.h = 30;
    w.step();
    expect(gun.w).toBeCloseTo(30, 5);
  });

  it("a hat sits over a creature's head, toward the front, mirrored by facing", () => {
    const { w } = setup();
    const dragon = w.spawn({ type: "dragon", x: 400, y: 200, w: 80, h: 60, solid: false, gravityScale: 0 }, "dragon");
    const hat = gear(w, "hat", { attachedTo: dragon.id }, 20);
    const mid = dragon.x + dragon.w / 2;
    dragon.facing = 1; w.step();
    expect(hat.x + hat.w / 2).toBeGreaterThan(mid + 10);
    dragon.facing = -1; w.step();
    expect(hat.x + hat.w / 2).toBeLessThan(mid - 10);
  });

  it("a hat on a player stays centred", () => {
    const { w, player } = setup();
    const hat = gear(w, "hat", {}, 20);
    w.step();
    expect(hat.x + hat.w / 2).toBeCloseTo(player.x + player.w / 2, 5);
  });

  it("a creature without art is measured at its hitbox, so its hat does not float", () => {
    const { w } = setup();
    w.hasArt = () => false;
    const blob = w.spawn({ type: "blob", x: 400, y: 200, w: 40, h: 40, solid: false, gravityScale: 0 }, "blob");
    const hat = gear(w, "hat", { attachedTo: blob.id }, 16);
    w.step();
    expect(visualHeight(blob, false)).toBe(40);
    expect(hat.y + hat.h).toBeLessThanOrEqual(blob.y + 6);
    expect(hat.y + hat.h).toBeGreaterThan(blob.y);
    w.hasArt = () => true;
    w.step();
    expect(hat.y + hat.h).toBeLessThanOrEqual(visualBox(blob).y + 6); // 60 px drawn: higher
    expect(hat.y).toBeLessThan(blob.y - 15);
  });
});
