// Paper to level tests (ADR 0040).
// Pure, offline tests: verifies paper bounds detection, stage coordinate mapping,
// Wonder level reply parsing, retake fallback, and the verified mod compiled from paper.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectPaperBounds,
  mapBoxToStage,
  normalizePaperLevel,
  parsePaperLevelReply,
  parsePngDimensions,
  paperPrompt,
  runPaperBuild,
  STAGE,
  type PaperBounds,
  type PaperDeps,
} from "../server/paper";
import { compileMod } from "../server/compile";
import { verifyMod } from "../server/verify";
import { levelToModSource, type SketchLevel } from "../server/sketch";

const FIXTURE_DIR = resolve(process.cwd(), "tests/fixtures/paper");

function fixtureDataUrl(name: string): string {
  const buf = readFileSync(resolve(FIXTURE_DIR, name));
  return `data:image/png;base64,${buf.toString("base64")}`;
}

describe("paper bounds detection and dimensions", () => {
  it("extracts PNG dimensions accurately from header bytes", () => {
    const f1Url = fixtureDataUrl("paper-level-1.png");
    const dims = parsePngDimensions(f1Url);
    expect(dims).toEqual({ w: 640, h: 480 });
  });

  it("detects the paper sheet boundaries in the 3 photographed fixtures", () => {
    for (const name of ["paper-level-1.png", "paper-level-2.png", "paper-level-3.png"]) {
      const url = fixtureDataUrl(name);
      const bounds = detectPaperBounds(url);

      // In the fixtures, the paper sits on a darker desk:
      // Paper starts around x=70..100, y=40..60, width ~470..510, height ~370..400
      expect(bounds.x).toBeGreaterThan(30);
      expect(bounds.x).toBeLessThan(140);
      expect(bounds.y).toBeGreaterThan(20);
      expect(bounds.y).toBeLessThan(100);
      expect(bounds.w).toBeGreaterThan(400);
      expect(bounds.h).toBeGreaterThan(320);
    }
  });

  it("falls back gracefully when given non-PNG or corrupted data", () => {
    const fallback = detectPaperBounds("data:image/png;base64,AAAA");
    expect(fallback.w).toBeGreaterThan(0);
    expect(fallback.h).toBeGreaterThan(0);
  });
});

describe("coordinate mapping from paper to stage", () => {
  const paperBounds: PaperBounds = { x: 80, y: 50, w: 480, h: 380 };

  it("maps normalized 0..1000 paper coordinates to stage world space", () => {
    // Top-left of paper (0, 0) -> Stage top-left
    const tl = mapBoxToStage({ x: 0, y: 0, w: 200, h: 50 });
    expect(tl.x).toBe(STAGE.left);
    expect(tl.y).toBe(STAGE.skyY);
    expect(tl.w).toBe(STAGE.width * 0.2);

    // Bottom ground of paper (1000 on y) -> Stage ground line y = 400
    const ground = mapBoxToStage({ x: 100, y: 950, w: 800, h: 50 });
    expect(ground.y).toBeCloseTo(STAGE.skyY + 0.95 * STAGE.height, 1);
    expect(ground.y + ground.h).toBeLessThanOrEqual(440);
  });

  it("maps percentage 0..100 coordinates to stage world space", () => {
    const mid = mapBoxToStage({ x: 50, y: 50, w: 20, h: 5 });
    expect(mid.x).toBeCloseTo(STAGE.left + 0.5 * STAGE.width, 1);
    expect(mid.y).toBeCloseTo(STAGE.skyY + 0.5 * STAGE.height, 1);
  });

  it("maps bottom-right paper coordinates to stage ground", () => {
    const br = mapBoxToStage({ x: 900, y: 1000, w: 100, h: 50 });
    expect(br.x).toBeCloseTo(STAGE.left + 0.9 * STAGE.width, 1);
    expect(br.y).toBeCloseTo(STAGE.groundY, 1);
  });

  it("maps pixel coordinates relative to paper bounds", () => {
    // Center pixel of paper
    const pxBox = mapBoxToStage({ x: 80 + 240, y: 50 + 190, w: 96, h: 38 }, paperBounds, { w: 640, h: 480 });
    expect(pxBox.x).toBeCloseTo(STAGE.left + 0.5 * STAGE.width, 1);
    expect(pxBox.y).toBeCloseTo(STAGE.skyY + 0.5 * STAGE.height, 1);
  });
});

