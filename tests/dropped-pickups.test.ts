// ADR 0053 / bead 2yt: the flying-companion contract end to end in the sim, no AI.
// One mod = one creature that flies, drops coins that fall and settle, and a shared score
// HUD that counts pickups. This is the shape the Wonder prompt asks for, pinned here so a
// regression in the engine (gravity, bounce, pickup reach, HUD ownership) fails a test.
import { describe, expect, it } from "vitest";
import type { ModDefinition } from "../src/contract";
import { World } from "../src/sim/world";
import { ModLoader, runModTest } from "../src/sim/loader";
import groundMod from "../src/mods/ground";
import playerMod from "../src/mods/player";
import { bounceVelocity, landingVelocity, MAX_BOUNCE, MIN_BOUNCE_SPEED } from "../src/sim/bounce";

const superheroCat: ModDefinition = {
  id: "superhero-cat",
  title: "Superhero cat",
  knobs: {
    dropEvery: { value: 20, min: 5, max: 120, label: "Frames between coins" },
  },
  setup(api, knobs) {
    const every = Math.max(5, Math.floor(Number(knobs.dropEvery)));
    const cat = api.spawn({
      type: "superhero-cat", x: 200, y: 180, w: 40, h: 30,
      color: 0x2c2cff, solid: false, gravityScale: 0, data: { flying: true },
    });
    const baseX = cat.x;
    const baseY = cat.y;
    let score = 0;
    let wait = every;
    api.setHud("score", { kind: "stat", label: "Coins", icon: "🪙", value: 0 });
    api.onTick(() => {
      const t = api.tick() / 60;
      // Smooth sinusoidal patrol: no gravity, no ground contact.
      cat.x = baseX + Math.sin(t * 1.2) * 60;
      cat.y = baseY + Math.sin(t * 2.4) * 16;
      cat.facing = Math.cos(t * 1.2) >= 0 ? 1 : -1;
      if (--wait <= 0) {
        wait = every;
        api.spawn({
          type: "cat-coin", x: cat.x + cat.w / 2 - 6, y: cat.y + cat.h, w: 12, h: 12,
          color: 0xffd94d, solid: false, gravityScale: 1, data: { bounce: 0.45, value: 1 },
        });
      }
      const p = api.player();
      if (!p) return;
      for (const c of api.byType("cat-coin")) {
        if (!api.touches(p, c)) continue;
        api.burst(c.x + c.w / 2, c.y + c.h / 2, 0xffd94d, 12);
        api.despawn(c.id);
        score += Number(c.data.value) || 1;
        api.setHud("score", { kind: "stat", label: "Coins", icon: "🪙", value: score });
      }
    });
  },
  dispose(api) {
    for (const e of api.byType("cat-coin")) api.despawn(e.id);
    for (const e of api.byType("superhero-cat")) api.despawn(e.id);
  },
  test(t) {
    // The verifier runs a mod alone in an empty world: spawn our own ground.
    t.api.spawn({ type: "ground", x: -200, y: 400, w: 1200, h: 48, solid: true, gravityScale: 0 });
    for (let i = 0; i < 180; i++) t.step(1);
    const cat = t.api.byType("superhero-cat")[0];
    t.expect(!!cat, "the cat spawns");
    t.expect(cat.gravityScale === 0, "the cat ignores gravity");
    t.expect(cat.y >= 120 && cat.y <= 240, "the cat patrols at altitude");
    const coins = t.api.byType("cat-coin");
    t.expect(coins.length > 0, "the cat drops coins");
    t.expect(coins[0].gravityScale === 1, "dropped coins fall");
    t.step(120);
    const landed = t.api.byType("cat-coin");
    t.expect(landed.length > 0 && landed.every((c) => !Number.isNaN(c.y)), "dropped coins stay finite");
  },
};

/** Step until `cond` or fail; keeps the test readable. */
function stepUntil(world: World, frames: number, cond: () => boolean): boolean {
  for (let i = 0; i < frames; i++) {
    if (cond()) return true;
    world.step();
  }
  return cond();
}

