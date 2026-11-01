// Paper level fidelity tests (ADR 0084, bead paperfix):
// 1. Drawn enemies on a platform patrol that platform and stay on it (never walk off).
// 2. Touching or overlapping platform segments at about the same height merge into one.
// 3. Goal marks parse, spawn finish-flag, and clear the level on touch.
// 4. Backward compatibility: old replies without a goal still parse and verify.
// 5. One coin HUD: level coin progress suppresses the cumulative score counter.
import { describe, expect, it } from "vitest";
import { compileMod } from "../server/compile";
import {
  findPlatformUnder,
  levelToModSource,
  mergeTouchingPlatforms,
  normalizeLevel,
  parseSketchLevel,
  type SketchLevel,
} from "../server/sketch";
import { normalizePaperLevel, parsePaperLevelReply } from "../server/paper";
import { verifyMod } from "../server/verify";
import { ModLoader } from "../src/sim/loader";
import { World } from "../src/sim/world";
import { createHud, filterVisibleHud } from "../src/client/hud";
import type { HudWidget } from "../src/contract";

describe("paper level fidelity (ADR 0084)", () => {
  it("enemy drawn on a platform is still on it after 600 ticks", async () => {
    // Platform at y = 250 (elevated above ground y = 400).
    // Enemy drawn standing on this platform at y = 220..248.
    const level: SketchLevel = normalizeLevel({
      name: "Perch Patrol",
      platforms: [
        { x: 100, y: 250, w: 240, h: 24, kind: "ledge" },
        { x: -400, y: 400, w: 1600, h: 48, kind: "ledge" }, // ground
      ],
      coins: [],
      enemies: [{ x: 200, y: 220, w: 28, h: 28 }],
    });

    // Check platform top detection and snapping
    const plat = findPlatformUnder(level.enemies[0], level.platforms);
    expect(plat).toBeDefined();
    expect(plat!.y).toBe(250);

    const source = levelToModSource(level);
    const compiled = compileMod(source);
    expect(compiled.ok).toBe(true);
    expect(compiled.errors).toEqual([]);

    const verified = await verifyMod(source, compiled.js);
    expect(verified.ok).toBe(true);

    const world = new World(42);
    const loader = new ModLoader(world);
    loader.load(verified.def!);

    // Enemy spawned and snapped to the platform top (250 - 28 = 222)
    const enemyAtStart = world.entities.find((e) => e.type === "sketch-walker");
    expect(enemyAtStart).toBeDefined();
    expect(enemyAtStart!.y).toBe(222);
    expect(enemyAtStart!.data.minX).toBe(100);
    expect(enemyAtStart!.data.maxX).toBe(340);

    // Spawn verifier's own ground as existing sketch tests do, and let sim run for 600 ticks (10s)
    world.spawn({ type: "ground", x: -600, y: 400, w: 8000, h: 48, solid: true, gravityScale: 0 }, "engine");

    for (let i = 0; i < 600; i++) {
      world.step();
    }

    const enemyAfter = world.entities.find((e) => e.type === "sketch-walker");
    expect(enemyAfter).toBeDefined();
    // Still on the elevated platform top, NOT fallen to ground (y=372/400)
    expect(enemyAfter!.y).toBe(222);
    // Stayed strictly within platform bounds [100, 340]
    expect(enemyAfter!.x).toBeGreaterThanOrEqual(100);
    expect(enemyAfter!.x + enemyAfter!.w).toBeLessThanOrEqual(340);
  });

  it("touching segments merge", () => {
    // Two platform segments drawn touching horizontally at about the same height
    const rawSketch = {
      name: "Split Ledge",
      platforms: [
        { x: 100, y: 300, w: 120, h: 24, kind: "ledge" },
        { x: 220, y: 302, w: 100, h: 24, kind: "ledge" }, // touches at x = 220, dy = 2
      ],
      coins: [],
      enemies: [],
    };

    const normSketch = normalizeLevel(rawSketch);
    expect(normSketch.platforms).toHaveLength(1);
    expect(normSketch.platforms[0].x).toBe(100);
    expect(normSketch.platforms[0].w).toBe(220); // 120 + 100
    expect(normSketch.platforms[0].y).toBe(300);

    // Overlapping segments at the same height merge into one
    const overlapping = [
      { x: 50, y: 200, w: 100, h: 20, kind: "ledge" as const },
      { x: 140, y: 204, w: 120, h: 20, kind: "ledge" as const }, // overlaps 10px, dy = 4
    ];
    const merged = mergeTouchingPlatforms(overlapping);
    expect(merged).toHaveLength(1);
    expect(merged[0].x).toBe(50);
    expect(merged[0].w).toBe(210); // 50 to 260

    // Segments at significantly different heights do NOT merge
    const differentHeights = [
      { x: 50, y: 200, w: 100, h: 20, kind: "ledge" as const },
      { x: 140, y: 280, w: 120, h: 20, kind: "ledge" as const }, // dy = 80 > yTolerance
    ];
    const kept = mergeTouchingPlatforms(differentHeights);
    expect(kept).toHaveLength(2);

    // Paper path normalizer also merges touching segments
    const rawPaper = {
      name: "Paper Split",
      platforms: [
        { x: 100, y: 600, w: 200, h: 30, kind: "ledge" },
        { x: 300, y: 602, w: 200, h: 30, kind: "ledge" },
      ],
      coins: [],
      enemies: [],
    };
    const normPaper = normalizePaperLevel(rawPaper);
    expect(normPaper.platforms).toHaveLength(1);
  });

  it("goal parses and clears the level", async () => {
    const reply = JSON.stringify({
      name: "Victory Peak",
      platforms: [{ x: 100, y: 350, w: 500, h: 24, kind: "ledge" }],
      coins: [],
      enemies: [],
      goal: { x: 520, y: 310, w: 30, h: 40 },
    });

    const parsed = parseSketchLevel(reply);
    expect(parsed.error).toBeUndefined();
    expect(parsed.level).toBeDefined();
    expect(parsed.level!.goal).toEqual({ x: 520, y: 310, w: 30, h: 40 });

    const source = levelToModSource(parsed.level!);
    expect(source).toContain("GOAL = [520, 310, 30, 40]");
    expect(source).toContain('type: "finish-flag"');

    const compiled = compileMod(source);
    expect(compiled.ok).toBe(true);

    const verified = await verifyMod(source, compiled.js);
    expect(verified.ok).toBe(true);

    const world = new World(1);
    const loader = new ModLoader(world);
    loader.load(verified.def!);

    // Goal entity spawned
    const flag = world.entities.find((e) => e.type === "finish-flag");
    expect(flag).toBeDefined();
    expect(flag!.x).toBe(520);
    expect(flag!.y).toBe(310);

    // Spawn player touching the goal flag
    world.spawn({ type: "player", x: 520, y: 310, w: 26, h: 34, gravityScale: 0 }, "engine");
    world.step();

    // Finish-flag cleared the level: LEVEL CLEAR! banner on level-note HUD
    const note = world.hud.get("level-note");
    expect(note).toBeDefined();
    expect(note!.text).toBe("LEVEL CLEAR!");
  });

  it("old replies without a goal still parse", async () => {
    // Old sketch reply omitting the goal property
    const oldSketchReply = JSON.stringify({
      name: "Old Ledges",
      platforms: [{ x: 100, y: 350, w: 300, h: 24, kind: "ledge" }],
      coins: [{ x: 180, y: 310, w: 16, h: 16 }],
      enemies: [],
    });

    const parsedSketch = parseSketchLevel(oldSketchReply);
    expect(parsedSketch.error).toBeUndefined();
    expect(parsedSketch.level).toBeDefined();
    expect(parsedSketch.level!.name).toBe("Old Ledges");
    expect(parsedSketch.level!.goal).toBeUndefined();

    // Verify old level still compiles and verifies cleanly
    const source = levelToModSource(parsedSketch.level!);
    expect(source).toContain("GOAL = null");
    const compiled = compileMod(source);
    expect(compiled.ok).toBe(true);
    const verified = await verifyMod(source, compiled.js);
    expect(verified.ok).toBe(true);

    // Old paper reply omitting the goal property
    const oldPaperReply = JSON.stringify({
      name: "Old Paper Ledges",
      platforms: [{ x: 100, y: 800, w: 600, h: 35, kind: "ledge" }],
      coins: [],
      enemies: [],
    });
    const parsedPaper = parsePaperLevelReply(oldPaperReply);
    expect(parsedPaper.error).toBeUndefined();
    expect(parsedPaper.level).toBeDefined();
    expect(parsedPaper.level!.goal).toBeUndefined();
  });

  it("one coin HUD", () => {
    // When both general score HUD ("COINS 15") and level coin progress ("COINS 0/5") exist:
    const generalScore: HudWidget = {
      id: "score",
      owner: "engine",
      kind: "stat",
      label: "Coins",
      icon: "🪙",
      value: 15,
      position: "top-left",
    };

    const levelCoins: HudWidget = {
      id: "sketch-score",
      owner: "sketch-mod",
      kind: "stat",
      label: "Coins",
      icon: "🪙",
      value: 0,
      max: 5,
      position: "top-left",
    };

    // Before level loads: only general score exists -> shows general score
    const initialWidgets = [generalScore];
    expect(filterVisibleHud(initialWidgets)).toEqual([generalScore]);

    // When level with coin count loads: both exist in world.hud -> only level progress is shown
    const activeLevelWidgets = [generalScore, levelCoins];
    const visible = filterVisibleHud(activeLevelWidgets);
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe("sketch-score");
    expect(visible[0].value).toBe(0);
    expect(visible[0].max).toBe(5);

    // DOM rendering verification with fake host
    class FakeDoc {
      createElement(tag: string) {
        return {
          tag,
          className: "",
          id: "",
          style: {} as Record<string, string>,
          children: [] as any[],
          dataset: {} as Record<string, string>,
          appendChild(c: any) { this.children.push(c); return c; },
          append(...nodes: any[]) { this.children.push(...nodes); },
          remove() {},
          ownerDocument: this,
        };
      }
    }
    const fakeDoc = new FakeDoc();
    const fakeHost = fakeDoc.createElement("div");
    const hud = createHud(fakeHost as any);

    const world = new World(1);
    world.setHud("engine", "score", { kind: "stat", label: "Coins", icon: "🪙", value: 15, position: "top-left" });
    world.setHud("sketch-mod", "sketch-score", { kind: "stat", label: "Coins", icon: "🪙", value: 0, max: 5, position: "top-left" });

    hud.render(world);
    // Root overlay exists and rendered only 1 visible widget
    expect(world.hud.size).toBe(2);
    expect(filterVisibleHud(world.hud.values())).toHaveLength(1);
    expect(filterVisibleHud(world.hud.values())[0].id).toBe("sketch-score");

    // When level unloads: sketch-score is removed -> general score returns
    world.removeHud("sketch-mod", "sketch-score");
    expect(world.hud.size).toBe(1);
    expect(filterVisibleHud(world.hud.values())).toHaveLength(1);
    expect(filterVisibleHud(world.hud.values())[0].id).toBe("score");
  });
});