describe("paper level parsing and normalization", () => {
  it("normalizes platforms, coins, and enemies into playable game bounds", () => {
    const raw = {
      name: "Summit Ledges",
      platforms: [
        { x: 100, y: 900, w: 800, h: 40, kind: "ledge" },
        { x: 250, y: 600, w: 200, h: 30, kind: "moving" },
        { x: 550, y: 400, w: 180, h: 25, kind: "bouncer" },
        { x: 700, y: 200, w: 50, h: 200, kind: "wall" },
      ],
      coins: [
        { x: 280, y: 560, w: 25, h: 25 },
        { x: 580, y: 360, w: 25, h: 25 },
      ],
      enemies: [
        { x: 750, y: 160, w: 40, h: 40 },
      ],
    };

    const norm = normalizePaperLevel(raw);
    expect(norm.name).toBe("Summit Ledges");
    expect(norm.platforms.length).toBe(4);
    expect(norm.platforms.some((p) => p.kind === "ledge")).toBe(true);
    expect(norm.platforms.some((p) => p.kind === "moving")).toBe(true);
    expect(norm.platforms.some((p) => p.kind === "bouncer")).toBe(true);
    expect(norm.platforms.some((p) => p.kind === "wall")).toBe(true);

    // Platforms have playable thickness
    expect(norm.platforms[0].h).toBeGreaterThanOrEqual(18);
    expect(norm.platforms[0].h).toBeLessThanOrEqual(40);

    // Coins standardized to 16x16
    expect(norm.coins[0].w).toBe(16);
    expect(norm.coins[0].h).toBe(16);

    // Enemies standardized to 28x28
    expect(norm.enemies[0].w).toBe(28);
    expect(norm.enemies[0].h).toBe(28);
  });

  it("parses Wonder JSON reply with markdown fences and text", () => {
    const reply = `I found your drawing on the paper!
\`\`\`json
{
  "name": "Sky Castles",
  "platforms": [
    { "x": 50, "y": 880, "w": 900, "h": 40, "kind": "ledge" },
    { "x": 300, "y": 550, "w": 250, "h": 35, "kind": "ledge" }
  ],
  "coins": [
    { "x": 420, "y": 500, "w": 25, "h": 25 }
  ],
  "enemies": [
    { "x": 500, "y": 500, "w": 35, "h": 35 }
  ]
}
\`\`\``;

    const parsed = parsePaperLevelReply(reply);
    expect(parsed.error).toBeUndefined();
    expect(parsed.level).toBeDefined();
    expect(parsed.level!.name).toBe("Sky Castles");
    expect(parsed.level!.platforms.length).toBe(2);
    expect(parsed.level!.coins.length).toBe(1);
    expect(parsed.level!.enemies.length).toBe(1);
  });

  it("returns an error for empty or unreadable level replies (triggering retake)", () => {
    const emptyReply = '{"name":"empty","platforms":[],"coins":[],"enemies":[]}';
    const parsed = parsePaperLevelReply(emptyReply);
    expect(parsed.error).toBeDefined();
    expect(parsed.level).toBeUndefined();

    const junkReply = "I could not see any drawing here.";
    const junkParsed = parsePaperLevelReply(junkReply);
    expect(junkParsed.error).toBeDefined();
  });
});

