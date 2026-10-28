import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";
import { ModLoader, runModTest } from "../src/sim/loader";
import chickenMod from "../src/mods/chicken";

describe("chicken", () => {
  it("passes its runModTest", () => {
    const r = runModTest(chickenMod);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it("unload removes all owned chickens", () => {
    const w = new World(4);
    const l = new ModLoader(w);
    l.load(chickenMod);
    expect(w.entities.filter((e) => e.type === "chicken").length).toBeGreaterThan(0);
    l.unload("chicken");
    expect(w.entities.filter((e) => e.type === "chicken")).toHaveLength(0);
  });
  it("respects the count knob", () => {
    const w = new World(4);
    const l = new ModLoader(w);
    l.load(chickenMod, { count: 4 });
    expect(w.entities.filter((e) => e.type === "chicken")).toHaveLength(4);
    l.unload("chicken");
  });
});
