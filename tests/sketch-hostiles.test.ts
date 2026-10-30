// Drawn enemies are real hostiles (bead 49d / ADR 0070). A hand-drawn level used to spawn its
// enemies as "casual" scenery: they walked through you, bullets passed through them and a jump
// never landed. Playtest 2026-10-30: a tester drew a level with five enemies and none of them
// could be fought. The fix is in the level compiler (server/sketch.ts), so every future sketch
// gets real hostiles; these checks run the REAL compiler output in the sim.
import { describe, expect, it } from "vitest";
import { compileMod } from "../server/compile";
import { levelToModSource, normalizeLevel } from "../server/sketch";
import type { SketchLevel } from "../server/sketch";
import { verifyMod } from "../server/verify";
import type { ModDefinition } from "../src/contract";
import { emptyInput } from "../src/contract";
import { ModLoader } from "../src/sim/loader";
import { World } from "../src/sim/world";
import playerMod from "../src/mods/player";

/** A small level like the one drawn in the playtest: ground, a ledge, coins and two enemies. */
const DRAWN: SketchLevel = normalizeLevel({
  name: "Drawn Ridge",
  platforms: [
    { x: -400, y: 400, w: 1600, h: 40, kind: "ledge" },
    { x: 300, y: 300, w: 160, h: 20, kind: "ledge" },
  ],
  coins: [{ x: 350, y: 260, w: 16, h: 16 }],
  enemies: [
    { x: 120, y: 372, w: 28, h: 28 },
    { x: 700, y: 372, w: 28, h: 28 },
  ],
});

async function drawnLevel(): Promise<{ def: ModDefinition; source: string }> {
  const source = levelToModSource(DRAWN);
  const compiled = compileMod(source);
  expect(compiled.errors).toEqual([]);
  const verified = await verifyMod(source, compiled.js);
  expect(verified.errors).toEqual([]);
  return { def: verified.def!, source };
}

function worldWith(def: ModDefinition): World {
  const world = new World(9);
  new ModLoader(world).load(def);
  return world;
}

describe("drawn enemies are real hostiles", () => {
  it("compiles to hostile walkers, not casual scenery, and still verifies", async () => {
    const { def, source } = await drawnLevel();
    const world = worldWith(def);
    const walkers = world.entities.filter((e) => e.type === "sketch-walker");
    expect(walkers).toHaveLength(2);
    for (const w of walkers) {
      expect(w.data.hostile).toBe(true);
      expect(w.data.enemy).toBe(true);
      expect(w.data.casual).toBeUndefined(); // casual == friendly: the old bug
      expect(Number(w.data.damage)).toBeGreaterThan(0);
    }
    expect(source).not.toContain("casual");
  });

  it("hurts the player on contact", async () => {
    const { def } = await drawnLevel();
    const world = worldWith(def);
    const walker = world.entities.find((e) => e.type === "sketch-walker")!;
    const player = world.spawn({ type: "player", x: walker.x, y: walker.y, w: 26, h: 34, gravityScale: 1 }, "engine");
    world.step();
    expect(player.health).toBeLessThan(100);
  });

  it("takes a player bullet", async () => {
    const { def } = await drawnLevel();
    const world = worldWith(def);
    const walker = world.entities.find((e) => e.type === "sketch-walker")!;
    const health = walker.health;
    world.spawn({
      type: "bullet", x: walker.x + 4, y: walker.y + 8, w: 8, h: 6, vx: 400, gravityScale: 0,
      data: { visual: "projectile", fromPlayer: true, damage: 40 },
    }, "gun");
    world.step();
    expect(walker.health).toBe(health - 40);
  });

  it("chases the player once it notices one, and only then", async () => {
    const { def } = await drawnLevel();
    const world = worldWith(def);
    const walker = world.entities.find((e) => e.type === "sketch-walker" && e.x === 700)!;
    world.spawn({ type: "player", x: 640, y: 360, w: 26, h: 34, gravityScale: 1 }, "engine");
    // Park the player so only the chase can move the walker: no input, no gravity surprises.
    const start = walker.x;
    for (let i = 0; i < 20; i++) { world.input = emptyInput(); world.step(); }
    expect(walker.x).toBeLessThan(start); // walked left, toward the player at x=640
  });

  it("dies to a stomp and bounces the player, like any hostile", async () => {
    const { def } = await drawnLevel();
    const world = worldWith(def);
    const walker = world.entities.find((e) => e.type === "sketch-walker")!;
    const player = world.spawn({ type: "player", x: walker.x, y: walker.y - 40, w: 26, h: 34, gravityScale: 1 }, "engine");
    let bounced = false;
    for (let i = 0; i < 12 && !bounced; i++) {
      world.step();
      if (player.vy < -100) bounced = true;
    }
    expect(world.entities.some((e) => e.id === walker.id)).toBe(false);
    expect(bounced).toBe(true);
  });

  it("the compiled level's own test() passes in the real verifier", async () => {
    const { def } = await drawnLevel();
    const { runModTest } = await import("../src/sim/loader");
    expect(runModTest(def).errors).toEqual([]);
  });
});

describe("drawn enemies keep playerMod alive", () => {
  it("a drawn level plus the real player still plays", async () => {
    const { def } = await drawnLevel();
    const world = new World(5);
    const loader = new ModLoader(world);
    loader.load(playerMod);
    loader.load(def);
    const player = world.entities.find((e) => e.type === "player")!;
    for (let i = 0; i < 90; i++) {
      world.input = { ...emptyInput(), right: true };
      world.step();
    }
    expect(world.entities).toContain(player);
    expect(Number.isFinite(player.x + player.y)).toBe(true);
  });
});
