// Draw-to-build (ADR 0026): sketch geometry, level-spec parsing, and the compiled level mod.
// Everything here runs offline: the multimodal Wonder call is injected, never made.
import { describe, expect, it } from "vitest";
import {
  buildSketchPayload,
  MAX_STROKES,
  sketchViewOf,
  strokeBbox,
  thinPoints,
  toWorldStroke,
} from "../src/client/sketch";
import {
  isEmptyLevel,
  levelFromStrokes,
  levelToModSource,
  modIdFor,
  normalizeLevel,
  parseSketchLevel,
  runSketchBuild,
  sanitizeSketch,
  sketchPrompt,
} from "../server/sketch";
import type { SketchDeps, SketchLevel } from "../server/sketch";
import { compileMod } from "../server/compile";
import { verifyMod } from "../server/verify";
import { World } from "../src/sim/world";
import { ModLoader } from "../src/sim/loader";
import playerMod from "../src/mods/player";
import type { SketchStroke } from "../src/contract";

const PNG = `data:image/png;base64,${"A".repeat(400)}`;

function stroke(tag: SketchStroke["tag"], x: number, y: number, w: number, h: number): SketchStroke {
  return { color: "#3fd06a", tag, points: [{ x, y }], bbox: { x, y, w, h } };
}

describe("sketch strokes (client geometry)", () => {
  it("turns screen points into a world-space box via the camera", () => {
    const cam = { x: 1000, y: -50 };
    const box = strokeBbox([{ x: 10, y: 20 }, { x: 110, y: 60 }], cam);
    expect(box).toEqual({ x: 1010, y: -30, w: 100, h: 40 });
    const s = toWorldStroke({ tag: "terrain", color: "#3fd06a", points: [{ x: 10, y: 20 }] }, cam);
    expect(s.tag).toBe("terrain");
    expect(s.bbox).toEqual({ x: 1010, y: -30, w: 4, h: 4 }); // a dot still gets a buildable box
  });

  it("thins long polylines but keeps both ends", () => {
    const pts = Array.from({ length: 900 }, (_, i) => ({ x: i, y: i * 2 }));
    const thin = thinPoints(pts, 100);
    expect(thin.length).toBe(100);
    expect(thin[0]).toEqual({ x: 0, y: 0 });
    expect(thin[thin.length - 1]).toEqual({ x: 899, y: 1798 });
  });

  it("builds the wire payload with the world rect the sketch covers", () => {
    const strokes = Array.from({ length: MAX_STROKES + 5 }, () => ({ tag: "terrain" as const, color: "#3fd06a", points: [{ x: 5, y: 5 }] }));
    const p = buildSketchPayload(strokes, { x: -200, y: -100 }, PNG, "  a tower  ", 900, 600);
    expect(p.image).toBe(PNG);
    expect(p.strokes.length).toBe(MAX_STROKES);
    expect(p.prompt).toBe("a tower");
    expect(p.view).toEqual({ x: -200, y: -100, w: 900, h: 600 });
    expect(sketchViewOf(320, 200, { x: 1, y: 2 })).toEqual({ x: 1, y: 2, w: 320, h: 200 });
  });
});

describe("sketch payload sanitizing", () => {
  it("rejects non-image data and empty sketches", () => {
    expect(sanitizeSketch({ image: "http://evil/x.png", strokes: [stroke("terrain", 0, 0, 10, 10)] })).toBeNull();
    expect(sanitizeSketch({ image: PNG, strokes: [] })).toBeNull();
  });

  it("keeps valid strokes, drops broken ones, and caps the counts", () => {
    const good = stroke("coin", 10, 20, 16, 16);
    const bad = { color: "#fff", tag: "terrain", points: [], bbox: { x: Number.NaN, y: 0, w: 1, h: 1 } };
    const clean = sanitizeSketch({ image: PNG, strokes: [good, bad, { junk: true }, ...Array.from({ length: 200 }, () => good)], prompt: "hi" });
    expect(clean).not.toBeNull();
    expect(clean!.strokes.length).toBe(80);
    expect(clean!.strokes[0].tag).toBe("coin");
    expect(clean!.prompt).toBe("hi");
  });
});

