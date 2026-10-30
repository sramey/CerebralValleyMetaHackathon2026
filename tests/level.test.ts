// ADR 0074: the level generator and api.buildLevel. The generated level must be deterministic, structurally rich,
// jumpable (every gap under the player's reach) and finishable by a simple bot.
import { describe, expect, it } from "vitest";
import type { ModDefinition } from "../src/contract";
import { emptyInput } from "../src/contract";
import { ModLoader } from "../src/sim/loader";
import { World } from "../src/sim/world";
import { GROUND_Y, MAX_GAP, MAX_STEP, generateLevel } from "../src/sim/levelgen";
import playerMod from "../src/mods/player";
import groundMod from "../src/mods/ground";

const levelMod = (o: { seed: number; difficulty: number; length: number }): ModDefinition => {
  let b: { dispose(): void } | undefined;
  return { id: "level", title: "Level", setup(api) { b = api.buildLevel!(o); }, dispose() { b?.dispose(); } };
};

describe("level generator (ADR 0074)", () => {
  it("is deterministic: same seed and numbers, same level; another seed differs", () => {
    const a = generateLevel({ seed: 7, difficulty: 3, length: 3600 });
    expect(generateLevel({ seed: 7, difficulty: 3, length: 3600 })).toEqual(a);
    expect(generateLevel({ seed: 8, difficulty: 3, length: 3600 }).pieces).not.toEqual(a.pieces);
  });

  it("is a real layout: several heights, gaps, hazards, enemies on ledges, coins and a flag", () => {
    const l = generateLevel({ seed: 3, difficulty: 3, length: 7000 });
    expect(l.stats.heights).toBeGreaterThanOrEqual(3);
    expect(l.stats.gaps).toBeGreaterThanOrEqual(2);
    expect(l.stats.hazards).toBeGreaterThanOrEqual(3);
    expect(l.stats.enemies).toBeGreaterThanOrEqual(3);
    expect(l.stats.coins).toBeGreaterThan(10);
    expect(l.pieces.filter((p) => p.kind === "flag")).toHaveLength(1);
    expect(l.endX - l.startX).toBeGreaterThanOrEqual(7000);
    expect(l.pieces.length).toBeLessThan(420); // the world holds 500 entities
  });

  it("harder is structurally harder: more hazards and enemies, wider gaps", () => {
    const sum = (d: number, f: (l: ReturnType<typeof generateLevel>) => number): number => [1, 2, 3, 4, 5, 6, 7, 8].reduce((s, seed) => s + f(generateLevel({ seed, difficulty: d, length: 4000 })), 0);
    expect(sum(5, (l) => l.stats.hazards + l.stats.enemies)).toBeGreaterThan(sum(1, (l) => l.stats.hazards + l.stats.enemies) * 1.5);
    const meanGap = (d: number): number => { let n = 0, t = 0; for (let seed = 1; seed <= 8; seed++) for (const p of generateLevel({ seed, difficulty: d, length: 4000 }).pits) { n++; t += p.w; } return t / Math.max(1, n); };
    expect(meanGap(5)).toBeGreaterThan(meanGap(1));
  });

  it("longer is longer, and every gap between standable things stays inside the jump", () => {
    for (let seed = 1; seed <= 12; seed++) for (const difficulty of [1, 3, 5]) {
      const l = generateLevel({ seed, difficulty, length: 5000 });
      expect(l.endX - l.startX).toBeGreaterThanOrEqual(5000);
      const solids = l.pieces.filter((p) => p.kind === "ground" || p.kind === "platform" || p.kind === "block").sort((a, b) => a.x - b.x);
      let reach = solids[0].x + solids[0].w;
      for (const s of solids.slice(1)) {
        expect(s.x - reach, `seed ${seed} d${difficulty}`).toBeLessThanOrEqual(MAX_GAP);
        reach = Math.max(reach, s.x + s.w);
      }
      for (const s of solids) expect(GROUND_Y - s.y).toBeLessThanOrEqual(300);
    }
  });
});

