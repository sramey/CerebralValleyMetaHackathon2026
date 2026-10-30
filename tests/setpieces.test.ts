import { describe, expect, it } from "vitest";
import {
  computeSetPieceLayout,
  isSetPiece,
  isSetPieceSubject,
  shouldOverrideShapeWithArt,
} from "../src/client/setpieces";
import {
  computeRockVertices,
  debrisKindOf,
  hashDebris,
  isDebrisOrHazard,
  mixRgb,
  scaleRgb,
} from "../src/client/debris";

describe("setpieces override and classification (bead metabuild-ideation-bex)", () => {
  it("identifies landmark set-piece subjects", () => {
    expect(isSetPieceSubject("volcano")).toBe(true);
    expect(isSetPieceSubject("castle")).toBe(true);
    expect(isSetPieceSubject("waterfall")).toBe(true);
    expect(isSetPieceSubject("giant tree")).toBe(true);
    expect(isSetPieceSubject("ancient tree")).toBe(true);
    expect(isSetPieceSubject("pyramid")).toBe(true);
    expect(isSetPieceSubject("pirate ship")).toBe(true);
    expect(isSetPieceSubject("watchtower")).toBe(true);
    expect(isSetPieceSubject("lighthouse")).toBe(true);
    expect(isSetPieceSubject("mountain")).toBe(true);
    expect(isSetPieceSubject("campfire")).toBe(true);

    // Negative cases: small items, characters, projectiles
    expect(isSetPieceSubject("ninja")).toBe(false);
    expect(isSetPieceSubject("chicken")).toBe(false);
    expect(isSetPieceSubject("coin")).toBe(false);
    expect(isSetPieceSubject("bullet")).toBe(false);
    expect(isSetPieceSubject("tree")).toBe(false); // standard tree is regular prop unless giant or sized large
  });

  it("identifies set-piece entities and respects explicit landmark flags", () => {
    // Wonder's volcano mod
    const volcano = {
      type: "volcano",
      x: 650,
      y: 230,
      w: 200,
      h: 170,
      data: { visual: "shape", craterX: 750, craterY: 242 },
    };
    expect(isSetPiece(volcano)).toBe(true);

    const castle = { type: "castle", x: 400, y: 150, w: 250, h: 250 };
    expect(isSetPiece(castle)).toBe(true);

    const waterfall = { type: "waterfall", x: 300, y: 100, w: 120, h: 300 };
    expect(isSetPiece(waterfall)).toBe(true);

    const campfire = { type: "campfire", x: 300, y: 366, w: 48, h: 34 };
    expect(isSetPiece(campfire)).toBe(true);

    // A large tree is recognized as a setpiece
    const giantTree = { type: "tree", x: 100, y: 200, w: 100, h: 200 };
    expect(isSetPiece(giantTree)).toBe(true);

    // A small sapling is not a setpiece
    const smallTree = { type: "tree", x: 100, y: 360, w: 24, h: 40 };
    expect(isSetPiece(smallTree)).toBe(false);

    // Explicit setpiece data flag
    const customMonument = { type: "mystic-shrine", x: 100, y: 300, w: 50, h: 50, data: { setpiece: true } };
    expect(isSetPiece(customMonument)).toBe(true);
  });

  it("overrides visual:'shape' with generated sprite art for nameable set-pieces", () => {
    // The volcano from the user's issue: had data.visual = "shape"
    const volcano = {
      type: "volcano",
      data: { visual: "shape" },
    };
    expect(shouldOverrideShapeWithArt(volcano)).toBe(true);

    const castle = { type: "castle", data: { visual: "shape" } };
    expect(shouldOverrideShapeWithArt(castle)).toBe(true);

    const campfire = { type: "campfire", data: { visual: "shape" } };
    expect(shouldOverrideShapeWithArt(campfire)).toBe(true);

    // Geometric primitives that should stay shapes
    const ball = { type: "ball", data: { visual: "shape" } };
    expect(shouldOverrideShapeWithArt(ball)).toBe(false);

    const spikes = { type: "spikes", data: { visual: "shape" } };
    expect(shouldOverrideShapeWithArt(spikes)).toBe(false);
  });

  it("anchors set-piece to ground level and computes fitting scale", () => {
    const e = { x: 500, y: 230, w: 200, h: 170 };
    // With 512x512 texture
    const layout = computeSetPieceLayout(e, 512, 512, 400);

    // Bottom must be anchored to ground (y = 400)
    expect(layout.y + layout.h).toBe(400);
    // Height must be at least entity height
    expect(layout.h).toBe(170);
    // Aspect ratio 1:1 means width matches height (or at least entity w)
    expect(layout.w).toBe(200);
    // Centered at e.x + e.w / 2 = 500 + 100 = 600
    expect(layout.x + layout.w * 0.5).toBe(600);
  });

  it("enforces minimum landmark scale for undersized entities", () => {
    const tiny = { x: 200, y: 350, w: 40, h: 50 };
    const layout = computeSetPieceLayout(tiny, 0, 0, 400);

    // Ground anchored
    expect(layout.y + layout.h).toBe(400);
    // Enforces landmark presence (>= 150 px height, >= 180 px width)
    expect(layout.h).toBeGreaterThanOrEqual(150);
    expect(layout.w).toBeGreaterThanOrEqual(180);
    expect(layout.x + layout.w * 0.5).toBe(220);
  });
});