describe("sketch level spec", () => {
  it("parses a JSON reply, fences and chatter included", () => {
    const reply = 'Sure! ```json\n{"name":"Stairway","platforms":[{"x":40,"y":300,"w":180,"h":24,"kind":"ledge"}],"coins":[{"x":90,"y":260,"w":16,"h":16}],"enemies":[]}\n```';
    const parsed = parseSketchLevel(reply);
    expect(parsed.error).toBeUndefined();
    expect(parsed.level!.name).toBe("Stairway");
    expect(parsed.level!.platforms).toEqual([{ x: 40, y: 300, w: 180, h: 24, kind: "ledge" }]);
    expect(parsed.level!.coins).toEqual([{ x: 90, y: 260, w: 16, h: 16 }]);
  });

  it("reports a reason instead of throwing on junk", () => {
    expect(parseSketchLevel("no ideas").error).toBeDefined();
    expect(parseSketchLevel("{not json}").error).toBeDefined();
    expect(parseSketchLevel('{"name":"x","platforms":[],"coins":[],"enemies":[]}').error).toContain("no platforms");
  });

  it("clamps boxes into the world and keeps the drawn coordinates otherwise", () => {
    const level = normalizeLevel({
      name: "  Ridge  ",
      platforms: [
        { x: 500, y: 300, w: 200, h: 24 },
        { x: -99999, y: -99999, w: 200, h: 24 },
        { x: 700, y: 200, w: 40, h: 160 },
        { x: 500, y: 300, w: 200, h: 24 }, // duplicate
        { x: 1, y: 2, h: 20 },
      ],
      coins: [{ x: 520, y: 260, w: 60, h: 60 }],
      enemies: [{ x: 600, y: 270, w: 8, h: 8 }],
    });
    expect(level.name).toBe("Ridge");
    expect(level.platforms.length).toBe(3);
    expect(level.platforms[0]).toEqual({ x: 500, y: 300, w: 200, h: 24, kind: "ledge" });
    expect(level.platforms[1].x).toBe(-2400);
    expect(level.platforms[2].kind).toBe("wall"); // tall and thin
    expect(level.coins[0].w).toBe(40);
    expect(level.coins[0].x).toBe(520); // a 60 px blob is clamped to a 40 px coin, on the same corner
    expect(level.enemies[0].w).toBe(20);
  });

  it("caps how much one sketch can build", () => {
    const many = { platforms: Array.from({ length: 200 }, (_, i) => ({ x: i * 30, y: 100, w: 60, h: 20 })), coins: Array.from({ length: 200 }, () => ({ x: 1, y: 1, w: 16, h: 16 })) };
    const level = normalizeLevel(many);
    expect(level.platforms.length).toBeLessThanOrEqual(24);
    expect(level.coins.length).toBe(40);
  });

  it("falls back to the brush tags when the model cannot help", () => {
    const level = levelFromStrokes([
      stroke("terrain", 100, 320, 200, 20),
      stroke("terrain", 600, 100, 30, 180),
      stroke("coin", 150, 280, 16, 16),
      stroke("hazard", 300, 280, 28, 28),
      stroke("bouncer", 400, 340, 80, 18),
    ], "a stairway");
    expect(level.name).toBe("a stairway");
    expect(level.platforms.map((p) => p.kind).sort()).toEqual(["bouncer", "ledge", "wall"]);
    expect(level.coins.length).toBe(1);
    expect(level.enemies.length).toBe(1);
    expect(isEmptyLevel(level)).toBe(false);
    expect(isEmptyLevel(levelFromStrokes([]))).toBe(true);
  });

  it("gives each level a stable id and describes strokes with their world boxes", () => {
    const level = normalizeLevel({ name: "Coin Cave", platforms: [{ x: 10, y: 300, w: 100, h: 20 }] });
    const again = normalizeLevel({ name: "Coin Cave", platforms: [{ x: 10, y: 300, w: 100, h: 20 }] });
    expect(modIdFor(level)).toBe(modIdFor(again));
    expect(modIdFor(level)).toMatch(/^sketch-coin-cave-/);
    expect(modIdFor(normalizeLevel({ name: "Coin Cave", platforms: [{ x: 90, y: 300, w: 100, h: 20 }] }))).not.toBe(modIdFor(level));
    const prompt = sketchPrompt([stroke("terrain", 10, 300, 100, 20)], "stairs", { x: 0, y: 0, w: 900, h: 600 });
    expect(prompt).toContain("tag=terrain");
    expect(prompt).toContain("box={x:10, y:300, w:100, h:20}");
    expect(prompt).toContain("stairs");
  });
});

