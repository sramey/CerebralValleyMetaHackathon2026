// ADR 0055 / bead ees: the engine owns collectibles. A mod only TAGS an entity with
// data.collectible; the engine detects the player's pickup reach, despawns it with a
// burst, and adds the value to ONE shared score HUD. No AI, no network: pure sim.
import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import type { ModDefinition } from "../src/contract";
import { World } from "../src/sim/world";
import { ModLoader, runModTest } from "../src/sim/loader";
import { COLLECT_BURST, ENGINE_OWNER, SCORE_HUD, collectibleOf } from "../src/sim/collect";
import { Feel } from "../src/client/feel";
import groundMod from "../src/mods/ground";
import playerMod from "../src/mods/player";

/** A mod that only tags: the engine does the collecting. Value 1. */
const taggedCoins: ModDefinition = {
  id: "tagged-coins",
  title: "Tagged coins",
  setup(api) {
    api.spawn({
      type: "tagged-coin", x: 320, y: 340, w: 14, h: 14,
      color: 0xffd94d, solid: false, gravityScale: 1, data: { bounce: 0.45, collectible: true },
    });
  },
  dispose(api) {
    for (const e of api.byType("tagged-coin")) api.despawn(e.id);
  },
  test(t) {
    t.api.spawn({ type: "ground", x: -200, y: 400, w: 1200, h: 48, solid: true, gravityScale: 0 });
    const coin = t.api.byType("tagged-coin")[0];
    t.expect(!!coin, "a tagged coin spawns");
    t.api.spawn({ type: "player", x: coin.x, y: coin.y, w: 26, h: 34, color: 0xffffff, gravityScale: 1 });
    t.step(2);
    t.expect(t.api.byType("tagged-coin").length === 0, "touching a tagged coin collects it");
    t.expect(t.api.hud("score")?.value === 1, "the engine's score HUD counts it");
  },
};

/** A second mod that only tags, worth 2, into the same shared HUD. */
const taggedGems: ModDefinition = {
  id: "tagged-gems",
  title: "Tagged gems",
  setup(api) {
    api.spawn({
      type: "tagged-gem", x: 700, y: 340, w: 14, h: 14,
      color: 0x63e6ff, solid: false, gravityScale: 1, data: { collectible: 2 },
    });
  },
  dispose(api) {
    for (const e of api.byType("tagged-gem")) api.despawn(e.id);
  },
  test(t) {
    t.api.spawn({ type: "ground", x: -200, y: 400, w: 1200, h: 48, solid: true, gravityScale: 0 });
    const gem = t.api.byType("tagged-gem")[0];
    t.api.spawn({ type: "player", x: gem.x, y: gem.y, w: 26, h: 34, color: 0xffffff, gravityScale: 1 });
    t.step(2);
    t.expect(t.api.byType("tagged-gem").length === 0, "touching a tagged gem collects it");
    t.expect(t.api.hud("score")?.value === 2, "collectible: 2 is worth two points");
  },
};

/** A mod that already collects by hand AND tags: the engine must not count it twice. */
const handRolled: ModDefinition = {
  id: "hand-rolled",
  title: "Hand-rolled pickup",
  setup(api) {
    api.spawn({
      type: "hand-coin", x: 320, y: 380, w: 14, h: 14,
      color: 0xffd94d, solid: false, gravityScale: 0, data: { collectible: true },
    });
    api.onTick(() => {
      const p = api.player();
      if (!p) return;
      for (const c of api.byType("hand-coin")) {
        if (!api.touches(p, c)) continue;
        api.despawn(c.id);
        p.data.score = Number(p.data.score ?? 0) + 1;
      }
    });
  },
  dispose(api) {
    for (const e of api.byType("hand-coin")) api.despawn(e.id);
  },
};

function worldWith(...mods: ModDefinition[]): { w: World; l: ModLoader } {
  const w = new World(31);
  const l = new ModLoader(w);
  for (const m of mods) l.load(m);
  return { w, l };
}

const playerOf = (w: World) => w.entities.find((e) => e.type === "player")!;

/** Drop the player on an entity and run one step (the same trick hud.test uses). */
function touch(w: World, e: { x: number; y: number }): void {
  const p = playerOf(w);
  p.x = e.x;
  p.y = e.y;
  p.vx = 0;
  p.vy = 0;
  w.step();
}

