// Draw-to-build (ADR 0023): a hand-drawn level sketch -> a verified, hot-loaded level mod.
//
// Two halves:
//  1. Wonder reads the sketch image + the exact world-space stroke boxes and returns a
//     JSON level spec (it decides what each stroke *means*: a stair, a tower, a pit).
//  2. This module compiles that JSON into a deterministic mod source, so the geometry
//     lands on the drawn coordinates instead of wherever a model felt like putting it.
//     A stroke-box fallback keeps the feature working when the model returns junk, and
//     everything here but `runSketchBuild` is pure, so the whole conversion is unit-tested
//     with no live calls.
import type { BuildStage, SketchPoint, SketchStroke } from "../src/contract";
import type { ChatMessage } from "./meta";

/** One axis-aligned box in world space (x/y grow right/down, like the sim). */
export interface SketchBox { x: number; y: number; w: number; h: number }

/** How a platform behaves: a jump-through ledge, a solid wall, a slider, or a trampoline. */
export type SketchPlatformKind = "ledge" | "wall" | "moving" | "bouncer";

export interface SketchPlatform extends SketchBox { kind: SketchPlatformKind }

export interface SketchLevel {
  name: string;
  platforms: SketchPlatform[];
  coins: SketchBox[];
  enemies: SketchBox[];
}

const EMPTY_LEVEL: SketchLevel = { name: "Sketched level", platforms: [], coins: [], enemies: [] };

/** World bounds a sketch may reach: the visible sky above the ground slab down to a little below it. */
const WORLD = { minX: -2400, maxX: 4200, minY: -900, maxY: 420 };
const MAX_PLATFORMS = 24;
const MAX_COINS = 40;
const MAX_ENEMIES = 12;
const MAX_MOVERS = 8;
const MAX_BOUNCERS = 8;

export const SKETCH_SYSTEM = `You read hand-drawn Level Sketches for a 2D side-scrolling platformer and answer with ONE JSON object.
The world: x grows right, y grows DOWN, the ground surface is y = 400, the screen is roughly 900 px tall (sky above), and a player is 26x34 px.
You get the sketch image and, for every stroke the player drew, its exact world-space box. Trust the numbers over your reading of the pixels.
Answer with JSON only, no prose, no markdown fence:
{"name":"short evocative level name","platforms":[{"x":0,"y":0,"w":0,"h":0,"kind":"ledge"|"wall"|"moving"|"bouncer"}],"coins":[{"x":0,"y":0,"w":0,"h":0}],"enemies":[{"x":0,"y":0,"w":0,"h":0}]}
Rules:
- Keep each world box where the player drew it (at most ~30 px of tidying); the level is built at those coordinates.
- "ledge" = jump-through platform (wide, thin). "wall" = solid block the player cannot pass. "moving" = a slider. "bouncer" = a trampoline pad.
- Give platforms a playable thickness: 18-40 px. A stroke drawn along the ground line can stay at the ground.
- Coins ~16x16, enemies ~28x28, placed just above the platform they belong to.
- The ground, when drawn, is a long platform at y = 400.
- Add nothing that the player did not draw except small playability fixes (a coin slightly above its ledge, an enemy on a platform). Empty arrays are fine.`;

const n2 = (v: number): number => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** A box clamped into the world, or null when it is wasted (NaN, zero-size even after clamping). */
function box(raw: unknown, minSize: number, maxSize: number): SketchBox | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const x = Number(o.x);
  const y = Number(o.y);
  const w = Number(o.w);
  const h = Number(o.h);
  if (![x, y, w, h].every((v) => Number.isFinite(v))) return null;
  const bw = clamp(w, minSize, maxSize);
  const bh = clamp(h, minSize, maxSize);
  return {
    x: n2(clamp(x, WORLD.minX, WORLD.maxX)),
    y: n2(clamp(y, WORLD.minY, WORLD.maxY)),
    w: n2(bw),
    h: n2(bh),
  };
}

function kindOfPlatform(raw: unknown, b: SketchBox): SketchPlatformKind {
  const k = typeof raw === "string" ? raw.toLowerCase() : "";
  if (k === "moving" || k === "mover" || k === "slider") return "moving";
  if (k === "bouncer" || k === "bounce" || k === "trampoline") return "bouncer";
  if (k === "wall" || k === "block") return "wall";
  if (k === "ledge" || k === "platform") return "ledge";
  // No usable kind from the model: a tall thin mark is a wall, anything else is a ledge.
  return b.h > b.w * 1.5 ? "wall" : "ledge";
}