describe("compiled level mod", () => {
  const level: SketchLevel = normalizeLevel({
    name: "Test Ridge",
    platforms: [
      { x: 100, y: 300, w: 180, h: 24, kind: "ledge" },
      { x: 400, y: 200, w: 40, h: 120, kind: "wall" },
      { x: 700, y: 260, w: 140, h: 18, kind: "moving" },
      { x: 900, y: 360, w: 80, h: 16, kind: "bouncer" },
    ],
    coins: [{ x: 150, y: 250, w: 16, h: 16 }],
    enemies: [{ x: 500, y: 360, w: 28, h: 28 }],
  });

  it("is deterministic and verifies in the real verifier", async () => {
    const source = levelToModSource(level);
    expect(levelToModSource(level)).toBe(source);
    const compiled = compileMod(source);
    expect(compiled.ok, compiled.errors.join("; ")).toBe(true);
    const verified = await verifyMod(source, compiled.js);
    expect(verified.ok, verified.errors.join("; ")).toBe(true);
    expect(verified.def!.title).toContain("Test Ridge");
  });

  it("spawns every entity at the exact world box that was drawn", async () => {
    const source = levelToModSource(level);
    const compiled = compileMod(source);
    const verified = await verifyMod(source, compiled.js);
    const world = new World(7);
    const loader = new ModLoader(world);
    loader.load(verified.def!);
    const boxes = (type: string) => world.entities.filter((e) => e.type === type).map((e) => [e.x, e.y, e.w, e.h]);
    expect(boxes("sketch-platform")).toEqual([
      [100, 300, 180, 24],
      [400, 200, 40, 120],
    ]);
    expect(boxes("sketch-mover-platform")).toEqual([[700, 260, 140, 18]]);
    expect(boxes("sketch-trampoline")).toEqual([[900, 360, 80, 16]]);
    expect(boxes("sketch-coin")).toEqual([[150, 250, 16, 16]]);
    expect(boxes("sketch-walker")).toEqual([[500, 360, 28, 28]]);
    // The wide mark is a jump-through ledge; the tall one is a wall that blocks.
    const [ledge, wall] = world.entities.filter((e) => e.type === "sketch-platform");
    expect(ledge.data.oneWay).toBe(true);
    expect(wall.data.oneWay).toBeUndefined();
    // Everything belongs to the mod, so one Unload removes the whole drawn level.
    expect(world.entities.every((e) => e.owner === verified.def!.id)).toBe(true);
    loader.unload(verified.def!.id);
    expect(world.entities.length).toBe(0);
  });

  it("lets the player collect a drawn coin and bounce on a drawn pad", async () => {
    const source = levelToModSource(level);
    const compiled = compileMod(source);
    const verified = await verifyMod(source, compiled.js);
    const world = new World(11);
    const loader = new ModLoader(world);
    loader.load(verified.def!);
    const coin = world.entities.find((e) => e.type === "sketch-coin")!;
    const pad = world.entities.find((e) => e.type === "sketch-trampoline")!;
    const player = world.spawn({ type: "player", x: coin.x, y: coin.y, w: 26, h: 34, gravityScale: 1 }, "engine");
    world.step();
    expect(world.entities.some((e) => e.type === "sketch-coin")).toBe(false);
    expect(world.hud.get("sketch-score")?.value).toBe(1);
    // Drop the player onto the pad and check the launch velocity.
    player.x = pad.x + 10;
    player.y = pad.y - 30;
    player.vy = 200;
    world.step();
    expect(player.vy).toBeLessThan(0);
  });

  it("lets the player stand on a drawn ledge and walk off it", async () => {
    const source = levelToModSource(level);
    const compiled = compileMod(source);
    const verified = await verifyMod(source, compiled.js);
    const world = new World(5);
    const loader = new ModLoader(world);
    loader.load(playerMod);
    loader.load(verified.def!);
    const ledge = world.entities.find((e) => e.type === "sketch-platform")!;
    const player = world.entities.find((e) => e.type === "player")!;
    player.x = ledge.x + 40;
    player.y = ledge.y - 90;
    player.vx = 0;
    player.vy = 0;
    for (let i = 0; i < 120; i++) world.step();
    expect(player.onGround).toBe(true);
    expect(Math.abs(player.y + player.h - ledge.y)).toBeLessThan(1.5); // feet on the drawn surface
    // The one-way ledge lets the player jump up through it from below.
    player.x = ledge.x + 90;
    player.y = ledge.y + 60;
    player.vy = -720;
    player.onGround = false;
    let passed = false;
    for (let i = 0; i < 40; i++) {
      world.step();
      if (player.y + player.h < ledge.y) passed = true;
    }
    expect(passed).toBe(true);
  });

  it("builds an empty-but-valid level when a sketch only has coins", async () => {
    const coinOnly = normalizeLevel({ name: "Coins", platforms: [], coins: [{ x: 20, y: 20, w: 16, h: 16 }] });
    const compiled = compileMod(levelToModSource(coinOnly));
    expect(compiled.ok, compiled.errors.join("; ")).toBe(true);
    const verified = await verifyMod(levelToModSource(coinOnly), compiled.js);
    expect(verified.ok, verified.errors.join("; ")).toBe(true);
  });
});

