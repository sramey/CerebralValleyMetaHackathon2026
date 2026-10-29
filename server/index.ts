// WebSocket game server on port 8787 (override with PORT). Route (Spark) -> write (Wonder) ->
// compile -> verify -> one auto-fix -> hot-load message. Never crashes on a
// bad mod or a missing MODEL_API_KEY (answers with say in that case).
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { SIM } from "../src/contract";
import type { ClientMsg, KnobDefs, KnobValue, ServerMsg, WorldMod } from "../src/contract";
import { chat, hasApiKey, loadEnv, SPARK, WONDER } from "./meta";
import { compileMod } from "./compile";
import { verifyMod } from "./verify";
import { buildEditPrompt, buildFixPrompt, buildRouterPrompt, buildWonderPrompt, formatManifest, ROUTER_SYSTEM, WONDER_SYSTEM } from "./prompt";
import { logBuild, saveModSources } from "./createlog";
import { artCachedUrl, artKeyForType, deriveSubject, generateSubjectArt, isScenerySubject, pickArtType } from "./art";
import { segmentPhoto } from "./photo";
import { Budget, readLimits } from "./budget";
import type { Kind } from "./budget";
import { isWorldId, snapshotWorld, WorldStore } from "./worlds";
import { createStaticHandler } from "./static";
import { createVoiceHub } from "./voice";

loadEnv();
const PORT = Number(process.env.PORT ?? 8787);

interface ManifestRec {
  id: string;
  title: string;
  source: string;
  compiled: string;
  knobs: KnobDefs;
  art?: { key: string; url: string; scenery?: boolean };
}

// Each connection has its own world (ADR 0014): a public server must never mix visitors' mods.
interface Session { manifest: Map<string, ManifestRec>; ip: string }
const sessions = new WeakMap<WebSocket, Session>();
function sess(ws: WebSocket): Session {
  let s = sessions.get(ws);
  if (!s) { s = { manifest: new Map(), ip: "unknown" }; sessions.set(ws, s); }
  return s;
}

const HOST = process.env.HOST ?? "127.0.0.1";
const DATA_DIR = join(process.cwd(), process.env.DATA_DIR ?? "data");
const killSwitchOn = () => /^(1|true|yes|on)$/i.test(process.env.AI_KILL_SWITCH ?? "");
const budget = new Budget({ ...readLimits(process.env), killSwitch: killSwitchOn, file: join(DATA_DIR, "budget.json") });
const worlds = new WorldStore(join(DATA_DIR, "worlds"), join(process.cwd(), "worlds"));

interface BuiltinDef { alias: string; file: string; id: string }

// Hand-written mods in src/mods: simple exact commands use these, not Wonder.
const BUILTINS: BuiltinDef[] = [
  { alias: "player", file: "player.ts", id: "player" },
  { alias: "ground", file: "ground.ts", id: "ground" },
  { alias: "rain", file: "rain.ts", id: "rain" },
  { alias: "coin", file: "coins.ts", id: "coins" },
  { alias: "coins", file: "coins.ts", id: "coins" },
  { alias: "enemy", file: "enemy.ts", id: "enemies" },
  { alias: "enemies", file: "enemy.ts", id: "enemies" },
  { alias: "moving platform", file: "platform-moving.ts", id: "moving-platform" },
  { alias: "fire arrow", file: "fire-arrow.ts", id: "fire-arrow" },
  { alias: "fire arrows", file: "fire-arrow.ts", id: "fire-arrow" },
  { alias: "chicken", file: "chicken.ts", id: "chicken" },
];

// "starter world" alias: player then ground, delivered sequentially.
const STARTER_WORLD: BuiltinDef[] = [
  { alias: "player", file: "player.ts", id: "player" },
  { alias: "ground", file: "ground.ts", id: "ground" },
];

function normalizeBuiltinCommand(command: string): string {
  let s = command.toLowerCase().trim().replace(/\s+/g, " ");
  s = s.replace(/[.!?,;:]+$/, "").trim();
  s = s.replace(/^(?:add|make|create|spawn|build|give|put)\s+/, "");
  s = s.replace(/^(?:a|an|the)\s+/, "");
  s = s.replace(/[.!?,;:]+$/, "").trim();
  return s;
}

interface DeliverTimings { route: number; write: number; compile: number; verify: number }