function list(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : [];
}

/** Turn whatever the model (or the stroke fallback) said into a bounded, buildable level. */
export function normalizeLevel(raw: unknown): SketchLevel {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 48) : EMPTY_LEVEL.name;
  const out: SketchLevel = { name, platforms: [], coins: [], enemies: [] };
  const seen = new Set<string>();
  const platforms: SketchPlatform[] = [];
  for (const p of list(o.platforms)) {
    const b = box(p, 12, 2000);
    if (!b || platforms.length >= MAX_PLATFORMS + MAX_MOVERS + MAX_BOUNCERS) continue;
    const kind = kindOfPlatform((p as Record<string, unknown>)?.kind, b);
    const key = `${kind}:${b.x},${b.y},${b.w},${b.h}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const h = kind === "bouncer" ? clamp(b.h, 12, 40) : clamp(b.h, 12, 400);
    platforms.push({ ...b, h, kind });
  }
  for (const c of list(o.coins)) {
    const b = box(c, 14, 40);
    const size = Math.min(b?.w ?? 16, b?.h ?? 16);
    if (b) out.coins.push({ x: n2(b.x + (b.w - size) / 2), y: n2(b.y + (b.h - size) / 2), w: n2(Math.max(14, size)), h: n2(Math.max(14, size)) });
  }
  for (const e of list(o.enemies)) {
    const b = box(e, 20, 90);
    const size = Math.min(b?.w ?? 28, b?.h ?? 28);
    if (b) out.enemies.push({ x: n2(b.x + (b.w - size) / 2), y: n2(b.y + (b.h - size) / 2), w: n2(Math.max(20, size)), h: n2(Math.max(20, size)) });
  }
  out.coins = out.coins.slice(0, MAX_COINS);
  out.enemies = out.enemies.slice(0, MAX_ENEMIES);
  const movers = platforms.filter((p) => p.kind === "moving").slice(0, MAX_MOVERS);
  const bouncers = platforms.filter((p) => p.kind === "bouncer").slice(0, MAX_BOUNCERS);
  const solids = platforms.filter((p) => p.kind === "ledge" || p.kind === "wall").slice(0, MAX_PLATFORMS);
  out.platforms = [...solids, ...movers, ...bouncers];
  return out;
}

/** Pull the JSON object out of a model reply and normalize it. Never throws. */
export function parseSketchLevel(text: string): { level?: SketchLevel; error?: string } {
  const s = typeof text === "string" ? text : "";
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return { error: "the reply had no JSON object" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(s.slice(start, end + 1));
  } catch {
    return { error: "the reply was not valid JSON" };
  }
  if (!parsed || typeof parsed !== "object") return { error: "the reply was not a JSON object" };
  const level = normalizeLevel(parsed);
  if (level.platforms.length === 0 && level.coins.length === 0 && level.enemies.length === 0) {
    return { error: "the reply named no platforms, coins or enemies" };
  }
  return { level };
}

/** Deterministic level from the raw strokes, used when the model's reply cannot be used. */
export function levelFromStrokes(strokes: readonly SketchStroke[], hint = ""): SketchLevel {
  const raw = { name: hint.trim().slice(0, 48) || "Sketched level", platforms: [] as unknown[], coins: [] as unknown[], enemies: [] as unknown[] };
  for (const s of strokes) {
    const b = s?.bbox;
    if (!b || ![b.x, b.y, b.w, b.h].every((v) => Number.isFinite(v))) continue;
    const tall = b.h > b.w * 1.5;
    switch (s.tag) {
      case "coin":
        raw.coins.push({ ...b, w: Math.max(16, b.w), h: Math.max(16, b.h) });
        break;
      case "hazard":
        raw.enemies.push({ ...b, w: Math.max(26, b.w), h: Math.max(26, b.h) });
        break;
      case "bouncer":
        raw.platforms.push({ ...b, h: Math.max(14, b.h), kind: "bouncer" });
        break;
      default:
        raw.platforms.push({ ...b, h: Math.max(18, b.h), kind: tall ? "wall" : "ledge" });
        break;
    }
  }
  return normalizeLevel(raw);
}

/** True when a level has nothing to build. */
export function isEmptyLevel(level: SketchLevel): boolean {
  return level.platforms.length === 0 && level.coins.length === 0 && level.enemies.length === 0;
}

/** Stable id per level geometry: drawing the same map twice replaces it instead of stacking. */
export function modIdFor(level: SketchLevel): string {
  const slug = level.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20) || "level";
  let h = 0x811c9dc5;
  for (const c of JSON.stringify([level.platforms, level.coins, level.enemies])) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `sketch-${slug}-${h.toString(36).slice(0, 5)}`;
}

const COLOR = { platform: 0x6b5236, wall: 0x6b5236, moving: 0x7a5cff, bouncer: 0x54e0ff, coin: 0xffd34d, enemy: 0xff5a4d };

/**
 * Compile a level spec into a self-contained mod source. Pure and deterministic: the same
 * level always produces the same bytes, and every entity keeps the drawn box exactly.
 */
export function levelToModSource(level: SketchLevel): string {
  const id = modIdFor(level);
  const title = `✏️ ${level.name}`;
  const statics = level.platforms.filter((p) => p.kind === "ledge" || p.kind === "wall");
  const movers = level.platforms.filter((p) => p.kind === "moving");
  const bouncers = level.platforms.filter((p) => p.kind === "bouncer");
  const first = statics[0];
  const rowsOf = (boxes: readonly SketchBox[]): string => boxes.map((b) => `[${n2(b.x)}, ${n2(b.y)}, ${n2(b.w)}, ${n2(b.h)}]`).join(", ");
  // Last column: 1 = jump-through ledge, 0 = solid wall.
  const platforms = statics.map((p) => `[${n2(p.x)}, ${n2(p.y)}, ${n2(p.w)}, ${n2(p.h)}, ${p.kind === "ledge" ? 1 : 0}]`).join(", ");
  const lines: string[] = [];
  lines.push(`// "${level.name}" — built from a hand-drawn sketch (ADR 0023).`);
  lines.push(`// Every box below is the world-space box the player drew, unchanged.`);
  lines.push(`const PLATFORMS = [${platforms}];`);
  lines.push(`const MOVERS = [${rowsOf(movers)}];`);
  lines.push(`const BOUNCERS = [${rowsOf(bouncers)}];`);
  lines.push(`const COINS = [${rowsOf(level.coins)}];`);
  lines.push(`const ENEMIES = [${rowsOf(level.enemies)}];`);
  lines.push("");
  lines.push(`function overlap(a, b) {`);
  lines.push(`  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;`);
  lines.push(`}`);
  lines.push("");
  lines.push(`export default {`);
  lines.push(`  id: ${JSON.stringify(id)},`);
  lines.push(`  title: ${JSON.stringify(title)},`);
  lines.push(`  knobs: {`);
  lines.push(`    bounce: { value: 780, min: 300, max: 1500, label: "Bounce pad power" },`);
  lines.push(`  },`);
  lines.push(`  setup(api, knobs) {`);
  lines.push(`    for (const p of PLATFORMS) {`);
  lines.push(`      // p[4] === 1 means a jump-through ledge; a wall blocks the player.`);
  lines.push(`      api.spawn({ type: "sketch-platform", x: p[0], y: p[1], w: p[2], h: p[3], color: ${COLOR.platform}, solid: true, gravityScale: 0, data: p[4] === 1 ? { oneWay: true } : {} });`);
  lines.push(`    }`);
  lines.push(`    for (let i = 0; i < MOVERS.length; i++) {`);
  lines.push(`      const m = MOVERS[i];`);
  lines.push(`      api.spawn({ type: "sketch-mover-platform", x: m[0], y: m[1], w: m[2], h: m[3], color: ${COLOR.moving}, solid: true, gravityScale: 0, data: { baseX: m[0], range: Math.max(48, Math.min(180, m[2])), phase: i * 0.9 } });`);
  lines.push(`    }`);
  lines.push(`    const power = Number(knobs.bounce);`);
  lines.push(`    for (const b of BOUNCERS) {`);
  lines.push(`      api.spawn({ type: "sketch-trampoline", x: b[0], y: b[1], w: b[2], h: b[3], color: ${COLOR.bouncer}, gravityScale: 0, data: { power } });`);
  lines.push(`    }`);
  lines.push(`    for (const c of COINS) {`);
  lines.push(`      api.spawn({ type: "sketch-coin", x: c[0], y: c[1], w: c[2], h: c[3], color: ${COLOR.coin}, gravityScale: 0, data: { baseY: c[1] } });`);
  lines.push(`    }`);
  lines.push(`    for (const e of ENEMIES) {`);
  lines.push(`      api.spawn({ type: "sketch-walker", x: e[0], y: e[1], w: e[2], h: e[3], vx: 42, color: ${COLOR.enemy}, gravityScale: 1, data: { baseX: e[0], baseY: e[1], casual: true } });`);
  lines.push(`    }`);
  lines.push(`    let collected = 0;`);
  lines.push(`    if (COINS.length > 0) api.setHud("sketch-score", { kind: "stat", label: "Coins", icon: "🪙", value: 0, max: COINS.length, position: "top-left" });`);
  lines.push(`    api.onTick(() => {`);
  lines.push(`      // Deterministic animation from the sim tick only: no wall clock, no Math.random.`);
  lines.push(`      const time = api.tick() / 60;`);
  lines.push(`      for (const m of api.byType("sketch-mover-platform")) {`);
  lines.push(`        m.x = Number(m.data.baseX) + Math.sin(time * 1.4 + Number(m.data.phase)) * Number(m.data.range) * 0.5;`);
  lines.push(`      }`);
  lines.push(`      for (const c of api.byType("sketch-coin")) {`);
  lines.push(`        c.y = Number(c.data.baseY) + Math.sin(time * 2 + c.id * 0.7) * 3;`);
  lines.push(`      }`);
  lines.push(`      for (const e of api.byType("sketch-walker")) {`);
  lines.push(`        // Patrol around the drawn spot; the engine turns them at real walls.`);
  lines.push(`        const home = Number(e.data.baseX);`);
  lines.push(`        if (e.vx === 0) e.vx = 42;`);
  lines.push(`        if (e.x < home - 90) e.vx = Math.abs(e.vx);`);
  lines.push(`        if (e.x > home + 90) e.vx = -Math.abs(e.vx);`);
  lines.push(`        if (e.y > 900) { e.x = home; e.y = Number(e.data.baseY); e.vx = 42; e.vy = 0; }`);
  lines.push(`      }`);
  lines.push(`      const player = api.player();`);
  lines.push(`      if (!player) return;`);
  lines.push(`      for (const c of api.byType("sketch-coin")) {`);
  lines.push(`        if (!overlap(player, c)) continue;`);
  lines.push(`        api.burst(c.x + c.w / 2, c.y + c.h / 2, ${COLOR.coin}, 10);`);
  lines.push(`        api.despawn(c.id);`);
  lines.push(`        collected++;`);
  lines.push(`        api.setHud("sketch-score", { kind: "stat", label: "Coins", icon: "🪙", value: collected, max: COINS.length, position: "top-left" });`);
  lines.push(`      }`);
  lines.push(`      for (const b of api.byType("sketch-trampoline")) {`);
  lines.push(`        if (player.vy >= 0 && overlap(player, b)) {`);
  lines.push(`          player.vy = -Number(b.data.power);`);
  lines.push(`          api.burst(player.x + player.w / 2, b.y, ${COLOR.bouncer}, 8);`);
  lines.push(`        }`);
  lines.push(`      }`);
  lines.push(`    });`);
  lines.push(`  },`);
  lines.push(`  dispose(api) {`);
  lines.push(`    for (const type of ["sketch-platform", "sketch-mover-platform", "sketch-trampoline", "sketch-coin", "sketch-walker"]) {`);
  lines.push(`      for (const e of api.byType(type)) api.despawn(e.id);`);
  lines.push(`    }`);
  lines.push(`    api.removeHud("sketch-score");`);
  lines.push(`  },`);
  lines.push(`  test(t) {`);
  lines.push(`    const plats = t.api.byType("sketch-platform");`);
  lines.push(`    t.expect(plats.length === ${statics.length}, "every drawn platform spawns (${statics.length})");`);
  if (first) {
    lines.push(`    const p0 = plats[0];`);
    lines.push(`    t.expect(!!p0 && p0.x === ${n2(first.x)} && p0.y === ${n2(first.y)} && p0.w === ${n2(first.w)} && p0.h === ${n2(first.h)}, "first platform keeps its drawn world box");`);
  }
  lines.push(`    t.expect(t.api.byType("sketch-coin").length === ${level.coins.length}, "every drawn coin spawns (${level.coins.length})");`);
  lines.push(`    t.expect(t.api.byType("sketch-walker").length === ${level.enemies.length}, "every drawn enemy spawns (${level.enemies.length})");`);
  lines.push(`    t.expect(t.api.byType("sketch-trampoline").length === ${bouncers.length}, "every bouncer spawns (${bouncers.length})");`);
  // The verifier runs mods alone in an empty world: spawn our own ground before stepping.
  lines.push(`    t.api.spawn({ type: "ground", x: -600, y: 400, w: 8000, h: 48, solid: true, gravityScale: 0 });`);
  lines.push(`    t.step(90);`);
  lines.push(`    t.expect(t.api.entities().every((e) => Number.isFinite(e.x + e.y)), "positions stay finite");`);
  lines.push(`    t.expect(t.api.byType("sketch-walker").length === ${level.enemies.length}, "enemies are still on the map");`);
  lines.push(`  },`);
  lines.push(`};`);
  lines.push("");
  return lines.join("\n");
}

