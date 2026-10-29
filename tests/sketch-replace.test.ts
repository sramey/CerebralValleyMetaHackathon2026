import { describe, expect, it } from "vitest";
import { levelToModSource, needsFloor, normalizeLevel } from "../server/sketch";
import { compileMod } from "../server/compile";
import { verifyMod } from "../server/verify";
import { World } from "../src/sim/world";
import { ModLoader } from "../src/sim/loader";

// Bug j2t: a sketched level replaces the starter ground, so it must stand on its own.
const hills = normalizeLevel({ name: "Hills", platforms: [{ x: 500, y: 300, w: 200, h: 24 }], coins: [{ x: 520, y: 260, w: 16, h: 16 }], enemies: [] });
const withGround = normalizeLevel({ name: "Flat", platforms: [{ x: -200, y: 400, w: 1400, h: 30 }, { x: 500, y: 300, w: 200, h: 24 }], coins: [], enemies: [] });

describe("a sketched level replaces the level (bug j2t)", () => {
  it("lays its own floor only when no ground was drawn", () => {
    expect(needsFloor(hills)).toBe(true);
    expect(needsFloor(withGround)).toBe(false);
  });

  it("a level with no ground still has a floor, and unloading removes every entity it made", async () => {
    const source = levelToModSource(hills);
    const verified = await verifyMod(source, compileMod(source).js);
    expect(verified.ok).toBe(true);
    const world = new World(3);
    const loader = new ModLoader(world);
    loader.load(verified.def!);
    const floor = world.entities.filter((e) => e.type === "ground");
    expect(floor.length).toBe(1);
    expect(floor[0].y).toBe(400);
    loader.unload(verified.def!.id);
    expect(world.entities.length).toBe(0);
  });

  it("a drawn ground is not doubled", async () => {
    const source = levelToModSource(withGround);
    const verified = await verifyMod(source, compileMod(source).js);
    const world = new World(3);
    new ModLoader(world).load(verified.def!);
    expect(world.entities.some((e) => e.type === "ground")).toBe(false);
  });
});
