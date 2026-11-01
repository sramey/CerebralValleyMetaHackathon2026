import { describe, expect, it } from "vitest";
import type { ModDefinition } from "../src/contract";
import { checkProjectileHitAndDamage } from "../src/sim/combat";
import { ModLoader, modApiFor } from "../src/sim/loader";
import { World } from "../src/sim/world";
import groundMod from "../src/mods/ground";
import playerMod from "../src/mods/player";

/** ADR 0066: setScene reshapes the world and every claim is undone exactly. */
function level() {
  const world = new World(7);
  const loader = new ModLoader(world);
  loader.load(playerMod);
  loader.load(groundMod);
  loader.load({
    id: "dressing", title: "Dressing", setup(api) {
      api.spawn({ type: "tree", x: 300, y: 330, w: 50, h: 70, solid: false, gravityScale: 0 });
      api.spawn({ type: "brick-tower", x: 600, y: 200, w: 60, h: 200, solid: true, gravityScale: 0 });
      api.spawn({ type: "gun", x: 200, y: 380, w: 22, h: 12, solid: false, gravityScale: 0, data: { pickup: true } });
    }, dispose() {},
  });
  return { world, loader };
}
const scene = (id: string, opts: Parameters<NonNullable<ReturnType<typeof modApiFor>["setScene"]>>[0]): ModDefinition => ({
  id, title: id, setup(api) { api.setScene!(opts); }, dispose() {},
});
const types = (w: World) => w.entities.map((e) => e.type).sort().join(",");

describe("setScene (ADR 0066)", () => {
  it("hides terrain and scenery, keeps the player, gear and creatures", () => {
    const { world, loader } = level();
    loader.load(scene("space", { hideTerrain: true, hideScenery: true, backdrop: "space", playerSkin: "spaceship" }));
    expect(types(world)).toBe("gun,player");
    expect(world.scene).toEqual({ backdrop: "space", playerSkin: "spaceship", skinFlight: true });
  });

  it("a shot at a hidden tower passes through it, and the ship is not stopped by the ground", () => {
    const { world, loader } = level();
    const before = world.entities.find((e) => e.type === "brick-tower")!;
    loader.load(scene("space", { hideTerrain: true }));
    expect(world.entities.includes(before)).toBe(false);
    const api = modApiFor(world, "tester");
    const shot = api.spawn({ type: "laser-bolt", x: 590, y: 280, w: 16, h: 6, solid: false, gravityScale: 0, vx: 600, data: { fromPlayer: true } });
    expect(checkProjectileHitAndDamage(api, shot)).toBeUndefined();
    expect(api.raycast!(500, 280, 1, 0, 300)).toBeUndefined();
    expect(shot.dead).toBeFalsy();
    const p = world.entities.find((e) => e.type === "player")!;
    p.gravityScale = 1; p.y = 380; p.vy = 400;
    for (let i = 0; i < 90; i++) world.step();
    expect(p.y).toBeGreaterThan(450); // nothing to land on
  });

  it("unload restores terrain, scenery, backdrop, skin and gravity exactly", () => {
    const { world, loader } = level();
    const player = world.entities.find((e) => e.type === "player")!;
    const g0 = player.gravityScale;
    const t0 = types(world);
    const ids0 = world.entities.map((e) => e.id);
    loader.load({ id: "space", title: "space", setup(api) { api.setScene!({ hideTerrain: true, hideScenery: true, backdrop: "space", playerSkin: "spaceship" }); api.player()!.gravityScale = 0; }, dispose() {} });
    expect(player.gravityScale).toBe(0);
    loader.unload("space");
    expect(types(world)).toBe(t0);
    expect(world.entities.map((e) => e.id)).toEqual(ids0);
    expect(world.scene).toEqual({});
    expect(player.gravityScale).toBe(g0);
  });

  it("two scenes undone in reverse order peel back one layer at a time", () => {
    const { world, loader } = level();
    loader.load(scene("a", { hideScenery: true }));
    expect(types(world)).not.toContain("tree");
    loader.load(scene("b", { hideTerrain: true, backdrop: "space", playerSkin: "spaceship" }));
    expect(types(world)).toBe("gun,player");
    loader.unload("b");
    expect(types(world)).toContain("brick-tower");
    expect(types(world)).not.toContain("tree");
    expect(world.scene).toEqual({});
    loader.unload("a");
    expect(types(world)).toContain("tree");
  });

  it("undoing the older scene first still ends with everything restored", () => {
    const { world, loader } = level();
    const player = world.entities.find((e) => e.type === "player")!;
    const t0 = types(world);
    loader.load({ id: "a", title: "a", setup(api) { api.setScene!({ hideScenery: true, backdrop: "space" }); api.player()!.gravityScale = 0; }, dispose() {} });
    loader.load(scene("b", { hideTerrain: true, playerSkin: "spaceship" }));
    loader.unload("a");
    expect(world.scene).toEqual({ playerSkin: "spaceship", skinFlight: true });
    loader.unload("b");
    expect(types(world)).toBe(t0);
    expect(world.scene).toEqual({});
    expect(player.gravityScale).toBe(1);
  });

  it("an entity's own mod unloading while it is hidden drops it for good", () => {
    const { world, loader } = level();
    loader.load(scene("space", { hideScenery: true }));
    loader.unload("dressing");
    loader.unload("space");
    expect(types(world)).not.toMatch(/tree|tower|gun/);
  });

  it("a reload (knob change) re-hides without duplicating or losing anything", () => {
    const { world, loader } = level();
    const t0 = types(world);
    const def = scene("space", { hideTerrain: true });
    loader.load(def);
    loader.load(def);
    loader.unload("space");
    expect(types(world)).toBe(t0);
  });

  it("ignores unknown backdrops and junk options", () => {
    const { world, loader } = level();
    loader.load(scene("odd", { backdrop: "lava!!", playerSkin: 7 as unknown as string }));
    expect(world.scene).toEqual({});
    loader.unload("odd");
  });

  it("collectibles and gear are never hidden: a genre change keeps the loot", () => {
    const { world, loader } = level();
    loader.load({ id: "coins", title: "coins", setup(api) { const p = api.player()!; api.spawn({ type: "coin-pile", x: p.x, y: p.y, w: 20, h: 20, solid: false, gravityScale: 0, data: { collectible: true } }); }, dispose() {} });
    loader.load(scene("space", { hideScenery: true, hideTerrain: true }));
    world.step();
    expect(world.collected.size).toBe(1);
  });
});