/** Compile/verify/send/manifest/log one mod source. Returns false on any failure. */
async function deliverMod(ws: WebSocket, command: string, source: string, routeLabel: string, t0: number, timings: DeliverTimings): Promise<boolean> {
  const manifest = sess(ws).manifest;
  try {
    stage(ws, { kind: "stage", stage: "compiling", detail: "compiling the mod", command });
    const c0 = performance.now();
    const compiled = compileMod(source);
    timings.compile += Math.round(performance.now() - c0);
    if (!compiled.ok) return false;
    stage(ws, { kind: "stage", stage: "verifying", detail: "verifying the mod", command });
    const v0 = performance.now();
    const verified = await verifyMod(source, compiled.js);
    timings.verify += Math.round(performance.now() - v0);
    if (!verified.ok || !verified.def) return false;
    const def = verified.def;
    const rec: ManifestRec = { id: def.id, title: def.title, source, compiled: compiled.js, knobs: def.knobs ?? {} };
    manifest.set(def.id, rec);
    stage(ws, { kind: "stage", stage: "done", detail: `loaded ${def.id} (${SIM.healthFrames} frames OK)`, command });
    send(ws, { kind: "mod", mod: { id: def.id, title: def.title, source, compiled: compiled.js, knobs: rec.knobs } });
    const files = saveModSources([source], def.id);
    logBuild({ command, route: routeLabel, outcome: "mod", modId: def.id, title: def.title, timings: { route: timings.route, write: 0, compile: timings.compile, verify: timings.verify, total: Math.round(performance.now() - t0) }, verify: { ok: true, errors: [], msPerFrame: verified.msPerFrame }, fixAttempted: false, sourceFile: files[files.length - 1], sourceFiles: files });
    return true;
  } catch {
    return false;
  }
}

type RouteAction = "new" | "tweak" | "edit" | "undo" | "question";
interface Route {
  action: RouteAction;
  target?: string;
  knob?: string;
  value?: KnobValue;
  answer?: string;
}

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function stage(ws: WebSocket, s: ServerMsg & { kind: "stage" }): void {
  send(ws, s);
}

function knobValues(rec: ManifestRec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, d] of Object.entries(rec.knobs)) out[k] = d.value;
  return out;
}

function manifestText(ws: WebSocket): string {
  return formatManifest([...sess(ws).manifest.values()].map((m) => ({ id: m.id, title: m.title, knobs: knobValues(m) })));
}

function photoTitle(prompt: string): string {
  const trimmed = prompt.trim();
  const cap = trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : trimmed;
  return `${cap} (photo)`;
}

function buildPhotoModSource(key: string, prompt: string, aspect: number): string {
  const aspectLit = String(Number((Number.isFinite(aspect) && aspect > 0 ? aspect : 1).toFixed(4)));
  const idLit = JSON.stringify(key);
  const titleLit = JSON.stringify(photoTitle(prompt));
  return [
    `export default {`,
    `  id: ${idLit},`,
    `  title: ${titleLit},`,
    `  knobs: { size: { value: 64, min: 24, max: 160, label: "Size" } },`,
    `  setup(api, knobs) {`,
    `    const h = Number(knobs.size);`,
    `    const aspect = ${aspectLit};`,
    `    const w = Math.min(220, Math.max(16, h * aspect));`,
    `    api.spawn({ type: ${idLit}, x: 260, y: 400 - h, w: w, h: h, color: 0xffd76a, solid: false, gravityScale: 1 });`,
    `    api.onTick(() => {`,
    `      if (api.tick() % 200 !== 0) return;`,
    `      for (const e of api.byType(${idLit})) {`,
    `        if (e.onGround) e.vy = -240;`,
    `      }`,
    `    });`,
    `  },`,
    `  dispose(api) {`,
    `    for (const e of api.byType(${idLit})) api.despawn(e.id);`,
    `  },`,
    `  test(t) {`,
    `    t.step(5);`,
    `    t.expect(t.api.byType(${idLit}).length === 1, "exactly one photo entity");`,
    `  },`,
    `};`,
    ``,
  ].join("\n");
}

const pendingFinds = new Map<WebSocket, Map<string, { box: { x: number; y: number; w: number; h: number }; prompt: string }>>();

