import { afterEach, describe, expect, it, vi } from "vitest";
import type { Texture } from "pixi.js";
import { canUseSpriteSheet, detectMoodCommand, entityKind, extractSpawnedEntities, isHeldItemType, isPlayerAbilityCommand, isPlayerCommand } from "../src/ontology";
import { artKeyForType, deriveSubject, generateSubjectArt, isScenerySubject, pickArtType } from "../server/art";
import { moodSpecFor, sheetPath } from "../server/mood";
import { newRecent, noteTouched, resolvePronoun } from "../server/context";
import { formatManifest } from "../server/prompt";
import { framesFor } from "../src/client/sprites";
import { World } from "../src/sim/world";

describe("entity ontology & art invariants (x9i, 98v, olm)", () => {
  it("classifies terrain, effects, projectiles, shapes, props, creatures, and player deterministically", () => {
    expect(entityKind("player")).toBe("player");
    for (const t of ["ground", "snow-ground", "ice-platform", "platform-moving", "brick-wall", "wall", "stair", "stairs", "step", "ledge", "ramp", "block", "pillar"]) {
      expect(entityKind(t), t).toBe("terrain");
      expect(canUseSpriteSheet(t), t).toBe(false);
    }
    // Static solids (solid: true && gravityScale === 0) are always terrain regardless of type name.
    expect(entityKind({ type: "mystery-surface", solid: true, gravityScale: 0 })).toBe("terrain");

    for (const t of ["rain", "raindrop", "snow", "snowflake", "fog", "fog-bank", "smoke", "explosion", "spark", "christmas-light", "garland", "aurora"]) {
      expect(entityKind(t), t).toBe("effect");
      expect(canUseSpriteSheet(t), t).toBe(false);
    }

    for (const t of ["projectile", "bullet", "boss-bullet", "shot", "orb-shot", "arrow", "fire-arrow", "fireball", "laser", "laser-beam", "missile", "shuriken"]) {
      expect(entityKind(t), t).toBe("projectile");
      expect(canUseSpriteSheet(t), t).toBe(false);
    }

    for (const t of ["coin", "ball", "bouncing-ball", "orb", "bubble", "ring", "spikes", "spike-trap", "triangle", "diamond", "gem", "star", "christmas-star", "pill", "bomb"]) {
      expect(entityKind(t), t).toBe("shape");
      expect(canUseSpriteSheet(t), t).toBe(false);
    }

    for (const t of ["christmas-gift", "tree", "snowman", "house", "castle", "chest", "gun", "laser-gun", "sword", "shield", "bow", "wand"]) {
      expect(entityKind(t), t).toBe("prop");
      expect(canUseSpriteSheet(t), t).toBe(true);
      expect(isScenerySubject(t), t).toBe(true);
    }

    for (const t of ["dragon", "fire-dragon", "zombie", "turtle", "chicken", "robot", "elf", "boss", "wanderer"]) {
      expect(entityKind(t), t).toBe("creature");
      expect(canUseSpriteSheet(t), t).toBe(true);
      expect(isScenerySubject(t), t).toBe(false);
    }
  });

  it("pickArtType and artKeyForType never return a sprite key for terrain, effects, projectiles, or shapes", () => {
    const forbidden = [
      "ground",
      "snow-ground",
      "ice-platform",
      "brick-wall",
      "wall",
      "stair",
      "stairs",
      "step",
      "boss-bullet",
      "snowflake",
      "christmas-light",
      "christmas-star",
    ];
    for (const t of forbidden) {
      expect(artKeyForType(t), `artKeyForType(${t})`).toBe("");
      expect(pickArtType(`api.spawn({ type: "${t}", x: 0, y: 0, w: 40, h: 40 })`), `pickArtType(${t})`).toBeNull();
    }
    // Static solid geometry with an arbitrary type name is also rejected by pickArtType.
    expect(pickArtType(`api.spawn({ type: "custom-step", x: 200, y: 380, w: 40, h: 20, solid: true, gravityScale: 0 })`)).toBeNull();
  });

  it("classifies held items (gun, sword, wand) as isolated non-character items and never guy-with-gun", async () => {
    expect(isHeldItemType("gun")).toBe(true);
    expect(isHeldItemType("laser-gun")).toBe(true);
    expect(isHeldItemType("sword")).toBe(true);
    expect(isHeldItemType("gunner")).toBe(false);
    expect(deriveSubject("Give me a gun.", "gun")).toBe("gun");
    expect(deriveSubject("Give my character a laser gun that shoots fast", "laser-gun")).toBe("laser gun");

    process.env.MODEL_API_KEY = "test-key-not-real";
    const prompts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        prompts.push(JSON.parse(init.body).prompt);
        return { ok: false, status: 500, json: async () => ({}) };
      }),
    );
    await generateSubjectArt("gun", "gun", false);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("NO character");
    expect(prompts[0]).toContain("NO hands holding it");
    expect(prompts[0]).not.toContain("idle, running, running, jumping");

    // And generateSubjectArt on "ground" or "snow-ground" never calls fetch at all.
    prompts.length = 0;
    expect(await generateSubjectArt("this Christmas themed", "ground", false)).toBeNull();
    expect(await generateSubjectArt("this Christmas themed", "snow-ground", false)).toBeNull();
    expect(await generateSubjectArt("some stairs", "stair", false)).toBeNull();
    expect(await generateSubjectArt("a wall", "wall", false)).toBeNull();
    expect(prompts).toHaveLength(0);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("client framesFor never returns a sprite sheet for terrain, effect, projectile, or shape entities", () => {
    const fakeTex = {} as Texture;
    const map: Record<string, Texture[]> = {
      ninja: [fakeTex],
      ground: [fakeTex],
      stair: [fakeTex],
      wall: [fakeTex],
      platform: [fakeTex],
      bullet: [fakeTex],
      dragon: [fakeTex],
      tree: [fakeTex],
    };
    for (const t of ["ground", "snow-ground", "platform", "ice-platform", "stair", "wall", "brick-wall", "boss-bullet", "snowflake", "christmas-star"]) {
      expect(framesFor(map, t, false), t).toEqual([]);
    }
    expect(framesFor(map, "player", true)).toEqual([fakeTex]);
    expect(framesFor(map, "fire-dragon", false)).toEqual([fakeTex]);
    expect(framesFor(map, "pine-tree", false)).toEqual([fakeTex]);
    expect(sheetPath("ground")).toBeNull();
    expect(sheetPath("stair")).toBeNull();
    expect(sheetPath("wall")).toBeNull();
  });

  it("routes 'Make this Christmas themed.' and theme words ('daytime', 'spooky') to mood without pronoun hijacking", async () => {
    expect(detectMoodCommand("Make this Christmas themed.")).toBe("christmas");
    expect(detectMoodCommand("make it christmas themed")).toBe("christmas");
    expect(detectMoodCommand("christmas theme")).toBe("christmas");
    expect(detectMoodCommand("make the world retro themed")).toBe("retro");
    expect(detectMoodCommand("make it daytime")).toBe("daytime");
    expect(detectMoodCommand("daytime")).toBe("daytime");
    expect(detectMoodCommand("make it spooky")).toBe("spooky");
    expect(detectMoodCommand("make a christmas tree")).toBeNull();
    expect(detectMoodCommand("make it rain")).toBeNull();
    expect(detectMoodCommand("make it bigger")).toBeNull();

    const r = newRecent();
    noteTouched(r, "enemies");
    expect(resolvePronoun("Make this Christmas themed.", r)).toBeUndefined();
    expect(resolvePronoun("make it christmas themed", r)).toBeUndefined();
    expect(resolvePronoun("make it daytime", r)).toBeUndefined();

    const xmas = await moodSpecFor("christmas");
    expect(xmas.name).toBe("christmas");
    expect(xmas.ambient).toBe("snow");
    expect(xmas.grass).toBe(0xf4f9ff);

    const day = await moodSpecFor("daytime");
    expect(day.name).toBe("daytime");
  });

  it("populates entity.kind in World.spawn and exposes entity kinds in the manifest", () => {
    const w = new World(1);
    const g = w.spawn({ type: "snow-ground", x: 0, y: 400, w: 800, h: 40, solid: true, gravityScale: 0 }, "m");
    const p = w.spawn({ type: "player", x: 100, y: 360, w: 26, h: 34, gravityScale: 1 }, "player");
    const gift = w.spawn({ type: "christmas-gift", x: 200, y: 370, w: 24, h: 24, gravityScale: 1 }, "m");
    expect(g.kind).toBe("terrain");
    expect(p.kind).toBe("player");
    expect(gift.kind).toBe("prop");

    const extracted = extractSpawnedEntities(`
      api.spawn({ type: "snow-ground", x: 0, y: 400, w: 800, h: 40, solid: true, gravityScale: 0 });
      api.spawn({ type: "christmas-gift", x: 200, y: 370, w: 24, h: 24 });
    `);
    expect(extracted.map((e) => `${e.type}:${e.kind}`)).toEqual(["snow-ground:terrain", "christmas-gift:prop"]);
    const text = formatManifest([{ id: "holiday", title: "Holiday", knobs: {}, entities: extracted }]);
    expect(text).toContain("entities=[snow-ground:terrain, christmas-gift:prop]");
  });

  it("deriveSubject strips quantifiers ('some stairs' -> 'stairs') and pickArtType rejects stairs/walls", () => {
    expect(deriveSubject("Add some stairs.", "stair")).toBe("stairs");
    expect(deriveSubject("add a few trees", "tree")).toBe("trees");
    expect(deriveSubject("spawn many blocks", "block")).toBe("blocks");
    expect(pickArtType('api.spawn({ type: "stair", x: 200, y: 380, w: 30, h: 20, solid: true, gravityScale: 0 })')).toBeNull();
    expect(pickArtType('api.spawn({ type: "wall", x: 200, y: 380, w: 30, h: 100, solid: true, gravityScale: 0 })')).toBeNull();
  });

  it("never lets pronoun resolution hijack player ability or first-person commands to NPC mods (7hl)", () => {
    const r = newRecent();
    noteTouched(r, "wanderer-newcomer");

    expect(isPlayerCommand("Make it so my character can stick to the walls.")).toBe(true);
    expect(isPlayerAbilityCommand("Make it so my character can stick to the walls.")).toBe(true);
    expect(resolvePronoun("Make it so my character can stick to the walls.", r)).toBeUndefined();

    expect(isPlayerCommand("make it so if I hit space bar again he gets one more extra jump.")).toBe(true);
    expect(isPlayerAbilityCommand("make it so if I hit space bar again he gets one more extra jump.")).toBe(true);
    expect(resolvePronoun("make it so if I hit space bar again he gets one more extra jump.", r)).toBeUndefined();

    expect(isPlayerAbilityCommand("give me double jump")).toBe(true);
    expect(resolvePronoun("give me double jump", r)).toBeUndefined();

    expect(isPlayerAbilityCommand("make my character stick to walls")).toBe(true);
    expect(resolvePronoun("make my character stick to walls", r)).toBeUndefined();

    // Ordinary third-person NPC pronouns still resolve to the recent mod:
    expect(resolvePronoun("make him faster", r)).toBe("wanderer-newcomer");
    expect(resolvePronoun("make them jump higher", r)).toBe("wanderer-newcomer");
    expect(resolvePronoun("make it bigger", r)).toBe("wanderer-newcomer");
  });
});