/** A compact, model-readable description of the sketch: coordinates, not adjectives. */
export function sketchPrompt(strokes: readonly SketchStroke[], hint = "", view?: SketchBox): string {
  const lines: string[] = [];
  lines.push("The player drew this level sketch on top of the game screen.");
  if (view) {
    lines.push(`The sketch covers this world rectangle: x ${n2(view.x)}..${n2(view.x + view.w)}, y ${n2(view.y)}..${n2(view.y + view.h)} (y grows down; the ground surface is y = 400).`);
  }
  if (hint.trim()) lines.push(`The player typed: "${hint.trim().slice(0, 200)}"`);
  lines.push(`Strokes (${strokes.length}), each with its exact world-space box {x, y, w, h}:`);
  strokes.slice(0, 60).forEach((s, i) => {
    const b = s.bbox;
    lines.push(`${i + 1}. tag=${s.tag} color=${s.color} box={x:${n2(b.x)}, y:${n2(b.y)}, w:${n2(b.w)}, h:${n2(b.h)}}`);
  });
  lines.push("Meant by the tags: terrain = platforms/walls/ground, coin = collectibles, hazard = enemies, bouncer = moving or bouncy surfaces.");
  lines.push("Reply with the JSON level object only.");
  return lines.join("\n");
}

/** Validate a client sketch payload: finite stroke numbers, capped counts, a real PNG data URL. */
export function sanitizeSketch(msg: { image?: unknown; strokes?: unknown; prompt?: unknown }): { image: string; strokes: SketchStroke[]; prompt: string } | null {
  if (typeof msg.image !== "string" || !msg.image.startsWith("data:image/") || msg.image.length < 256 || msg.image.length >= 4_000_000) return null;
  const raw = Array.isArray(msg.strokes) ? msg.strokes.slice(0, 400) : [];
  const strokes: SketchStroke[] = [];
  for (const s of raw) {
    if (strokes.length >= 80) break;
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const b = o.bbox as Record<string, unknown> | undefined;
    if (!b || ![b.x, b.y, b.w, b.h].every((v) => typeof v === "number" && Number.isFinite(v))) continue;
    const pts = Array.isArray(o.points) ? (o.points as unknown[]).slice(0, 400) : [];
    const points: SketchPoint[] = [];
    for (const p of pts) {
      const q = p as Record<string, unknown> | undefined;
      if (q && typeof q.x === "number" && typeof q.y === "number" && Number.isFinite(q.x) && Number.isFinite(q.y)) points.push({ x: q.x, y: q.y });
    }
    const tag = o.tag === "coin" || o.tag === "hazard" || o.tag === "bouncer" || o.tag === "terrain" ? o.tag : "freehand";
    strokes.push({
      color: typeof o.color === "string" ? o.color.slice(0, 16) : "#3fd06a",
      tag,
      points,
      bbox: { x: b.x as number, y: b.y as number, w: b.w as number, h: b.h as number },
    });
  }
  const prompt = typeof msg.prompt === "string" ? msg.prompt.slice(0, 200) : "";
  if (strokes.length === 0 && !prompt) return null;
  return { image: msg.image, strokes, prompt };
}

