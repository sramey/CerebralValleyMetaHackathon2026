// Bead 5yy: creatures that hop off the end of the ground are put back, and the entity cap
// takes the spawner's own drops before it takes a creature someone just built.
import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";
import { SIM } from "../src/contract";

const GROUND = { type: "ground", x: 0, y: 400, w: 2400, h: 200, solid: true, gravityScale: 0 };

function worldWithGround(): World {
  const w = new World(7);
  w.spawn(GROUND, "ground");
  w.spawn({ type: "player", x: 1200, y: 340, w: 32, h: 60 }, "player");
  return w;
}

describe("creatures at the end of the ground (bead 5yy)", () => {
  it("a hopper walking at the right end is back on the ground, not lost below it", () => {
    const w = worldWithGround();
    const slime = w.spawn({ type: "slime", x: 2300, y: 360, w: 40, h: 40, vx: 160 }, "slime");
    // The mod hops it every time it lands and keeps steering right, as a generated hopper does.
    // Check the invariant on every frame, not one lucky final frame: while it stands, it stands
    // on the slab (it is only ever past the end while falling, and the rescue puts it back).
    let standingOffSlab = false;
    for (let i = 0; i < 60 * 40; i++) {
      slime.vx = 160;
      if (slime.onGround) slime.vy = -420;
      w.step();
      if (slime.onGround && slime.y < 400 + 900 && (slime.x < 0 || slime.x > 2400)) standingOffSlab = true;
    }
    expect(w.entities).toContain(slime);
    expect(slime.y).toBeLessThan(400 + 900); // never ends up below the rescue line
    expect(standingOffSlab).toBe(false);
  });

  it("a creature that is already far below the slab stands beside the player, keeping its velocity", () => {
    const w = worldWithGround();
    const fallen = w.spawn({ type: "slime", x: 2600, y: 1700, w: 40, h: 40, vx: 90, vy: 800 }, "slime");
    w.step();
    expect(fallen.y + fallen.h).toBeCloseTo(400, 0);
    expect(fallen.onGround).toBe(true);
    expect(Math.abs(fallen.x - 1200)).toBeLessThan(400);
    expect(fallen.vx).toBe(90);
  });

  it("leaves everything else alone: flyers and non-creatures stay where they are", () => {
    const w = worldWithGround();
    const flyer = w.spawn({ type: "dragon", x: 100, y: 3000, w: 80, h: 60, gravityScale: 0 }, "dragon");
    const crate = w.spawn({ type: "crate", x: 100, y: 3000, w: 30, h: 30 }, "crate");
    w.step();
    expect(flyer.y).toBeGreaterThan(2000);
    expect(crate.y).toBeGreaterThan(2000); // a prop that fell is not a creature, so it is not rescued
  });

  it("does nothing in a world with no ground slab", () => {
    const w = new World(7);
    const slime = w.spawn({ type: "slime", x: 100, y: 5000, w: 40, h: 40 }, "slime");
    w.step();
    expect(slime.y).toBeGreaterThan(4000);
  });
});

describe("entity cap eviction (bead 5yy)", () => {
  it("rain evicts its own oldest drops before a creature someone just built", () => {
    const w = worldWithGround();
    const slime = w.spawn({ type: "slime", x: 600, y: 360, w: 40, h: 40 }, "slime-mod");
    while (w.entities.length < SIM.maxEntities) {
      w.spawn({ type: "raindrop", x: 10, y: 10, w: 2, h: 8, gravityScale: 0 }, "rain");
    }
    const first = w.entities.find((e) => e.owner === "rain")!;
    for (let i = 0; i < 50; i++) w.spawn({ type: "raindrop", x: 20, y: 10, w: 2, h: 8, gravityScale: 0 }, "rain");
    expect(w.entities).toContain(slime);
    expect(w.entities).not.toContain(first);
    expect(w.entities.length).toBeLessThanOrEqual(SIM.maxEntities);
  });
});