async function buildPhotoMod(ws: WebSocket, key: string, prompt: string, aspect: number): Promise<void> {
  const manifest = sess(ws).manifest;
  const t0 = performance.now();
  const safePrompt = typeof prompt === "string" ? prompt : "";
  const command = `photo: ${safePrompt}`;
  let compileMs = 0;
  let verifyMs = 0;
  try {
    if (typeof key !== "string" || !key) {
      send(ws, { kind: "say", text: "That photo didn't come through — try taking it again." });
      logBuild({ command, route: "new", outcome: "failed", timings: { route: 0, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) }, fixAttempted: false });
      return;
    }
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
    const source = buildPhotoModSource(key, safePrompt, safeAspect);
    const c0 = performance.now();
    const compiled = compileMod(source);
    compileMs = Math.round(performance.now() - c0);
    if (!compiled.ok) {
      send(ws, { kind: "say", text: `That didn't verify: ${compiled.errors.join("; ").slice(0, 500)}` });
      logBuild({ command, route: "new", outcome: "failed", timings: { route: 0, write: 0, compile: compileMs, verify: 0, total: Math.round(performance.now() - t0) }, verify: { ok: false, errors: compiled.errors, msPerFrame: 0 }, fixAttempted: false });
      return;
    }
    const v0 = performance.now();
    const verified = await verifyMod(source, compiled.js);
    verifyMs = Math.round(performance.now() - v0);
    if (!verified.ok || !verified.def) {
      const errors = verified.errors.length > 0 ? verified.errors : ["verification failed"];
      send(ws, { kind: "say", text: `That didn't verify: ${errors.join("; ").slice(0, 500)}` });
      logBuild({ command, route: "new", outcome: "failed", timings: { route: 0, write: 0, compile: compileMs, verify: verifyMs, total: Math.round(performance.now() - t0) }, verify: { ok: false, errors, msPerFrame: verified.msPerFrame }, fixAttempted: false });
      return;
    }
    const def = verified.def;
    const rec: ManifestRec = { id: def.id, title: def.title, source, compiled: compiled.js, knobs: def.knobs ?? {} };
    manifest.set(def.id, rec);
    stage(ws, { kind: "stage", stage: "done", detail: `loaded ${def.id} (${SIM.healthFrames} frames OK)`, command });
    send(ws, { kind: "mod", mod: { id: def.id, title: def.title, source, compiled: compiled.js, knobs: rec.knobs, artPending: key } });
    const files = saveModSources([source], def.id);
    logBuild({ command, route: "new", outcome: "mod", modId: def.id, title: def.title, timings: { route: 0, write: 0, compile: compileMs, verify: verifyMs, total: Math.round(performance.now() - t0) }, verify: { ok: true, errors: [], msPerFrame: verified.msPerFrame }, fixAttempted: false, sourceFile: files[files.length - 1], sourceFiles: files });
  } catch (err) {
    try {
      send(ws, { kind: "say", text: `Photo failed: ${err instanceof Error ? err.message : String(err)}` });
    } catch { /* ignore */ }
    try {
      logBuild({ command, route: "new", outcome: "failed", timings: { route: 0, write: 0, compile: compileMs, verify: verifyMs, total: Math.round(performance.now() - t0) }, fixAttempted: false });
    } catch { /* ignore */ }
  }
}

async function handlePhoto(ws: WebSocket, msg: Extract<ClientMsg, { kind: "photo" }>): Promise<void> {
  const t0 = performance.now();
  const prompt = typeof msg.prompt === "string" ? msg.prompt : "";
  const command = `photo: ${prompt}`;
  if (typeof msg.image !== "string" || !msg.image.startsWith("data:image") || msg.image.length >= 4_000_000) {
    send(ws, { kind: "say", text: "That photo didn't come through — try taking it again." });
    logBuild({ command, route: "new", outcome: "say", timings: { route: 0, write: 0, compile: 0, verify: 0, total: 0 }, fixAttempted: false });
    return;
  }
  if (typeof msg.key !== "string" || !msg.key) {
    send(ws, { kind: "say", text: "That photo didn't come through — try taking it again." });
    logBuild({ command, route: "new", outcome: "say", timings: { route: 0, write: 0, compile: 0, verify: 0, total: 0 }, fixAttempted: false });
    return;
  }
  try {
    if (!spend(ws, "sam")) { send(ws, { kind: "segment", key: msg.key, box: null }); return; }
    const box = await segmentPhoto(msg.image, prompt);
    send(ws, { kind: "segment", key: msg.key, box });
    if (!box) {
      send(ws, { kind: "say", text: "I couldn't spot that in the photo — hold it up clearly and try again." });
      logBuild({ command, route: "new", outcome: "say", timings: { route: 0, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) }, fixAttempted: false });
      return;
    }
    await buildPhotoMod(ws, msg.key, prompt, box.w / box.h);
  } catch (err) {
    try {
      send(ws, { kind: "say", text: `Photo failed: ${err instanceof Error ? err.message : String(err)}` });
    } catch { /* ignore */ }
    try {
      logBuild({ command, route: "new", outcome: "failed", timings: { route: 0, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) }, fixAttempted: false });
    } catch { /* ignore */ }
  }
}

async function handlePhotoFind(ws: WebSocket, msg: Extract<ClientMsg, { kind: "photoFind" }>): Promise<void> {
  const key = typeof msg.key === "string" ? msg.key : "";
  const prompt = typeof msg.prompt === "string" ? msg.prompt : "";
  try {
    if (typeof msg.image !== "string" || !msg.image.startsWith("data:image") || msg.image.length >= 4_000_000) {
      send(ws, { kind: "segment", key, box: null });
      return;
    }
    if (!spend(ws, "sam")) { send(ws, { kind: "segment", key, box: null }); return; }
    const box = await segmentPhoto(msg.image, prompt);
    if (box) {
      let perWs = pendingFinds.get(ws);
      if (!perWs) {
        perWs = new Map();
        pendingFinds.set(ws, perWs);
      }
      perWs.set(key, { box, prompt });
    }
    send(ws, { kind: "segment", key, box });
  } catch {
    try {
      send(ws, { kind: "segment", key, box: null });
    } catch { /* ignore */ }
  }
}

