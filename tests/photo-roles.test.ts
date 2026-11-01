// ADR 0082: a photo object gets a role (prop, collectible, enemy, friendly) and a real name.
// The templates are server-generated, compiled and verified like any mod; no model call.
import { describe, expect, it } from "vitest";
import { buildPhotoModSource, photoTitle } from "../server/photo-mod";
import { compileMod } from "../server/compile";
import { importMod, verifyMod } from "../server/verify";
import { World } from "../src/sim/world";
import { ModLoader, runModTest } from "../src/sim/loader";
import { SCORE_HUD } from "../src/sim/collect";
import { isFriendly, isHostileEnemy, isPet, isDamageableTarget } from "../src/sim/combat";
import { PHOTO_ROLES, cleanSlug, freeSlug, parsePhotoRole, photoSlug } from "../src/photo-role";
import playerMod from "../src/mods/player";
import groundMod from "../src/mods/ground";
import { gunMod } from "../src/mods/gun";
import type { ModDefinition } from "../src/contract";

const NAME = "learning toy";
const SLUG = "learning-toy";

async function make(role: string, slug = SLUG): Promise<{ source: string; def: ModDefinition }> {
  const source = buildPhotoModSource("photo-7", NAME, 1.25, role, slug);
  const c = compileMod(source);
  expect(c.errors).toEqual([]);
  expect(c.ok).toBe(true);
  return { source, def: await importMod(c.js) };
}

describe("role and slug helpers", () => {
  it("accepts the four roles and falls back to prop", () => {
    for (const r of PHOTO_ROLES) expect(parsePhotoRole(r)).toBe(r);
    for (const bad of ["boss", "", undefined, 3, null, "Enemy"]) expect(parsePhotoRole(bad)).toBe("prop");
  });
  it("makes a readable slug from the spoken name", () => {
    expect(photoSlug("Learning toy!")).toBe("learning-toy");
    expect(photoSlug("  ")).toBe("object");
    expect(photoSlug("a".repeat(80)).length).toBeLessThanOrEqual(24);
    expect(cleanSlug("learning-toy")).toBe("learning-toy");
    for (const bad of ["../x", "Has Space", "UPPER", "", "a".repeat(40), 5, null]) expect(cleanSlug(bad)).toBeNull();
  });
  it("keeps a name from becoming a behaviour the player did not pick", () => {
    expect(photoSlug("cat", "prop")).toBe("my-cat"); // a pet by name alone
    expect(photoSlug("cat", "friendly")).toBe("cat");
    expect(photoSlug("zombie", "collectible")).toBe("my-zombie"); // enemy by name alone
    expect(photoSlug("zombie", "enemy")).toBe("zombie");
  });
  it("finds the first free slug", () => {
    const used = new Set(["toy", "toy-2"]);
    expect(freeSlug("mug", (s) => used.has(s))).toBe("mug");
    expect(freeSlug("toy", (s) => used.has(s))).toBe("toy-3");
  });
  it("titles the mod with the name, capitalised", () => {
    expect(photoTitle(NAME)).toBe("Learning toy");
    expect(photoTitle("")).toBe("Object");
  });
});

describe.each(PHOTO_ROLES)("photo template: %s", (role) => {
  it("compiles, verifies and passes its own test()", async () => {
    const { source, def } = await make(role);
    const c = compileMod(source);
    const v = await verifyMod(source, c.js);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(runModTest(def)).toEqual({ ok: true, errors: [] });
  });

  it("carries the name where Spark and Wonder see it: title, entity type, data.name", async () => {
    const { def } = await make(role);
    expect(def.id).toBe("photo-7");
    expect(def.title).toBe("Learning toy");
    const w = new World(5);
    new ModLoader(w).load(def);
    const e = w.entities.find((x) => x.type === SLUG);
    expect(e).toBeDefined();
    expect(e!.data.name).toBe(NAME);
    expect(def.knobs && "size" in def.knobs).toBe(true);
  });

  it("still works with no slug (the photo key is the type) and unloads clean", async () => {
    const source = buildPhotoModSource("photo-9", NAME, 1, role);
    expect(source).toContain("\"photo-9\"");
    const c = compileMod(source);
    const def = await importMod(c.js);
    const w = new World(3);
    const l = new ModLoader(w);
    l.load(def);
    expect(w.entities.some((x) => x.type === "photo-9")).toBe(true);
    l.unload("photo-9");
    expect(w.entities.some((x) => x.type === "photo-9")).toBe(false);
  });
});

