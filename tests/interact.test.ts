import { describe, expect, it } from "vitest";
import type { ModDefinition, ModEvent } from "../src/contract";
import { emptyInput } from "../src/contract";
import { ModLoader, runModTest } from "../src/sim/loader";
import { World } from "../src/sim/world";

const ground = (w: World) => w.spawn({ type: "ground", x: -2000, y: 400, w: 6000, h: 48, solid: true, gravityScale: 0 }, "engine");
const player = (w: World, x = 0) => w.spawn({ type: "player", x, y: 360, w: 24, h: 34, gravityScale: 1 }, "engine");

/** A mod that records every event it hears. */
function recorder(id: string, seen: ModEvent[], body?: (api: Parameters<ModDefinition["setup"]>[0]) => void): ModDefinition {
  return {
    id, title: id,
    setup(api) {
      for (const t of ["touch", "hit", "death", "interact", "order", "signal"] as const) api.on?.(t, (ev) => seen.push(ev));
      body?.(api);
    },
    dispose() {},
  };
}

describe("mod events (ADR 0059)", () => {
  it("hit and death reach the owner next tick, death with the last position and the attacker", () => {
    const w = new World(1);
    const loader = new ModLoader(w);
    const seen: ModEvent[] = [];
    let slime = -1;
    loader.load(recorder("slimes", seen, (api) => { slime = api.spawn({ type: "slime", x: 300, y: 370, w: 30, h: 30 }).id; }));
    loader.load({ id: "sword", title: "Sword", setup(api) { api.onTick(() => { if (api.tick() === 2) { api.damage(slime, 40); api.damage(slime, 80); } }); }, dispose() {} });
    w.step(); w.step();
    expect(seen).toEqual([]); // raised inside the sword's tick, not delivered into it
    w.step();
    expect(seen.map((e) => e.type)).toEqual(["hit", "hit", "death"]);
    const death = seen[2];
    expect(death.by).toBe("sword");
    expect(death.entity?.x).toBe(300); // a copy: the live entity has no x any more
  });

  it("touch fires once per contact, and only for mods that listen", () => {
    const w = new World(1);
    ground(w);
    const p = player(w, 0);
    const loader = new ModLoader(w);
    const seen: ModEvent[] = [];
    loader.load(recorder("cat", seen, (api) => { api.spawn({ type: "cat", x: 10, y: 370, w: 30, h: 30, gravityScale: 0 }); }));
    for (let i = 0; i < 10; i++) w.step();
    expect(seen.filter((e) => e.type === "touch")).toHaveLength(1);
    expect(seen[0].other?.id).toBe(p.id);
  });

  it("the action key next to data.interact raises interact and shows a prompt", () => {
    const w = new World(1);
    ground(w);
    player(w, 0);
    const loader = new ModLoader(w);
    const seen: ModEvent[] = [];
    loader.load(recorder("sage", seen, (api) => {
      api.spawn({ type: "sage", x: 50, y: 360, w: 30, h: 40, gravityScale: 0, data: { interact: "Ask" } });
      api.on?.("interact", (ev) => api.say?.(ev.entity!, "Seek the golden coin."));
    }));
    w.step();
    expect(w.interactable?.label).toBe("Ask");
    w.input = { ...emptyInput(), use: true };
    w.step(); w.step(); w.step(); // held: one press, one event
    w.input = emptyInput();
    w.step();
    expect(seen.filter((e) => e.type === "interact")).toHaveLength(1);
    expect([...w.speech.values()][0]?.text).toBe("Seek the golden coin.");
  });

  it("signals reach every other mod, not the sender", () => {
    const w = new World(1);
    const loader = new ModLoader(w);
    const a: ModEvent[] = [];
    const b: ModEvent[] = [];
    loader.load(recorder("boss", a, (api) => api.onTick(() => { if (api.tick() === 1) api.signal?.("boss-down", 1); })));
    loader.load(recorder("door", b));
    w.step(); w.step();
    expect(a).toEqual([]);
    expect(b).toEqual([{ type: "signal", name: "boss-down", value: 1, from: "boss" }]);
  });

  it("a listener that throws is contained like a tick handler", () => {
    const w = new World(1);
    const loader = new ModLoader(w);
    const quarantined: string[] = [];
    loader.isolateFaults((m) => quarantined.push(m.id));
    loader.load({ id: "bad", title: "Bad", setup(api) { api.on?.("signal", () => { throw new Error("boom"); }); }, dispose() {} });
    loader.load({ id: "bell", title: "Bell", setup(api) { api.onTick(() => { if (api.tick() === 1) api.signal?.("ring"); }); }, dispose() {} });
    w.step(); w.step(); w.step();
    expect(quarantined).toEqual(["bad"]);
    expect(loader.has("bell")).toBe(true);
  });

  it("unload drops listeners and bubbles; a reload does not double them", () => {
    const w = new World(1);
    const loader = new ModLoader(w);
    const seen: ModEvent[] = [];
    const def = recorder("echo", seen, (api) => { const e = api.spawn({ type: "owl", x: 0, y: 0, w: 10, h: 10, gravityScale: 0 }); api.say?.(e, "hoot"); });
    loader.load({ id: "bell", title: "Bell", setup(api) { api.onTick(() => api.signal?.("ring")); }, dispose() {} });
    loader.load(def);
    loader.load(def); // reload
    w.step(); w.step();
    expect(seen.filter((e) => e.type === "signal")).toHaveLength(1);
    loader.unload("echo");
    expect(w.speech.size).toBe(0);
  });

  it("works inside a mod's own test()", () => {
    const def: ModDefinition = {
      id: "piñata", title: "Piñata",
      setup(api) {
        api.spawn({ type: "pinata", x: 0, y: 0, w: 20, h: 20, gravityScale: 0, health: 10 });
        api.on?.("death", (ev) => api.spawn({ type: "candy", x: ev.entity!.x, y: ev.entity!.y, w: 8, h: 8, gravityScale: 0 }));
      },
      dispose() {},
      test(t) {
        t.api.damage(t.api.byType("pinata")[0].id, 50);
        t.step(1);
        t.expect(t.api.byType("candy").length === 1, "candy drops where it broke");
      },
    };
    expect(runModTest(def)).toEqual({ ok: true, errors: [] });
  });
});