async function handlePhotoBring(ws: WebSocket, msg: Extract<ClientMsg, { kind: "photoBring" }>): Promise<void> {
  const key = typeof msg.key === "string" ? msg.key : "";
  const perWs = pendingFinds.get(ws);
  const entry = perWs?.get(key);
  if (!entry) {
    send(ws, { kind: "say", text: "That detection expired — find the object again." });
    return;
  }
  perWs!.delete(key);
  if (perWs!.size === 0) pendingFinds.delete(ws);
  const aspect = entry.box.h !== 0 ? entry.box.w / entry.box.h : 1;
  await buildPhotoMod(ws, key, entry.prompt, aspect);
}

async function handlePhotoBringLocal(ws: WebSocket, msg: Extract<ClientMsg, { kind: "photoBringLocal" }>): Promise<void> {
  const key = typeof msg.key === "string" ? msg.key : "";
  const prompt = typeof msg.prompt === "string" ? msg.prompt : "";
  const aspect = (msg as { aspect?: unknown }).aspect;
  if (typeof aspect !== "number" || !Number.isFinite(aspect) || aspect < 0.1 || aspect > 10) {
    send(ws, { kind: "say", text: "That photo didn't come through — try taking it again." });
    return;
  }
  await buildPhotoMod(ws, key, prompt, aspect);
}

function parseRoute(text: string): Route | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const action = obj.action as RouteAction;
    if (!["new", "tweak", "edit", "undo", "question"].includes(action)) return null;
    const r: Route = { action };
    if (typeof obj.target === "string") r.target = obj.target;
    if (typeof obj.knob === "string") r.knob = obj.knob;
    if (typeof obj.value === "number" || typeof obj.value === "string" || typeof obj.value === "boolean") {
      r.value = obj.value as KnobValue;
    }
    if (typeof obj.answer === "string") r.answer = obj.answer;
    return r;
  } catch {
    return null;
  }
}

function stripFences(src: string): string {
  let s = src.trim();
  const m = s.match(/^```(?:ts|typescript|javascript|js)?\s*\n([\s\S]*?)\n```\s*$/);
  if (m) s = m[1].trim();
  return s;
}

/** Ask Spark to split a compound build command into standalone add-commands. */
async function trySplitCompound(command: string): Promise<string[] | null> {
  try {
    const res = await chat(SPARK, [
      {
        role: "system",
        content: "Reply with ONLY a JSON array of strings, each a standalone add-command. Split the request into at most 4 independent single-add commands. No markdown, no prose.",
      },
      { role: "user", content: command },
    ], 512);
    const start = res.text.indexOf("[");
    const end = res.text.lastIndexOf("]");
    if (start < 0 || end <= start) return null;
    const arr: unknown = JSON.parse(res.text.slice(start, end + 1));
    if (!Array.isArray(arr)) return null;
    const items = arr
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 4);
    return items.length >= 2 ? items : null;
  } catch {
    return null;
  }
}

async function handleCommand(ws: WebSocket, text: string): Promise<void> {
  // Compound split: only for build-shaped commands that join requests with
  // "," or " and ". Anything else takes the normal single-command path.
  if (/^\s*(add|make|create|spawn|build)\b/i.test(text) && (text.includes(",") || text.toLowerCase().includes(" and "))) {
    const items = await trySplitCompound(text);
    if (items && items.length >= 2) {
      for (const item of items) {
        await handleSingle(ws, item);
      }
      return;
    }
  }
  await handleSingle(ws, text);
}

