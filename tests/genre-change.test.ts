import { describe, expect, it } from "vitest";
import { MAX_ART_PER_BUILD, pickSkin, spritePrompt, subjectArtPrompt } from "../server/art";
import { genreWarnings, isGenreChange } from "../server/genre";
import { MOD_API_REFERENCE, ROUTER_SYSTEM } from "../server/prompt";
import { runModTest } from "../src/sim/loader";

const OWNER = "turn this into a 2d space flight game, where my character is a 2d space ship, and there are things i can shoot";

describe("genre change pattern (ADR 0066)", () => {
  it("recognises the owner's command and ordinary genre-change phrasings", () => {
    expect(isGenreChange(OWNER)).toBe(true);
    for (const c of ["turn this into a space shooter", "turn the game into a racing game", "make this a fishing game", "change it into an underwater adventure"]) expect(isGenreChange(c), c).toBe(true);
    for (const c of ["add a dragon", "make it rain", "turn this into a christmas theme", "make the ninja a space ninja"]) expect(isGenreChange(c), c).toBe(false);
  });

  it("Wonder is taught setScene, the shared combat path and no data.visual", () => {
    expect(MOD_API_REFERENCE).toContain("GENRE CHANGE");
    expect(MOD_API_REFERENCE).toContain("api.setScene({ hideTerrain: true, hideScenery: true");
    expect(MOD_API_REFERENCE).toContain("api.damageHit(bolt");
    expect(MOD_API_REFERENCE).toMatch(/NEVER set data\.visual/);
    expect(MOD_API_REFERENCE).toContain("never restore them yourself in dispose()");
    expect(MOD_API_REFERENCE).toContain("kill one target with t.api.damage(target.id, 999)");
  });

  it("the router keeps named things out of 'shape'", () => {
    expect(ROUTER_SYSTEM).toMatch(/volcano[^"]*NEVER a shape/);
    expect(ROUTER_SYSTEM).not.toMatch(/\bcone, wedge\b/);
  });

  it("warns, never rejects, when a genre change skips setScene or sets visual:shape", () => {
    const bare = 'export default { id: "x", setup(api) { api.spawn({ type: "alien", data: { visual: "shape" } }); } }';
    expect(genreWarnings(OWNER, bare)).toHaveLength(2);
    expect(genreWarnings(OWNER, 'api.setScene({ hideTerrain: true })')).toEqual([]);
    expect(genreWarnings("make this a snow level", bare)).toHaveLength(1); // only the shape note
    expect(genreWarnings("make it rain", "api.spawn({})")).toEqual([]);
  });

  it("reads the skin from the source and orders it as its own flight sheet, capped at two images", () => {
    expect(pickSkin('api.setScene({ hideTerrain: true, playerSkin: "Space Ship" })')).toBe("space-ship");
    expect(pickSkin("api.setScene({ hideTerrain: true })")).toBeNull();
    expect(MAX_ART_PER_BUILD).toBe(2);
    const p = subjectArtPrompt("spaceship", "spaceship-skin", false, false, true);
    expect(p).toContain("the player's own character");
    expect(p).toContain("hovering level, flying forward with thrust");
    expect(p).toContain("facing right");
    expect(p).not.toBe(spritePrompt("spaceship", { held: false, scenery: true }));
  });

  it("a space mod written to the pattern verifies, flies free of the ground and shoots through the shared helper", () => {
    const def = {
      id: "space-flight", title: "Space flight",
      setup(api: import("../src/contract").ModApi) {
        api.setScene!({ hideTerrain: true, hideScenery: true, backdrop: "space", playerSkin: "spaceship" });
        for (let i = 0; i < 4; i++) api.spawn({ type: "alien-drone", x: 400 + i * 90, y: 196, w: 44, h: 36, solid: false, gravityScale: 0, health: 20, data: { hostile: true, flying: true } });
        let cool = 0;
        api.onTick(() => {
          const p = api.player(); if (!p) return;
          p.gravityScale = 0; p.vy = 0;
          const inp = api.input();
          if ((inp.shoot || inp.use) && cool <= 0) { cool = 10; api.spawn({ type: "laser-bolt", x: p.x + 30, y: p.y + 14, w: 16, h: 6, vx: 700, solid: false, gravityScale: 0, data: { fromPlayer: true, life: 70 } }); }
          cool--;
          for (const b of api.byType("laser-bolt")) api.damageHit!(b, { damage: 20, despawnOnHit: true });
        });
      },
      dispose(api: import("../src/contract").ModApi) { for (const t of ["alien-drone", "laser-bolt"]) for (const e of api.byType(t)) api.despawn(e.id); },
      test(t: import("../src/contract").TestApi) {
        t.api.spawn({ type: "player", x: 120, y: 200, w: 26, h: 34, solid: false, gravityScale: 1 });
        t.step(2);
        t.step(40, { shoot: true });
        t.expect(t.api.byType("alien-drone").length < 4 || t.api.entities().some((e) => e.type === "alien-drone" && e.health < 20), "a shot hurt a target");
      },
    };
    const res = runModTest(def);
    expect(res.errors).toEqual([]);
  });
});