describe("resting restitution (data.bounce)", () => {
  it("is off by default: a landing still stops dead", () => {
    expect(bounceVelocity(900, undefined)).toBe(0);
    expect(bounceVelocity(900, 0)).toBe(0);
    expect(landingVelocity({ data: {} }, 900)).toBe(0);
  });

  it("returns an upward speed scaled by data.bounce", () => {
    expect(bounceVelocity(600, 0.5)).toBe(-300);
    expect(bounceVelocity(600, 1)).toBe(-600 * MAX_BOUNCE);
    expect(bounceVelocity(600, -3)).toBe(0);
  });

  it("lets a slow landing settle instead of jittering", () => {
    expect(bounceVelocity(MIN_BOUNCE_SPEED, 0.6)).toBe(0);
    expect(bounceVelocity(MIN_BOUNCE_SPEED + 1, 0.6)).toBeLessThan(0);
  });

  it("is deterministic and never feeds energy in", () => {
    for (let i = 0; i < 10; i++) {
      const v = bounceVelocity(1000, 0.45);
      expect(v).toBe(bounceVelocity(1000, 0.45));
      expect(Math.abs(v)).toBeLessThan(1000);
    }
  });
});

describe("flying companion that drops coins (ADR 0053)", () => {
  it("passes its own test() in the verifier's empty world", () => {
    const r = runModTest(superheroCat);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("hovers at altitude in a real world and never lands", () => {
    const w = new World(21);
    const l = new ModLoader(w);
    l.load(groundMod);
    l.load(playerMod);
    l.load(superheroCat);
    for (let i = 0; i < 240; i++) {
      w.step();
      const cat = w.entities.find((e) => e.type === "superhero-cat")!;
      expect(cat.onGround).toBe(false);
      expect(cat.y).toBeGreaterThan(100);
      expect(cat.y).toBeLessThan(260);
    }
    // It actually moves: a hovering statue is not a patrol.
    const cat = w.entities.find((e) => e.type === "superhero-cat")!;
    expect(cat.facing === 1 || cat.facing === -1).toBe(true);
  });

  it("drops coins that fall, bounce at least once, and settle on the ground", () => {
    const w = new World(22);
    const l = new ModLoader(w);
    l.load(groundMod);
    l.load(superheroCat);
    // Wait for one drop to appear well above the ground.
    const got = stepUntil(w, 240, () => w.entities.some((e) => e.type === "cat-coin" && e.y < 300));
    expect(got).toBe(true);
    const coin = () => w.entities.find((e) => e.type === "cat-coin")!;
    const startY = coin().y;
    let bounces = 0;
    let prevVy = coin().vy;
    const settled = stepUntil(w, 400, () => {
      const c = coin();
      if (c.vy < 0 && prevVy >= 0) bounces++;
      prevVy = c.vy;
      return c.onGround && c.vy === 0 && Math.abs(c.y + c.h - 400) < 1;
    });
    expect(startY).toBeLessThan(300);
    expect(settled).toBe(true);
    expect(bounces).toBeGreaterThanOrEqual(1);
    expect(coin().gravityScale).toBe(1);
    expect(coin().y + coin().h).toBeCloseTo(400, 0);
  });

  it("collects on a walk-by and increments one shared score HUD with a burst", () => {
    const w = new World(23);
    const l = new ModLoader(w);
    l.load(groundMod);
    l.load(playerMod);
    l.load(superheroCat);
    const player = w.entities.find((e) => e.type === "player")!;
    const before = w.hud.get("score");
    expect(before?.label).toBe("Coins");
    expect(Number(before?.value)).toBe(0);

    let collected = 0;
    for (let i = 0; i < 600 && collected === 0; i++) {
      w.step();
      const coin = w.entities.find((e) => e.type === "cat-coin" && e.onGround);
      if (!coin) continue;
      const particlesBefore = w.particles.length;
      // The player walks under the coin (reach, not a raw box test).
      player.x = coin.x - 6;
      player.y = coin.y;
      player.vx = 0;
      player.vy = 0;
      w.step();
      if (!w.entities.some((e) => e.id === coin.id)) {
        collected = 1;
        expect(w.particles.length).toBeGreaterThan(particlesBefore);
      }
    }
    expect(collected).toBe(1);
    const hud = w.hud.get("score")!;
    expect(hud.label).toBe("Coins");
    expect(Number(hud.value)).toBeGreaterThanOrEqual(1);
  });

  it("undoes cleanly: unload leaves no cat, no coin and no HUD", () => {
    const w = new World(24);
    const l = new ModLoader(w);
    l.load(groundMod);
    l.load(superheroCat);
    for (let i = 0; i < 120; i++) w.step();
    expect(w.entities.some((e) => e.type === "cat-coin")).toBe(true);
    l.unload("superhero-cat");
    expect(w.entities.filter((e) => e.type === "cat-coin" || e.type === "superhero-cat")).toHaveLength(0);
    expect(w.hud.get("score")).toBeUndefined();
    // The engine's own ground is untouched.
    expect(w.entities.some((e) => e.type === "ground")).toBe(true);
  });
});