describe("photo roles in the engine", () => {
  it("prop: today's hop, tuned by the Jump height knob", async () => {
    const { def } = await make("prop");
    expect(def.knobs && "jump" in def.knobs).toBe(true);
    const w = new World(8);
    const l = new ModLoader(w);
    l.load(groundMod);
    l.load(def);
    const e = w.entities.find((x) => x.type === SLUG)!;
    expect(isHostileEnemy(e)).toBe(false);
    for (let i = 0; i < 205; i++) w.step();
    expect(e.vy).toBeLessThan(0); // the 200th tick hopped
  });

  it("collectible: touching it adds to the engine score", async () => {
    const { def } = await make("collectible");
    const w = new World(11);
    const l = new ModLoader(w);
    l.load(groundMod);
    l.load(playerMod);
    l.load(def);
    const e = w.entities.find((x) => x.type === SLUG)!;
    expect(e.data.collectible).toBe(true);
    expect(w.hud.has(SCORE_HUD)).toBe(false);
    const p = w.entities.find((x) => x.type === "player")!;
    p.x = e.x; p.y = e.y; p.vx = 0; p.vy = 0;
    w.step();
    expect(w.entities.some((x) => x.type === SLUG)).toBe(false);
    expect(w.hud.get(SCORE_HUD)?.value).toBe(1);
  });

  it("enemy: chases, hurts on touch, and is defeated by shots", async () => {
    const { def } = await make("enemy");
    const w = new World(21);
    const l = new ModLoader(w);
    l.load(groundMod);
    l.load(playerMod);
    l.load(gunMod);
    l.load(def);
    const e = w.entities.find((x) => x.type === SLUG)!;
    const p = w.entities.find((x) => x.type === "player")!;
    expect(isHostileEnemy(e)).toBe(true);
    expect(isFriendly(e)).toBe(false);
    expect(isDamageableTarget(e, { ...p, type: "player-bullet", data: { fromPlayer: true }, owner: "gun" } as never)).toBe(true);
    // chase
    p.x = 100; p.y = 366; e.x = 500;
    const gap = Math.abs(e.x - p.x);
    for (let i = 0; i < 30; i++) w.step();
    expect(Math.abs(e.x - p.x)).toBeLessThan(gap);
    // hurt on touch
    const hp = p.health;
    e.x = p.x; e.y = p.y;
    w.step();
    expect(p.health).toBeLessThan(hp);
    // defeated by shots: keep clear of the player and fire until it falls
    p.health = 100;
    let shots = 0;
    for (let round = 0; round < 12 && w.entities.includes(e) && !e.dead; round++) {
      p.x = 100; p.y = 366; p.facing = 1; e.x = 260; e.y = 372; e.vx = 0;
      w.input.use = true; w.step(); w.input.use = false;
      shots++;
      for (let i = 0; i < 14; i++) { e.x = Math.max(e.x, 260); w.step(); if (!w.entities.includes(e) || e.dead) break; }
    }
    expect(shots).toBeGreaterThan(0);
    expect(w.entities.some((x) => x.type === SLUG)).toBe(false);
  });

  it("friendly: follows the player and is never hit by player fire", async () => {
    const { def } = await make("friendly");
    const w = new World(31);
    const l = new ModLoader(w);
    l.load(groundMod);
    l.load(playerMod);
    l.load(gunMod);
    l.load(def);
    const f = w.entities.find((x) => x.type === SLUG)!;
    const p = w.entities.find((x) => x.type === "player")!;
    expect(isFriendly(f)).toBe(true);
    expect(isPet(f)).toBe(true);
    expect(isHostileEnemy(f)).toBe(false);
    // follow
    p.x = 700; p.y = 366;
    const gap = Math.abs(f.x - p.x);
    for (let i = 0; i < 40; i++) w.step();
    expect(Math.abs(f.x - p.x)).toBeLessThan(gap);
    // immune to the player's own shots
    f.x = 760; f.y = 372; p.x = 700; p.facing = 1;
    const hp = f.health;
    for (let n = 0; n < 4; n++) {
      w.input.use = true; w.step(); w.input.use = false;
      for (let i = 0; i < 16; i++) { f.x = 760; w.step(); }
    }
    expect(w.entities.includes(f)).toBe(true);
    expect(f.health).toBe(hp);
  });

  it("a name that sounds like a creature does not change the role the player chose", () => {
    // Prop named "zombie": the slug is prefixed, so the engine does not treat it as an enemy by name.
    const slug = photoSlug("zombie", "prop");
    const w = new World(2);
    w.spawn({ type: slug, x: 10, y: 10, w: 20, h: 20, color: 0, gravityScale: 0 }, "m");
    expect(isHostileEnemy(w.entities[0])).toBe(false);
    expect(isPet(w.entities[0])).toBe(false);
  });
});

describe("the wire carries role and slug (ADR 0082)", () => {
  it("keeps a valid role and slug, and defaults or drops bad ones", async () => {
    const { validateClientMsg } = await import("../server/validate");
    const ok = validateClientMsg({ kind: "photoBringLocal", key: "photo-1", prompt: "toy", aspect: 1, role: "enemy", slug: "learning-toy" });
    expect(ok.ok && ok.msg).toMatchObject({ kind: "photoBringLocal", role: "enemy", slug: "learning-toy" });
    const bad = validateClientMsg({ kind: "photoBringLocal", key: "photo-1", prompt: "toy", aspect: 1, role: "boss", slug: "../x y" });
    expect(bad.ok && bad.msg).toMatchObject({ role: "prop" });
    expect(bad.ok && (bad.msg as { slug?: string }).slug).toBeUndefined();
    const old = validateClientMsg({ kind: "photoBringLocal", key: "photo-1", prompt: "toy", aspect: 1 });
    expect(old.ok && old.msg).toMatchObject({ role: "prop" });
    const bring = validateClientMsg({ kind: "photoBring", key: "photo-2", role: "friendly" });
    expect(bring.ok && bring.msg).toMatchObject({ kind: "photoBring", role: "friendly" });
  });
});

describe("naming works in the router (ADR 0082)", () => {
  it("'make the learning toy bigger / jump higher' tweak the photo mod's own knobs, no model call", async () => {
    const { relativeTweak, parseRelativeAsk } = await import("../server/relative-tweak");
    const { def } = await make("prop");
    const knobs = def.knobs!;
    const about = `${def.id} ${def.title}`;
    expect(parseRelativeAsk("make the learning toy bigger")).toMatchObject({ dim: "size", up: true, noun: "toy" });
    expect(parseRelativeAsk("make me bigger")).toBeNull(); // the player keeps its own route
    expect(parseRelativeAsk("make it bigger")).toBeNull();
    expect(relativeTweak("make the learning toy bigger", knobs, about, true)).toEqual({ knob: "size", value: 96 });
    expect(relativeTweak("make the learning toy jump higher", knobs, about, true)).toEqual({ knob: "jump", value: 360 });
  });
});
