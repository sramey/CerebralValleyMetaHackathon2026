// Stomping (bead 49d / ADR 0070). Landing on a hostile's head finishes it and bounces the
// player. Playtest 2026-10-30: a hand-drawn level's enemies could not be jumped on at all, and
// a T-Rex pet "stomping" zombies only worked because its mod hand-rolled the check. The rule is
// the engine's now, so every hostile answers to the same landing.
import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";
import { STOMP, stompableBy } from "../src/sim/stomp";

function world(): World {
  const w = new World(21);
  w.spawn({ type: "ground", x: -600, y: 400, w: 2000, h: 48, solid: true, gravityScale: 0 }, "ground");
  return w;
}

function playerAt(w: World, x: number, y: number, vy = 0) {
  return w.spawn({ type: "player", x, y, w: 26, h: 34, vy, gravityScale: 1 }, "player");
}

describe("stomp", () => {
  it("a falling player kills a hostile, bounces and takes no damage from it", () => {
    const w = world();
    const pet = w.spawn({ type: "zombie", x: 300, y: 372, w: 28, h: 28, gravityScale: 1, data: { hostile: true } }, "waves");
    const p = playerAt(w, 300, pet.y - 30, 400);
    w.step();
    expect(w.entities.some((e) => e.id === pet.id)).toBe(false); // 100 hp hostile: one landing finishes it
    expect(p.vy).toBe(-STOMP.bounce);
    expect(p.health).toBe(100); // the head you land on is not also a body check
    expect(p.data.stomps).toBe(1);
  });

  it("walking into a hostile is not a stomp: it hurts instead", () => {
    const w = world();
    const zombie = w.spawn({ type: "zombie", x: 300, y: 366, w: 28, h: 34, gravityScale: 1, data: { hostile: true } }, "waves");
    const p = playerAt(w, 300, 366); // standing in it, vy = 0
    w.step();
    expect(w.entities).toContain(zombie);
    expect(p.health).toBeLessThan(100);
  });

  it("rising into a hostile from below is not a stomp", () => {
    const w = world();
    const bat = w.spawn({ type: "bat", x: 300, y: 100, w: 24, h: 18, gravityScale: 0, data: { hostile: true } }, "waves");
    const p = playerAt(w, 300, 130, -300); // head-first into it, feet below its top? no: above
    w.step();
    expect(w.entities).toContain(bat);
    expect(p.vy).toBeLessThan(0);
  });

  it("a boss survives a stomp but the player bounces off it and is not hurt that tick", () => {
    const w = world();
    const boss = w.spawn({ type: "boss", x: 300, y: 340, w: 80, h: 60, health: 500, gravityScale: 1, data: { hostile: true } }, "boss");
    const p = playerAt(w, 320, boss.y - 20, 400);
    w.step();
    expect(w.entities).toContain(boss);
    expect(boss.health).toBe(500 - STOMP.damage);
    expect(p.vy).toBe(-STOMP.bounce);
    expect(p.health).toBe(100);
  });

  it("never touches a pet, an ally, a chicken or scenery", () => {
    const w = world();
    const pets = [
      w.spawn({ type: "trex", x: 200, y: 270, w: 150, h: 130, gravityScale: 1, data: { casual: true, interact: "Pet" } }, "trex-mod"),
      w.spawn({ type: "knight", x: 400, y: 360, w: 30, h: 40, gravityScale: 1, data: { hero: true } }, "hero"),
      w.spawn({ type: "chicken", x: 600, y: 370, w: 26, h: 26, gravityScale: 1, data: { casual: true } }, "chicken"),
    ];
    for (const pet of pets) {
      const p = playerAt(w, pet.x + 2, pet.y - 20, 400);
      let lowest = 0;
      for (let i = 0; i < 3; i++) { w.step(); lowest = Math.min(lowest, p.vy); }
      expect(w.entities).toContain(pet);
      expect(pet.health).toBe(100);
      expect(lowest).toBeGreaterThanOrEqual(0); // never bounced: a friend is not a platform
      expect(p.data.stomps).toBeUndefined();
      w.despawn(p.id);
    }
  });

  it("lets the hostile tune the bounce and the damage", () => {
    const w = world();
    const brute = w.spawn({
      type: "brute", x: 300, y: 350, w: 60, h: 50, health: 300, gravityScale: 1,
      data: { hostile: true, stompBounce: 520, stompDamage: 120 },
    }, "boss");
    const p = playerAt(w, 320, brute.y - 20, 400);
    w.step();
    expect(brute.health).toBe(300 - 120);
    expect(p.vy).toBe(-520);
  });

  it("works on a hostile that only has a hostile-sounding name (no flags at all)", () => {
    const w = world();
    const walker = w.spawn({ type: "walker", x: 300, y: 372, w: 28, h: 28, gravityScale: 1 }, "classic");
    const p = playerAt(w, 300, walker.y - 30, 400);
    w.step();
    expect(w.entities.some((e) => e.id === walker.id)).toBe(false);
    expect(p.vy).toBe(-STOMP.bounce);
  });

  it("only counts a landing from above, close to the head", () => {    const make = (feetOffset: number, vy: number) => {
      const w = world();
      const e = w.spawn({ type: "goblin", x: 300, y: 340, w: 40, h: 40, gravityScale: 1, data: { hostile: true } }, "m");
      const p = w.spawn({ type: "player", x: 300, y: 340 + feetOffset - 34, w: 26, h: 34, vy, gravityScale: 1 }, "player");
      return stompableBy(p, e);
    };
    expect(make(0, 400)).toBe(false); // feet level with its top: not touching
    expect(make(6, 400)).toBe(true); // just inside the head
    expect(make(30, 400)).toBe(false); // deep in its body: a collision, not a stomp
    expect(make(6, -400)).toBe(false); // rising, not landing
  });
});
