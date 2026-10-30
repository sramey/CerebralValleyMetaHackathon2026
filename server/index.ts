// WebSocket game server on port 8787 (override with PORT). Route (Spark) -> write (Wonder) ->
// compile -> verify -> one auto-fix -> hot-load message. Never crashes on a
// bad mod or a missing MODEL_API_KEY (answers with say in that case).
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { SIM } from "../src/contract";
import { detectMoodCommand, entityKind, extractSpawnedEntities, isHeldItemType, isPlayerAbilityCommand, isPlayerCommand } from "../src/ontology";
import { moodKey, moodSpecFor, pool, restyleSheet, sheetPath } from "./mood";
import { fallbackVisual, lookFor, parseShape, parseVisual } from "./visual";
import type { Visual } from "./visual";
import type { BuildReceipt, ClientMsg, ReceiptArt, ReceiptRoute, KnobDefs, Look, MoodSpec, ShapeName, KnobValue, ServerMsg, TimelineStep, WorldMod } from "../src/contract";
import { routerChat } from "./router-model";
import type { Routed } from "./router-model";
import { chat, hasApiKey, loadEnv, SPARK, WONDER } from "./meta";
import type { ChatMessage } from "./meta";
import { compileMod } from "./compile";
import { importMod, verifyMod } from "./verify";
import { inspectWorld, playtestMod } from "./playtest";
import type { PlaytestWorldMod } from "./playtest";
import { inspectTool, playtestTool, runAgent } from "./agent";
import type { AgentStep, AgentTrace } from "./agent";
import { forceModId, modIdOf } from "./modid";
import { runPool } from "./pool";
import { mergeDependentParts, mightBeCompound, splitCompound } from "./compound";
import { orderRoute, parseRoute, resolveRoute } from "./route-rules";
import type { Route, RouteCtx, RouteMod } from "./route-rules";
import { forget, newRecent, noteCommand, noteTouched, recentText, resolvePronoun } from "./context";
import type { Recent } from "./context";
import { buildEditPrompt, buildFixPrompt, buildRouterPrompt, buildWonderPrompt, formatManifest, ROUTER_SYSTEM, WONDER_SYSTEM } from "./prompt";
import { activeLogFile, logBuild, logMood, saveModSources } from "./createlog";
import { createStatsHandler } from "./stats-feed";
import { artCachedUrl, artKeyForType, clearCachedArt, deriveSubject, generateSubjectArt, isFlyingRequest, isScenerySubject, pickArtType, purgeLegacyArt, subjectArtPrompt, IMAGE_MODEL } from "./art";
import { aiReceipt, plainReceipt } from "./receipt";
import { learnFromFix, learnRuleFromFeedback, learnSkillFromFeedback } from "./learn";
import { segmentPhoto } from "./photo";
import { Budget, readLimits } from "./budget";
import type { Kind } from "./budget";
import { Timeline, type Snapshot } from "./timeline";
import { isWorldId, restyledForWorld, snapshotWorld, WorldStore } from "./worlds";
import { generateExportHtml } from "./export";
import { createStaticHandler } from "./static";
import { createVoiceHub } from "./voice";
import { appendTester, sanitizeTester } from "./testers";
import { runSketchBuild } from "./sketch";
import { runPaperBuild } from "./paper";
import { clampKnobValue, gateMessage } from "./validate";
import { screenRequest, lateVerdict } from "./safety";
import type { PendingVerdict } from "./safety";
import { cachedExplanation, explainMod } from "./explain";

loadEnv();
const PORT = Number(process.env.PORT ?? 8787);

interface ManifestRec {
  id: string;
  title: string;
  source: string;
  compiled: string;
  knobs: KnobDefs;
  art?: { key: string; url: string; scenery?: boolean };
  look?: Look;
  /** How this mod was made (ADR 0065), when it was built in this session. */
  receipt?: BuildReceipt;
}

// Each connection has its own world (ADR 0014): a public server must never mix visitors' mods.
/** A screen verdict the build path may still read, tagged with the command it belongs to (ADR 0044). */
interface PendingScreen { command: string; verdict: PendingVerdict }
interface Session { /** Family-test tester index and session id once the page said ?tester=N (ADR 0034). */ tester?: { n: number; sid: string }; manifest: Map<string, ManifestRec>; ip: string; recent: Recent; /** Ids claimed by builds still running, and their commands (ADR 0016). */ reserved: Set<string>; inflight: Set<string>; mood?: MoodSpec; moodMods?: Set<string>; /** Level mods a sketch replaced, by the sketch mod id, so undo can put them back (bug j2t). */ levelStash?: Map<string, ManifestRec[]>; restyled?: Record<string, string>; /** Time-travel steps and the command that probably explains the next one (ADR 0041). */ timeline?: Timeline; lastCommand?: { text: string; at: number }; tlTimer?: ReturnType<typeof setTimeout>; /** Kid-safe verdict the screen did not wait for (ADR 0044). */ pendingSafety?: PendingScreen }
const sessions = new WeakMap<WebSocket, Session>();
function sess(ws: WebSocket): Session {
  let s = sessions.get(ws);
  if (!s) { s = { manifest: new Map(), ip: "unknown", recent: newRecent(), reserved: new Set(), inflight: new Set() }; sessions.set(ws, s); }
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
  { alias: "basketball", file: "basketball.ts", id: "basketball" },
  { alias: "hoop", file: "basketball.ts", id: "basketball" },
  { alias: "swarm", file: "swarm.ts", id: "swarm" },
  { alias: "swarms", file: "swarm.ts", id: "swarm" },
  { alias: "wave", file: "swarm.ts", id: "swarm" },
  { alias: "waves", file: "swarm.ts", id: "swarm" },
];

// "starter world" alias: player then ground, delivered sequentially.
const STARTER_WORLD: BuiltinDef[] = [
  { alias: "player", file: "player.ts", id: "player" },
  { alias: "ground", file: "ground.ts", id: "ground" },
];

// The player's world as the client last reported it (ADR 0013): playtests run in a copy of it.
const worldOf = new WeakMap<WebSocket, { id: string; values: Record<string, KnobValue> }[]>();
const builtinJs = new Map<string, string>();

// The starter mods load on the client without the server. Adopt them into the manifest so the router and edits ("make me huge") can see them.
const adoptingOf = new WeakMap<WebSocket, Promise<void>>();
async function adoptBuiltins(manifest: Map<string, ManifestRec>, ids: string[]): Promise<void> {
  for (const id of ids) {
    const b = BUILTINS.find((x) => x.id === id);
    if (!b || manifest.has(id)) continue;
    try {
      const source = readFileSync(join(process.cwd(), "src/mods", b.file), "utf8");
      const c = compileMod(source);
      if (!c.ok) continue;
      const def = await importMod(c.js);
      manifest.set(id, { id, title: def.title, source, compiled: c.js, knobs: def.knobs ?? {} });
    } catch { /* leave it unknown */ }
  }
}

function worldMods(ws: WebSocket): PlaytestWorldMod[] {
  const manifest = sess(ws).manifest;
  // The client's list, plus mods that landed since it was sent (parallel builds finishing under this one).
  const reported = worldOf.get(ws);
  const listing = reported ? [...reported, ...[...manifest.keys()].filter((id) => !reported.some((m) => m.id === id)).map((id) => ({ id, values: {} }))] : [...manifest.keys()].map((id) => ({ id, values: {} }));
  const out: PlaytestWorldMod[] = [];
  for (const m of listing) {
    let compiled = manifest.get(m.id)?.compiled ?? builtinJs.get(m.id);
    if (!compiled) {
      const b = BUILTINS.find((x) => x.id === m.id);
      try { if (b) { const c = compileMod(readFileSync(join(process.cwd(), "src/mods", b.file), "utf8")); if (c.ok) { compiled = c.js; builtinJs.set(m.id, c.js); } } } catch { /* unknown mod: skip it */ }
    }
    if (compiled) out.push({ id: m.id, compiled, values: m.values });
  }
  return out;
}

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