describe("collectible tags (data.collectible)", () => {
  it("reads true as one point, a number as that many, a string as a HUD id", () => {
    const ent = (data: Record<string, number | string | boolean>) => ({ data } as never);
    expect(collectibleOf(ent({}))).toBeUndefined();
    expect(collectibleOf(ent({ collectible: false }))).toBeUndefined();
    expect(collectibleOf(ent({ collectible: 0 }))).toBeUndefined();
    expect(collectibleOf(ent({ collectible: "" }))).toBeUndefined();
    expect(collectibleOf(ent({ collectible: true }))).toEqual({ value: 1, hud: SCORE_HUD });
    expect(collectibleOf(ent({ collectible: true, value: 4 }))).toEqual({ value: 4, hud: SCORE_HUD });
    expect(collectibleOf(ent({ collectible: 5 }))).toEqual({ value: 5, hud: SCORE_HUD });
    expect(collectibleOf(ent({ collectible: "Gems!" }))).toEqual({ value: 1, hud: "gems" });
    expect(collectibleOf(ent({ collectible: true, collectibleHud: "blue-gems" }))).toEqual({ value: 1, hud: "blue-gems" });
  });

  it("never lets a typo wreck the counter: odd values stay finite, positive and capped", () => {
    const ent = (data: Record<string, number | string | boolean>) => ({ data } as never);
    expect(collectibleOf(ent({ collectible: -3 }))).toEqual({ value: 1, hud: SCORE_HUD });
    expect(collectibleOf(ent({ collectible: Number.NaN }))).toEqual({ value: 1, hud: SCORE_HUD });
    expect(collectibleOf(ent({ collectible: Number.POSITIVE_INFINITY }))).toEqual({ value: 1, hud: SCORE_HUD });
    expect(collectibleOf(ent({ collectible: 1e9 }))?.value).toBe(1000);
  });
});