describe("paper mod compilation and verification", () => {
  it("compiles a paper level into a verified, passing mod", async () => {
    const level: SketchLevel = {
      name: "Paper Step Summit",
      platforms: [
        { x: 100, y: 380, w: 800, h: 28, kind: "ledge" },
        { x: 300, y: 240, w: 200, h: 24, kind: "moving" },
        { x: 600, y: 150, w: 160, h: 20, kind: "bouncer" },
      ],
      coins: [
        { x: 390, y: 200, w: 16, h: 16 },
        { x: 670, y: 110, w: 16, h: 16 },
      ],
      enemies: [
        { x: 450, y: 340, w: 28, h: 28 },
      ],
    };

    const source = levelToModSource(level);
    expect(source).toContain("Paper Step Summit");
    expect(source).toContain("PLATFORMS = [");
    expect(source).toContain("MOVERS = [");
    expect(source).toContain("BOUNCERS = [");
    expect(source).toContain("COINS = [");
    expect(source).toContain("ENEMIES = [");

    const compiled = compileMod(source);
    expect(compiled.ok).toBe(true);
    expect(compiled.errors).toEqual([]);

    const verified = await verifyMod(source, compiled.js);
    expect(verified.ok).toBe(true);
    expect(verified.errors).toEqual([]);
    expect(verified.def).toBeDefined();
    expect(verified.def?.id).toMatch(/^sketch-paper-step-summit-/);
    expect(verified.msPerFrame).toBeLessThan(2.0); // within 2 ms per frame budget
  });
});

describe("runPaperBuild end-to-end pipeline", () => {
  const f1Url = fixtureDataUrl("paper-level-1.png");

  it("executes the paper build pipeline and delivers a verified mod", async () => {
    const stages: string[] = [];
    const notes: string[] = [];
    let deliveredSource = "";

    const deps: PaperDeps = {
      ask: async () => JSON.stringify({
        name: "Paper Castle",
        platforms: [
          { x: 100, y: 880, w: 800, h: 40, kind: "ledge" },
          { x: 350, y: 550, w: 220, h: 30, kind: "ledge" },
        ],
        coins: [{ x: 450, y: 510, w: 25, h: 25 }],
        enemies: [{ x: 500, y: 500, w: 35, h: 35 }],
      }),
      deliver: async (src) => {
        deliveredSource = src;
        const c = compileMod(src);
        if (!c.ok) return { ok: false, errors: c.errors };
        const v = await verifyMod(src, c.js);
        return { ok: v.ok, errors: v.errors };
      },
      say: () => {},
      stage: (s, detail) => stages.push(`${s}:${detail}`),
      note: (n) => notes.push(n),
    };

    const res = await runPaperBuild(deps, { image: f1Url, prompt: "castle level" });
    expect(res.ok).toBe(true);
    expect(res.title).toBe("Paper Castle");
    expect(deliveredSource).toContain("Paper Castle");
    expect(stages).toContain("writing:reading your paper drawing");
    expect(stages).toContain("compiling:building your paper level");
  });

  it("falls back to asking to retake when no level is found on the paper", async () => {
    let saidMessage = "";
    const deps: PaperDeps = {
      ask: async () => '{"name":"empty","platforms":[],"coins":[],"enemies":[]}',
      deliver: async () => ({ ok: true, errors: [] }),
      say: (msg) => { saidMessage = msg; },
      stage: () => {},
    };

    const res = await runPaperBuild(deps, { image: f1Url });
    expect(res.ok).toBe(false);
    expect(saidMessage).toMatch(/taking the photo again|retake/i);
  });

  it("retries once when the initial reply is malformed, then succeeds", async () => {
    let calls = 0;
    const deps: PaperDeps = {
      ask: async () => {
        calls++;
        if (calls === 1) return "not json";
        return JSON.stringify({
          name: "Recovered Level",
          platforms: [{ x: 100, y: 900, w: 600, h: 30, kind: "ledge" }],
          coins: [],
          enemies: [],
        });
      },
      deliver: async (src) => {
        const c = compileMod(src);
        const v = await verifyMod(src, c.js);
        return { ok: v.ok, errors: v.errors };
      },
      say: () => {},
      stage: () => {},
    };

    const res = await runPaperBuild(deps, { image: f1Url });
    expect(res.ok).toBe(true);
    expect(calls).toBe(2);
    expect(res.title).toBe("Recovered Level");
  });
});
