// Engine review fixes (ADR 0056, 0057): crash containment, loop guards, stable tick order,
// equipment and projectile rules, the ground slab, bookkeeping cleanup and the broad phase.
import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";
import { ModLoader } from "../src/sim/loader";
import { SolidGrid } from "../src/sim/grid";
import { createRng } from "../src/sim/rng";
import { compileMod, guardLoops } from "../server/compile";
import { verifyMod } from "../server/verify";
import groundMod from "../src/mods/ground";
import playerMod from "../src/mods/player";
import type { ModDefinition } from "../src/contract";

const mod = (id: string, setup: ModDefinition["setup"], extra: Partial<ModDefinition> = {}): ModDefinition =>
  ({ id, title: id, setup, dispose: () => {}, ...extra });

describe("crash containment (ADR 0056)", () => {
  it("unloads a mod whose tick handler throws and keeps the world stepping", () => {
    const world = new World(1);
    const loader = new ModLoader(world);
    const quarantined: string[] = [];
    loader.isolateFaults((m, msg) => quarantined.push(`${m.id}: ${msg}`));
    const mover = world.spawn({ type: "box", x: 0, y: 0, w: 10, h: 10, vx: 60, gravityScale: 0 }, "other");
    loader.load(mod("bad", (api) => {
      api.spawn({ type: "junk", x: 0, y: 0, w: 4, h: 4, gravityScale: 0 });
      api.onTick(() => { if (api.tick() > 5) throw new Error("boom"); });
    }));
    let ticks = 0;
    loader.load(mod("good", (api) => api.onTick(() => { ticks++; })));
    for (let i = 0; i < 20; i++) world.step();
    expect(quarantined).toEqual(["bad: boom"]);
    expect(loader.has("bad")).toBe(false);
    expect(world.entities.some((e) => e.owner === "bad")).toBe(false);
    expect(ticks).toBe(20);
    expect(mover.x).toBeGreaterThan(15);
  });

  it("still throws when isolation is off, so the verifier fails a crashing mod", () => {
    const world = new World(1);
    new ModLoader(world).load(mod("bad", (api) => api.onTick(() => { throw new Error("boom"); })));
    expect(() => world.step()).toThrow("boom");
  });

  it("a setup that throws halfway leaves no handlers or entities behind", () => {
    const world = new World(1);
    const loader = new ModLoader(world);
    let ran = 0;
    expect(() => loader.load(mod("half", (api) => {
      api.spawn({ type: "junk", x: 0, y: 0, w: 4, h: 4 });
      api.onTick(() => { ran++; });
      throw new Error("setup failed");
    }))).toThrow("setup failed");
    world.step();
    expect(ran).toBe(0);
    expect(world.entities).toHaveLength(0);
    expect(loader.has("half")).toBe(false);
  });

  it("a knob tweak keeps the mod's place in the tick order", () => {
    const world = new World(1);
    const loader = new ModLoader(world);
    const order: string[] = [];
    loader.load(mod("a", (api) => api.onTick(() => order.push("a")), { knobs: { n: { value: 1, min: 0, max: 5 } } }));
    loader.load(mod("b", (api) => api.onTick(() => order.push("b"))));
    loader.setKnob("a", "n", 2);
    world.step();
    expect(order).toEqual(["a", "b"]);
  });
});