async function handleSingle(ws: WebSocket, text: string): Promise<void> {
  const t0 = performance.now();
  let routeMs = 0;
  let writeMs = 0;
  let compileMs = 0;
  let verifyMs = 0;
  const command = text.slice(0, 400);
  const manifest = sess(ws).manifest;

  stage(ws, { kind: "stage", stage: "routing", detail: "routing your command", command });

  if (!spend(ws, "build")) {
    send(ws, { kind: "timing", command, ms: { route: 0, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) } });
    logBuild({ command, route: "new", outcome: "say", timings: { route: 0, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) }, fixAttempted: false });
    return;
  }

  // 1. Route with Spark.
  let route: Route | null = null;
  try {
    const r0 = performance.now();
    const res = await chat(SPARK, [
      { role: "system", content: ROUTER_SYSTEM },
      { role: "user", content: buildRouterPrompt(command, manifestText(ws)) },
    ], 1024);
    routeMs = Math.round(performance.now() - r0);
    void res.ms;
    route = parseRoute(res.text);
    // Fallback: a build-shaped command never dead-ends on a router miss.
    if (!route && /^(add|make|create|spawn|give|put|build)\b/i.test(command.trim())) {
      console.log(`[route] fallback to new for: ${command}`);
      route = { action: "new" };
    }
    // Guard: "add/make/create ..." is always a build, never a tweak/question.
    if (route && /^(add|make|create|spawn|build)\b/i.test(command.trim()) && route.action !== "new" && route.action !== "edit" && route.action !== "undo") {
      console.log(`[route] coerced ${route.action} -> new for: ${command}`);
      route = { action: "new" };
    }
  } catch (err) {
    send(ws, { kind: "say", text: `Router hiccup: ${err instanceof Error ? err.message : String(err)}. Try again?` });
    send(ws, { kind: "timing", command, ms: { route: routeMs, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) } });
    logBuild({ command, route: "new", outcome: "say", timings: { route: routeMs, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) }, fixAttempted: false });
    return;
  }
  if (!route) {
    send(ws, { kind: "say", text: "I didn't quite get that — try something like 'add a player' or 'make it rain'." });
    send(ws, { kind: "timing", command, ms: { route: routeMs, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) } });
    logBuild({ command, route: "new", outcome: "say", timings: { route: routeMs, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) }, fixAttempted: false });
    return;
  }

  // 2. Non-generation routes.
  if (route.action === "question") {
    send(ws, { kind: "say", text: route.answer ?? "Hello! Tell me what to build — e.g. 'add a player', 'make it rain'." });
    send(ws, { kind: "timing", command, ms: { route: routeMs, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) } });
    logBuild({ command, route: "question", outcome: "say", timings: { route: routeMs, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) }, fixAttempted: false });
    return;
  }
  if (route.action === "undo") {
    const id = route.target ?? "";
    if (id && manifest.has(id)) {
      manifest.delete(id);
      send(ws, { kind: "removed", modId: id });
    } else {
      send(ws, { kind: "say", text: id ? `Nothing loaded with id "${id}".` : "Tell me which mod to remove." });
    }
    send(ws, { kind: "timing", command, ms: { route: routeMs, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) } });
    return;
  }
  if (route.action === "tweak") {
    const rec = route.target ? manifest.get(route.target) : undefined;
    if (rec && route.knob && route.value !== undefined && route.knob in rec.knobs) {
      rec.knobs[route.knob] = { ...rec.knobs[route.knob], value: route.value };
      send(ws, { kind: "tweak", modId: rec.id, knob: route.knob, value: route.value });
      send(ws, { kind: "timing", command, ms: { route: routeMs, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) } });
      logBuild({ command, route: "tweak", outcome: "tweak", modId: rec.id, knob: route.knob, value: route.value, timings: { route: routeMs, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) }, fixAttempted: false });
      return;
    }
    // Client is the authority on what is loaded (it also has local built-in
    // mods the server has never seen). Forward a fully-specified tweak and
    // let the client apply or reject it, instead of rebuilding from scratch.
    if (!rec && route.target && route.knob && typeof route.value === "number") {
      console.log(`[route] tweak forwarded to client: ${route.target}.${route.knob}=${route.value}`);
      send(ws, { kind: "tweak", modId: route.target, knob: route.knob, value: route.value });
      send(ws, { kind: "timing", command, ms: { route: routeMs, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) } });
      logBuild({ command, route: "tweak", outcome: "tweak", modId: route.target, knob: route.knob, value: route.value, timings: { route: routeMs, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) }, fixAttempted: false });
      return;
    }
    // Tweak that names no loaded target/knob never fails: an unknown target
    // is built fresh, while a known target with an inapplicable knob is a
    // behavior change — rewrite that mod in place (edit).
    if (rec) {
      console.log(`[route] tweak -> edit ${rec.id} for: ${command}`);
      route = { action: "edit", target: rec.id };
    } else {
      console.log(`[route] tweak -> new for: ${command}`);
      route = { action: "new" };
    }
  }

  // Built-in fast path: exact simple "new" commands use hand-written mods.
  // Any read/compile/verify failure falls through to Wonder below.
  if (route.action === "new") {
    const key = normalizeBuiltinCommand(command);
    const builtinTimings: DeliverTimings = { route: routeMs, write: 0, compile: 0, verify: 0 };
    const deliverBuiltin = async (b: BuiltinDef): Promise<boolean> => {
      let src: string;
      try {
        src = readFileSync(join(process.cwd(), "src/mods", b.file), "utf8");
      } catch {
        return false;
      }
      const ok = await deliverMod(ws, command, src, "builtin", t0, builtinTimings);
      compileMs = builtinTimings.compile;
      verifyMs = builtinTimings.verify;
      return ok;
    };
    if (key === "starter world") {
      const pending = STARTER_WORLD.filter((b) => !manifest.has(b.id));
      if (pending.length > 0) {
        let delivered = false;
        for (const b of pending) {
          if (await deliverBuiltin(b)) delivered = true;
        }
        if (delivered) {
          send(ws, { kind: "timing", command, ms: { route: routeMs, write: 0, compile: compileMs, verify: verifyMs, total: Math.round(performance.now() - t0) } });
          return;
        }
      }
    } else {
      const builtin = BUILTINS.find((b) => b.alias === key);
      if (builtin && !manifest.has(builtin.id)) {
        if (await deliverBuiltin(builtin)) {
          send(ws, { kind: "timing", command, ms: { route: routeMs, write: 0, compile: compileMs, verify: verifyMs, total: Math.round(performance.now() - t0) } });
          return;
        }
      }
    }
  }

  // 3. new / edit: Wonder writes one mod. An edit whose target is gone falls
  // back to new.
  let editRec: ManifestRec | undefined;
  if (route.action === "edit") {
    editRec = route.target ? manifest.get(route.target) : undefined;
    if (!editRec) {
      console.log(`[route] edit -> new (missing target) for: ${command}`);
      route = { action: "new" };
    }
  }
  stage(ws, { kind: "stage", stage: "writing", detail: "writing the mod", command });
  let source = "";
  const sources: string[] = [];
  let fixAttempted = false;
  const routeAction = route.action;
  try {
    const w0 = performance.now();
    const res = await chat(WONDER, [
      { role: "system", content: WONDER_SYSTEM },
      { role: "user", content: editRec ? buildEditPrompt(command, editRec.source, manifestText(ws)) : buildWonderPrompt(command, manifestText(ws)) },
    ], 4096);
    writeMs = Math.round(performance.now() - w0);
    source = stripFences(res.text);
    sources.push(source);
  } catch (err) {
    send(ws, { kind: "say", text: `The writer failed: ${err instanceof Error ? err.message : String(err)}` });
    send(ws, { kind: "timing", command, ms: { route: routeMs, write: writeMs, compile: 0, verify: 0, total: Math.round(performance.now() - t0) } });
    logBuild({ command, route: routeAction, outcome: "say", timings: { route: routeMs, write: writeMs, compile: 0, verify: 0, total: Math.round(performance.now() - t0) }, fixAttempted: false });
    return;
  }

  const attempt = async (src: string) => {
    const c0 = performance.now();
    const compiled = compileMod(src);
    compileMs += Math.round(performance.now() - c0);
    if (!compiled.ok) return { ok: false as const, errors: compiled.errors, js: "", msPerFrame: 0 };
    stage(ws, { kind: "stage", stage: "verifying", detail: "verifying the mod", command });
    const v0 = performance.now();
    const res = await verifyMod(src, compiled.js);
    verifyMs += Math.round(performance.now() - v0);
    if (!res.ok) return { ok: false as const, errors: res.errors, js: compiled.js, msPerFrame: res.msPerFrame };
    return { ok: true as const, errors: [] as string[], js: compiled.js, res };
  };

  stage(ws, { kind: "stage", stage: "compiling", detail: "compiling the mod", command });
  let first = await attempt(source);
  if (!first.ok) {
    // ONE auto-fix round.
    stage(ws, { kind: "stage", stage: "fixing", detail: "fixing the mod", command });
    fixAttempted = true;
    try {
      const w0 = performance.now();
      const fix = await chat(WONDER, [
        { role: "system", content: WONDER_SYSTEM },
        { role: "user", content: buildFixPrompt(command, source, first.errors) },
      ], 4096);
      writeMs += Math.round(performance.now() - w0);
      source = stripFences(fix.text);
      sources.push(source);
      stage(ws, { kind: "stage", stage: "compiling", detail: "recompiling the fix", command });
      first = await attempt(source);
    } catch (err) {
      send(ws, { kind: "say", text: `Fix attempt failed: ${err instanceof Error ? err.message : String(err)}` });
      send(ws, { kind: "timing", command, ms: { route: routeMs, write: writeMs, compile: compileMs, verify: verifyMs, total: Math.round(performance.now() - t0) } });
      const files = saveModSources(sources);
      logBuild({ command, route: routeAction, outcome: "say", timings: { route: routeMs, write: writeMs, compile: compileMs, verify: verifyMs, total: Math.round(performance.now() - t0) }, fixAttempted, sourceFile: files[files.length - 1], sourceFiles: files });
      return;
    }
  }

  if (first.ok) {
    const def = first.res.def!;
    // Art on demand: cached art attaches immediately; otherwise the mod
    // ships with artPending and the art streams in asynchronously.
    let art: { key: string; url: string; scenery?: boolean } | undefined;
    let artPending: string | undefined;
    let pendingArt: { subject: string; key: string; scenery: boolean } | undefined;
    const artType = pickArtType(source);
    if (artType) {
      const subject = deriveSubject(command, artType);
      const key = artKeyForType(artType);
      if (key) {
        const scenery = isScenerySubject(subject) || isScenerySubject(artType);
        const cachedUrl = artCachedUrl(key);
        if (cachedUrl) {
          art = { key, url: cachedUrl, ...(scenery ? { scenery: true } : {}) };
        } else if (spend(ws, "image")) {
          artPending = key;
          pendingArt = { subject, key, scenery };
        }
      }
    }
    const rec: ManifestRec = { id: def.id, title: def.title, source, compiled: first.js, knobs: def.knobs ?? {}, ...(art ? { art } : {}) };
    // Edit keeps the same id so the client loader replaces it; if Wonder
    // renamed it anyway, drop the stale entry instead of duplicating.
    if (editRec && def.id !== editRec.id) manifest.delete(editRec.id);
    manifest.set(def.id, rec);
    stage(ws, { kind: "stage", stage: "done", detail: `loaded ${def.id} (${SIM.healthFrames} frames OK)`, command });
    send(ws, { kind: "mod", mod: { id: def.id, title: def.title, source, compiled: first.js, knobs: rec.knobs, ...(art ? { art } : {}), ...(artPending ? { artPending } : {}) } });
    if (pendingArt) {
      const { subject, key, scenery } = pendingArt;
      generateSubjectArt(subject, key, scenery).then(url => { if (url) { rec.art = { key, url, ...(scenery ? { scenery: true } : {}) }; try { send(ws, { kind: "art", modId: def.id, art: { key, url, ...(scenery ? { scenery: true } : {}) } }); } catch {} } }).catch(() => {});
      send(ws, { kind: "say", text: `Drawing ${subject}...` });
    }
    const files = saveModSources(sources, def.id);
    logBuild({ command, route: editRec ? "edit" : routeAction, outcome: editRec ? "edit" : "mod", modId: def.id, title: def.title, timings: { route: routeMs, write: writeMs, compile: compileMs, verify: verifyMs, total: Math.round(performance.now() - t0) }, verify: { ok: true, errors: [], msPerFrame: first.res.msPerFrame }, fixAttempted, sourceFile: files[files.length - 1], sourceFiles: files });
  } else {
    stage(ws, { kind: "stage", stage: "failed", detail: first.errors.join("; ").slice(0, 500), command });
    send(ws, { kind: "say", text: `That didn't verify: ${first.errors.join("; ").slice(0, 500)}` });
    const files = saveModSources(sources);
    logBuild({ command, route: routeAction, outcome: "failed", timings: { route: routeMs, write: writeMs, compile: compileMs, verify: verifyMs, total: Math.round(performance.now() - t0) }, verify: { ok: false, errors: first.errors, msPerFrame: first.msPerFrame }, fixAttempted, sourceFile: files[files.length - 1], sourceFiles: files });
  }
  send(ws, { kind: "timing", command, ms: { route: routeMs, write: writeMs, compile: compileMs, verify: verifyMs, total: Math.round(performance.now() - t0) } });
}

