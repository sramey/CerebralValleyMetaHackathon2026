import { describe, expect, it } from "vitest";
import { type ArtPlan, artPlanFor, canUseSpriteSheet, entityKind } from "../src/ontology";
import { LEGACY_PURGE_KEYS, artKeyForType, isScenerySubject, isSkippedType, pickArtType } from "../server/art";

/**
 * ADR 0031: art decisions are derived from the entity ontology. These tests pin
 * the derivation and cover type names the old hand-maintained SKIP_TYPES and
 * scenery word lists never contained.
 */

/** Type names that appear in no hand list (and never did): compound modifiers over ontology head nouns. */
const UNSEEN: [type: string, plan: ArtPlan][] = [
  ["glacier-step", "none"], // terrain head noun
  ["obsidian-pillar", "none"], // static structure
  ["thundercloud", "scenery"], // prop head noun in an unseen compound
  ["bone-dagger", "held-item"], // held item
  ["void-stalker", "sheet"], // creature
  ["river-pebble", "scenery"], // scenery prop
  ["ghost-ship", "scenery"], // prop head noun, creature-looking modifier
  ["torchlight-garland", "none"], // effect
  ["rosy-apple", "scenery"], // prop
  ["clockwork-bell", "scenery"], // prop
];

describe("art plan comes from the ontology (ADR 0031)", () => {
  it("maps every kind to exactly one art form", () => {
    for (const t of ["ground", "snow-ground", "brick-wall", "stair", "custom-step", "platform-moving"]) {
      expect(artPlanFor(t), t).toBe("none");
    }
    for (const t of ["rain", "snowflake", "fog-bank", "christmas-light", "explosion"]) {
      expect(artPlanFor(t), t).toBe("none");
    }
    for (const t of ["bullet", "boss-bullet", "laser-beam", "fireball"]) {
      expect(artPlanFor(t), t).toBe("none");
    }
    for (const t of ["coin", "bouncing-ball", "christmas-star", "spike-trap", "gem"]) {
      expect(artPlanFor(t), t).toBe("none");
    }
    for (const t of ["gun", "laser-gun", "sword", "wand", "potion"]) {
      expect(artPlanFor(t), t).toBe("held-item");
    }
    for (const t of ["tree", "pine-tree", "christmas-gift", "house", "snowman"]) {
      expect(artPlanFor(t), t).toBe("scenery");
    }
    for (const t of ["turtle", "fire-dragon", "wanderer", "boss"]) {
      expect(artPlanFor(t), t).toBe("sheet");
    }
    // The player's sheet ships with the engine: a sheet, but never a generated one.
    expect(artPlanFor("player")).toBe("sheet");
    expect(isSkippedType("player")).toBe(true);
    expect(artKeyForType("player")).toBe("");
    // Static solids are terrain whatever they are called.
    expect(artPlanFor({ type: "mystery-surface", solid: true, gravityScale: 0 })).toBe("none");
  });

  it("classifies ten type names the old hand lists never saw", () => {
    for (const [type, plan] of UNSEEN) {
      expect(entityKind(type), type).toBeDefined();
      expect(artPlanFor(type), `${type} -> ${plan}`).toBe(plan);
    }
  });

  it("keeps every downstream art helper in agreement with the plan", () => {
    const corpus = [
      ...UNSEEN.map(([t]) => t),
      "ground",
      "snow-ground",
      "stair",
      "wall",
      "boss-bullet",
      "snowflake",
      "christmas-light",
      "christmas-star",
      "coin",
      "player",
      "gun",
      "sword",
      "tree",
      "christmas-gift",
      "dragon",
      "turtle",
      "ponytail", // cosmetic appendage: code-drawn, never a sheet
      "christmas-string", // light string: code-drawn, never a sheet
      "",
    ];
    for (const t of corpus) {
      const plan = artPlanFor(t);
      const skipped = isSkippedType(t);
      const key = artKeyForType(t);
      // The empty type is always skipped: there is nothing to draw.
      const expectSkipped = t === "" || plan === "none" || (plan === "sheet" && !canUseSpriteSheet(t));
      expect(skipped, `isSkippedType(${t})`).toBe(expectSkipped);
      expect(key === "", `artKeyForType(${t})`).toBe(skipped);
      expect(isScenerySubject(t), `isScenerySubject(${t})`).toBe(plan === "scenery" || plan === "held-item");
      // A spawned type only asks for art when the plan calls for it.
      const picked = pickArtType(`api.spawn({ type: "${t}", x: 0, y: 0, w: 20, h: 20 })`);
      expect(picked, `pickArtType(${t})`).toBe(skipped ? null : t);
    }
  });

  it("never generates art for a type the ontology draws in code, even when it is a static solid", () => {
    expect(artKeyForType("custom-step")).toBe("");
    expect(artKeyForType("hologram-panel")).not.toBe(""); // unknown head noun: creatures still get sheets
    expect(pickArtType(`api.spawn({ type: "custom-step", x: 200, y: 380, w: 40, h: 20, solid: true, gravityScale: 0 })`)).toBeNull();
    expect(pickArtType(`api.spawn({ type: "mystery-surface", x: 0, y: 0, w: 40, h: 20, solid: true, gravityScale: 0 })`)).toBeNull();
  });

  it("only names code-drawn keys in the legacy startup purge", () => {
    for (const key of LEGACY_PURGE_KEYS) {
      expect(artKeyForType(key), `purge key ${key} must never be valid art`).toBe("");
      expect(artPlanFor(key), key).toBe("none");
    }
  });
});
