// The "Ground width" knob did nothing visible (bead r8n): the slab was anchored at x = -3200 with
// `width + 3000`, so its right end sat at `width - 200` — 2200 px away at the default and 5800 px
// at the top of the range, both far outside the ~960 px the camera shows. The slab is now centred
// on the play area, so dragging the knob really widens and narrows the ground you can walk on and
// its ends come into view.
import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";
import { ModLoader } from "../src/sim/loader";
import { GROUND_DEFAULT_WIDTH, groundMod } from "../src/mods/ground";
import { playerMod } from "../src/mods/player";
import { runModTest } from "../src/sim/loader";

const SPAWN_X = 120;
const LEVEL_END = 1150; // the overhang tunnel, the last thing the starter level needs floor under
const SCREEN = 960;

function load(width?: number): { w: World; loader: ModLoader } {
  const w = new World(11);
  const loader = new ModLoader(w);
  loader.load(groundMod, width === undefined ? {} : { width });
  return { w, loader };
}

const slab = (w: World) => w.entities.find((e) => e.type === "ground")!;

describe("the ground width knob", () => {
  it("covers the starter level at its default and passes its own test", () => {
    const { w } = load();
    const g = slab(w);
    expect(g.w).toBe(GROUND_DEFAULT_WIDTH);
    expect(g.x).toBeLessThanOrEqual(SPAWN_X);
    expect(g.x + g.w).toBeGreaterThanOrEqual(LEVEL_END);
    expect(runModTest(groundMod).ok).toBe(true);
  });

  it("widens and narrows the slab, moving both ends", () => {
    const { w, loader } = load();
    const before = { ...slab(w) };
    loader.setKnob("ground", "width", 2800);
    const wide = { ...slab(w) };
    expect(wide.w).toBe(2800);
    expect(wide.x).toBeLessThan(before.x); // the left end moved left
    expect(wide.x + wide.w).toBeGreaterThan(before.x + before.w); // the right end moved right

    loader.setKnob("ground", "width", 1200);
    const narrow = { ...slab(w) };
    expect(narrow.w).toBe(1200);
    expect(narrow.x).toBeGreaterThan(wide.x);
    expect(narrow.x + narrow.w).toBeLessThan(wide.x + wide.w);
  });

  it("keeps the ends near enough to the spawn to see and reach, at every setting", () => {
    const { w, loader } = load();
    for (const width of [1200, 2100, 2800]) {
      loader.setKnob("ground", "width", width);
      const g = slab(w);
      // The right end is at most two screens away, so a player can walk to it and see the change.
      expect(g.x + g.w - SPAWN_X).toBeLessThan(2 * SCREEN);
      // The left end is at most one screen left of the spawn, so narrowing brings a cliff into view.
      expect(SPAWN_X - g.x).toBeLessThan(SCREEN);
      // And the level is never left hanging over a hole.
      expect(g.x).toBeLessThanOrEqual(SPAWN_X);
      expect(g.x + g.w).toBeGreaterThanOrEqual(LEVEL_END);
    }
  });

  it("never narrows past the level, whatever number reaches it", () => {
    const { w, loader } = load();
    loader.setKnob("ground", "width", 10);
    const g = slab(w);
    expect(g.w).toBe(1200);
    expect(g.x + g.w).toBeGreaterThanOrEqual(LEVEL_END);
  });

  it("puts the player on solid ground at every setting", () => {
    for (const width of [1200, 2100, 2800]) {
      const w = new World(3);
      const loader = new ModLoader(w);
      loader.load(groundMod, { width });
      loader.load(playerMod);
      for (let i = 0; i < 90; i++) w.step();
      const p = w.entities.find((e) => e.type === "player")!;
      expect(p.onGround).toBe(true);
      expect(p.y + p.h).toBeCloseTo(400, 0);
    }
  });
});