// Hold-to-talk (ADR 0012): mic audio arrives as binary frames and is proxied to Muse Voice Transcribe.
const voiceHub = createVoiceHub({
  modNames: (ws) => [...sess(ws).manifest.values()].flatMap((m) => [m.id, m.title]),
  send,
  guard: {
    check: (ws) => {
      if (!hasApiKey()) return "Voice isn't connected on this server. Type instead.";
      const v = budget.check(sess(ws).ip, "voice", 10);
      return v.ok ? null : v.message;
    },
    record: (ws, seconds) => budget.add(sess(ws).ip, "voice", seconds),
  },
});

/** Spend one unit of Meta budget, or tell the visitor why not (the game keeps playing). */
function spend(ws: WebSocket, kind: Kind): boolean {
  if (!hasApiKey()) {
    send(ws, { kind: "say", text: "The AI isn't connected on this server, but you can still play and try a demo world." });
    send(ws, { kind: "visitor", reason: "nokey", demos: worlds.demos() });
    return false;
  }
  const v = budget.take(sess(ws).ip, kind);
  if (v.ok) return true;
  send(ws, { kind: "say", text: v.message });
  if (kind !== "image") send(ws, { kind: "visitor", reason: v.scope === "killswitch" ? "killswitch" : "budget", demos: worlds.demos() });
  return false;
}