/** A bot that holds right and jumps at walls, spikes, enemies and gaps. */
function runBot(spec: { seed: number; difficulty: number; length: number }, ticks: number): { reached: number; end: number } {
  const world = new World(1);
  const loader = new ModLoader(world);
  loader.load(playerMod);
  loader.load(groundMod);
  loader.load(levelMod(spec));
  const lvl = generateLevel(spec);
  let best = 0;
  for (let i = 0; i < ticks; i++) {
    const p = world.entities.find((e) => e.type === "player")!;
    const ahead = (dx: number) => world.entities.some((e) => e.solid && e.x <= p.x + dx && e.x + e.w >= p.x + dx && e.y >= p.y + p.h - 4 && e.y <= p.y + p.h + 40);
    const hazard = world.entities.some((e) => (e.type === "spikes" || e.type === "walker") && e.x < p.x + 110 && e.x + e.w > p.x - 10 && Math.abs(e.y - p.y) < 90);
    const wall = world.entities.some((e) => e.solid && e.x > p.x && e.x < p.x + 50 && e.y < p.y + p.h - 8 && e.y + e.h > p.y);
    const edge = p.onGround && !ahead(46);
    const climb = world.entities.some((e) => e.type === "platform" && e.x > p.x && e.x < p.x + 90 && e.y < p.y + p.h - 10 && e.y > p.y - 150);
    world.input = { ...emptyInput(), right: true, jump: (p.onGround && (edge || hazard || wall)) || (p.onGround && climb && i % 40 === 0) };
    world.step();
    best = Math.max(best, p.x);
    if (p.x > lvl.endX - 100) break;
  }
  return { reached: best, end: lvl.endX };
}

describe("api.buildLevel", () => {
  it("replaces the starter terrain, hands it back on undo, and sends a fallen player to the checkpoint", () => {
    const world = new World(1);
    const loader = new ModLoader(world);
    loader.load(playerMod);
    loader.load(groundMod);
    const before = world.entities.filter((e) => e.type === "ground" || e.type === "platform").length;
    expect(before).toBeGreaterThan(3);
    loader.load(levelMod({ seed: 4, difficulty: 3, length: 3000 }));
    expect(world.entities.filter((e) => e.type === "ground").length).toBeGreaterThan(3); // the generated floor
    expect(world.entities.some((e) => e.type === "finish-flag")).toBe(true);
    const p = world.entities.find((e) => e.type === "player")!;
    p.y = 900; // fell in a pit
    world.step(); world.step();
    expect(p.y).toBeLessThan(420);
    expect(p.health).toBeLessThan(100);
    loader.unload("level");
    expect(world.entities.some((e) => e.type === "finish-flag" || e.type === "walker" || e.type === "spikes")).toBe(false);
    expect(world.entities.filter((e) => e.type === "ground" || e.type === "platform").length).toBe(before);
  });

  it("a stomp kills a walker; spikes hurt", () => {
    const world = new World(1);
    const loader = new ModLoader(world);
    loader.load(playerMod);
    loader.load(levelMod({ seed: 5, difficulty: 4, length: 6000 }));
    const p = world.entities.find((e) => e.type === "player")!;
    const sp = world.entities.find((e) => e.type === "spikes")!;
    p.x = sp.x + 4; p.y = sp.y - p.h + 6; p.vy = 0;
    world.step();
    expect(p.health).toBeLessThan(100);
    const w = world.entities.find((e) => e.type === "walker")!;
    const n = world.entities.filter((e) => e.type === "walker").length;
    p.health = 100; p.x = w.x + 2; p.y = w.y - p.h + 10; p.vy = 200;
    world.step();
    expect(world.entities.filter((e) => e.type === "walker").length).toBe(n - 1);
  });

  it("a simple hold-right-and-jump bot finishes most easy levels", () => {
    let done = 0, tried = 0;
    const lost: string[] = [];
    for (let seed = 1; seed <= 10; seed++) for (const difficulty of [1, 2]) {
      tried++;
      const r = runBot({ seed, difficulty, length: 3400 }, 60 * 150);
      if (r.reached > r.end - 300) done++; else lost.push(`seed ${seed} d${difficulty}: ${Math.round(r.reached)}/${r.end}`);
    }
    expect(done / tried, lost.join("; ")).toBeGreaterThanOrEqual(0.7);
  });

  it("stays well under the sim budget with a long hard level", () => {
    const world = new World(1);
    const loader = new ModLoader(world);
    loader.load(playerMod);
    loader.load(levelMod({ seed: 9, difficulty: 5, length: 9000 }));
    const t0 = performance.now();
    for (let i = 0; i < 300; i++) world.step();
    expect((performance.now() - t0) / 300).toBeLessThan(2);
    expect(world.entities.length).toBeLessThan(500);
  });
});

