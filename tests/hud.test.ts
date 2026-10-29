import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";
import { ModLoader, runModTest } from "../src/sim/loader";
import { pickArtType } from "../server/art";
import playerMod from "../src/mods/player";
import groundMod from "../src/mods/ground";
import coinsMod from "../src/mods/coins";
import type { ModDefinition } from "../src/contract";

/** A HUD-only mod like Wonder would write for "add a speedometer HUD". */
const speedometerMod: ModDefinition = {
  id: "speedometer",
  title: "Speedometer",
  setup(api) {
    api.setHud("speed", { kind: "stat", label: "Speed", value: 0, unit: "px/s", position: "top-right" });
    api.onTick(() => {
      const p = api.player();
      api.setHud("speed", { kind: "stat", label: "Speed", value: p ? Math.abs(p.vx) : 0, unit: "px/s", position: "top-right" });
    });
  },
  dispose() {},
  test(t) {
    t.step(30);
    const w = t.api.hud("speed");
    t.expect(!!w, "speed widget exists");
    t.expect(w?.kind === "stat", "speed widget is a stat");
    t.expect((w?.value ?? -1) === 0, "no player means speed reads 0");
  },
};

/** A transient-banner mod like Wonder would write for "show wave banners". */
const bannerMod: ModDefinition = {
  id: "wave-banner",
  title: "Wave banner",
  setup(api) {
    api.setHud("wave", { kind: "banner", text: "Wave 1", duration: 1, position: "top-center" });
  },
  dispose() {},
  test(t) {
    t.expect(!!t.api.hud("wave"), "banner shows");
    t.step(70); // 70 frames > 1 s of sim time
    t.expect(!t.api.hud("wave"), "banner auto-removes after its duration");
  },
};