describe("loop guards (ADR 0056)", () => {
  it("an infinite loop fails verification fast instead of hanging", async () => {
    const src = `export default { id: "spin", title: "Spin",
      setup(api) { api.onTick(() => { let y = 0; while (y >= 0) { y++; } }); },
      dispose() {} };`;
    const c = compileMod(src);
    expect(c.ok).toBe(true);
    const t0 = performance.now();
    const r = await verifyMod(src, c.js);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/loop ran more than/);
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it("keeps labels, strings and regexes intact and normal loops working", async () => {
    const js = guardLoops(`
      const s = "while (true) {}"; const re = /for\\(;;\\)/;
      let hits = 0;
      outer: for (let i = 0; i < 3; i++) { for (const x of [1, 2, 3]) { if (x === 2) continue outer; hits++; } }
      let k = 0; do k++; while (k < 4);
      for (const key in { a: 1, b: 2 }) hits += key.length;
      export default { s, re: re.source, hits, k };`);
    const ns = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
    expect(ns.default).toEqual({ s: "while (true) {}", re: "for\\(;;\\)", hits: 5, k: 4 });
  });
});

describe("gameplay rules (ADR 0057)", () => {
  const player = (world: World) => {
    const p = world.spawn({ type: "player", x: 100, y: 300, w: 26, h: 34, gravityScale: 0 }, "player");
    p.facing = 1;
    return p;
  };

  it("a sword still lying in the level as a pickup is not snapped to the player", () => {
    const world = new World(1);
    player(world);
    const pickup = world.spawn({ type: "sword", x: 600, y: 360, w: 10, h: 30, gravityScale: 0, data: { pickup: true } }, "loot");
    const held = world.spawn({ type: "sword", x: 600, y: 360, w: 10, h: 30, gravityScale: 0 }, "gear");
    world.step();
    expect(pickup.x).toBe(600);
    expect(held.x).toBeLessThan(200);
  });

  it("a projectile a mod resolves with damageHit can pierce: the engine leaves it alone", () => {
    const world = new World(1);
    const loader = new ModLoader(world);
    const enemy = world.spawn({ type: "goblin", x: 200, y: 300, w: 30, h: 30, gravityScale: 0, data: { hostile: true } }, "enemies");
    loader.load(mod("piercer", (api) => {
      api.spawn({ type: "bullet", x: 195, y: 305, w: 10, h: 6, vx: 120, gravityScale: 0, data: { fromPlayer: true } });
      api.onTick(() => { for (const b of api.byType("bullet")) api.damageHit!(b, { damage: 5, despawnOnHit: false }); });
    }));
    world.step();
    world.step();
    expect(world.entities.some((e) => e.type === "bullet")).toBe(true);
    expect(enemy.health).toBe(90);
  });

  it("enemy fire hits the player, never other hostiles, and no shot hits the player on the frame it spawns", () => {
    const world = new World(1);
    const p = player(world);
    const other = world.spawn({ type: "slime", x: 300, y: 300, w: 30, h: 30, gravityScale: 0, data: { hostile: true } }, "enemies");
    world.spawn({ type: "fireball", x: 290, y: 305, w: 10, h: 10, vx: 0, gravityScale: 0, data: { hostile: true } }, "enemies");
    world.spawn({ type: "bullet", x: 105, y: 305, w: 6, h: 4, vx: 0, gravityScale: 0 }, "trap");
    world.step();
    expect(other.health).toBe(100);
    expect(p.health).toBe(100);
  });

  it("only the ground slab gets ground rules: a platform at y=400 blocks from below", () => {
    const world = new World(1);
    world.spawn({ type: "platform", x: 0, y: 400, w: 100, h: 20, solid: true, gravityScale: 0 }, "level");
    const e = world.spawn({ type: "bubble", x: 20, y: 422, w: 10, h: 10, vy: -300, gravityScale: 0 }, "fx");
    world.step();
    expect(e.y).toBe(420);
  });

  it("forgets per-entity bookkeeping when an entity goes", () => {
    const world = new World(1);
    world.spawn({ type: "ground", x: -200, y: 400, w: 1200, h: 48, solid: true, gravityScale: 0 }, "ground");
    world.spawn({ type: "wall", x: 200, y: 300, w: 20, h: 100, solid: true, gravityScale: 0 }, "level");
    const c = world.spawn({ type: "chicken", x: 169, y: 370, w: 30, h: 30, vx: 80, data: { casual: true } }, "farm");
    for (let i = 0; i < 10; i++) { c.vx = 80; world.step(); }
    const w = world as unknown as { blocked: Map<number, number>; hopCooldown: Map<number, number>; turning: Map<number, unknown> };
    expect(w.blocked.has(c.id) || w.turning.has(c.id)).toBe(true); // it was grinding into the wall
    world.despawn(c.id);
    expect(w.blocked.has(c.id) || w.hopCooldown.has(c.id) || w.turning.has(c.id)).toBe(false);
  });
});

describe("broad phase (ADR 0057)", () => {
  it("a grid query always includes every solid that overlaps the box", () => {
    const rng = createRng(7);
    const solids = Array.from({ length: 300 }, () => ({
      x: rng() * 8000 - 1000, y: rng() * 1200 - 600, w: 4 + rng() * (rng() < 0.05 ? 20000 : 300), h: 4 + rng() * 200,
    }));
    const grid = new SolidGrid();
    grid.build(solids);
    for (let q = 0; q < 500; q++) {
      const b = { x: rng() * 8000 - 1000, y: rng() * 1200 - 600, w: rng() * 120, h: rng() * 120 };
      const got = grid.query(b);
      for (let i = 0; i < solids.length; i++) {
        const s = solids[i];
        if (b.x < s.x + s.w && b.x + b.w > s.x && b.y < s.y + s.h && b.y + b.h > s.y) expect(got).toContain(i);
      }
      expect([...got].sort((a, c) => a - c)).toEqual(got);
    }
  });

  it("a full 500-entity level steps well inside the frame budget", () => {
    const world = new World(1);
    const loader = new ModLoader(world);
    loader.load(groundMod);
    loader.load(playerMod);
    for (let i = 0; i < 160; i++) world.spawn({ type: "block", x: i * 40, y: 360 - (i % 7) * 30, w: 32, h: 16, solid: true, gravityScale: 0 }, "level");
    for (let i = 0; i < 320; i++) world.spawn({ type: i % 2 ? "slime" : "chicken", x: (i * 53) % 6400, y: 300, w: 24, h: 24, vx: i % 2 ? 50 : -50, data: { hostile: i % 2 === 1 } }, "mobs");
    for (let i = 0; i < 60; i++) world.step();
    const t0 = performance.now();
    for (let i = 0; i < 300; i++) world.step();
    // Budget is 2 ms (SIM.msBudget); leave headroom for slow CI machines.
    expect((performance.now() - t0) / 300).toBeLessThan(4);
  });
});