describe("sketch build pipeline (no live calls)", () => {
  function deps(replies: string[], deliverResults: { ok: boolean; errors: string[] }[] = []): SketchDeps & { said: string[]; delivered: string[]; asked: number } {
    const d = {
      said: [] as string[],
      delivered: [] as string[],
      asked: 0,
      async ask() {
        d.asked++;
        return replies[Math.min(d.asked - 1, replies.length - 1)] ?? "";
      },
      async deliver(source: string) {
        d.delivered.push(source);
        return deliverResults[Math.min(d.delivered.length - 1, deliverResults.length - 1)] ?? { ok: true, errors: [] };
      },
      say(text: string) { d.said.push(text); },
      stage() {},
    };
    return d;
  }

  const msg = {
    image: PNG,
    strokes: [stroke("terrain", 100, 320, 200, 20), stroke("coin", 150, 280, 16, 16)],
    prompt: "a ledge",
    view: { x: 0, y: 0, w: 900, h: 600 },
  };

  it("asks Wonder once, compiles its level, and reports what was built", async () => {
    const d = deps(['{"name":"Ledge","platforms":[{"x":100,"y":320,"w":200,"h":20}],"coins":[{"x":150,"y":280,"w":16,"h":16}],"enemies":[]}']);
    const r = await runSketchBuild(d, msg);
    expect(r.ok).toBe(true);
    expect(d.asked).toBe(1);
    expect(d.delivered.length).toBe(1);
    expect(d.delivered[0]).toContain("sketch-platform");
    expect(d.said.join(" ")).toContain("Ledge is live: 1 platforms, 1 coins");
    expect(r.usedFallback).toBe(false);
  });

  it("re-asks once on an unusable reply, then falls back to the stroke boxes", async () => {
    const d = deps(["no json here", "still not json"]);
    const r = await runSketchBuild(d, msg);
    expect(d.asked).toBe(2);
    expect(r.ok).toBe(true);
    expect(r.usedFallback).toBe(true);
    expect(d.delivered[0]).toContain("sketch-platform");
    expect(d.delivered[0]).toContain("[100, 320");
  });

  it("fixes a failed build once and reports the failure if the fix fails too", async () => {
    const good = '{"name":"Fixed","platforms":[{"x":100,"y":300,"w":200,"h":20}],"coins":[],"enemies":[]}';
    const d = deps(['{"name":"Ridge","platforms":[{"x":100,"y":300,"w":200,"h":20}],"coins":[],"enemies":[]}', good], [{ ok: false, errors: ["test: first platform keeps its drawn world box"] }, { ok: true, errors: [] }]);
    const r = await runSketchBuild(d, msg);
    expect(r.ok).toBe(true);
    expect(d.asked).toBe(2);
    expect(d.delivered.length).toBe(2);
    expect(d.delivered[1]).toContain('"Fixed"');

    const broken = deps(['{"name":"Ridge","platforms":[{"x":100,"y":300,"w":200,"h":20}],"coins":[],"enemies":[]}'], [{ ok: false, errors: ["too slow"] }]);
    const bad = await runSketchBuild(broken, msg);
    expect(bad.ok).toBe(false);
    expect(broken.said.join(" ")).toContain("didn't verify");
  });

  it("refuses a sketch that never arrived", async () => {
    const d = deps(["{}"]);
    const r = await runSketchBuild(d, { image: "nope", strokes: [], prompt: "" });
    expect(r.ok).toBe(false);
    expect(d.asked).toBe(0);
  });
});
