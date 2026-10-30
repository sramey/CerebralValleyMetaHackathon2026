// Pets and companions (bead 49d / ADR 0070). Playtest 2026-10-30: a tester asked for "a T-Rex
// pet that stomps zombies"; it sank into the ground, spun left-right while standing on a ledge
// and hurt its owner. Three rules are the engine's now, not the mod's or the prompt's:
//   - a companion never damages the player or an ally (friendly-fire guard),
//   - a body can never be pushed out of the BOTTOM of a solid it is standing in (sink guard),
//   - facing flips are rate-limited and a creature with a drop on both sides holds still
//     (no per-frame spinning).
// The fixture below is the shape the generated pet mod had, trimmed to the lines that broke.
import { describe, expect, it } from "vitest";
import type { ModDefinition } from "../src/contract";
import { isDamageableTarget, isPet } from "../src/sim/combat";
import { ModLoader } from "../src/sim/loader";
import { World } from "../src/sim/world";
import type { Entity } from "../src/contract";

/** Trimmed from the generated pet mod: a big 150x130 companion with casual + "Pet" interaction. */
const BIG_PET: ModDefinition = {
  id: "big-pet",
  title: "Big Pet",
  setup(api) {
    const p = api.player();
    const pet = api.spawn({
      type: "trex", x: p ? p.x - 300 : 60, y: 400 - 130, w: 150, h: 130, vx: 45, gravityScale: 1,
      data: { casual: true, interact: "Pet", name: "Big Pet", dir: 1 },
    });
    api.onTick(() => {
      const d = pet.data;
      if (pet.y > 500) return;
      pet.vx = (Number(d.dir) || 1) * 45;
      pet.facing = pet.vx > 0 ? 1 : -1;
      if (pet.x < -300) d.dir = 1;
      if (pet.x > 900) d.dir = -1;
    });
  },
  dispose(api) {
    for (const e of api.byType("trex")) api.despawn(e.id);
  },
};

function grounded(): World {
  const w = new World(31);
  w.spawn({ type: "ground", x: -3200, y: 400, w: 6400, h: 48, solid: true, gravityScale: 0 }, "ground");
  return w;
}

function player(w: World, x = 120, y = 360) {
  return w.spawn({ type: "player", x, y, w: 26, h: 34, gravityScale: 1 }, "player");
}

describe("pets never hurt the player or allies", () => {
  it("a companion whose mod also flagged it hostile still cannot hurt its owner", () => {
    const w = grounded();
    const p = player(w, 300, 360);
    // The bug's shape: a pet that fights zombies tagged hostile (so the mod thought it was a fighter).
    const pet = w.spawn({ type: "trex", x: 300, y: 366, w: 60, h: 34, gravityScale: 1, data: { hostile: true, pet: true, damage: 40 } }, "trex-mod");
    for (let i = 0; i < 30; i++) { pet.x = p.x; pet.y = p.y; w.step(); }
    expect(p.health).toBe(100);
    expect(isPet(pet)).toBe(true);
  });

  it("a companion marked only by data.interact = 'Pet' (how the generated mod did it) is a pet too", () => {
    const w = grounded();
    const p = player(w, 300, 360);
    const pet = w.spawn({ type: "trex", x: 300, y: 366, w: 60, h: 34, gravityScale: 1, data: { interact: "Pet", damage: 40 } }, "trex-mod");
    for (let i = 0; i < 60; i++) { pet.x = p.x; pet.y = p.y; w.step(); }
    expect(p.health).toBe(100);
  });

  it("still lets a real hostile hurt the player (the guard is about friends only)", () => {
    const w = grounded();
    const p = player(w, 300, 360);
    const zombie = w.spawn({ type: "zombie", x: 300, y: 366, w: 28, h: 34, gravityScale: 1, data: { hostile: true } }, "waves");
    w.step();
    expect(zombie.health).toBe(100);
    expect(p.health).toBeLessThan(100);
  });

  it("an ally's shot hits hostiles, never the player or another friend", () => {
    const w = grounded();
    const p = player(w, 120, 360);
    const friend = w.spawn({ type: "knight", x: 200, y: 360, w: 30, h: 34, gravityScale: 1, data: { hero: true } }, "hero");
    const zombie = w.spawn({ type: "zombie", x: 400, y: 366, w: 28, h: 34, gravityScale: 1, data: { hostile: true } }, "waves");
    const shot = w.spawn({ type: "bolt", x: 100, y: 370, w: 10, h: 6, vx: 500, gravityScale: 0, data: { damage: 10 } }, "pet-turret");
    for (let i = 0; i < 45; i++) w.step();
    expect(p.health).toBe(100);
    expect(friend.health).toBe(100);
    expect(zombie.health).toBeLessThan(100);
    expect(w.entities.some((e) => e.id === shot.id)).toBe(false);
  });

  it("a pet is not a valid target for an ally's own shot either", () => {
    const bolt: Entity = {
      id: 1, type: "bolt", x: 0, y: 0, w: 8, h: 6, vx: 0, vy: 0, color: 0,
      solid: false, gravityScale: 0, facing: 1, onGround: false, health: 1, owner: "turret", data: {},
    };
    const pet: Entity = {
      id: 2, type: "trex", x: 0, y: 0, w: 60, h: 60, vx: 0, vy: 0, color: 0,
      solid: false, gravityScale: 1, facing: 1, onGround: true, health: 100, owner: "pet-mod", data: { pet: true },
    };
    expect(isDamageableTarget(pet, bolt)).toBe(false);
  });
});

