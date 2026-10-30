// ADR 0053 / bead 2yt: the prompt and art half of "one cohesive flying companion".
// Wonder is told a request may be ONE subject with several behaviors, the flying archetype
// is named, dropped pickups follow the engine's settle + collectible-tag + shared-score
// contract (ADR 0055), and Muse Image is asked for airborne poses instead of a walk cycle.
import { describe, expect, it } from "vitest";
import { buildWonderPrompt, WONDER_SYSTEM } from "../server/prompt";
import { isFlyingRequest, artKeyForType, spritePrompt } from "../server/art";

describe("Wonder guidance for the cohesive build (ADR 0053)", () => {
  it("tells Wonder the request may be one subject with many behaviors", () => {
    expect(WONDER_SYSTEM).toContain("ONE REQUEST, ONE MOD");
    expect(WONDER_SYSTEM).toMatch(/never split into separate builds|never assume another mod/i);
  });

  it("names the flying-creature archetype", () => {
    expect(WONDER_SYSTEM).toContain("FLYING CREATURES");
    expect(WONDER_SYSTEM).toMatch(/gravityScale: 0 and solid: false/);
    expect(WONDER_SYSTEM).toContain("data: { flying: true }");
    expect(WONDER_SYSTEM).toMatch(/Math\.sin\(api\.tick\(\)/);
  });

  it("names the dropped-pickup contract: gravity, engine bounce, tagged auto-collect, one score HUD", () => {
    expect(WONDER_SYSTEM).toContain("DROPPED PICKUPS");
    expect(WONDER_SYSTEM).toMatch(/data: \{ bounce: 0\.45, collectible: true \}/);
    expect(WONDER_SYSTEM).toContain("ENGINE-OWNED PICKUPS");
    expect(WONDER_SYSTEM).toContain("gravityScale: 1");
    // The engine owns the pickup (ADR 0055): Wonder is told to tag, never to hand-roll
    // the contact test, the despawn, the burst or its own score counter.
    expect(WONDER_SYSTEM).toContain("data: { collectible: true }");
    expect(WONDER_SYSTEM).toMatch(/never write your own contact test/);
    expect(WONDER_SYSTEM).not.toContain("api.touches(player, drop)");
    expect(WONDER_SYSTEM).not.toContain('api.setHud("score"');
  });

  it("keeps the superhero-cat request as one Wonder prompt", () => {
    const prompt = buildWonderPrompt(
      "add a superhero cat that flies around dropping coins",
      "(world is empty — no mods loaded)",
    );
    expect(prompt).toContain("add a superhero cat that flies around dropping coins");
    expect(prompt).toMatch(/Write ONE self-contained TypeScript mod/);
  });
});

describe("flying sprite pose (ADR 0053)", () => {
  it("spots a flying request in words and in types", () => {
    expect(isFlyingRequest("add a superhero cat that flies around dropping coins", "superhero-cat")).toBe(true);
    expect(isFlyingRequest("add a dragon", "fire-dragon")).toBe(true);
    expect(isFlyingRequest("add a cat", "cat")).toBe(false);
    expect(isFlyingRequest("add a castle", "castle")).toBe(false);
  });

  it("asks Muse Image for airborne poses instead of a walk cycle", () => {
    const flying = spritePrompt("superhero cat", { held: false, scenery: false, flying: true });
    const walking = spritePrompt("superhero cat", { held: false, scenery: false });
    expect(flying).toContain("AIRBORNE");
    expect(flying).not.toContain("running");
    expect(flying).toMatch(/off the ground/);
    expect(walking).toContain("running");
  });

  it("gives a flying sheet its own cache key so a walking cat is never reused", () => {
    expect(artKeyForType("superhero-cat")).toBe("cat");
    expect(artKeyForType("superhero-cat", "fly")).toBe("cat-fly");
    expect(artKeyForType("ground", "fly")).toBe("");
  });

  it("never overrides held-item or scenery art with a flying pose", () => {
    expect(spritePrompt("cat", { held: true, scenery: false, flying: true })).toContain("held item icon sheet");
    expect(spritePrompt("cat", { held: false, scenery: true, flying: true })).toContain("scenery sprite sheet");
  });
});