/** The world rect a sketch covers (for the prompt); tolerates a missing/garbled view. */
export function sketchView(raw: unknown): SketchBox | undefined {
  const v = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!v) return undefined;
  const x = Number(v.x);
  const y = Number(v.y);
  const w = Number(v.w);
  const h = Number(v.h);
  if (![x, y, w, h].every((n) => Number.isFinite(n)) || w <= 0 || h <= 0) return undefined;
  return { x, y, w, h };
}

export interface SketchDeps {
  /** One multimodal Wonder call: receives the sketch image plus the stroke-coordinate text. */
  ask: (messages: ChatMessage[]) => Promise<string>;
  /** Compile + verify + hot-load a mod source. Errors are model-readable. */
  deliver: (source: string) => Promise<{ ok: boolean; errors: string[] }>;
  say: (text: string) => void;
  stage: (stage: BuildStage, detail: string) => void;
  note?: (text: string) => void;
}

export interface SketchResult { ok: boolean; title: string; source: string; level?: SketchLevel; usedFallback: boolean }

/**
 * The whole draw-to-build pipeline after the sketch arrives: Wonder reads the sketch,
 * its JSON is compiled to a mod, and the mod is verified and hot-loaded. One automatic
 * retry: a bad reply is re-asked with the reason, a failed build is re-asked with the errors.
 * Falls back to a deterministic stroke-box level if the model cannot answer at all.
 */