describe("pets never sink through solids", () => {
  it("a body rising out of the floor is set on top of it, not shoved out of its underside", () => {
    const w = grounded();
    // A big pet that spawned/hopped into the slab: feet 110 px inside the ground, rising.
    const pet = w.spawn({ type: "trex", x: 40, y: 380, w: 150, h: 130, vy: -260, gravityScale: 1, data: { casual: true, interact: "Pet" } }, "pet-mod");
    w.step();
    expect(pet.y + pet.h).toBeCloseTo(400, 0); // standing on the floor
    expect(pet.onGround).toBe(true);
    for (let i = 0; i < 120; i++) w.step();
    expect(pet.y + pet.h).toBeCloseTo(400, 0); // and it stays there
  });

  it("the generated pet shape stays on the ground for a full walk", () => {
    const w = grounded();
    player(w);
    new ModLoader(w).load(BIG_PET);
    const pet = w.entities.find((e) => e.type === "trex")!;
    let lowest = -Infinity;
    for (let i = 0; i < 600; i++) { w.step(); lowest = Math.max(lowest, pet.y + pet.h); }
    expect(lowest).toBeCloseTo(400, 0);
  });

  it("a pet landed on from above is not a stomp and does not lose health", () => {
    const w = grounded();
    const pet = w.spawn({ type: "trex", x: 200, y: 270, w: 150, h: 130, gravityScale: 1, data: { casual: true, interact: "Pet" } }, "pet-mod");
    const p = w.spawn({ type: "player", x: 260, y: 230, w: 26, h: 34, vy: 500, gravityScale: 1 }, "player");
    for (let i = 0; i < 10; i++) w.step();
    expect(w.entities).toContain(pet);
    expect(pet.health).toBe(100);
    expect(p.vy).toBeGreaterThanOrEqual(0);
  });
});

describe("the prompts teach the same rules the engine enforces", () => {
  it("Wonder is told how to build a pet and that stomping is already the engine's", async () => {
    const { WONDER_SYSTEM } = await import("../server/prompt");
    expect(WONDER_SYSTEM).toContain("PETS & COMPANIONS");
    expect(WONDER_SYSTEM).toContain("data.pet = true");
    expect(WONDER_SYSTEM).toContain("STOMPING");
    expect(WONDER_SYSTEM).toContain("Do not write a stomp check");
    // The pet rule has to say plainly that a companion is never a hostile.
    expect(WONDER_SYSTEM).toMatch(/PETS & COMPANIONS[^\n]*never data\.hostile/i);
  });

  it("the open-weights reviewer can flag a pet that hurts its owner", async () => {
    const { REVIEWER_SYSTEM } = await import("../server/reviewer-prompt");
    expect(REVIEWER_SYSTEM).toContain("PETS:");
    expect(REVIEWER_SYSTEM).toContain("data.pet = true");
  });
});

describe("pets do not spin in place", () => {
  it("a big walker parked on a narrow perch holds still instead of flipping every frame", () => {
    const w = new World(41);
    w.spawn({ type: "ground", x: -600, y: 400, w: 2000, h: 48, solid: true, gravityScale: 0 }, "ground");
    w.spawn({ type: "platform", x: 300, y: 280, w: 60, h: 18, solid: true, gravityScale: 0, data: { oneWay: true } }, "level");
    const pet = w.spawn({ type: "trex", x: 250, y: 150, w: 150, h: 130, vx: 45, gravityScale: 1, data: { casual: true } }, "pet-mod");
    let flips = 0;
    let last = pet.facing;
    for (let i = 0; i < 240; i++) {
      pet.vx = 45; // the mod keeps steering into the drop, as the generated pet did
      w.step();
      if (pet.facing !== last) { flips++; last = pet.facing; }
    }
    expect(pet.y + pet.h).toBeCloseTo(280, 0); // standing on the perch, not fallen off
    expect(flips).toBeLessThanOrEqual(2); // it used to be one flip per tick
  });

  it("a creature turned at a wall still turns at once (hysteresis must not hide a real turn)", () => {
    const w = new World(43);
    w.spawn({ type: "ground", x: -600, y: 400, w: 2000, h: 48, solid: true, gravityScale: 0 }, "ground");
    w.spawn({ type: "wall", x: 200, y: 200, w: 30, h: 200, solid: true, gravityScale: 0 }, "level");
    const walker = w.spawn({ type: "walker", x: 100, y: 370, w: 30, h: 30, gravityScale: 1 }, "m");
    walker.facing = 1;
    let turnedAt = -1;
    for (let i = 0; i < 120; i++) {
      walker.vx = walker.facing * 80;
      w.step();
      if (turnedAt < 0 && (walker.facing as number) === -1) turnedAt = i;
    }
    expect(turnedAt).toBeGreaterThan(0);
    expect(turnedAt).toBeLessThan(120); // one deliberate turn, not a per-frame flip
  });
});