function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  if (msg.kind === "removed") worldOf.set(ws, (worldOf.get(ws) ?? []).filter((m) => m.id !== msg.modId));
  if (msg.kind === "mod" || msg.kind === "removed" || msg.kind === "mood") noteTimelineSoon(ws);
}

// --- time-travel timeline (ADR 0041) -----------------------------------------------
function timelineSnapshot(ws: WebSocket): Snapshot {
  const s = sess(ws);
  const mods = snapshotWorld(worldOf.get(ws) ?? [], s.manifest, BUILTIN_IDS);
  const stash = s.levelStash && s.levelStash.size > 0 ? [...s.levelStash].map(([k, v]) => [k, v.map((r) => structuredClone(r))] as [string, unknown[]]) : undefined;
  return { mods, ...(s.mood ? { mood: s.mood } : {}), ...(s.restyled ? { restyled: { ...s.restyled } } : {}), ...(stash ? { stash } : {}) };
}

/** Record the world as a step if it changed, and tell the client. The player's last command, if fresh, names the step. */
function noteTimeline(ws: WebSocket, force?: { kind: TimelineStep["kind"]; label: string }): void {
  const s = sess(ws);
  const tl = (s.timeline ??= new Timeline());
  const cmd = s.lastCommand && Date.now() - s.lastCommand.at < 90_000 ? s.lastCommand.text : undefined;
  const step = tl.record(timelineSnapshot(ws), cmd, force);
  if (!step) return;
  s.lastCommand = undefined;
  send(ws, { kind: "timeline", steps: tl.list(), current: step.n });
}

/** Coalesce a compound change (sketch + floor, mood + restyle) into one step. */
function noteTimelineSoon(ws: WebSocket): void {
  const s = sess(ws);
  if (s.tlTimer) clearTimeout(s.tlTimer);
  s.tlTimer = setTimeout(() => { s.tlTimer = undefined; noteTimeline(ws); }, 450);
}

