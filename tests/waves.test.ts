import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";
import { ModLoader, runModTest } from "../src/sim/loader";
import {
  computeWaveSpawn,
  spawnWaveUnit,
  applySwarmSeparation,
  WaveController,
} from "../src/sim/waves";
import swarmMod from "../src/mods/swarm";
import type { Entity } from "../src/contract";

describe("wave spawner & swarm archetype (ADR 0052)", () => {
  it("computes explicit multi-angle offscreen positions for left, right, and top", () => {
    const world = new World(100);
    const loader = new ModLoader(world);
    const loaded = loader.load({
      id: "test",
      title: "Test",
      setup() {},
      dispose() {},
    });
    const api = (loader as any).apiFor("test");

    // Spawn player to define camera center
    api.spawn({ type: "player", x: 400, y: 360, w: 26, h: 34 });
    const cam = api.camera();
    const sw = 960;

    // Left flank: camera.x - 60
    const leftSpawn = computeWaveSpawn(api, { side: "left", screenWidth: sw, groundY: 400, w: 24, h: 24, speed: 80 });
    expect(leftSpawn.side).toBe("left");
    expect(leftSpawn.x).toBe(cam.x - 60);
    expect(leftSpawn.y).toBe(400 - 24);
    expect(leftSpawn.vx).toBe(80);
    expect(leftSpawn.facing).toBe(1);
    expect(leftSpawn.gravityScale).toBe(1);
    expect(leftSpawn.isFlyer).toBe(false);

    // Right flank: camera.x + screen.w + 60
    const rightSpawn = computeWaveSpawn(api, { side: "right", screenWidth: sw, groundY: 400, w: 24, h: 24, speed: 80 });
    expect(rightSpawn.side).toBe("right");
    expect(rightSpawn.x).toBe(cam.x + sw + 60);
    expect(rightSpawn.y).toBe(400 - 24);
    expect(rightSpawn.vx).toBe(-80);
    expect(rightSpawn.facing).toBe(-1);
    expect(rightSpawn.gravityScale).toBe(1);
    expect(rightSpawn.isFlyer).toBe(false);

    // Top airborne swooper: camera.y - 60
    const topSpawn = computeWaveSpawn(api, { side: "top", screenWidth: sw, groundY: 400, w: 24, h: 24, speed: 80 });
    expect(topSpawn.side).toBe("top");
    expect(topSpawn.y).toBe(cam.y - 60);
    expect(topSpawn.x).toBeGreaterThanOrEqual(cam.x + 60);
    expect(topSpawn.x).toBeLessThanOrEqual(cam.x + sw - 60);
    expect(topSpawn.gravityScale).toBe(0);
    expect(topSpawn.isFlyer).toBe(true);
    expect(topSpawn.vy).toBeGreaterThan(0);
  });

  it("distributes random spawns ~40% left, ~40% right, ~20% top", () => {
    const world = new World(42);
    const loader = new ModLoader(world);
    loader.load({ id: "t", title: "T", setup() {}, dispose() {} });
    const api = (loader as any).apiFor("t");

    let left = 0;
    let right = 0;
    let top = 0;
    const total = 1000;

    for (let i = 0; i < total; i++) {
      const pos = computeWaveSpawn(api);
      if (pos.side === "left") left++;
      else if (pos.side === "right") right++;
      else if (pos.side === "top") top++;
    }

    // 40% = 400, 20% = 200. Allow +/- 5% tolerance
    expect(left / total).toBeGreaterThan(0.35);
    expect(left / total).toBeLessThan(0.45);
    expect(right / total).toBeGreaterThan(0.35);
    expect(right / total).toBeLessThan(0.45);
    expect(top / total).toBeGreaterThan(0.15);
    expect(top / total).toBeLessThan(0.25);
  });

  it("spawns units tagged with swarm data and off-screen positions", () => {
    const world = new World(123);
    const loader = new ModLoader(world);
    loader.load({ id: "t", title: "T", setup() {}, dispose() {} });
    const api = (loader as any).apiFor("t");

    const unit = spawnWaveUnit(api, { speed: 90, side: "left" });
    expect(unit.data.swarm).toBe(true);
    expect(unit.data.hostile).toBe(true);
    expect(unit.data.side).toBe("left");
    expect(unit.vx).toBe(90);
    expect(unit.facing).toBe(1);
  });

  it("anti-clumping separation pushes stacked/overlapping swarm units apart", () => {
    const world = new World(999);
    const loader = new ModLoader(world);
    loader.load({ id: "t", title: "T", setup() {}, dispose() {} });
    const api = (loader as any).apiFor("t");

    // Spawn two enemies stacked at the exact same x, y coordinates
    const e1 = api.spawn({
      type: "swarm-crawler",
      x: 300,
      y: 376,
      w: 24,
      h: 24,
      vx: 50,
      vy: 0,
      data: { swarm: true, hostile: true },
    });
    const e2 = api.spawn({
      type: "swarm-crawler",
      x: 300,
      y: 376,
      w: 24,
      h: 24,
      vx: 50,
      vy: 0,
      data: { swarm: true, hostile: true },
    });

    const initDist = Math.abs(e1.x - e2.x);
    expect(initDist).toBe(0);

    // Apply separation
    applySwarmSeparation([e1, e2], { radius: 40, strength: 40 });

    // One should have vx reduced, one increased
    expect(e1.vx).not.toBe(e2.vx);
    const diffVx = Math.abs(e1.vx - e2.vx);
    expect(diffVx).toBeGreaterThan(0);

    // After stepping physics, they should no longer share the same x
    world.step();
    expect(e1.x).not.toBe(e2.x);
    expect(Math.abs(e1.x - e2.x)).toBeGreaterThan(0);
  });

  it("WaveController paces level progression by real kills, never runaway timer", () => {
    const world = new World(777);
    const loader = new ModLoader(world);
    loader.load({ id: "t", title: "T", setup() {}, dispose() {} });
    const api = (loader as any).apiFor("t");

    api.spawn({ type: "player", x: 400, y: 360, w: 26, h: 34 });
    const controller = new WaveController(api, {
      baseWaveSize: 5,
      killsPerLevel: 5,
      baseSpeed: 75,
      autoTick: false,
    });

    expect(controller.getLevel()).toBe(1);
    expect(controller.getKills()).toBe(0);

    // Advance 120 ticks without defeats -> level must strictly remain 1
    for (let i = 0; i < 120; i++) {
      controller.step();
    }
    expect(controller.getLevel()).toBe(1);
    expect(controller.getKills()).toBe(0);

    // Defeat 4 enemies -> level must still be 1
    for (let i = 0; i < 4; i++) {
      controller.recordKill();
    }
    expect(controller.getLevel()).toBe(1);
    expect(controller.getKills()).toBe(4);

    // 5th defeat triggers Level 2
    controller.recordKill();
    expect(controller.getLevel()).toBe(2);
    expect(controller.getKills()).toBe(0);

    // Verify wave announcement banner exists and has duration 2
    const banner = api.hud("wave");
    expect(banner).toBeDefined();
    expect(banner?.kind).toBe("banner");
    expect(banner?.text).toBe("Wave 2");
    expect(banner?.duration).toBe(2);

    // Verify speed increased by 10-15% (75 * 1.12 = 84)
    expect(controller.currentSpeed).toBeGreaterThanOrEqual(75 * 1.10);
    expect(controller.currentSpeed).toBeLessThanOrEqual(75 * 1.15);
  });

  it("built-in swarmMod passes runModTest and satisfies contract", () => {
    const res = runModTest(swarmMod);
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it("swarmMod cleans up cleanly on dispose", () => {
    const world = new World(123);
    const loader = new ModLoader(world);
    loader.load(swarmMod);

    expect(loader.has("swarm")).toBe(true);
    expect(world.hud.has("wave")).toBe(true);

    loader.unload("swarm");
    expect(loader.has("swarm")).toBe(false);
    expect(world.hud.has("wave")).toBe(false);
    expect(world.hud.has("wave-level")).toBe(false);
    expect(world.entities.filter((e) => e.owner === "swarm").length).toBe(0);
  });
});

describe("camera after the player is knocked out", () => {
  it("stays finite when the player dies mid-step (no NaN black screen)", () => {
    const world = new World(7);
    const loader = new ModLoader(world);
    loader.load({ id: "t", title: "T", setup(api: any) {
      api.spawn({ type: "ground", x: -200, y: 400, w: 1400, h: 48, solid: true, gravityScale: 0 });
      api.spawn({ type: "player", x: 400, y: 366, w: 26, h: 34, gravityScale: 1, health: 10 });
      api.spawn({ type: "enemy", x: 400, y: 366, w: 26, h: 34, gravityScale: 0, data: { hostile: true, damage: 50 } });
    }, dispose() {} } as any);
    for (let i = 0; i < 10; i++) world.step();
    expect(world.entities.some((e) => e.type === "player")).toBe(false);
    expect(Number.isFinite(world.camera.x)).toBe(true);
    expect(Number.isFinite(world.camera.y)).toBe(true);
  });
});