describe("level size", () => {
  it("the longest level still fits the entity cap", () => {
    const l = generateLevel({ seed: 2, difficulty: 5, length: 16000 });
    expect(l.pieces.length).toBeLessThanOrEqual(430);
    expect(l.pieces.filter((p) => p.kind === "flag")).toHaveLength(1);
  });
});

import { detectLevelCommand } from "../src/ontology";

describe("detectLevelCommand (ADR 0074)", () => {
  it.each([
    ["make a harder level", { fresh: true, difficulty: "up" }],
    ["Make a harder level.", { fresh: true, difficulty: "up" }],
    ["make me a real platformer level", { fresh: true }],
    ["build a longer obstacle course", { fresh: true, length: "up" }],
    ["generate a new level", { fresh: true }],
    ["give me an easier level", { fresh: true, difficulty: "down" }],
    ["extend the level", { fresh: false, length: "up" }],
    ["extend the level to the right", { fresh: false, length: "up" }],
    ["extend the level and add obstacles", { fresh: false, length: "up", difficulty: "up" }],
    ["can you extend this level and add more enemies", { fresh: false, length: "up", difficulty: "up" }],
    ["make the level longer", { fresh: false, length: "up" }],
    ["make this level much harder", { fresh: false, difficulty: "up" }],
    ["make the stage easier", { fresh: false, difficulty: "down" }],
    ["add more level", { fresh: false, length: "up" }],
  ])("%s", (cmd, want) => {
    expect(detectLevelCommand(cmd)).toEqual(want);
  });

  it.each([
    "add a player", "level up", "make it rain", "make the dragon harder", "add a boss level 5", "add obstacles", "make it harder", "extend the level and add a dragon",
    "make the ground wider", "change the background to medieval", "make a harder dragon", "next level",
  ])("%s is not a level request (no level in the world)", (cmd) => {
    expect(detectLevelCommand(cmd)).toBeNull();
  });

  it("level-less phrasings mean the level once one exists", () => {
    expect(detectLevelCommand("add obstacles", true)).toEqual({ fresh: false, difficulty: "up" });
    expect(detectLevelCommand("make it harder", true)).toEqual({ fresh: false, difficulty: "up" });
    expect(detectLevelCommand("add some spikes", true)).toEqual({ fresh: false, difficulty: "up" });
    expect(detectLevelCommand("add a dragon", true)).toBeNull();
  });
});

import { compileMod } from "../server/compile";
import { verifyMod } from "../server/verify";
import { FIRST_LEVEL, currentLevelParams, levelModSource, levelParamsFor, levelSay } from "../server/levelmod";

describe("level mod (server template)", () => {
  it("the template compiles, passes the verifier and builds a real level", async () => {
    const src = levelModSource({ ...FIRST_LEVEL, seed: 77 });
    const c = compileMod(src);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const v = await verifyMod(src, c.js);
    expect(v.errors ?? []).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.msPerFrame).toBeLessThan(2);
  });

  it("first 'harder level' lands on difficulty 4; later asks step the level that is already there", () => {
    const first = levelParamsFor({ fresh: true, difficulty: "up" }, undefined, () => 0.5);
    expect(first.difficulty).toBe(FIRST_LEVEL.difficulty + 1);
    expect(first.length).toBe(FIRST_LEVEL.length);
    const knobs = { difficulty: { value: 4 }, length: { value: 4800 }, seed: { value: 321 } };
    const cur = currentLevelParams(knobs);
    expect(levelParamsFor({ fresh: false, difficulty: "up" }, cur, () => 0.1)).toEqual({ difficulty: 5, length: 4800, seed: 321 });
    expect(levelParamsFor({ fresh: false, difficulty: "up" }, { ...cur, difficulty: 5 }, () => 0.1).difficulty).toBe(5); // clamped
    expect(levelParamsFor({ fresh: false, length: "up" }, cur, () => 0.1)).toEqual({ difficulty: 4, length: 7200, seed: 321 });
    const fresh = levelParamsFor({ fresh: true }, cur, () => 0.9);
    expect(fresh.seed).not.toBe(321);
    expect(fresh.difficulty).toBe(4);
    expect(levelParamsFor({ fresh: false, length: "down" }, { ...cur, length: 1500 }, () => 0.1).length).toBe(1200); // clamped
  });

  it("describes the level it built", () => {
    const text = levelSay({ difficulty: 4, length: 4800, seed: 5 }, { gaps: 4, hazards: 7, enemies: 6, platforms: 20 }, "built");
    expect(text).toMatch(/tough level/);
    expect(text).toMatch(/4 pits/);
  });
});