function handleTimelineRestore(ws: WebSocket, n: number): void {
  const s = sess(ws);
  const step = s.timeline?.get(n);
  if (!step) { send(ws, { kind: "say", text: "That step is no longer in the timeline." }); return; }
  s.manifest.clear();
  for (const m of step.mods) {
    if (m.builtin !== true) s.manifest.set(m.id, { id: m.id, title: m.title, source: m.source, compiled: m.compiled, knobs: structuredClone(m.knobs), ...(m.art ? { art: m.art } : {}), ...(m.look ? { look: m.look } : {}) });
  }
  s.mood = step.mood;
  s.moodMods = step.mood ? new Set(s.manifest.keys()) : undefined;
  s.restyled = step.restyled ? { ...step.restyled } : undefined;
  s.levelStash = step.stash ? new Map(step.stash.map(([k, v]) => [k, (v as ManifestRec[]).map((r) => structuredClone(r))])) : undefined;
  worldOf.set(ws, step.mods.map((m) => ({ id: m.id, values: m.values ?? {} })));
  adoptingOf.set(ws, adoptBuiltins(s.manifest, step.mods.filter((m) => m.builtin === true).map((m) => m.id)));
  if (s.tlTimer) { clearTimeout(s.tlTimer); s.tlTimer = undefined; }
  send(ws, { kind: "world", id: "", mods: step.mods, ...(step.mood ? { mood: step.mood } : {}), ...(step.restyled ? { restyled: step.restyled } : {}) });
  noteTimeline(ws, { kind: "restore", label: `Restored: ${step.label}` });
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
  return formatManifest([...sess(ws).manifest.values()].map((m) => ({ id: m.id, title: m.title, knobs: knobValues(m), entities: extractSpawnedEntities(m.source).map((e) => ({ type: e.type, kind: e.kind })) })));
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

/**
 * Draw-to-build (ADR 0026): Wonder reads the sketch image + world stroke boxes, and the
 * resulting JSON level is compiled here into a level mod, verified, and hot-loaded.
 * Ports and prompts live in server/sketch.ts; this only wires the session in.
 */
async function handleSketchMessage(ws: WebSocket, msg: Extract<ClientMsg, { kind: "sketch" }>): Promise<void> {
  const t0 = performance.now();
  const command = "✏️ sketched level";
  // A sketch prompt is a build request too, so it takes the same kid-safe screen (ADR 0044).
  const ask = typeof msg.prompt === "string" ? msg.prompt.trim() : "";
  if (ask) {
    const safety = await screenRequest(ask);
    if (safety.unsafe) {
      console.log(`[safety] sketch declined category=${safety.category ?? "other"} by=${safety.by} in ${safety.ms} ms`);
      send(ws, { kind: "say", text: safety.reply });
      send(ws, { kind: "timing", command: `[safety:${safety.category ?? "other"}]`, ms: { route: 0, write: 0, compile: 0, verify: 0, total: safety.ms } });
      return;
    }
  }
  if (!spend(ws, "build")) {
    // Budget/key denial used to `return` silently and leave the sketch overlay waiting out its
    // watchdog; tell the overlay now so the player can keep drawing (bug q8x).
    stage(ws, { kind: "stage", stage: "failed", detail: "the AI build budget for this visit is used up", command });
    return;
  }
  const manifest = sess(ws).manifest;
  await adoptingOf.get(ws);
  await adoptBuiltins(manifest, ["ground"]); // so the starter ground can be stashed and restored
  const timings: DeliverTimings = { route: 0, write: 0, compile: 0, verify: 0 };
  const deliver = async (source: string): Promise<{ ok: boolean; errors: string[] }> => {
    stage(ws, { kind: "stage", stage: "compiling", detail: "building your level", command });
    const c0 = performance.now();
    const compiled = compileMod(source);
    timings.compile += Math.round(performance.now() - c0);
    if (!compiled.ok) return { ok: false, errors: compiled.errors };
    stage(ws, { kind: "stage", stage: "verifying", detail: "verifying your level", command });
    const v0 = performance.now();
    const verified = await verifyMod(source, compiled.js);
    timings.verify += Math.round(performance.now() - v0);
    if (!verified.ok || !verified.def) return { ok: false, errors: verified.errors.length > 0 ? verified.errors : ["verification failed"] };
    const def = verified.def;
    // A sketched level REPLACES the level: the starter ground and any earlier sketch come out (undo puts them back).
    const stash = (sess(ws).levelStash ??= new Map());
    const replaced = [...manifest.values()].filter((m) => m.id !== def.id && (m.id === "ground" || m.id.startsWith("sketch-")));
    if (replaced.length > 0 && !stash.has(def.id)) stash.set(def.id, replaced);
    for (const m of replaced) { manifest.delete(m.id); send(ws, { kind: "removed", modId: m.id }); }
    manifest.set(def.id, { id: def.id, title: def.title, source, compiled: compiled.js, knobs: def.knobs ?? {} });
    noteTouched(sess(ws).recent, def.id);
    stage(ws, { kind: "stage", stage: "done", detail: `loaded ${def.id} (${SIM.healthFrames} frames OK)`, command });
    send(ws, { kind: "mod", mod: { id: def.id, title: def.title, source, compiled: compiled.js, knobs: def.knobs ?? {} } });
    const files = saveModSources([source], def.id);
    logBuild({ command, route: "new", outcome: "mod", modId: def.id, title: def.title, timings: { route: 0, write: timings.write, compile: timings.compile, verify: timings.verify, total: Math.round(performance.now() - t0) }, verify: { ok: true, errors: [], msPerFrame: verified.msPerFrame }, fixAttempted: false, sourceFile: files[files.length - 1], sourceFiles: files });
    return { ok: true, errors: [] };
  };
  try {
    await runSketchBuild({
      // The signal is the sketch pipeline's own deadline (bug q8x): a hung vision call is
      // cancelled here instead of holding the build until the client gives up.
      ask: (messages, signal) => chat(WONDER, messages, 1400, "minimal", signal).then((r) => { timings.write += r.ms; return r.text; }),
      deliver,
      say: (text) => send(ws, { kind: "say", text }),
      stage: (s, detail) => stage(ws, { kind: "stage", stage: s, detail, command }),
      note: (text) => console.log(`[sketch] ${text}`),
    }, msg);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    send(ws, { kind: "say", text: `Sketch failed: ${why}` });
    stage(ws, { kind: "stage", stage: "failed", detail: why.slice(0, 200), command });
    logBuild({ command, route: "new", outcome: "failed", timings: { route: 0, write: timings.write, compile: timings.compile, verify: timings.verify, total: Math.round(performance.now() - t0) }, fixAttempted: false });
  }
  send(ws, { kind: "timing", command, ms: { route: 0, write: timings.write, compile: timings.compile, verify: timings.verify, total: Math.round(performance.now() - t0) } });
}

/**
 * Paper-to-level (ADR 0040): a photographed drawing on paper -> verified, playable level mod.
 */
async function handlePaperLevelMessage(ws: WebSocket, msg: Extract<ClientMsg, { kind: "paperLevel" }>): Promise<void> {
  const t0 = performance.now();
  const command = "📄 paper level";
  const ask = typeof msg.prompt === "string" ? msg.prompt.trim() : "";
  if (ask) {
    const safety = await screenRequest(ask);
    if (safety.unsafe) {
      console.log(`[safety] paper level declined category=${safety.category ?? "other"} by=${safety.by} in ${safety.ms} ms`);
      send(ws, { kind: "say", text: safety.reply });
      send(ws, { kind: "timing", command: `[safety:${safety.category ?? "other"}]`, ms: { route: 0, write: 0, compile: 0, verify: 0, total: safety.ms } });
      return;
    }
  }
  if (!spend(ws, "build")) {
    // A budget/key denial used to `return` silently and leave the orb on "Reading your paper
    // level drawing..." forever; tell it now so the player can take another photo (ADR 0054).
    stage(ws, { kind: "stage", stage: "failed", detail: "the AI build budget for this visit is used up", command });
    return;
  }
  const manifest = sess(ws).manifest;
  await adoptingOf.get(ws);
  await adoptBuiltins(manifest, ["ground"]);
  const timings: DeliverTimings = { route: 0, write: 0, compile: 0, verify: 0 };
  const deliver = async (source: string): Promise<{ ok: boolean; errors: string[] }> => {
    stage(ws, { kind: "stage", stage: "compiling", detail: "building your paper level", command });
    const c0 = performance.now();
    const compiled = compileMod(source);
    timings.compile += Math.round(performance.now() - c0);
    if (!compiled.ok) return { ok: false, errors: compiled.errors };
    stage(ws, { kind: "stage", stage: "verifying", detail: "verifying your paper level", command });
    const v0 = performance.now();
    const verified = await verifyMod(source, compiled.js);
    timings.verify += Math.round(performance.now() - v0);
    if (!verified.ok || !verified.def) return { ok: false, errors: verified.errors.length > 0 ? verified.errors : ["verification failed"] };
    const def = verified.def;
    const stash = (sess(ws).levelStash ??= new Map());
    const replaced = [...manifest.values()].filter((m) => m.id !== def.id && (m.id === "ground" || m.id.startsWith("sketch-")));
    if (replaced.length > 0 && !stash.has(def.id)) stash.set(def.id, replaced);
    for (const m of replaced) { manifest.delete(m.id); send(ws, { kind: "removed", modId: m.id }); }
    manifest.set(def.id, { id: def.id, title: def.title, source, compiled: compiled.js, knobs: def.knobs ?? {} });
    noteTouched(sess(ws).recent, def.id);
    stage(ws, { kind: "stage", stage: "done", detail: `loaded ${def.id} (${SIM.healthFrames} frames OK)`, command });
    send(ws, { kind: "mod", mod: { id: def.id, title: def.title, source, compiled: compiled.js, knobs: def.knobs ?? {} } });
    const files = saveModSources([source], def.id);
    logBuild({ command, route: "new", outcome: "mod", modId: def.id, title: def.title, timings: { route: 0, write: timings.write, compile: timings.compile, verify: timings.verify, total: Math.round(performance.now() - t0) }, verify: { ok: true, errors: [], msPerFrame: verified.msPerFrame }, fixAttempted: false, sourceFile: files[files.length - 1], sourceFiles: files });
    return { ok: true, errors: [] };
  };
  try {
    await runPaperBuild({
      ask: (messages, signal) => chat(WONDER, messages, 1400, "minimal", signal).then((r) => { timings.write += r.ms; return r.text; }),
      deliver,
      say: (text) => send(ws, { kind: "say", text }),
      stage: (s, detail) => stage(ws, { kind: "stage", stage: s, detail, command }),
      note: (text) => console.log(`[paper] ${text}`),
    }, msg);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    send(ws, { kind: "say", text: `Paper level failed: ${why}` });
    // A thrown build must not leave the orb waiting for a stage that never comes (ADR 0054).
    stage(ws, { kind: "stage", stage: "failed", detail: why.slice(0, 200), command });
    logBuild({ command, route: "new", outcome: "failed", timings: { route: 0, write: timings.write, compile: timings.compile, verify: timings.verify, total: Math.round(performance.now() - t0) }, fixAttempted: false });
  }
  send(ws, { kind: "timing", command, ms: { route: 0, write: timings.write, compile: timings.compile, verify: timings.verify, total: Math.round(performance.now() - t0) } });
}

function stripFences(src: string): string {
  let s = src.trim();
  const m = s.match(/^```(?:ts|typescript|javascript|js)?\s*\n([\s\S]*?)\n```\s*$/);
  if (m) s = m[1].trim();
  return s;
}

async function handleCommand(ws: WebSocket, text: string): Promise<void> {
  // Kid-safe screen first (ADR 0044): a declined request never reaches the router, so it can
  // never spend a Wonder build or become a mod. The reply is one kind sentence with an
  // alternative; the player's words are not logged.
  const safety = await screenRequest(text);
  if (safety.unsafe) {
    console.log(`[safety] declined category=${safety.category ?? "other"} by=${safety.by} in ${safety.ms} ms`);
    send(ws, { kind: "say", text: safety.reply });
    const ms = { route: 0, write: 0, compile: 0, verify: 0, total: safety.ms };
    send(ws, { kind: "timing", command: `[safety:${safety.category ?? "other"}]`, ms });
    logBuild({ command: `[safety:${safety.category ?? "other"}]`, route: "new", outcome: "say", timings: ms, fixAttempted: false });
    return;
  }
  // A verdict that missed the deadline is read before the build writes anything (step 3 below).
  sess(ws).pendingSafety = safety.pending ? { command: text.slice(0, 400), verdict: safety.pending } : undefined;
  // Compound requests (ADR 0053): Muse Spark splits, and only genuinely independent things
  // become separate builds. One subject with several traits or behaviors stays ONE build, so
  // parallel builds never race over the same mod id in front of the player. A part that points
  // back at an earlier one is merged by a deterministic guard; the word splitter is the fallback.
  // The router starts beside the split (ADR 0058): a command that turns out to be one request
  // no longer waits for the split first.
  if (mightBeCompound(text)) {
    await adoptingOf.get(ws);
    noteCommand(sess(ws).recent, text);
    const routing = hasApiKey() ? routerChat(routerMessages(ws, text.slice(0, 400)), 1024) : undefined;
    routing?.catch(() => { /* read (and reported) by handleSingle, or dropped for a compound */ });
    const parts = await splitWithSpark(text);
    if (parts) {
      // A mood part restyles the whole world, so a mood + build pair runs in order, not in parallel.
      const sequential = parts.some((p) => detectMoodCommand(p) !== null);
      const limit = sequential ? 1 : Math.max(1, Number(process.env.MAX_PARALLEL ?? 4));
      const t0 = performance.now();
      console.log(`[split] ${parts.length} independent requests, parallel ${Math.min(limit, parts.length)}: ${parts.join(" | ")}`);
      await runPool(parts, limit, (item) => handleSingle(ws, item, { size: parts.length, parallel: Math.min(limit, parts.length) }));
      // End marker for the whole compound command (the sub-builds each sent their own), so clients and the rehearsal harness can tell it is done.
      const total = Math.round(performance.now() - t0);
      send(ws, { kind: "timing", command: text, ms: { route: 0, write: 0, compile: 0, verify: 0, total } });
      return;
    }
    await handleSingle(ws, text, undefined, undefined, routing);
    return;
  }
  await handleSingle(ws, text);
}

/** Spark splits a compound command (ADR 0053); null = one build. Falls back to the word splitter if Spark fails. */
async function splitWithSpark(command: string): Promise<string[] | null> {
  if (!mightBeCompound(command)) return null;
  try {
    const res = await chat(SPARK, [
      {
        role: "system",
        content: "Reply with ONLY a JSON array of strings. Split the player's request into standalone build commands, one per genuinely separate thing (at most 4). " +
          "ONE subject with its traits and behaviors stays ONE command: \"add a superhero cat that flies around dropping coins\" -> [\"add a superhero cat that flies around dropping coins\"]. " +
          "Separate things split: \"add a dragon, some coins, and make it rain\" -> [\"add a dragon\", \"add some coins\", \"make it rain\"]. No markdown, no prose.",
      },
      { role: "user", content: command },
    ], 512);
    const start = res.text.indexOf("[");
    const end = res.text.lastIndexOf("]");
    if (start < 0 || end <= start) return splitCompound(command);
    const arr: unknown = JSON.parse(res.text.slice(start, end + 1));
    if (!Array.isArray(arr)) return splitCompound(command);
    const items = mergeDependentParts(arr.filter((x): x is string => typeof x === "string"));
    return items.length >= 2 ? items : null;
  } catch {
    return splitCompound(command);
  }
}

/** The router's messages for one command: its system prompt, the loaded mods and the short-term memory. */
function routerMessages(ws: WebSocket, command: string): ChatMessage[] {
  return [
    { role: "system", content: ROUTER_SYSTEM },
    { role: "user", content: buildRouterPrompt(command, manifestText(ws), recentText(sess(ws).recent)) },
  ];
}

/** What the route rules may know (ADR 0059): `mods` are the server's verified mods, `world` adds the client's own built-ins for orders. */
function routeCtx(ws: WebSocket, command: string, forceEditModId?: string): RouteCtx {
  const mods = new Map<string, RouteMod>();
  for (const m of sess(ws).manifest.values()) {
    mods.set(m.id, { id: m.id, title: m.title, knobs: m.knobs, types: extractSpawnedEntities(m.source).map((e) => e.type) });
  }
  const world = new Map<string, RouteMod>();
  for (const m of worldOf.get(ws) ?? []) world.set(m.id, { id: m.id, title: m.id, knobs: {} });
  for (const [id, m] of mods) world.set(id, m);
  return { command, mods, world, recent: sess(ws).recent, forceEditModId };
}

/** Carry out an order route: the client steers the creatures, the thing ordered becomes "it" (ADR 0059). */
function sendOrder(ws: WebSocket, command: string, route: Route, routeMs: number, t0: number): void {
  const modId = route.target ?? "*";
  const order = route.order ?? "follow";
  if (modId !== "*") noteTouched(sess(ws).recent, modId);
  // A router-read order already opened a build card: close it before the client says who heard.
  if (routeMs > 0) stage(ws, { kind: "stage", stage: "done", detail: `order: ${order}`, command });
  send(ws, { kind: "order", modId, order });
  const ms = { route: routeMs, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) };
  send(ws, { kind: "timing", command, ms });
  logBuild({ command, route: "order", outcome: "tweak", modId, value: order, timings: ms, fixAttempted: false });
}