describe("hud (ADR 0019)", () => {
  it("setHud stores an owner-scoped widget; hudList keeps creation order", () => {
    const w = new World(1);
    w.setHud("mod-a", "hp", { kind: "bar", label: "HP", value: 70, max: 100 });
    w.setHud("mod-b", "score", { kind: "stat", label: "Coins", value: 3 });
    const list = w.hudList();
    expect(list.map((h) => h.id)).toEqual(["hp", "score"]);
    expect(list[0]).toMatchObject({ id: "hp", owner: "mod-a", kind: "bar", value: 70, max: 100 });
    expect(list[1]).toMatchObject({ id: "score", owner: "mod-b", kind: "stat", value: 3 });
  });

  it("setHud with the same id updates in place (upsert, no duplicate)", () => {
    const w = new World(1);
    w.setHud("a", "fuel", { kind: "bar", label: "Fuel", value: 50, max: 100 });
    w.setHud("a", "fuel", { kind: "bar", label: "Fuel", value: 20, max: 100 });
    expect(w.hudList()).toHaveLength(1);
    expect(w.hud.get("fuel")?.value).toBe(20);
    expect(w.hudList()[0].id).toBe("fuel"); // still first in order
  });

  it("removeHud is owner-scoped: another mod cannot remove your widget", () => {
    const w = new World(1);
    w.setHud("mod-a", "hp", { kind: "bar", value: 10, max: 100 });
    w.removeHud("mod-b", "hp");
    expect(w.hud.has("hp")).toBe(true);
    w.removeHud("mod-a", "hp");
    expect(w.hud.has("hp")).toBe(false);
  });

  it("loader.unload removes every widget the mod owned (clean undo)", () => {
    const w = new World(1);
    const l = new ModLoader(w);
    l.load(speedometerMod);
    l.load(bannerMod);
    expect(w.hud.has("speed")).toBe(true);
    expect(w.hud.has("wave")).toBe(true);
    l.unload("speedometer");
    expect(w.hud.has("speed")).toBe(false);
    expect(w.hud.has("wave")).toBe(true); // other mods keep theirs
    l.unload("wave-banner");
    expect(w.hud.size).toBe(0);
  });

  it("banner with duration expires on sim time; without duration it persists", () => {
    const w = new World(1);
    w.setHud("a", "flash", { kind: "banner", text: "Go!", duration: 1 });
    for (let i = 0; i < 50; i++) w.step();
    expect(w.hud.has("flash")).toBe(true);
    for (let i = 0; i < 20; i++) w.step(); // 70 frames > 1 s
    expect(w.hud.has("flash")).toBe(false);
    w.setHud("a", "title", { kind: "banner", text: "World 1" });
    for (let i = 0; i < 600; i++) w.step();
    expect(w.hud.has("title")).toBe(true); // stateful until removed
  });

  it("upserting a timed banner refreshes its remaining time", () => {
    const w = new World(1);
    w.setHud("a", "combo", { kind: "banner", text: "Combo x2", duration: 1 });
    for (let i = 0; i < 55; i++) w.step(); // almost expired
    expect(w.hud.has("combo")).toBe(true);
    w.setHud("a", "combo", { kind: "banner", text: "Combo x3", duration: 1 });
    for (let i = 0; i < 30; i++) w.step();
    expect(w.hud.has("combo")).toBe(true); // refreshed, not expired
    expect(w.hud.get("combo")?.text).toBe("Combo x3");
  });

  it("non-finite numbers and unknown kinds/positions are sanitized, never NaN", () => {
    const w = new World(1);
    w.setHud("a", "bad", {
      kind: "meter" as "bar",
      value: Number.NaN,
      max: Infinity,
      color: Number.NaN,
      position: "middle" as "center",
      label: 5 as unknown as string,
    });
    const h = w.hud.get("bad")!;
    expect(h.kind).toBe("stat"); // unknown kind falls back to stat
    expect(h.value).toBeUndefined();
    expect(h.max).toBeUndefined();
    expect(h.color).toBeUndefined();
    expect(h.position).toBeUndefined();
    expect(h.label).toBeUndefined();
    expect(JSON.stringify(w.hudList())).not.toContain("NaN");
  });

  it("hud state is deterministic for the same seed and steps", () => {
    const run = (): string => {
      const w = new World(42);
      w.setHud("a", "hp", { kind: "bar", value: 100, max: 100 });
      w.setHud("a", "msg", { kind: "banner", text: "hi", duration: 0.5 });
      for (let i = 0; i < 80; i++) w.step();
      return JSON.stringify(w.hudList());
    };
    expect(run()).toBe(run());
  });

  it("hud-only mods pass the verifier's runModTest and read back via t.api.hud", () => {
    for (const mod of [speedometerMod, bannerMod]) {
      const r = runModTest(mod);
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
    }
  });

  it("hud-only mod source never triggers Muse Image art generation", () => {
    const source = `export default ${JSON.stringify("x")}; api.setHud("speed", { kind: "stat", label: "Speed", value: 0, unit: "px/s", position: "top-right" }); api.onTick(() => { const p = api.player(); api.setHud("speed", { kind: "stat", label: "Speed", value: p ? Math.abs(p.vx) : 0, unit: "px/s", position: "top-right" }); });`;
    expect(pickArtType(source)).toBeNull();
    // ...while a mod that spawns a new entity type still does.
    expect(pickArtType(`api.spawn({ type: "turtle", x: 0, y: 0, w: 20, h: 20 });`)).toBe("turtle");
  });

  it("starter player shows a live health bar: full at spawn, drops on damage, resets on respawn", () => {
    const w = new World(1);
    const l = new ModLoader(w);
    l.load(groundMod);
    l.load(playerMod);
    let hp = w.hud.get("health");
    expect(hp).toMatchObject({ id: "health", owner: "player", kind: "bar", value: 100, max: 100 });
    const p = w.entities.find((e) => e.type === "player")!;
    w.damage(p.id, 30);
    w.step();
    hp = w.hud.get("health");
    expect(hp?.value).toBe(70);
    expect(hp?.owner).toBe("player");
    p.y = 2000; // fall off the world
    w.step();
    hp = w.hud.get("health");
    expect(hp?.value).toBe(100); // respawn refills the bar
    l.unload("player");
    expect(w.hud.has("health")).toBe(false); // undo removes it
  });

  it("coins shows a score stat that increments on collection and unloads cleanly", () => {
    const w = new World(9);
    const l = new ModLoader(w);
    l.load(groundMod);
    l.load(playerMod);
    l.load(coinsMod);
    expect(w.hud.get("score")).toMatchObject({ id: "score", owner: "coins", kind: "stat", value: 0 });
    const player = w.entities.find((e) => e.type === "player")!;
    const coin = w.entities.find((e) => e.type === "coin")!;
    player.x = coin.x;
    player.y = coin.y;
    player.vx = 0;
    player.vy = 0;
    w.step();
    expect(Number(player.data.score)).toBe(1);
    expect(w.hud.get("score")?.value).toBe(1);
    l.unload("coins");
    expect(w.hud.has("score")).toBe(false);
  });
});
