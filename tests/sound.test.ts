import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import { Feel } from "../src/client/feel";
import type { FeelEvent } from "../src/client/feel";
import { Sound, bedFor, buildSfx, sfxFor } from "../src/client/sound";
import type { Entity, MoodSpec } from "../src/contract";

function ent(over: Partial<Entity>): Entity {
  return {
    id: 1, type: "player", x: 0, y: 0, w: 32, h: 48, vx: 0, vy: 0, color: 0xffffff, solid: false,
    gravityScale: 1, facing: 1, onGround: true, health: 100, owner: "", data: {},
    ...over,
  } as Entity;
}

function mood(over: Partial<MoodSpec>): MoodSpec {
  return {
    name: "x", anchor: "", skyTop: 0x101020, skyBottom: 0x202040, ridgeFar: 0, ridgeNear: 0, moon: 0, star: 0, grass: 0, soil: 0,
    tint: 0xffffff, grade: 0, dim: 0, fog: 0, vignette: 0, ambient: "none", ...over,
  };
}

describe("event -> sound mapping", () => {
  it("maps every game-feel event to a sound", () => {
    expect(sfxFor({ kind: "jump" })?.sfx).toBe("jump");
    expect(sfxFor({ kind: "step" })?.sfx).toBe("step");
    expect(sfxFor({ kind: "coin" })?.sfx).toBe("coin");
    expect(sfxFor({ kind: "shoot" })?.sfx).toBe("shoot");
    expect(sfxFor({ kind: "land", impact: 0.8 })?.sfx).toBe("land");
    expect(sfxFor({ kind: "hit", damage: 10, self: false })?.sfx).toBe("hit");
    expect(sfxFor({ kind: "hit", damage: 10, self: true })?.sfx).toBe("hurt");
  });

  it("lands louder when harder and silent for a tiny drop", () => {
    expect(sfxFor({ kind: "land", impact: 0.05 })).toBeNull();
    const soft = sfxFor({ kind: "land", impact: 0.2 })?.gain ?? 0;
    const hard = sfxFor({ kind: "land", impact: 1 })?.gain ?? 0;
    expect(hard).toBeGreaterThan(soft);
    expect(hard).toBeLessThanOrEqual(1);
  });

  it("rings on a landed build, thunks on a rejected or failed one, and stays quiet between", () => {
    expect(buildSfx("done")).toBe("chime");
    expect(buildSfx("rejected")).toBe("thunk");
    expect(buildSfx("failed")).toBe("thunk");
    for (const st of ["routing", "writing", "compiling", "verifying", "fixing"] as const) expect(buildSfx(st)).toBeNull();
  });

  it("picks an ambience bed per mood", () => {
    expect(bedFor(null)).toBe("night");
    expect(bedFor(mood({ name: "christmas", ambient: "snow" }))).toBe("christmas");
    expect(bedFor(mood({ name: "spooky" }))).toBe("spooky");
    expect(bedFor(mood({ name: "sunny meadow", skyBottom: 0xbfe6ff }))).toBe("day");
    expect(bedFor(mood({ name: "neon city", ambient: "sparks" }))).toBe("night");
  });
});

describe("Feel emits sound events from world changes", () => {
  const run = (frames: Entity[][]): FeelEvent[] => {
    const out: FeelEvent[] = [];
    const feel = new Feel(new Container(), () => {}, true, (e) => out.push(e));
    for (const f of frames) feel.update(f, 1 / 60);
    return out;
  };

  it("jump then land", () => {
    const ev = run([
      [ent({})],
      [ent({ onGround: false, vy: -720 })],
      [ent({ onGround: false, vy: 700 })],
      [ent({ onGround: true, vy: 0 })],
    ]);
    expect(ev.map((e) => e.kind)).toEqual(["jump", "land"]);
  });

  it("footsteps come with distance walked, not time standing", () => {
    const walk = Array.from({ length: 60 }, () => [ent({ vx: 240 })]);
    const steps = run(walk).filter((e) => e.kind === "step").length;
    expect(steps).toBeGreaterThanOrEqual(4);
    expect(steps).toBeLessThanOrEqual(6);
    expect(run(Array.from({ length: 60 }, () => [ent({ vx: 0 })]))).toEqual([]);
  });

  it("coin, hit and shoot", () => {
    const player = ent({});
    const coin = ent({ id: 2, type: "coin", x: 20, y: 20, w: 16, h: 16, gravityScale: 0 });
    const goblin = ent({ id: 3, type: "goblin", x: 300 });
    const ev = run([
      [player, coin, goblin],
      [player, goblin],
      [player, { ...goblin, health: 80 } as Entity],
      [player, { ...goblin, health: 80 } as Entity, ent({ id: 4, type: "fire_arrow", x: 40, y: 10, w: 12, h: 6, gravityScale: 0 })],
    ]);
    expect(ev.map((e) => e.kind)).toEqual(["coin", "hit", "shoot"]);
  });

  it("a world load full of projectiles is not a volley", () => {
    const arrows = Array.from({ length: 8 }, (_, i) => ent({ id: 10 + i, type: "arrow", x: 5, gravityScale: 0 }));
    expect(run([[ent({})], [ent({}), ...arrows]]).filter((e) => e.kind === "shoot")).toHaveLength(0);
  });
});

describe("Sound", () => {
  it("is safe without WebAudio and before the first gesture", () => {
    const s = new Sound();
    s.play("coin");
    s.playEvent({ kind: "jump" });
    s.setMood(null, true);
    s.unlock();
    expect(s.ready).toBe(false);
  });

  it("mutes, unmutes and clamps volume", () => {
    const s = new Sound({ muted: true, volume: 7 });
    expect(s.muted).toBe(true);
    expect(s.volume).toBe(1);
    expect(s.toggleMute()).toBe(false);
    s.setVolume(-1);
    expect(s.volume).toBe(0);
    expect(new Sound({ volume: Number("abc") }).volume).toBe(0.6);
  });
});