/** `routing`: a router call the caller already started for this command (and already noted in memory). */
async function handleSingle(ws: WebSocket, text: string, batch?: { size: number; parallel: number }, forceEditModId?: string, routing?: Promise<Routed>): Promise<void> {
  await adoptingOf.get(ws);
  if (!batch && !routing) noteCommand(sess(ws).recent, text);
  const t0 = performance.now();
  let routeMs = 0;
  let writeMs = 0;
  let compileMs = 0;
  let verifyMs = 0;
  const command = text.slice(0, 400);
  const manifest = sess(ws).manifest;

  // Orders to creatures that already exist ("chickens, follow me") need no model call and open no build card (ADR 0059).
  const order = forceEditModId ? null : orderRoute(routeCtx(ws, command));
  if (order) {
    console.log(`[route] order ${order.order} -> ${order.target} (no router call) for: ${command}`);
    sendOrder(ws, command, order, 0, t0);
    return;
  }

  stage(ws, { kind: "stage", stage: "routing", detail: "routing your command", command });

  if (!spend(ws, "build")) {
    send(ws, { kind: "timing", command, ms: { route: 0, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) } });
    logBuild({ command, route: "new", outcome: "say", timings: { route: 0, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) }, fixAttempted: false });
    return;
  }

  // 1. Route with Spark.
  let route: Route | null = null;
  let routed: ReceiptRoute | undefined;
  try {
    const r0 = performance.now();
    const res = await (routing ?? routerChat(routerMessages(ws, command), 1024));
    routeMs = Math.round(performance.now() - r0);
    send(ws, { kind: "routed", command, model: res.model, open: res.open, ms: res.ms, fellBack: res.fellBack });
    const resolved = resolveRoute(parseRoute(res.text), routeCtx(ws, command, forceEditModId));
    route = resolved.route;
    if (resolved.route) routed = { action: resolved.route.action, model: res.model, open: res.open, fellBack: res.fellBack, ms: res.ms, ...(resolved.route.visual ? { visual: resolved.route.visual } : {}), rules: resolved.rules };
    if (resolved.rules.length > 0) console.log(`[route] ${resolved.rules.join("; ")} for: ${command}`);
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
  if (route.action === "order") {
    sendOrder(ws, command, route, routeMs, t0);
    return;
  }
  if (route.action === "question") {
    send(ws, { kind: "say", text: route.answer ?? "Hello! Tell me what to build — e.g. 'add a player', 'make it rain'." });
    send(ws, { kind: "timing", command, ms: { route: routeMs, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) } });
    logBuild({ command, route: "question", outcome: "say", timings: { route: routeMs, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) }, fixAttempted: false });
    return;
  }
  if (route.action === "mood") {
    await handleMood(ws, route.mood ?? detectMoodCommand(command) ?? command.replace(/^(make|turn|set|change)\s+(it|this|everything|the\s+\w+)\s+/i, ""));
    send(ws, { kind: "timing", command, ms: { route: routeMs, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) } });
    return;
  }
  if (route.action === "undo") {
    const id = route.target ?? "";
    // "undo" with nothing (or the mood's name) to remove while a mood is on puts the world back.
    // A bare "undo" reverts the latest change, and the mood is the latest when no mod was added since it.
    const moodLatest = [...manifest.keys()].every((k) => sess(ws).moodMods?.has(k));
    const bare = /^\s*(undo|undo (that|it|this)|revert( it)?|go back|put it back|back to normal)\W*$/i.test(command);
    if (sess(ws).mood && ((!id || !manifest.has(id)) || (bare && moodLatest)) && (!id || bare || /mood|style|theme|look|atmosphere/i.test(id) || id.toLowerCase() === sess(ws).mood!.name)) {
      sess(ws).mood = undefined;
      sess(ws).restyled = undefined;
      send(ws, { kind: "mood", mood: null });
      send(ws, { kind: "say", text: "Back to normal." });
      send(ws, { kind: "timing", command, ms: { route: routeMs, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) } });
      return;
    }
    if (id && manifest.has(id)) {
      manifest.delete(id);
      forget(sess(ws).recent, id);
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
      noteTouched(sess(ws).recent, rec.id);
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
      noteTouched(sess(ws).recent, route.target);
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
  // Second chance for the kid-safe screen (ADR 0044): a Spark verdict that missed the screen's
  // deadline is read here, for free, before Wonder is asked to write anything.
  const late = lateVerdict(
    sess(ws).pendingSafety?.command === command ? sess(ws).pendingSafety?.verdict : undefined,
  );
  sess(ws).pendingSafety = undefined;
  if (late?.unsafe) {
    console.log(`[safety] declined late category=${late.category ?? "other"} in ${late.ms} ms`);
    send(ws, { kind: "say", text: late.reply });
    const safetyMs = { route: routeMs, write: 0, compile: 0, verify: 0, total: Math.round(performance.now() - t0) };
    send(ws, { kind: "timing", command: `[safety:${late.category ?? "other"}]`, ms: safetyMs });
    logBuild({ command: `[safety:${late.category ?? "other"}]`, route: "new", outcome: "say", timings: safetyMs, fixAttempted: false });
    return;
  }
  let editRec: ManifestRec | undefined;
  if (route.action === "edit") {
    editRec = route.target ? manifest.get(route.target) : undefined;
    if (!editRec) {
      console.log(`[route] edit -> new (missing target) for: ${command}`);
      route = { action: "new" };
    }
  }
  const session = sess(ws);
  // An edit keeps its mod id (ADR 0016). A new mod gets an id no other mod or running build has, and keeps it across fixes.
  let myId: string | undefined = editRec?.id;
  const keepId = (src: string): string => {
    if (myId) return forceModId(src, myId);
    const wanted = modIdOf(src);
    if (!wanted) return src;
    let id = wanted;
    for (let n = 2; manifest.has(id) || session.reserved.has(id); n++) id = `${wanted}-${n}`;
    myId = id;
    session.reserved.add(id);
    return id === wanted ? src : forceModId(src, id);
  };
  session.inflight.add(command);
  const releaseBuild = () => { session.inflight.delete(command); if (myId && !editRec) session.reserved.delete(myId); };
  const others = [...session.inflight].filter((c) => c !== command);
  const context = [recentText(session.recent), others.length > 0 ? `Other builds running right now for this player (do not duplicate them; choose a different mod id): ${others.map((c) => `"${c}"`).join("; ")}.` : ""].filter(Boolean).join("\n");
  const agentTrace: AgentTrace[] = [];
  let agentTurns = 0;
  const agentInfo = () => {
    if (agentTurns === 0) return {};
    const pts = agentTrace.filter((t) => t.name === "run_playtest");
    return { agent: { turns: agentTurns, calls: agentTrace.length, tools: agentTrace, playtests: pts.length, rejected: pts.filter((t) => t.ok === false).length } };
  };
  const batchInfo = batch ? { batch } : {};
  stage(ws, { kind: "stage", stage: "writing", detail: "writing the mod", command });
  let source = "";
  const sources: string[] = [];
  let fixAttempted = false;
  const routeAction = route.action;

  // Results are cached by source so the agent's own playtest runs aren't repeated (or re-shown) at the end.
  const attemptCache = new Map<string, Awaited<ReturnType<typeof attemptOnce>>>();
  let playtests = 0;
  const attempt = async (src: string) => {
    src = src.trim();
    const hit = attemptCache.get(src);
    if (hit) return hit;
    const r = await attemptOnce(src);
    attemptCache.set(src, r);
    return r;
  };
  const attemptOnce = async (src: string) => {
    const c0 = performance.now();
    const compiled = compileMod(src);
    compileMs += Math.round(performance.now() - c0);
    if (!compiled.ok) return { ok: false as const, errors: compiled.errors, js: "", msPerFrame: 0 };
    stage(ws, { kind: "stage", stage: "verifying", detail: "verifying the mod", command });
    const v0 = performance.now();
    const res = await verifyMod(src, compiled.js);
    verifyMs += Math.round(performance.now() - v0);
    if (!res.ok) return { ok: false as const, errors: res.errors, js: compiled.js, msPerFrame: res.msPerFrame };
    // "Can you still play?": a scripted bot plays a copy of the player's world with this mod in it.
    const pt = await playtestMod(worldMods(ws), { def: res.def!, replaces: editRec?.id });
    verifyMs += pt.ms;
    if (!pt.skipped) send(ws, { kind: "playtest", command, attempt: ++playtests, ok: pt.ok, plain: pt.plain, seed: pt.seed, frames: pt.frames, inputs: pt.inputs, mod: { id: res.def!.id, compiled: compiled.js }, ...(editRec ? { replaces: editRec.id } : {}), ms: pt.ms });
    if (!pt.ok) {
      stage(ws, { kind: "stage", stage: "rejected", detail: pt.plain, command });
      return { ok: false as const, errors: [`playtest: ${pt.plain} (${pt.detail})`], js: compiled.js, msPerFrame: res.msPerFrame };
    }
    return { ok: true as const, errors: [] as string[], js: compiled.js, res };
  };

  // Wonder's tools: look at the live world, and playtest its own draft (ADR 0016).
  const tools = () => [
    inspectTool(() => inspectWorld(worldMods(ws), Object.fromEntries([...manifest.values()].map((m) => [m.id, m.title])))),
    playtestTool(async (src) => {
      const r = await attempt(keepId(stripFences(src)));
      return { ok: r.ok, message: r.ok ? "passed: it works and the player can still play" : r.errors.join("; ").slice(0, 700) };
    }),
  ];
  const onText = (text: string) => send(ws, { kind: "codeStream", command, text });
  let stepPhase: "write" | "fix" = "write";
  const onStep = (s: AgentStep) => send(ws, { kind: "agentStep", command, phase: stepPhase, n: s.n, tool: s.tool, args: s.args, result: s.result, ok: s.ok, ms: s.ms });
  const onTool = (name: string) => stage(ws, { kind: "stage", stage: "writing", detail: name === "inspect_world" ? "looking at the world" : "playtesting a draft", command });
  const TOOL_RULES = "You have two tools. inspect_world shows the live world (mods, knob values, entity types and sizes): call it FIRST whenever the request changes or builds on something that already exists (the player, a mod, an enemy: 'make me huge', 'make them faster'), and skip it for a brand-new standalone thing. If the conversation already shows an inspect_world result, do not call it again. run_playtest compiles, verifies and playtests your complete source in the player's world: call it with your finished source; if it passes you are done, if it fails read the reason and call it again with a corrected source. If you skip the tools, reply with ONLY the module source.";

  try {
    const w0 = performance.now();
    const spent0 = compileMs + verifyMs;
    const user = editRec ? buildEditPrompt(command, editRec.source, manifestText(ws), context) : buildWonderPrompt(command, manifestText(ws), context);
    let text: string;
    try {
      // Requests that touch what already exists get the world snapshot up front, a local call of a few ms,
      // instead of spending a whole Wonder turn asking for it (ADR 0058).
      const touchesWorld = !!editRec || isPlayerCommand(command) || !!resolvePronoun(command, session.recent);
      const ag = await runAgent({ system: `${WONDER_SYSTEM}\n\n${TOOL_RULES}`, user, tools: tools(), maxCalls: 3, onTool, onStep, onText, ...(touchesWorld ? { prefetch: ["inspect_world"] } : {}) });
      agentTrace.push(...ag.trace);
      agentTurns += ag.turns;
      text = ag.text;
    } catch (agentErr) {
      console.log(`[agent] tool loop failed, plain completion instead: ${agentErr instanceof Error ? agentErr.message : String(agentErr)}`);
      text = (await chat(WONDER, [{ role: "system", content: WONDER_SYSTEM }, { role: "user", content: user }], 4096)).text;
    }
    writeMs = Math.round(performance.now() - w0) - (compileMs + verifyMs - spent0);
    source = keepId(stripFences(text));
    sources.push(source);
  } catch (err) {
    releaseBuild();
    send(ws, { kind: "say", text: `The writer failed: ${err instanceof Error ? err.message : String(err)}` });
    send(ws, { kind: "timing", command, ms: { route: routeMs, write: writeMs, compile: 0, verify: 0, total: Math.round(performance.now() - t0) } });
    logBuild({ command, route: routeAction, outcome: "say", timings: { route: routeMs, write: writeMs, compile: 0, verify: 0, total: Math.round(performance.now() - t0) }, fixAttempted: false, ...agentInfo(), ...batchInfo });
    return;
  }

  stage(ws, { kind: "stage", stage: "compiling", detail: "compiling the mod", command });
  let first = await attempt(source);
  const badSource = source;
  const firstErrors = first.ok ? [] : first.errors;
  if (!first.ok) {
    // ONE auto-fix round.
    stage(ws, { kind: "stage", stage: "fixing", detail: "fixing the mod", command });
    fixAttempted = true;
    stepPhase = "fix";
    try {
      const w0 = performance.now();
      const spent0 = compileMs + verifyMs;
      const fix = await runAgent({
        // Same system prompt as the write round, so a provider-side prefix cache can reuse it (ADR 0058).
        system: `${WONDER_SYSTEM}\n\n${TOOL_RULES}`,
        user: `${buildFixPrompt(command, source, first.errors)}\n\nBe terse: change only what the failure requires, keep the mod's id and every other line as is, and write no comments.`,
        tools: tools(),
        maxCalls: 3,
        onTool,
        onStep,
        onText,
      });
      agentTrace.push(...fix.trace);
      agentTurns += fix.turns;
      writeMs += Math.round(performance.now() - w0) - (compileMs + verifyMs - spent0);
      source = keepId(stripFences(fix.text));
      sources.push(source);
      stage(ws, { kind: "stage", stage: "compiling", detail: "recompiling the fix", command });
      first = await attempt(source);
    } catch (err) {
      releaseBuild();
      send(ws, { kind: "say", text: `Fix attempt failed: ${err instanceof Error ? err.message : String(err)}` });
      send(ws, { kind: "timing", command, ms: { route: routeMs, write: writeMs, compile: compileMs, verify: verifyMs, total: Math.round(performance.now() - t0) } });
      const files = saveModSources(sources);
      logBuild({ command, route: routeAction, outcome: "say", timings: { route: routeMs, write: writeMs, compile: compileMs, verify: verifyMs, total: Math.round(performance.now() - t0) }, fixAttempted, ...agentInfo(), ...batchInfo, sourceFile: files[files.length - 1], sourceFiles: files });
      return;
    }
  }
  releaseBuild();
  if (fixAttempted && firstErrors.length > 0) {
    void learnFromFix(command, firstErrors, badSource, first.ok ? source : undefined);
  }

  if (first.ok) {
    const def = first.res.def!;
    // Art on demand: cached art attaches immediately; otherwise the mod
    // ships with artPending and the art streams in asynchronously.
    let art: { key: string; url: string; scenery?: boolean } | undefined;
    let artPending: string | undefined;
    let pendingArt: { subject: string; type: string; key: string; scenery: boolean; flying: boolean } | undefined;
    const artType = pickArtType(source);
    // Spark's visual kind (from the router call) decides the art path; word lists only cover a router miss (ADR 0015).
    const fb = route.visual ? undefined : fallbackVisual(`${command} ${artType ?? ""}`);
    const visual: Visual | undefined = route.visual ?? fb?.visual;
    const look = artType ? lookFor(visual, route.shape ?? fb?.shape, [artType.toLowerCase()]) : undefined;
    if (artType && !look) {
      const subject = deriveSubject(command, artType);
      const scenery = visual === "prop" || isHeldItemType(subject) || isHeldItemType(artType) || entityKind(artType) === "prop" || (visual !== "creature" && (isScenerySubject(subject) || isScenerySubject(artType)));
      // A flying request gets airborne poses, not the walk cycle (ADR 0053).
      const flying = isFlyingRequest(`${command} ${subject}`, artType) && !scenery;
      const key = artKeyForType(artType, flying ? "fly" : undefined);
      if (key) {
        const cachedUrl = artCachedUrl(artType, flying ? "fly" : undefined);
        if (cachedUrl) {
          art = { key, url: cachedUrl, ...(scenery ? { scenery: true } : {}) };
        } else if (spend(ws, "image")) {
          artPending = key;
          pendingArt = { subject, type: artType, key, scenery, flying };
        }
      }
    }
    const rec: ManifestRec = { id: def.id, title: def.title, source, compiled: first.js, knobs: def.knobs ?? {}, ...(art ? { art } : {}), ...(look ? { look } : {}) };
    // The receipt (ADR 0065): the whole chain behind this mod, kept with it for "How was this made?".
    const receiptArt: ReceiptArt | undefined = look
      ? { model: "code", subject: artType ?? def.title, state: "code-drawn" }
      : pendingArt
        ? { model: IMAGE_MODEL, subject: pendingArt.subject, prompt: subjectArtPrompt(pendingArt.subject, pendingArt.key, pendingArt.scenery, pendingArt.flying), state: "drawing" }
        : art
          ? { model: IMAGE_MODEL, subject: artType ?? def.title, url: art.url, state: "cached" }
          : undefined;
    rec.receipt = aiReceipt({
      modId: def.id, title: def.title, command,
      route: routed ?? { action: route.action, model: SPARK, open: false, fellBack: false, ms: routeMs, rules: [] },
      sources, firstErrors, tools: agentTrace.map((t) => ({ name: t.name, ms: t.ms, ...(t.ok === undefined ? {} : { ok: t.ok }) })), turns: agentTurns,
      playtests, msPerFrame: first.res.msPerFrame,
      timings: { route: routeMs, write: writeMs, compile: compileMs, verify: verifyMs, total: Math.round(performance.now() - t0) },
      ...(receiptArt ? { art: receiptArt } : {}),
    });
    // Edit keeps the same id so the client loader replaces it; if Wonder
    // renamed it anyway, drop the stale entry instead of duplicating.
    if (editRec && def.id !== editRec.id) { manifest.delete(editRec.id); send(ws, { kind: "removed", modId: editRec.id }); }
    manifest.set(def.id, rec);
    noteTouched(session.recent, def.id);
    stage(ws, { kind: "stage", stage: "done", detail: `loaded ${def.id} (${SIM.healthFrames} frames OK)`, command });
    send(ws, { kind: "mod", mod: { id: def.id, title: def.title, source, compiled: first.js, knobs: rec.knobs, ...(art ? { art } : {}), ...(artPending ? { artPending } : {}), ...(look ? { look } : {}) } });
    if (pendingArt) {
      const { subject, type, key, scenery, flying } = pendingArt;
      const a0 = performance.now();
      generateSubjectArt(subject, type, scenery, flying).then(url => {
        const ra = rec.receipt?.art;
        if (ra) Object.assign(ra, url ? { state: "drawn", url, ms: Math.round(performance.now() - a0) } : { state: "none" });
        if (url) { rec.art = { key, url, ...(scenery ? { scenery: true } : {}) }; try { send(ws, { kind: "art", modId: def.id, art: { key, url, ...(scenery ? { scenery: true } : {}) } }); } catch {} } }).catch(() => {});
      send(ws, { kind: "say", text: `Drawing ${subject}...` });
    }
    const files = saveModSources(sources, def.id);
    logBuild({ command, route: editRec ? "edit" : routeAction, outcome: editRec ? "edit" : "mod", modId: def.id, title: def.title, timings: { route: routeMs, write: writeMs, compile: compileMs, verify: verifyMs, total: Math.round(performance.now() - t0) }, verify: { ok: true, errors: [], msPerFrame: first.res.msPerFrame }, fixAttempted, ...agentInfo(), ...batchInfo, sourceFile: files[files.length - 1], sourceFiles: files });
  } else {
    stage(ws, { kind: "stage", stage: "failed", detail: first.errors.join("; ").slice(0, 500), command });
    send(ws, { kind: "say", text: `That didn't verify: ${first.errors.join("; ").slice(0, 500)}` });
    const files = saveModSources(sources);
    logBuild({ command, route: routeAction, outcome: "failed", timings: { route: routeMs, write: writeMs, compile: compileMs, verify: verifyMs, total: Math.round(performance.now() - t0) }, verify: { ok: false, errors: first.errors, msPerFrame: first.msPerFrame }, fixAttempted, ...agentInfo(), ...batchInfo, sourceFile: files[files.length - 1], sourceFiles: files });
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

/** "make it spooky": Spark routed here. Design the mood, tell the client to repaint, then it asks for the sprite edits (ADR 0017). */
async function handleMood(ws: WebSocket, moodWords: string): Promise<void> {
  const t0 = performance.now();
  const words = moodWords.trim() || "spooky";
  send(ws, { kind: "say", text: `Making it ${words}...` });
  const spec = await moodSpecFor(words);
  sess(ws).mood = spec;
  sess(ws).moodMods = new Set(sess(ws).manifest.keys()); // to tell whether the mood is still the latest change
  sess(ws).restyled = {};
  send(ws, { kind: "mood", mood: spec });
  logMood({ mood: spec.name, ms: Math.round(performance.now() - t0) });
}

/** Edit each sprite sheet the client lists toward the mood anchor, a few at a time; every image counts against the spend guard. */
async function handleRestyle(ws: WebSocket, msg: Extract<ClientMsg, { kind: "restyle" }>): Promise<void> {
  const spec = sess(ws).mood;
  if (!spec || spec.name !== moodKey(String(msg.mood))) return;
  const keys = (Array.isArray(msg.keys) ? msg.keys : []).filter((k): k is string => typeof k === "string").slice(0, 12);
  await pool(keys, 4, async (key) => {
    if (sess(ws).mood !== spec) return;
    const skip = () => send(ws, { kind: "restyled", mood: spec.name, key, url: null });
    if (!sheetPath(key)) { skip(); return; }
    const cached = existsSync(join(process.cwd(), "public", "art", "gen", `${key}--${moodKey(spec.name)}.webp`));
    if (!cached && !spend(ws, "image")) { skip(); return; }
    const r = await restyleSheet(key, spec);
    if (sess(ws).mood === spec) {
      if (r) (sess(ws).restyled ??= {})[key] = r.url;
      send(ws, { kind: "restyled", mood: spec.name, key, url: r ? r.url : null });
    }
  });
}

function handleWorldSave(ws: WebSocket, msg: Extract<ClientMsg, { kind: "worldSave" }>): void {
  const requested = Array.isArray(msg.mods) ? msg.mods.filter((m) => m && typeof m.id === "string") : [];
  const s = sess(ws);
  const mods = snapshotWorld(requested, s.manifest, BUILTIN_IDS);
  const saved = worlds.save(mods, s.mood, restyledForWorld(s.mood, mods, s.restyled));
  if ("error" in saved) send(ws, { kind: "say", text: saved.error });
  else send(ws, { kind: "worldSaved", id: saved.id });
}

function handleWorldExport(ws: WebSocket, msg: Extract<ClientMsg, { kind: "worldExport" }>): void {
  const requested = Array.isArray(msg.mods) ? msg.mods.filter((m) => m && typeof m.id === "string") : [];
  const s = sess(ws);
  const mods = snapshotWorld(requested, s.manifest, BUILTIN_IDS);
  const restyled = restyledForWorld(s.mood, mods, s.restyled);
  try {
    const html = generateExportHtml({ mods, mood: s.mood, restyled }, process.cwd());
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    send(ws, { kind: "worldExported", html, filename: `talk-to-build-${stamp}.html` });
  } catch (err) {
    send(ws, { kind: "say", text: err instanceof Error ? err.message : "Failed to export game." });
  }
}

function handleWorldLoad(ws: WebSocket, msg: Extract<ClientMsg, { kind: "worldLoad" }>): void {
  const w = isWorldId(msg.id) ? worlds.get(msg.id) : null;
  if (!w) { send(ws, { kind: "say", text: "That world link doesn't exist (any more). Start fresh or open a demo world." }); return; }
  // The session now holds exactly this world, so remixing (edit/undo/tweak) works on it.
  const s = sess(ws);
  const manifest = s.manifest;
  manifest.clear();
  for (const m of w.mods) {
    if (m.builtin !== true) manifest.set(m.id, { id: m.id, title: m.title, source: m.source, compiled: m.compiled, knobs: structuredClone(m.knobs), ...(m.art ? { art: m.art } : {}), ...(m.look ? { look: m.look } : {}) });
  }
  s.mood = w.mood;
  s.moodMods = w.mood ? new Set(manifest.keys()) : undefined;
  const restyled = restyledForWorld(w.mood, w.mods, w.restyled);
  s.restyled = restyled;
  send(ws, { kind: "world", id: w.id, mods: w.mods as WorldMod[], ...(w.mood ? { mood: w.mood } : {}), ...(restyled ? { restyled } : {}) });
}

/** "How does this work?" (ADR 0043): explain one loaded mod's code in plain words, from the
 *  server's own copy of the source. A cached answer is free; a miss spends one explain unit. */
async function handleExplain(ws: WebSocket, msg: Extract<ClientMsg, { kind: "explain" }>): Promise<void> {
  await adoptingOf.get(ws);
  const manifest = sess(ws).manifest;
  if (!manifest.has(msg.modId)) await adoptBuiltins(manifest, [msg.modId]);
  const rec = manifest.get(msg.modId);
  if (!rec) { send(ws, { kind: "say", text: "I don't have that object's code in this world — build it first, then click it." }); return; }
  const hit = cachedExplanation(rec.source);
  if (!hit && !spend(ws, "explain")) return;
  const result = hit ? { ok: true as const, explanation: hit } : await explainMod({ source: rec.source, title: rec.title });
  if (!result.ok) { send(ws, { kind: "say", text: "That explanation didn't come through — click it again." }); return; }
  const e = result.explanation;
  send(ws, { kind: "explainResult", modId: rec.id, title: rec.title, text: e.text, lines: e.lines, cached: e.cached, ms: e.ms });
}

/** "How was this made?" (ADR 0065): the receipt this session kept for a mod. No model call, no spend. */
async function handleReceipt(ws: WebSocket, msg: Extract<ClientMsg, { kind: "receipt" }>): Promise<void> {
  await adoptingOf.get(ws);
  const manifest = sess(ws).manifest;
  if (!manifest.has(msg.modId)) await adoptBuiltins(manifest, [msg.modId]);
  const rec = manifest.get(msg.modId);
  if (!rec) { send(ws, { kind: "say", text: "I don't have that object's record in this world — build it first, then click it." }); return; }
  const builtin = BUILTINS.some((b) => b.id === rec.id);
  send(ws, { kind: "receiptResult", receipt: rec.receipt ?? plainReceipt(rec.id, rec.title, rec.source, builtin ? "builtin" : "loaded") });
}

async function handleFeedback(ws: WebSocket, msg: Extract<ClientMsg, { kind: "feedback" }>): Promise<void> {
  await adoptingOf.get(ws);
  const manifest = sess(ws).manifest;
  const modId = typeof msg.modId === "string" ? msg.modId.trim() : "";
  if (modId && !manifest.has(modId)) await adoptBuiltins(manifest, [modId]);
  const rec = modId ? manifest.get(modId) : undefined;
  const vote = msg.vote === "up" ? "up" : "down";
  const note = typeof msg.note === "string" ? msg.note.trim() : "";
  const entityType = typeof msg.entityType === "string" ? msg.entityType.trim() : undefined;
  const fixNow = msg.fixNow === true;

  if (!spend(ws, "build")) return;

  if (vote === "up") {
    const skill = await learnSkillFromFeedback({
      modId: modId || "mod",
      title: rec?.title,
      entityType,
      vote: "up",
      note,
      source: rec?.source,
    });
    send(ws, { kind: "say", text: `Learned skill: ${skill.title} (saved to skills/${skill.slug}.md)` });
    return;
  }

  const distilled = await learnRuleFromFeedback({
    modId: modId || "mod",
    title: rec?.title,
    entityType,
    vote: "down",
    note,
    source: rec?.source,
    hasArt: Boolean(rec?.art),
    look: rec?.look,
  });

  if (distilled.clearArt) {
    if (rec?.art?.key) clearCachedArt(rec.art.key);
    if (entityType) clearCachedArt(artKeyForType(entityType));
    if (modId) clearCachedArt(artKeyForType(modId));
    if (rec) delete rec.art;
  }

  if (fixNow && rec) {
    send(ws, { kind: "say", text: `Learned: ${distilled.rule.rule} — rebuilding ${rec.title}…` });
    noteTouched(sess(ws).recent, rec.id);
    await handleSingle(ws, distilled.editInstruction, undefined, rec.id);
    send(ws, { kind: "say", text: `Learned: ${distilled.rule.rule}` });
  } else {
    send(ws, { kind: "say", text: `Learned: ${distilled.rule.rule}` });
  }
}

function handleMessage(ws: WebSocket, raw: string): void {
  // Every text frame passes the wire validator first (ADR 0036): a bad or hostile message
  // gets one plain sentence and never reaches a handler, so it cannot spend Meta budget.
  gateMessage(raw, (msg) => dispatchClientMsg(ws, msg), (reply) => send(ws, { kind: "say", text: reply }));
}

function dispatchClientMsg(ws: WebSocket, msg: ClientMsg): void {
  if (voiceHub.handle(ws, msg)) return;
  const manifest = sess(ws).manifest;
  if (msg.kind === "worldState") {
    if (Array.isArray(msg.mods)) {
      const prev = new Set((worldOf.get(ws) ?? []).map((m) => m.id));
      worldOf.set(ws, msg.mods.filter((m) => m && typeof m.id === "string").map((m) => ({ id: m.id, values: m.values ?? {} })));
      for (const m of worldOf.get(ws) ?? []) if (!prev.has(m.id)) noteTouched(sess(ws).recent, m.id);
      noteTimelineSoon(ws);
    }
    adoptingOf.set(ws, adoptBuiltins(manifest, (worldOf.get(ws) ?? []).map((m) => m.id)));
  } else if (msg.kind === "worldSave") handleWorldSave(ws, msg);
  else if (msg.kind === "worldLoad") handleWorldLoad(ws, msg);
  else if (msg.kind === "worldExport") handleWorldExport(ws, msg);
  else if (msg.kind === "feedback") {
    handleFeedback(ws, msg).catch((err) => {
      send(ws, { kind: "say", text: `Feedback failed: ${err instanceof Error ? err.message : String(err)}` });
    });
  }
  else if (msg.kind === "tester") {
    const s = sess(ws);
    const sid = s.tester?.sid ?? Math.random().toString(36).slice(2, 8);
    const row = sanitizeTester(msg, sid, Date.now());
    if (row) { s.tester = { n: row.tester, sid }; appendTester(row); }
  }
  else if (msg.kind === "timelineRestore") handleTimelineRestore(ws, Number(msg.n));
  else if (msg.kind === "receipt") {
    handleReceipt(ws, msg).catch((err) => {
      send(ws, { kind: "say", text: `Couldn't open that record: ${err instanceof Error ? err.message : String(err)}` });
    });
  }
  else if (msg.kind === "explain") {
    handleExplain(ws, msg).catch((err) => {
      send(ws, { kind: "say", text: `Explanation failed: ${err instanceof Error ? err.message : String(err)}` });
    });
  }
  else if (msg.kind === "command") {
    sess(ws).lastCommand = { text: msg.text, at: Date.now() };
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
  } else if (msg.kind === "sketch") {
    handleSketchMessage(ws, msg).catch((err) => {
      send(ws, { kind: "say", text: `Sketch failed: ${err instanceof Error ? err.message : String(err)}` });
    });
  } else if (msg.kind === "paperLevel") {
    handlePaperLevelMessage(ws, msg).catch((err) => {
      const why = err instanceof Error ? err.message : String(err);
      send(ws, { kind: "say", text: `Paper level failed: ${why}` });
      // Safety net for a failure outside the build itself (kid-safe screen, level adopt): the orb
      // still has to leave "Reading your paper level drawing..." (ADR 0054).
      stage(ws, { kind: "stage", stage: "failed", detail: why.slice(0, 200), command: "📄 paper level" });
    });
  } else if (msg.kind === "restyle") {
    handleRestyle(ws, msg).catch(() => {});
  } else if (msg.kind === "undo") {
    if (msg.modId === "mood") {
      sess(ws).mood = undefined;
      sess(ws).restyled = undefined;
    } else if (manifest.has(msg.modId)) {
      manifest.delete(msg.modId);
      send(ws, { kind: "removed", modId: msg.modId });
      // Undoing a sketched level brings back the level it replaced (bug j2t).
      const back = sess(ws).levelStash?.get(msg.modId);
      if (back) {
        sess(ws).levelStash!.delete(msg.modId);
        for (const m of back) {
          manifest.set(m.id, m);
          send(ws, { kind: "mod", mod: { id: m.id, title: m.title, source: m.source, compiled: m.compiled, knobs: m.knobs } });
        }
      }
    } else {
      send(ws, { kind: "say", text: `Nothing loaded with id "${msg.modId}".` });
    }
  } else if (msg.kind === "knob") {
    const rec = manifest.get(msg.modId);
    // hasOwn, not `in`: "constructor"/"toString" would otherwise hit Object.prototype.
    const def = rec && Object.prototype.hasOwnProperty.call(rec.knobs, msg.knob) ? rec.knobs[msg.knob] : undefined;
    if (rec && def) {
      const value = clampKnobValue(def, msg.value);
      rec.knobs[msg.knob] = { ...def, value };
      send(ws, { kind: "tweak", modId: msg.modId, knob: msg.knob, value });
    } else {
      send(ws, { kind: "say", text: "Unknown mod or knob." });
    }
  }
}

// One port: static client + WebSocket (ADR 0014). Works behind an HTTPS proxy as wss.
// GET /api/stats is answered first: the in-app stats panel reads the build log's
// aggregate numbers from it (ADR 0027).
const staticHandler = createStaticHandler({ distDir: join(process.cwd(), "dist"), genArtDir: join(process.cwd(), "public", "art", "gen") });
const statsHandler = createStatsHandler({ logFile: activeLogFile });
const httpServer = createServer((req, res) => {
  if (!statsHandler(req, res)) staticHandler(req, res);
});
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
    const t = sessions.get(ws)?.tester;
    if (t) appendTester({ ts: Date.now(), sid: t.sid, tester: t.n, ev: "close" });
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
// One-time cleanup of legacy terrain sheets, explicitly at startup (never an import side effect, ADR 0031).
const purgedArt = purgeLegacyArt();
if (purgedArt.length > 0) console.log(`purged legacy art sheets: ${purgedArt.join(", ")}`);
httpServer.listen(PORT, HOST, () => {
  console.log(`meta server listening on ws://${HOST}:${PORT} (client + websocket on one port)`);
  console.log(`open http://${HOST}:${PORT}/ in Chrome`);
  console.log(hasApiKey() ? "Meta key: found" : "Meta key: not set, AI is off (demo worlds still play); set MODEL_API_KEY in .env and restart");
});
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { budget.stop(); process.exit(0); });
