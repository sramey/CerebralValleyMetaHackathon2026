import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { World } from "../src/sim/world";
import { ModLoader, runModTest } from "../src/sim/loader";
import { compileMod } from "../server/compile";
import { resolveItemMod } from "../src/client/items";
import jetpackMod from "../src/mods/jetpack";

describe("jetpack mod (bead metabuild-ideation-epl)", () => {
  it("passes its runModTest", () => {
    const r = runModTest(jetpackMod);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("compiles on the server as-is: a built-in mod source carries no value imports", () => {
    const src = readFileSync(new URL("../src/mods/jetpack.ts", import.meta.url), "utf8");
    expect(src.match(/^import\s+(?!type\b)[^;]+;/gm) ?? []).toEqual([]);
    const c = compileMod(src);
    expect(c.errors).toEqual([]);
    expect(c.ok).toBe(true);
  });

  it("resolves jetpack phrasings to the built-in jetpack mod", () => {
    expect(resolveItemMod("give me a jetpack")?.id).toBe("jetpack");
    expect(resolveItemMod("jetpack")?.id).toBe("jetpack");
    expect(resolveItemMod("add a jetpack")?.id).toBe("jetpack");
    expect(resolveItemMod("rocket pack")?.id).toBe("jetpack");
    expect(resolveItemMod("jet pack")?.id).toBe("jetpack");
  });

  it("unloads cleanly: no jetpack entity or fuel HUD left behind", () => {
    const w = new World(42);
    const l = new ModLoader(w);
    l.load(jetpackMod);
    expect(w.entities.filter((e) => e.type === "jetpack")).toHaveLength(1);
    expect(w.hudList().some((h) => h.id === "jetpack-fuel")).toBe(true);

    l.unload("jetpack");
    expect(w.entities.filter((e) => e.type === "jetpack")).toHaveLength(0);
    expect(w.hudList().some((h) => h.id === "jetpack-fuel")).toBe(false);
  });
});