describe("debris and small hazard rendering (bead metabuild-ideation-bex)", () => {
  it("classifies rocks, magma rocks, and asteroids", () => {
    expect(debrisKindOf({ type: "magma-rock" })).toBe("rock");
    expect(debrisKindOf({ type: "lava-rock" })).toBe("rock");
    expect(debrisKindOf({ type: "rock" })).toBe("rock");
    expect(debrisKindOf({ type: "asteroid" })).toBe("rock");
    expect(debrisKindOf({ type: "boulder" })).toBe("rock");
    expect(debrisKindOf({ type: "stone" })).toBe("rock");

    expect(isDebrisOrHazard({ type: "magma-rock" })).toBe(true);
  });

  it("classifies glowing blobs, lava drops, fireballs, and meteors", () => {
    expect(debrisKindOf({ type: "lava-drop" })).toBe("glowing-blob");
    expect(debrisKindOf({ type: "magma-drop" })).toBe("glowing-blob");
    expect(debrisKindOf({ type: "fireball" })).toBe("glowing-blob");
    expect(debrisKindOf({ type: "meteor" })).toBe("glowing-blob");
    expect(debrisKindOf({ type: "spark" })).toBe("glowing-blob");
    expect(debrisKindOf({ type: "ember" })).toBe("glowing-blob");

    expect(isDebrisOrHazard({ type: "lava-drop" })).toBe(true);
  });

  it("rejects non-debris entities from debris classifier", () => {
    expect(debrisKindOf({ type: "player" })).toBeUndefined();
    expect(debrisKindOf({ type: "ground" })).toBeUndefined();
    expect(debrisKindOf({ type: "platform" })).toBeUndefined();
    expect(debrisKindOf({ type: "chicken" })).toBeUndefined();
    expect(debrisKindOf({ type: "coin" })).toBeUndefined();

    expect(isDebrisOrHazard({ type: "player" })).toBe(false);
  });

  it("generates deterministic irregular rock vertices from entity id", () => {
    const pts1 = computeRockVertices(100, 100, 20, 42, 0, 7);
    const pts2 = computeRockVertices(100, 100, 20, 42, 0, 7);

    // 7 vertices => 14 coordinate numbers
    expect(pts1.length).toBe(14);
    expect(pts1).toEqual(pts2);

    // Different entity id generates different irregular points
    const pts3 = computeRockVertices(100, 100, 20, 99, 0, 7);
    expect(pts1).not.toEqual(pts3);

    // Vertices are not a square: radius varies
    const radii = [];
    for (let i = 0; i < pts1.length; i += 2) {
      const d = Math.hypot(pts1[i] - 100, pts1[i + 1] - 100);
      radii.push(d);
    }
    const maxR = Math.max(...radii);
    const minR = Math.min(...radii);
    expect(maxR).toBeGreaterThan(minR);
  });

  it("computes pure color utilities deterministically", () => {
    const brighter = scaleRgb(0x808080, 1.5);
    expect((brighter >> 16) & 255).toBe(192);

    const darker = scaleRgb(0x808080, 0.5);
    expect((darker >> 16) & 255).toBe(64);

    const mixed = mixRgb(0x000000, 0xffffff, 0.5);
    expect((mixed >> 16) & 255).toBe(128);

    const h1 = hashDebris(123, 1);
    const h2 = hashDebris(123, 1);
    expect(h1).toBe(h2);
    expect(h1).toBeGreaterThanOrEqual(0);
    expect(h1).toBeLessThanOrEqual(1);
  });
});
