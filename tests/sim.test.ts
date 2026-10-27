import { describe, expect, it } from "vitest";
import { SIM } from "../src/contract";
import { World } from "../src/sim/world";
import { ModLoader, runModTest } from "../src/sim/loader";
import playerMod from "../src/mods/player";
import groundMod from "../src/mods/ground";
import enemyMod from "../src/mods/enemy";
import rainMod from "../src/mods/rain";
import coinsMod from "../src/mods/coins";
import movingPlatformMod from "../src/mods/platform-moving";
import fireArrowMod from "../src/mods/fire-arrow";

function run(seed: number, steps: number) {
  const w = new World(seed);
  const l = new ModLoader(w);
  l.load(groundMod); l.load(playerMod);
  w.input.right = true;
  for (let i = 0; i < steps; i++) w.step();
  return w.entities.find((e) => e.type === "player")!;
}

describe("sim", () => {
  it("is deterministic for same seed+input", () => {
    const a = run(7, 300); const b = run(7, 300);
    expect(a.x).toBe(b.x); expect(a.y).toBe(b.y);
  });
  it("player falls and lands on ground", () => {
    const p = run(7, 300);
    expect(p.onGround).toBe(true);
    expect(p.y + p.h).toBeCloseTo(400, 0);
    expect(Number.isFinite(p.x + p.y)).toBe(true);
  });
  it("a solid entity with gravity still falls and lands (AI mods do this)", () => {
    const w = new World(3);
    w.spawn({ type: "ground", x: -100, y: 300, w: 600, h: 40, solid: true, gravityScale: 0 }, "test");
    const s = w.spawn({ type: "slime", x: 100, y: 100, w: 28, h: 28, solid: true, gravityScale: 1 }, "test");
    for (let i = 0; i < 120; i++) w.step();
    expect(s.onGround).toBe(true);
    expect(s.y + s.h).toBeCloseTo(300, 0);
  });
  it("fall speed is capped and the player respawns after falling off", () => {
    const w = new World(5); const l = new ModLoader(w);
    l.load(playerMod); // no ground: player falls from spawn
    for (let i = 0; i < 600; i++) w.step();
    const p = w.entities.find((e) => e.type === "player")!;
    expect(p.vy).toBeLessThanOrEqual(1100);
    expect(p.y).toBeLessThan(1000); // respawned, not falling forever
  });
  it("unload removes all owned entities", () => {
    const w = new World(1); const l = new ModLoader(w);
    l.load(playerMod);
    expect(w.entities.length).toBeGreaterThan(0);
    l.unload("player");
    expect(w.entities).toHaveLength(0);
  });
  it.each([playerMod, groundMod, enemyMod, rainMod, coinsMod, movingPlatformMod, fireArrowMod])(
    "sample mod $id passes its test()",
    (mod) => {
      const r = runModTest(mod);
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
    },
  );
  it("coins: collecting every coin raises the score", () => {
    const w = new World(9); const l = new ModLoader(w);
    l.load(groundMod); l.load(playerMod); l.load(coinsMod);
    const coins = w.entities.filter((e) => e.type === "coin");
    expect(coins.length).toBeGreaterThan(0);
    const player = w.entities.find((e) => e.type === "player")!;
    for (const c of [...coins]) {
      player.x = c.x; player.y = c.y; player.vx = 0; player.vy = 0;
      w.step();
    }
    expect(Number(player.data.score)).toBe(coins.length);
    expect(w.entities.filter((e) => e.type === "coin")).toHaveLength(0);
  });
  it("moving platform oscillates but stays solid and finite", () => {
    const w = new World(3); const l = new ModLoader(w);
    l.load(movingPlatformMod);
    const plat = w.entities.find((e) => e.type === "moving-platform")!;
    const x0 = plat.x;
    for (let i = 0; i < 45; i++) w.step();
    expect(plat.solid).toBe(true);
    expect(Number.isFinite(plat.x)).toBe(true);
    expect(plat.x).not.toBe(x0);
  });
  it("fire arrow needs no player and hits solids", () => {
    const w = new World(5); const l = new ModLoader(w);
    l.load(fireArrowMod);
    w.input.shoot = true;
    for (let i = 0; i < 10; i++) w.step();
    expect(w.entities.filter((e) => e.type === "fire-arrow")).toHaveLength(0);
    const p = w.spawn({ type: "player", x: 100, y: 300, w: 26, h: 34, color: 0xffffff, gravityScale: 0 }, "probe");
    p.facing = 1;
    w.spawn({ type: "wall", x: 300, y: 0, w: 40, h: 600, color: 0x888888, solid: true, gravityScale: 0 }, "probe");
    w.step();
    expect(w.entities.filter((e) => e.type === "fire-arrow").length).toBeGreaterThan(0);
    w.input.shoot = false;
    for (let i = 0; i < 120; i++) w.step();
    expect(w.entities.filter((e) => e.type === "fire-arrow")).toHaveLength(0);
  });
  it("full stack stays finite and bounded over 600 frames", () => {
    const w = new World(11); const l = new ModLoader(w);
    l.load(groundMod); l.load(playerMod); l.load(enemyMod); l.load(rainMod);
    l.load(coinsMod); l.load(movingPlatformMod); l.load(fireArrowMod);
    for (let i = 0; i < 600; i++) {
      w.input.right = i % 120 < 60;
      w.input.jump = i % 90 === 0;
      w.input.shoot = i % 40 === 0;
      w.step();
    }
    for (const e of w.entities) {
      expect(Number.isFinite(e.x) && Number.isFinite(e.y)).toBe(true);
    }
    expect(w.entities.length).toBeLessThanOrEqual(SIM.maxEntities);
  });
});