describe("standing orders (ADR 0059)", () => {
  const herd = () => {
    const w = new World(1);
    ground(w);
    const p = player(w, 0);
    const loader = new ModLoader(w);
    // A chicken that wanders right on its own every tick, like a real mod.
    loader.load({ id: "chickens", title: "Chickens", setup(api) {
      api.spawn({ type: "chicken", x: 400, y: 370, w: 24, h: 24, gravityScale: 1, data: { casual: true } });
      api.onTick(() => { for (const c of api.byType("chicken")) c.vx = 60; });
    }, dispose() {} });
    return { w, p, loader, hen: () => w.entities.find((e) => e.type === "chicken")! };
  };

  it("follow walks a creature over to the player and keeps it there, whatever its own code says", () => {
    const { w, loader, hen } = herd();
    expect(loader.order("chickens", "follow")).toBe(1);
    for (let i = 0; i < 360; i++) w.step();
    expect(Math.abs(hen().x - 0)).toBeLessThan(140);
    expect([...w.speech.values()]).toEqual([]); // the ack bubble aged out
  });

  it("stay holds it still; free hands it back to its mod", () => {
    const { w, loader, hen } = herd();
    loader.order("chickens", "stay");
    for (let i = 0; i < 30; i++) w.step();
    const x = hen().x;
    for (let i = 0; i < 60; i++) w.step();
    expect(hen().x).toBeCloseTo(x, 0);
    loader.order("chickens", "free");
    for (let i = 0; i < 60; i++) w.step();
    expect(hen().x).toBeGreaterThan(x + 20);
  });

  it("only creatures take orders; the order reaches the mod as an event", () => {
    const w = new World(1);
    ground(w);
    player(w);
    const loader = new ModLoader(w);
    const seen: ModEvent[] = [];
    loader.load(recorder("zoo", seen, (api) => {
      api.spawn({ type: "tree", x: 100, y: 300, w: 40, h: 100, solid: true, gravityScale: 0 });
      api.spawn({ type: "dog", x: 200, y: 370, w: 30, h: 30 });
    }));
    expect(loader.order("*", "come")).toBe(1);
    expect(loader.order("nobody", "come")).toBe(0);
    w.step();
    expect(seen.map((e) => [e.type, e.order, e.entity?.type])).toEqual([["order", "come", "dog"]]);
  });
});