const BUILTIN_IDS: ReadonlySet<string> = new Set(BUILTINS.map((b) => b.id));

function handleWorldSave(ws: WebSocket, msg: Extract<ClientMsg, { kind: "worldSave" }>): void {
  const requested = Array.isArray(msg.mods) ? msg.mods.filter((m) => m && typeof m.id === "string") : [];
  const saved = worlds.save(snapshotWorld(requested, sess(ws).manifest, BUILTIN_IDS));
  if ("error" in saved) send(ws, { kind: "say", text: saved.error });
  else send(ws, { kind: "worldSaved", id: saved.id });
}

function handleWorldLoad(ws: WebSocket, msg: Extract<ClientMsg, { kind: "worldLoad" }>): void {
  const w = isWorldId(msg.id) ? worlds.get(msg.id) : null;
  if (!w) { send(ws, { kind: "say", text: "That world link doesn't exist (any more). Start fresh or open a demo world." }); return; }
  // The session now holds exactly this world, so remixing (edit/undo/tweak) works on it.
  const manifest = sess(ws).manifest;
  manifest.clear();
  for (const m of w.mods) {
    if (m.builtin !== true) manifest.set(m.id, { id: m.id, title: m.title, source: m.source, compiled: m.compiled, knobs: structuredClone(m.knobs), ...(m.art ? { art: m.art } : {}) });
  }
  send(ws, { kind: "world", id: w.id, mods: w.mods as WorldMod[] });
}