describe("engine-owned picking up (ADR 0055)", () => {
  it("collects a tagged pickup on touch: despawn, burst, and one shared score HUD", () => {
    const w = new World(7);
    const p = w.spawn({ type: "player", x: 100, y: 300, w: 26, h: 34, color: 0xffffff, gravityScale: 0 }, "player");
    const gem = w.spawn({
      type: "crystal", x: 104, y: 304, w: 14, h: 14,
      color: 0x63e6ff, solid: false, gravityScale: 0, data: { collectible: true },
    }, "rocks");
    expect(w.hud.has(SCORE_HUD)).toBe(false);
    const particlesBefore = w.particles.length;
    w.step();
    expect(w.entities.some((e) => e.id === gem.id)).toBe(false);
    expect(w.particles.length).toBeGreaterThanOrEqual(particlesBefore + COLLECT_BURST);
    const hud = w.hud.get(SCORE_HUD)!;
    expect(hud.owner).toBe(ENGINE_OWNER);
    expect(hud.kind).toBe("stat");
    expect(hud.value).toBe(1);
    expect(p.data.score).toBeUndefined(); // the engine keeps the total, not the player
  });

  it("adds the tagged value, and a named hud id gets its own counter", () => {
    const w = new World(8);
    w.spawn({ type: "player", x: 100, y: 300, w: 26, h: 34, color: 0xffffff, gravityScale: 0 }, "player");
    w.spawn({ type: "coin", x: 104, y: 304, w: 14, h: 14, gravityScale: 0, data: { collectible: 3 } }, "a");
    w.spawn({ type: "gem", x: 104, y: 304, w: 14, h: 14, gravityScale: 0, data: { collectible: "gems" } }, "b");
    w.step();
    expect(w.hud.get(SCORE_HUD)?.value).toBe(3);
    expect(w.hud.get("gems")).toMatchObject({ id: "gems", owner: ENGINE_OWNER, kind: "stat", value: 1, label: "Gems" });
  });

  it("leaves untagged coins and already-taken pickups alone", () => {
    const w = new World(9);
    w.spawn({ type: "player", x: 100, y: 300, w: 26, h: 34, color: 0xffffff, gravityScale: 0 }, "player");
    const plain = w.spawn({ type: "coin", x: 104, y: 304, w: 14, h: 14, gravityScale: 0 }, "coins");
    const taken = w.spawn({ type: "gem", x: 104, y: 304, w: 14, h: 14, gravityScale: 0, data: { collectible: true, collected: true } }, "other");
    for (let i = 0; i < 5; i++) w.step();
    expect(w.entities.some((e) => e.id === plain.id)).toBe(true);
    expect(w.entities.some((e) => e.id === taken.id)).toBe(true);
    expect(w.hud.has(SCORE_HUD)).toBe(false);
  });

  it("needs the player's reach: a pickup two screens away stays put", () => {
    const w = new World(10);
    w.spawn({ type: "player", x: 0, y: 300, w: 26, h: 34, color: 0xffffff, gravityScale: 0 }, "player");
    const far = w.spawn({ type: "gem", x: 900, y: 300, w: 14, h: 14, gravityScale: 0, data: { collectible: true } }, "far");
    w.step();
    expect(w.entities.some((e) => e.id === far.id)).toBe(true);
    expect(w.hud.has(SCORE_HUD)).toBe(false);
  });

  it("two mods share ONE score HUD, values add up, and each passes its own test()", () => {
    for (const mod of [taggedCoins, taggedGems]) {
      const r = runModTest(mod);
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
    }
    const { w } = worldWith(groundMod, playerMod, taggedCoins, taggedGems);
    for (let i = 0; i < 60; i++) w.step(); // both drops land
    const scores = () => w.hudList().filter((h) => h.id === SCORE_HUD);
    expect(scores()).toHaveLength(0); // nobody collected anything yet
    touch(w, w.entities.find((e) => e.type === "tagged-coin")!);
    expect(scores()).toHaveLength(1);
    expect(scores()[0]).toMatchObject({ owner: ENGINE_OWNER, value: 1, label: "Coins" });
    touch(w, w.entities.find((e) => e.type === "tagged-gem")!);
    expect(scores()).toHaveLength(1); // still one widget, never a second counter
    expect(scores()[0].value).toBe(3);
  });

  it("does not double count a mod that already collects by hand in onTick", () => {
    const { w } = worldWith(groundMod, playerMod, handRolled);
    touch(w, w.entities.find((e) => e.type === "hand-coin")!);
    expect(w.entities.some((e) => e.type === "hand-coin")).toBe(false);
    expect(playerOf(w).data.score).toBe(1); // the mod's own count
    expect(w.hud.has(SCORE_HUD)).toBe(false); // the engine never saw the coin
    expect(w.collected.get(SCORE_HUD)).toBeUndefined();
  });

  it("keeps the banked total through the dropping mod's undo, and refills a wiped widget", () => {
    const { w, l } = worldWith(groundMod, playerMod, taggedCoins);
    for (let i = 0; i < 60; i++) w.step();
    touch(w, w.entities.find((e) => e.type === "tagged-coin")!);
    expect(w.hud.get(SCORE_HUD)?.value).toBe(1);
    l.unload("tagged-coins");
    expect(w.hud.get(SCORE_HUD)?.value).toBe(1); // the engine owns it, not the mod
    expect(w.collected.get(SCORE_HUD)).toBe(1);
    // A mod that reuses the id and is then undone takes the widget with it.
    w.setHud("greedy", SCORE_HUD, { kind: "stat", label: "Mine", value: 99 });
    w.removeHud("greedy", SCORE_HUD);
    expect(w.hud.has(SCORE_HUD)).toBe(false);
    w.step();
    expect(w.hud.get(SCORE_HUD)).toMatchObject({ owner: ENGINE_OWNER, value: 1, label: "Coins" });
  });

  it("is deterministic for the same seed and steps", () => {
    const run = (): string => {
      const w = new World(1234);
      w.spawn({ type: "player", x: 100, y: 300, w: 26, h: 34, color: 0xffffff, gravityScale: 0 }, "player");
      for (let i = 0; i < 6; i++) {
        w.spawn({ type: "gem", x: 90 + i * 4, y: 296 + i, w: 14, h: 14, color: 0x63e6ff, gravityScale: 0, data: { collectible: i % 2 === 0 ? 2 : true } }, `m${i}`);
      }
      for (let i = 0; i < 30; i++) w.step();
      return JSON.stringify({ hud: w.hudList(), collected: [...w.collected], particles: w.particles.length });
    };
    expect(run()).toBe(run());
  });
});

describe("engine-collected pickups still pop and sound on the client (feel.ts)", () => {
  it("pops a tagged pickup whose type is not a coin, and emits the coin sound", () => {
    const events: string[] = [];
    const feel = new Feel(new Container(), () => {}, true, (e) => events.push(e.kind));
    const base = { vx: 0, vy: 0, color: 0xffffff, solid: false, gravityScale: 1, facing: 1 as const, onGround: true, health: 100, owner: "" };
    const player = { ...base, id: 1, type: "player", x: 100, y: 100, w: 26, h: 34, data: {} };
    const relic = { ...base, id: 2, type: "relic", x: 110, y: 110, w: 16, h: 16, data: { collectible: true } };
    feel.update([player, relic], 1 / 60);
    feel.update([player], 1 / 60); // the engine collected it
    const parts = (feel as unknown as { parts: unknown[] }).parts;
    expect(parts.length).toBe(10); // one ring + nine sparks
    expect(events).toContain("coin");
  });
});
