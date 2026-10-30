import { describe, expect, it } from "vitest";
import type { ModDefinition } from "../src/contract";
import { isSceneScenery } from "../src/sim/scene";
import { isSetPiece } from "../src/client/setpieces";
import { ModLoader } from "../src/sim/loader";
import { World } from "../src/sim/world";

const landmarks: ModDefinition = {
  id: "landmarks", title: "Landmarks", setup(api) {
    for (const type of ["volcano", "castle", "waterfall"]) api.spawn({ type, x: 300, y: 240, w: 120, h: 160, solid: false, gravityScale: 0 });
  }, dispose() {},
};
const space: ModDefinition = { id: "space", title: "Space", setup(api) { api.setScene!({ backdrop: "space", hideScenery: true }); }, dispose() {} };

describe("set-pieces and genre scenes (ADR 0066)", () => {
  it("a non-solid landmark is scenery: a space scene hides it and undo brings it back", () => {
    const world = new World(1);
    const loader = new ModLoader(world);
    loader.load(landmarks);
    for (const e of world.entities) {
      expect(isSetPiece(e)).toBe(true);
      expect(isSceneScenery(e)).toBe(true);
    }
    loader.load(space);
    expect(world.entities.some((e) => e.type === "volcano")).toBe(false);
    loader.unload("space");
    expect(world.entities.map((e) => e.type).sort()).toEqual(["castle", "volcano", "waterfall"]);
  });
});