function handleMessage(ws: WebSocket, raw: string): void {
  let msg: ClientMsg;
  try {
    msg = JSON.parse(raw) as ClientMsg;
  } catch {
    send(ws, { kind: "say", text: "I only speak JSON — try the text box again." });
    return;
  }
  if (!msg || typeof msg !== "object" || typeof (msg as { kind?: unknown }).kind !== "string") {
    send(ws, { kind: "say", text: "I only speak JSON — try the text box again." });
    return;
  }
  if (voiceHub.handle(ws, msg)) return;
  const manifest = sess(ws).manifest;
  if (msg.kind === "worldSave") handleWorldSave(ws, msg);
  else if (msg.kind === "worldLoad") handleWorldLoad(ws, msg);
  else if (msg.kind === "command") {
    handleCommand(ws, msg.text).catch((err) => {
      send(ws, { kind: "say", text: `Command failed: ${err instanceof Error ? err.message : String(err)}` });
    });
  } else if (msg.kind === "photo") {
    handlePhoto(ws, msg).catch((err) => {
      send(ws, { kind: "say", text: `Photo failed: ${err instanceof Error ? err.message : String(err)}` });
    });
  } else if (msg.kind === "photoFind") {
    handlePhotoFind(ws, msg).catch((err) => {
      try {
        send(ws, { kind: "segment", key: typeof msg.key === "string" ? msg.key : "", box: null });
      } catch { /* ignore */ }
      void err;
    });
  } else if (msg.kind === "photoBring") {
    handlePhotoBring(ws, msg).catch((err) => {
      send(ws, { kind: "say", text: `Photo failed: ${err instanceof Error ? err.message : String(err)}` });
    });
  } else if (msg.kind === "photoBringLocal") {
    handlePhotoBringLocal(ws, msg).catch((err) => {
      send(ws, { kind: "say", text: `Photo failed: ${err instanceof Error ? err.message : String(err)}` });
    });
  } else if (msg.kind === "undo") {
    if (manifest.has(msg.modId)) {
      manifest.delete(msg.modId);
      send(ws, { kind: "removed", modId: msg.modId });
    } else {
      send(ws, { kind: "say", text: `Nothing loaded with id "${msg.modId}".` });
    }
  } else if (msg.kind === "knob") {
    const rec = manifest.get(msg.modId);
    if (rec && msg.knob in rec.knobs) {
      rec.knobs[msg.knob] = { ...rec.knobs[msg.knob], value: msg.value };
      send(ws, { kind: "tweak", modId: msg.modId, knob: msg.knob, value: msg.value });
    } else {
      send(ws, { kind: "say", text: "Unknown mod or knob." });
    }
  }
}

// One port: static client + WebSocket (ADR 0014). Works behind an HTTPS proxy as wss.
const staticHandler = createStaticHandler({ distDir: join(process.cwd(), "dist"), genArtDir: join(process.cwd(), "public", "art", "gen") });
const httpServer = createServer(staticHandler);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
const maxConnPerIp = Number(process.env.MAX_CONN_PER_IP ?? 10);
const connsByIp = new Map<string, number>();
const wss = new WebSocketServer({
  server: httpServer,
  maxPayload: 6 * 1024 * 1024, // photos arrive as data URLs (capped at 4 MB each)
  verifyClient: ({ origin }: { origin: string }) => allowedOrigins.length === 0 || allowedOrigins.includes(origin),
});
wss.on("connection", (ws: WebSocket, req) => {
  const fwd = process.env.TRUST_PROXY === "1" ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
  const ip = fwd || req.socket.remoteAddress || "unknown";
  if ((connsByIp.get(ip) ?? 0) >= maxConnPerIp) { ws.close(1013, "too many connections"); return; }
  connsByIp.set(ip, (connsByIp.get(ip) ?? 0) + 1);
  sess(ws).ip = ip;
  send(ws, { kind: "say", text: "hello! Tell me what to build — e.g. 'add a player'." });
  if (!hasApiKey() || killSwitchOn()) send(ws, { kind: "visitor", reason: killSwitchOn() ? "killswitch" : "nokey", demos: worlds.demos() });
  ws.on("close", () => {
    connsByIp.set(ip, Math.max(0, (connsByIp.get(ip) ?? 1) - 1));
    pendingFinds.delete(ws);
    voiceHub.close(ws);
  });
  ws.on("message", (data, isBinary) => {
    try {
      if (isBinary) { voiceHub.audio(ws, data); return; }
      handleMessage(ws, String(data));
    } catch (err) {
      try {
        send(ws, { kind: "say", text: `Oops: ${err instanceof Error ? err.message : String(err)}` });
      } catch { /* ignore */ }
    }
  });
});
httpServer.listen(PORT, HOST, () => {
  console.log(`meta server listening on ws://${HOST}:${PORT} (client + websocket on one port)`);
});
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { budget.stop(); process.exit(0); });