export async function runSketchBuild(deps: SketchDeps, msg: { image?: unknown; strokes?: unknown; prompt?: unknown; view?: unknown }): Promise<SketchResult> {
  const clean = sanitizeSketch(msg);
  const failed = (why: string): SketchResult => {
    deps.say(why);
    return { ok: false, title: "", source: "", usedFallback: false };
  };
  if (!clean) return failed("That sketch didn't come through — draw a few platforms and try again.");
  const view = sketchView(msg.view);
  const body: ChatMessage[] = [
    { role: "system", content: SKETCH_SYSTEM },
    {
      role: "user",
      content: [
        { type: "text", text: sketchPrompt(clean.strokes, clean.prompt, view) },
        { type: "image_url", image_url: { url: clean.image } },
      ],
    },
  ];

  deps.stage("writing", "reading your sketch");
  let level: SketchLevel | undefined;
  let error = "";
  for (let tryIndex = 0; tryIndex < 2 && !level; tryIndex++) {
    try {
      const text = await deps.ask(body);
      const parsed = parseSketchLevel(text);
      if (parsed.level) level = parsed.level;
      else error = parsed.error ?? "the reply was unusable";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    if (!level && tryIndex === 0) {
      deps.note?.(`first sketch reply unusable (${error}), asking once more`);
      body.push({ role: "assistant", content: "(my last reply was not usable)" });
      body.push({ role: "user", content: `That reply could not be used because ${error}. Reply again with ONLY the JSON level object.` });
    }
  }

  let usedFallback = false;
  if (!level) {
    level = levelFromStrokes(clean.strokes, clean.prompt);
    usedFallback = true;
    if (isEmptyLevel(level)) return failed("I couldn't read a level out of that sketch. Try drawing thicker platforms.");
    deps.note?.(`using the stroke-box fallback level (${error})`);
  }

  deps.stage("compiling", "building your level");
  let source = levelToModSource(level);
  let built = await deps.deliver(source);
  if (!built.ok) {
    // One auto-fix round: hand the level and the verifier's complaint back to Wonder.
    deps.stage("fixing", "fixing the level");
    try {
      const fixBody: ChatMessage[] = [
        { role: "system", content: SKETCH_SYSTEM },
        { role: "user", content: `This level spec failed verification:\n${JSON.stringify(level)}\nfailures:\n- ${built.errors.slice(0, 300).join("\n- ")}\nReply with a corrected JSON level object only.` },
      ];
      const text = await deps.ask(fixBody);
      const parsed = parseSketchLevel(text);
      if (parsed.level) {
        level = parsed.level;
        source = levelToModSource(level);
        deps.stage("compiling", "recompiling the fixed level");
        built = await deps.deliver(source);
      }
    } catch (err) {
      deps.note?.(`sketch fix round failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!built.ok) {
    return failed(`That sketch didn't verify: ${built.errors.join("; ").slice(0, 300)}`);
  }
  const counts = [
    level.platforms.length > 0 ? `${level.platforms.length} platforms` : "",
    level.coins.length > 0 ? `${level.coins.length} coins` : "",
    level.enemies.length > 0 ? `${level.enemies.length} enemies` : "",
  ].filter(Boolean).join(", ");
  deps.say(`${level.name} is live: ${counts || "level"}.${usedFallback ? " (built from your boxes directly)" : ""}`);
  return { ok: true, title: level.name, source, level, usedFallback };
}
