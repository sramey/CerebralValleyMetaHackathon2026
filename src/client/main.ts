import { createBuilds } from "./builds";
import { createBootGate } from "./boot-gate";
import { initFeedback } from "./feedback";
import { initExplain } from "./explain";
import { initReceipt } from "./receipt";
import { Application, Graphics, Sprite, Texture } from "pixi.js";
import { pickWalkFrame } from "./walk-frame";
import { PadTracker, HINT_TEXT, mergeInputs, nextMode, type InputMode } from "./gamepad";
import { healthBarColor, healthBarRect, rectBody, spriteBody, type DrawnBody } from "./health-bar";
import { computePrimaries, framesFor, isProjectileType, loadSpriteSheet, loadSubjects } from "./sprites";
import { startLateArt } from "./art-late";
import chickenMod from "../mods/chicken";
import { SIM, emptyInput, pendingArtKeys, sheetsOf } from "../contract";
import { canUseSpriteSheet, entityKind } from "../ontology";
import type { ClientMsg, Entity, KnobValue, ModDefinition, MoodSpec, ServerMsg, ShapeName } from "../contract";
import { initVoice } from "./voice";
import { Fx } from "./fx";
import { Feel } from "./feel";
import { Sound, buildSfx } from "./sound";
import { createTester } from "./tester";
import { createOnboarding, createSoundButton, plainBuildMessage } from "./onboard";
import { createMoodCard } from "./mood-card";
import { Portal } from "./portal";
import { isMoodUndoAsk, localRelativeAsk } from "./local-asks";
import { visualHeight } from "../sim/sockets";
import { ASTEROID_RE, TARGET_RE, drawAsteroidRock, drawBullseyeTarget, drawCliff, drawHoop, drawShape, drawTetherGear, isCliff, isTetherGear, kindOf, registerLook, scale, setGrade, setSnowy } from "./shapes";
import { celestialPos, computeDesiredCamY, depthFog, drawContactShadows, drawDistantMountains, drawGround25D, drawHorizonMist, drawSkyAndCelestials, drawSunEntity, isDaytimeSky } from "./depth";
import { drawBackdrop, drawScenery, skylineAmplitude } from "./scenery";
import { isSetPiece, SetPieceLayer } from "./setpieces";
import { drawDebris, drawDebrisParticle, isDebrisOrHazard } from "./debris";
import { drawFluffyCloud, drawParallaxEntities, isCloudEntity, isParallaxOrSkyEntity, isSkyOrBackgroundEntity } from "./parallax";
import { ModLoader } from "../sim/loader";
import { isHoop } from "../sim/hoop";
import { inputFromKeys, isGameKeyEvent, isTypingTarget } from "./keys";
import { createGhost } from "./ghost";
import { mountTimeline } from "./timeline";
import { createPipeline } from "./pipeline";
import { createBrain } from "./brain";
import { createTheater } from "./build-theater";
import { createHud } from "./hud";
import { createSpeech } from "./speech";
import { createSketch } from "./sketch";
import { CAMERA_LABEL, CAPTURE_LABEL, UPLOAD_LABEL, defaultAction, dialogCssVars, dialogLayout, fitInside, photoFindMessage, photoWorkSize, stageHint, wantsCameraStream } from "./camera-dialog";
import type { DialogPhase } from "./camera-dialog";
import { FINDER_IDLE, finderLine, finderNext } from "./camera-finder";
import type { FinderEvent, FinderState } from "./camera-finder";
import { compactPaperImage, paperImageSize, paperLevelMessage } from "./paper-image";
import { matchPaperIntent, matchSketchIntent } from "./phrases";
import { World } from "../sim/world";
import playerMod from "../mods/player";
import groundMod from "../mods/ground";
import enemyMod from "../mods/enemy";
import rainMod from "../mods/rain";
import coinsMod from "../mods/coins";
import movingPlatformMod from "../mods/platform-moving";
import fireArrowMod from "../mods/fire-arrow";
import parallaxMod from "../mods/parallax";
import basketballMod from "../mods/basketball";
import swarmMod from "../mods/swarm";
import { resolveItemMod, gunMod } from "./items";
import { parseUrlFlags, shareIssueMessage, urlWithoutWorld } from "./url-flags";
import type { ShareIssue } from "./url-flags";

const BUILTINS: Record<string, ModDefinition> = {
  player: playerMod, ground: groundMod, enemies: enemyMod, rain: rainMod,
  coins: coinsMod, "moving-platform": movingPlatformMod, "fire-arrow": fireArrowMod,
  chicken: chickenMod, parallax: parallaxMod, gun: gunMod, basketball: basketballMod,
};

const world = new World(1337);
const loader = new ModLoader(world);
// A mod that crashes mid-game is taken out and the world keeps running (ADR 0056).
loader.isolateFaults((mod, message) => {
  console.warn(`mod ${mod.id} crashed and was unloaded:`, message);
  say(`${mod.title} crashed, so I took it out. Everything else keeps running.`, "failed");
  log(`unloaded ${mod.id}: it crashed (${message.slice(0, 80)})`);
  renderMods();
  sendWorldState();
});
const ghost = createGhost(document.getElementById("stage-wrap")!);
const pipeline = createPipeline(document.getElementById("stage-wrap")!);
const brain = createBrain(document.getElementById("stage-wrap")!);
const theater = createTheater(document.getElementById("stage-wrap")!, (v) => pipeline.setCode(v.lines, v.partial, v.active), (m) => { pipeline.onMsg(m); theater.onMsg(m); });
// Declarative mod HUD overlay (ADR 0019): renders world.hud each frame.
const hud = createHud(document.getElementById("stage-wrap")!);
// Speech bubbles and the "B: Talk" prompt over entities (ADR 0059).
const speech = createSpeech(document.getElementById("stage-wrap")!);
let rejectedAt = 0;
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const stageEl = $("#stage");
const stageWrapEl = $("#stage-wrap");
const orb = $("#orb");
const orbState = $("#orb-state");
const orbSay = $("#orb-say");
const modsEl = $("#mods");
const logEl = $("#log");
const serverStatus = $("#server-status");
const inputEl = $<HTMLInputElement>("#command");
const orbDot = $("#orb-dot");
const orbFeedback = $("#orb-feedback");
const orbInputEl = $<HTMLInputElement>("#orb-input");
const toastEl = $("#toast");
let toastTimer = 0;
function showToast(text: string, icon = "↩"): void {
  if (!toastEl) return;
  toastEl.textContent = `${icon} ${text}`;
  toastEl.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), 2600);
}

function say(text: string, state = "idle"): void {
  orbSay.textContent = text;
  orb.dataset.state = state;
  orbState.textContent = state === "building" ? "Building" : state === "failed" ? "Rolled back" : state === "done" ? "Done" : "Listening";
  const orbClass = state === "building" ? "building" : state === "failed" ? "failed" : state === "done" ? "done" : "listening";
  orbDot.className = `orb ${orbClass}`;
  orbFeedback.textContent = text;
  orbFeedback.title = text;
  orbSay.title = text;
  if (text.startsWith("Back to normal")) showToast(text);
}
/** Label which model answered the router (ADR 0032): a small chip next to the orb state. */
const modelChip = document.createElement("span");
modelChip.id = "orb-model";
modelChip.style.cssText = "margin-left:.6em;font-size:.8em;opacity:.7";
orbState.after(modelChip);
function routedBy(msg: Extract<ServerMsg, { kind: "routed" }>): void {
  modelChip.textContent = `routed by ${msg.model}${msg.open ? " (open weights)" : ""}${msg.fellBack ? " (open timed out)" : ""} · ${msg.ms} ms`;
}
// A running chip's x stops that one build (ADR 0060); the server answers with a failed stage.
const builds = createBuilds(orbSay.parentElement ?? document.body, () => {}, (command) => send({ kind: "cancel", command }));
const feedback = initFeedback({
  send: (msg) => send(msg),
  sendWorldState: () => send({ kind: "worldState", mods: loader.list().map((m) => ({ id: m.id, values: m.values })) }),
  say,
  log,
});
/** "How does this work?" (ADR 0043): any object's code explained in plain words. */
const explain = initExplain({
  host: stageWrapEl,
  send: (msg) => send(msg),
  say,
  connected: () => ws?.readyState === WebSocket.OPEN,
  log,
});
/** "How was this made?" (ADR 0065): the chain from words to a verified, playable mod. */
const receipt = initReceipt({
  host: stageWrapEl,
  send: (msg) => send(msg),
  say,
  connected: () => ws?.readyState === WebSocket.OPEN,
  log,
});
/** While other builds are in flight the orb keeps saying "building"; returns true if it did. */
function sayWhileBuilding(): boolean {
  if (builds.active() === 0) return false;
  const head = builds.headline();
  if (head) say(head, "building");
  return true;
}
function log(text: string): void {
  const li = document.createElement("li");
  li.textContent = `${new Date().toLocaleTimeString()} ${text}`;
  logEl.prepend(li);
  while (logEl.children.length > 30) logEl.lastChild?.remove();
}

// --- cold start (bead q2s) ---------------------------------------------------
// Open the socket before the slow work below (Pixi init, sprite sheets): a cold first
// visit must never delay the server handshake behind image decoding. The socket's
// handlers touch state declared further down this file, so they await `boot.ready`,
// which resolves at the end of module evaluation (boot-gate.ts).
let ws: WebSocket | null = null;
// Dev: the lease's VITE_WS_URL. Production build: same origin as the page (ws:// or wss://
// behind HTTPS), ADR 0014.
const WS_URL: string = import.meta.env.DEV
  ? (import.meta.env.VITE_WS_URL ?? "ws://127.0.0.1:8787")
  : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
const boot = createBootGate();
connect(); // before every `await` in this file, on purpose

// --- rendering -------------------------------------------------------------
const app = new Application();
await app.init({ background: 0x05070a, antialias: false });
stageEl.appendChild(app.canvas);
const bgGfx = new Graphics();
bgGfx.zIndex = -200;
app.stage.addChild(bgGfx);
const setPieceLayer = new SetPieceLayer();
app.stage.addChild(setPieceLayer.container);
const gfx = new Graphics();
app.stage.addChild(gfx);
app.stage.sortableChildren = true;
gfx.zIndex = -100;
const barGfx = new Graphics(); // health bars: above every sprite (max layer 9), below fx/feel
barGfx.zIndex = 10.4;
app.stage.addChild(barGfx);
const drawnBodies = new Map<number, DrawnBody>(); // this frame's sprite bodies, for bar placement
const fx = new Fx(app.stage);
const urlFlags = parseUrlFlags(location.search, location.hash); // strangers' flags, decoded defensively (ADR 0037)
// Synthesized WebAudio sound (bead 6d3): silent until the first gesture; ?mute starts muted, ?vol=0..1 sets master volume, M toggles mute.
const sound = new Sound({ muted: urlFlags.mute, volume: urlFlags.volume ?? undefined });
const unlockSound = (): void => sound.unlock();
const syncSoundButton = createSoundButton(sound, stageWrapEl, unlockSound);
addEventListener("pointerdown", unlockSound);
addEventListener("keydown", unlockSound);
const feel = new Feel(app.stage, (amp) => fx.kick(amp), !urlFlags.noShake, (ev) => sound.playEvent(ev));
const portal = new Portal(app.stage); // screen-rip entrance for new entities (bead yzd)
portal.onRip = () => sound.play("portal");
let lastRenderAt = performance.now();
const isEffectType = (type: string): boolean => kindOf(type)?.kind === "effect";

// AI sprites (Muse Image sheets, chroma-keyed + sliced client-side). Frames:
// 0 idle, 1-2 walk/run, 3 jump. Entities whose type names a subject get its
// sprite; everything else falls back to code-drawn art.
// Bead 8zu: those sheets load *behind* the render loop, not in front of it. Awaiting them
// here held the first frame for up to 6 s per sheet — a black stage behind a socket that was
// already connected. The map starts empty, so the loop paints the code-drawn world at once
// and each subject's sprite swaps in when its sheet lands (art-late.ts).
const lateArt = startLateArt(() => loadSubjects({
  ninja: "/art/ninja-sheet.webp",
  chicken: "/art/chicken.webp",
}));
const framesBySubject = lateArt.frames;
void lateArt.settled.then(() => {
  console.info(`[art] subjects loaded: ${Object.entries(framesBySubject).map(([k, v]) => `${k}=${v.length}`).join(" ")}`);
});
const pendingArt = new Set<string>();
const scenerySubjects = new Set<string>();
let photoSeq = 0;
const pendingPhotos = new Map<string, HTMLCanvasElement>();
const spritePool = new Map<number, Sprite>();
let camYSmooth: number | null = null;
let camXSmooth: number | null = null;
// Draw-to-build (ADR 0026): ✏️ sketch overlay over the stage; sends image + world stroke boxes.
const sketch = createSketch(stageWrapEl, {
  send: (msg) => send(msg),
  say,
  camera: () => ({ x: camXSmooth ?? world.camera.x, y: camYSmooth ?? world.camera.y }),
  log,
});
$("#sketch-btn").addEventListener("click", () => sketch.open());
$("#brain-btn").addEventListener("click", () => brain.toggle());
// Test hook: open/close sketch mode without a pointer (live checks, screenshots).
(window as unknown as Record<string, unknown>).__sketch = {
  open: () => sketch.open(),
  close: () => sketch.close(),
  active: () => sketch.active(),
};
const layerOverride = new Map<number, number>();
function subjectKeyFor(e: Entity): string | undefined {
  const frames = framesFor(framesBySubject, e.type, e.type === "player", world.scene.playerSkin);
  if (frames.length < 1) return undefined;
  return Object.entries(framesBySubject).find(([, v]) => v === frames)?.[0];
}
function layerOf(e: Entity, subjectKey: string | undefined): number {
  if (e.type === "player") return 9;
  const override = layerOverride.get(e.id);
  if (override !== undefined) return override;
  if (subjectKey !== undefined && scenerySubjects.has(subjectKey)) return 0;
  if (subjectKey !== undefined && subjectKey.startsWith("photo")) return 1;
  return 2;
}
function spriteFor(id: number): Sprite {
  let s = spritePool.get(id);
  if (!s) {
    s = new Sprite();
    s.anchor.set(0.5, 1);
    app.stage.addChild(s);
    spritePool.set(id, s);
  }
  return s;
}

// --- code-drawn art (no image assets) ----------------------------------------
// Palette: near-black blue sky family, amber player accent, no purple.
const OUTLINE = 0x0b0e13;
const AMBER = 0xffc94d;
const GRASS = 0x3fd06a;
const SOIL_DARK = 0x1d3320;
// Mood palette (ADR 0017): defaults here, overridden while a mood is on.
const pal = { grass: GRASS, soil: SOIL_DARK, ridgeFar: 0x0a1418, ridgeNear: 0x0d1b20, moon: 0xf2ead0, star: 0x33404f };
const GOLD = 0xffd34d;
const SHINE = 0xfff2c0;
const TRAIL = 0xff8c2e;
const RAIN_BLUE = 0x6db3ff;
const SKY_BANDS = 12;
const SKY_TOP = [5, 7, 10] as const;      // #05070a
const SKY_BOTTOM = [13, 34, 41] as const; // horizon teal-dark
const SKY: number[] = [];
for (let i = 0; i < SKY_BANDS; i++) {
  const t = i / (SKY_BANDS - 1);
  const r = Math.round(SKY_TOP[0] + (SKY_BOTTOM[0] - SKY_TOP[0]) * t);
  const g = Math.round(SKY_TOP[1] + (SKY_BOTTOM[1] - SKY_TOP[1]) * t);
  const b = Math.round(SKY_TOP[2] + (SKY_BOTTOM[2] - SKY_TOP[2]) * t);
  SKY.push((r << 16) | (g << 8) | b);
}
// Reused scratch (no per-frame allocation in the hot loop).
const order: Entity[] = [];
const ridgeFar: number[] = [];
const ridgeNear: number[] = [];

function ridgeY(wx: number, seed: number): number {
  return seed === 0
    ? Math.sin(wx * 0.008) * 26 + Math.sin(wx * 0.021 + 1.7) * 10
    : Math.sin(wx * 0.011 + 4.0) * 20 + Math.sin(wx * 0.033) * 8;
}

function drawRidge(target: Graphics, pts: number[], camX: number, par: number, baseY: number, seed: number, color: number, amp = 1): void {
  const W = app.screen.width;
  const H = app.screen.height;
  pts.length = 0;
  const step = 32;
  for (let sx = -step; sx <= W + step; sx += step) {
    pts.push(sx, baseY - ridgeY(sx + camX * par, seed) * amp);
  }
  const topCount = pts.length;
  pts.push(W + step, H, -step, H);
  target.poly(pts).fill(color);
  const rim = mixC(color, pal.moon, 0.22);
  for (let i = 0; i + 3 < topCount; i += 2) {
    target.moveTo(pts[i], pts[i + 1]).lineTo(pts[i + 2], pts[i + 3]).stroke({ width: 1.5, color: rim, alpha: 0.30 });
  }
}

function squash(e: Entity): { bw: number; bh: number } {
  if (e.onGround) return { bw: e.w * 1.06, bh: e.h * 0.92 };
  if (e.vy < -40) return { bw: e.w * 0.95, bh: e.h * 1.06 };
  return { bw: e.w, bh: e.h };
}

function drawPlayer(e: Entity, x: number, y: number): void {
  const { bw, bh } = squash(e);
  const bx = x + (e.w - bw) / 2;
  const by = y + (e.h - bh); // anchor feet
  const right = e.facing > 0;
  gfx.rect(bx - 1.5, by - 1.5, bw + 3, bh + 3).fill(OUTLINE);
  gfx.rect(bx, by, bw, bh).fill(e.color);
  // headband stripe + tail streaming behind
  const bandH = Math.max(3, bh * 0.12);
  gfx.rect(bx, by + 2, bw, bandH).fill(AMBER);
  const tailLen = 6;
  const tailX = right ? bx - tailLen : bx + bw;
  gfx.rect(tailX, by + 3, tailLen, 2).fill(AMBER);
  // eye on the facing side
  const ex = right ? bx + bw - 9 : bx + 5;
  gfx.rect(ex, by + bh * 0.32, 4, 5).fill(0xffffff);
  gfx.rect(right ? ex + 2 : ex, by + bh * 0.32 + 1, 2, 3).fill(0x171106);
}

function drawBlob(e: Entity, x: number, y: number): void {
  const { bw, bh } = squash(e);
  const bx = x + (e.w - bw) / 2;
  const by = y + (e.h - bh);
  const r = Math.min(bw, bh) / 2;
  const cx = bx + bw / 2;
  // dome top + blocky base = rounded-ish walker; the outline is the same silhouette, grown
  const o = 1.5;
  gfx.ellipse(cx, by + r, r + o, r * 0.9 + o).fill(OUTLINE);
  gfx.rect(bx - o, by + r * 0.7, bw + 2 * o, bh - r * 0.7 + o).fill(OUTLINE);
  gfx.ellipse(cx, by + r, r, r * 0.9).fill(e.color);
  gfx.rect(bx, by + r * 0.7, bw, bh - r * 0.7).fill(e.color);
  // feet nubs
  gfx.rect(bx + 1, by + bh - 3, 6, 3).fill(OUTLINE);
  gfx.rect(bx + bw - 7, by + bh - 3, 6, 3).fill(OUTLINE);
  // paired eyes face the walk direction
  const dir = e.vx !== 0 ? (e.vx > 0 ? 1 : -1) : e.facing;
  const ex = cx + dir * r * 0.35;
  const ey = by + bh * 0.3;
  gfx.circle(ex - 4, ey, 3).fill(0xffffff);
  gfx.circle(ex + 4, ey, 3).fill(0xffffff);
  gfx.circle(ex - 4 + dir, ey + 0.5, 1.5).fill(0x171106);
  gfx.circle(ex + 4 + dir, ey + 0.5, 1.5).fill(0x171106);
}

function drawCoin(e: Entity, x: number, y: number): void {
  const cx = x + e.w / 2;
  const cy = y + e.h / 2;
  const r = Math.min(e.w, e.h) / 2;
  const spin = Math.abs(Math.cos(world.tickCount / 6));
  const rx = Math.max(1.5, r * (0.25 + 0.75 * spin));
  gfx.ellipse(cx, cy, rx + 1.5, r + 1.5).fill(OUTLINE);
  gfx.ellipse(cx, cy, rx, r).fill(GOLD);
  gfx.ellipse(cx - rx * 0.2, cy - r * 0.25, Math.max(1, rx * 0.35), Math.max(1, r * 0.3)).fill(SHINE);
}

function drawStair(e: Entity, x: number, y: number): void {
  const c = e.color || 0x7a8a99;
  gfx.rect(x, y, e.w, e.h).fill(c);
  const lip = Math.min(6, Math.max(2, Math.floor(e.h * 0.2)));
  gfx.rect(x, y, e.w, lip).fill(scale(c, 1.35));
  const shadow = Math.max(2, Math.floor(lip * 0.7));
  gfx.rect(x, y + e.h - shadow, e.w, shadow).fill(scale(c, 0.6));
  const seamW = 24;
  const count = Math.floor(e.w / seamW);
  for (let k = 1; k < count; k++) {
    const sx = x + k * seamW;
    gfx.rect(sx, y + lip, 1.5, e.h - lip - shadow).fill({ color: scale(c, 0.5), alpha: 0.7 });
  }
  const snowy = mood?.ambient === "snow" || mood?.name === "christmas" || mood?.name === "snowy" || e.type.toLowerCase().includes("snow") || e.type.toLowerCase().includes("ice");
  if (snowy) gfx.rect(x, y, e.w, Math.max(2, lip * 0.6)).fill(0xffffff);
}

function drawGround(e: Entity, x: number, y: number): void {
  drawGround25D(gfx, e, x, y, pal, app.screen.width, app.screen.height, grade);
}

function drawShot(e: Entity, x: number, y: number): void {
  const dir = e.vx !== 0 ? (e.vx > 0 ? 1 : -1) : e.facing;
  // fading trail behind the direction of travel
  for (let i = 1; i <= 3; i++) {
    const tw = e.w * 0.5;
    const tx = dir > 0 ? x - i * tw : x + e.w + (i - 1) * tw;
    gfx.rect(tx, y + e.h * 0.25, tw, e.h * 0.5).fill({ color: TRAIL, alpha: 0.36 / i });
  }
  gfx.rect(x, y, e.w, e.h).fill(e.color);
  gfx.rect(x + e.w * 0.2, y + e.h * 0.3, e.w * 0.6, e.h * 0.4).fill(0xfff6d8);
}

function drawDigitize(e: Entity, x: number, y: number): void {
  const fract = (v: number): number => v - Math.floor(v);
  const pulse = 0.5 + 0.5 * Math.sin(world.tickCount * 0.18);
  const cell = 6;
  for (let cx = 0; cx < e.w; cx += cell) {
    for (let cy = 0; cy < e.h; cy += cell) {
      const h = fract(Math.sin((e.x + cx) * 12.9898 + (e.y + cy) * 78.233 + Math.floor(world.tickCount / 6) * 37.7) * 43758.5453);
      if (h < 0.3 + 0.5 * pulse) {
        gfx.rect(x + cx, y + cy, Math.min(cell, e.w - cx), Math.min(cell, e.h - cy))
          .fill({ color: h < 0.08 ? 0xc8f6ff : e.color, alpha: 0.5 + 0.45 * pulse });
      }
    }
  }
  gfx.rect(x, y, e.w, e.h).stroke({ color: 0xc8f6ff, alpha: 0.25 + 0.35 * pulse, width: 1.5 });
}

let lastPrimariesTick = -1;
let cachedPrimaries = new Set<number>();
function getActivePrimaries(): Set<number> {
  if (lastPrimariesTick !== world.tickCount) {
    lastPrimariesTick = world.tickCount;
    cachedPrimaries = computePrimaries(world.entities, framesBySubject, (type) => !!kindOf(type), world.scene.playerSkin);
  }
  return cachedPrimaries;
}

function drawEntityRaw(e: Entity, camX: number, camY: number): void {
  if (isParallaxOrSkyEntity(e)) return;
  if (isSetPiece(e)) return; // Set-pieces are drawn in the background set-piece pass behind the play layer
  const x = e.x - camX;
  const y = e.y - camY;
  const W = app.screen.width;
  const H = app.screen.height;
  if (isDebrisOrHazard(e)) { drawDebris(gfx, e, x, y, world.tickCount); return; }
  if (isTetherGear(e)) { // grappling hook + rope: always code-drawn, never a character sprite (ADR 0050)
    const tt = e.data?.tetherTo;
    const target = tt === undefined ? undefined : tt === "player" ? world.entities.find((o) => o.type === "player") : world.entities.find((o) => o.id === Number(tt));
    drawTetherGear(gfx, e, x, y, target, camX, camY);
    return;
  }
  if (x + e.w < -40 || x > W + 40 || y + e.h < -40 || y > H + 40) return; // off-screen cull
  const t = e.type;
  if (morph.size > 0 && isMorphing(e)) { drawDigitize(e, x, y); return; } // a restyled sheet is about to swap in (ADR 0017)
  if (isHoop(e)) { drawHoop(gfx, e, x, y); return; } // a goal is a structure, never a floating ring (bead z1d)
  const look = kindOf(t); // code-drawn shapes and engine effects never use sprites or the outline (ADR 0015)
  if (look) { if (look.kind === "shape") drawShape(gfx, e, x, y, look.shape); return; }
  if (e.data?.visual === "shape" && t !== "coin" && !isProjectileType(t)) {
    const shape = typeof e.data.shape === "string" ? (e.data.shape as ShapeName) : "circle";
    drawShape(gfx, e, x, y, shape);
    return;
  }
  if (getActivePrimaries().has(e.id)) return; // sprite pass below
  if (t !== "player" && canUseSpriteSheet(e)) {
    for (const k of pendingArt) {
      if (t.includes(k)) { drawDigitize(e, x, y); return; }
    }
  }
  if (t === "sun" || /\bsun\b/i.test(t)) { drawSunEntity(gfx, e, x, y); return; }
  if (t.includes("cloud") || t.includes("cumulus")) {
    drawFluffyCloud(gfx, x, y, e.w, e.h, e.color, pal.moon, SKY[SKY_BANDS - 1], e.id);
    return;
  }
  if (isCliff(e)) { drawCliff(gfx, e, x, y); return; }
  if (t.indexOf("ground") >= 0 || t.indexOf("platform") >= 0 || /floor|bridge/i.test(t)) { drawGround(e, x, y); return; }
  // Each code-drawn look outlines its own silhouette (a box behind a dome left black corners).
  if (t === "player") {
    drawPlayer(e, x, y);
    return;
  }
  if (t.indexOf("coin") >= 0) { drawCoin(e, x, y); return; }
  if (t.indexOf("slime") >= 0 || t.indexOf("gel") >= 0 || t.indexOf("enemy") >= 0 ||
    t.indexOf("walker") >= 0 || t.indexOf("turtle") >= 0) { drawBlob(e, x, y); return; }
  gfx.rect(x - 1.5, y - 1.5, e.w + 3, e.h + 3).fill(OUTLINE); // rectangular looks below: outline is the rectangle
  if (t.indexOf("stair") >= 0 || t.indexOf("step") >= 0 || t.indexOf("wall") >= 0 || t.indexOf("block") >= 0 || t.indexOf("brick") >= 0 || t.indexOf("pillar") >= 0 || t.indexOf("ledge") >= 0 || t.indexOf("ramp") >= 0 || entityKind(e) === "terrain") { drawStair(e, x, y); return; }
  if (isProjectileType(t) || entityKind(e) === "projectile" || t.indexOf("arrow") >= 0 || t.indexOf("fire") >= 0) { drawShot(e, x, y); return; }
  if (ASTEROID_RE.test(t)) { drawAsteroidRock(gfx, e, x, y); return; }
  if (TARGET_RE.test(t)) { drawBullseyeTarget(gfx, e, x, y); return; }
  gfx.rect(x, y, e.w, e.h).fill(e.color);
  gfx.rect(x, y, e.w, Math.max(1.5, e.h * 0.12)).fill({ color: scale(e.color, 1.3), alpha: 0.6 });
  gfx.rect(x, y + e.h - Math.max(1.5, e.h * 0.12), e.w, Math.max(1.5, e.h * 0.12)).fill({ color: scale(e.color, 0.6), alpha: 0.6 });
}

// --- mood: one sentence restyles the whole world (ADR 0017) ------------------
let mood: MoodSpec | null = null;
let moodModCount = 0; // mods loaded when the mood was applied; more later means the mood is no longer the latest change
const origFrames = new Map<string, Texture[]>(); // sheets as they were before the mood, restored on undo
const morph = new Map<string, number>(); // sprite key -> digitize-until (ms)

/**
 * The card that says which mood is on. It follows the palette update itself (`applyMood` calls
 * `set`), so an undo, a redo or a reload updates it in the same step as the world's colours, with no
 * call site to forget (bug bv4).
 */
const moodCard = createMoodCard(() => { send({ kind: "undo", modId: "mood" }); revertMood(); say("Back to normal.", "done"); });

function mixC(a: number, b: number, t: number): number {
  const m = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}
/** The mood's palette swap for any code-drawn color: wash toward the tint, then brightness. */
function grade(c: number): number {
  if (!mood) return c;
  const w = mixC(c, mood.tint, mood.grade);
  const f = (s: number) => Math.min(255, Math.round(((w >> s) & 255) * mood!.dim));
  return (f(16) << 16) | (f(8) << 8) | f(0);
}
function isMorphing(e: Entity): boolean {
  const t = e.type.toLowerCase();
  for (const k of morph.keys()) if (e.type === "player" ? k === "ninja" : t.includes(k)) return true;
  return false;
}
function setSky(top: number, bottom: number): void {
  for (let i = 0; i < SKY_BANDS; i++) SKY[i] = mixC(top, bottom, i / (SKY_BANDS - 1));
}
function restoreSheets(): void {
  for (const [k, frames] of origFrames) framesBySubject[k] = frames;
  origFrames.clear();
  morph.clear();
}
function applyMood(m: MoodSpec | null): void {
  mood = m;
  moodCard.set(m); // the chip reads the mood through this one update, not through its callers (bug bv4)
  if (m) {
    pal.grass = m.grass; pal.soil = m.soil; pal.ridgeFar = m.ridgeFar; pal.ridgeNear = m.ridgeNear; pal.moon = m.moon; pal.star = m.star;
    setSky(m.skyTop, m.skyBottom);
  } else {
    pal.grass = GRASS; pal.soil = SOIL_DARK; pal.ridgeFar = 0x0a1418; pal.ridgeNear = 0x0d1b20; pal.moon = 0xf2ead0; pal.star = 0x33404f;
    for (let i = 0; i < SKY_BANDS; i++) SKY[i] = mixC((SKY_TOP[0] << 16) | (SKY_TOP[1] << 8) | SKY_TOP[2], (SKY_BOTTOM[0] << 16) | (SKY_BOTTOM[1] << 8) | SKY_BOTTOM[2], i / (SKY_BANDS - 1));
  }
  setGrade(grade);
  setSnowy(!!m && (m.ambient === "snow" || m.name === "christmas" || m.name === "snowy"));
  fx.setMood(m);
  portal.setMood(m);
  sound.setMood(m);
}
// --- scene backdrop: a genre change paints its own sky (ADR 0066), under any mood ---------------
const SPACE_BACKDROP = { skyTop: 0x01020a, skyBottom: 0x0a1030, moon: 0x7f9ad0, star: 0xdfe8ff };
let paintedBackdropKey = "";
/** Repaint the code-drawn sky when the scene's backdrop (or the mood on top of it) changes; a mood always wins. */
function syncBackdrop(): void {
  const key = mood ? `mood:${mood.name}` : world.scene.backdrop ?? "";
  if (key === paintedBackdropKey) return;
  paintedBackdropKey = key;
  if (mood) return; // applyMood painted it
  if (world.scene.backdrop === "space") {
    pal.moon = SPACE_BACKDROP.moon; pal.star = SPACE_BACKDROP.star;
    setSky(SPACE_BACKDROP.skyTop, SPACE_BACKDROP.skyBottom);
  } else {
    applyMood(null); // back to the starter sky
  }
}
/**
 * Put the world back to no mood (ADR 0017). `local` is false when the server already said so with
 * its own `mood: null` frame: that frame also makes the server record the world on the timeline
 * strip. A mood the player undoes here is not echoed by the server (bug bv4), so the strip gets the
 * loss of the mood straight away instead of waiting for the next action to record a step.
 */
function revertMood(local = true): void {
  restoreSheets();
  applyMood(null);
  if (local) timelineView.localStep({ kind: "undo", label: "Back to normal", mods: loader.list().map((m) => ({ id: m.id, title: m.title })) });
}
/** Server designed a mood: repaint the code-drawn world now, then ask for each AI sheet to be edited toward it. */
function onMood(m: MoodSpec | null): void {
  if (!m) { revertMood(false); say("Back to normal.", "done"); return; }
  if (mood && mood.name === m.name) return; // duplicate of the mood already on
  tester.mood(m.name);
  restoreSheets();
  applyMood(m);
  sound.play("swell");
  moodModCount = loader.list().length;
  renderMods();
  // Only sheets something in the world actually uses (no image spend on art nobody can see).
  // Bead 8zu: the boot sheets may still be loading, so this runs once they are in — a mood
  // spoken during the cold start still restyles them instead of quietly skipping them.
  void lateArt.settled.then(() => {
    if (!mood || mood.name !== m.name) return; // superseded by a newer mood
    const used = new Set<string>();
    for (const e of world.entities) { const k = subjectKeyFor(e); if (k) used.add(k); }
    // A new background alone (ADR 0067) leaves every sprite as it is: no sheet edits, no image spend.
    if (m.scope === "background") { say(`New background: ${m.name.replace(/-/g, " ")}.`, "done"); return; }
    const keys = [...used].filter((k) => !k.startsWith("photo") && !origFrames.has(k) && (framesBySubject[k]?.length ?? 0) > 0);
    // The palette is already on screen, so the card says done now (bead inh). The sheet redraws
    // arrive later and show on their own (the digitize morph); a card line held open for them
    // would still read "restyling" long after, and could overwrite a newer status.
    say(`It's ${m.name} now.`, "done");
    if (keys.length > 0) send({ kind: "restyle", mood: m.name, keys });
  });
}
async function onRestyled(msg: Extract<ServerMsg, { kind: "restyled" }>): Promise<void> {
  if (!msg.url || !mood || mood.name !== msg.mood) return;
  const frames = await loadSpriteSheet(msg.url);
  if (frames.length < 1 || !mood || mood.name !== msg.mood) return;
  morph.set(msg.key, performance.now() + 1000);
  setTimeout(() => {
    morph.delete(msg.key);
    if (!mood || mood.name !== msg.mood) return;
    if (!origFrames.has(msg.key)) origFrames.set(msg.key, framesBySubject[msg.key]);
    framesBySubject[msg.key] = frames;
  }, 1000);
}

function drawEntity(e: Entity, camX: number, camY: number): void {
  if (!mood) { drawEntityRaw(e, camX, camY); return; }
  const c = e.color;
  e.color = grade(c);
  drawEntityRaw(e, camX, camY);
  e.color = c;
}

// --- drawer + radial menu ---------------------------------------------------
const layoutEl = $("#app");
const drawerToggle = $<HTMLButtonElement>("#drawer-toggle");
const radialMenu = $("#radial-menu");
const radialCenter = $("#radial-center");
let radialTargetId: number | null = null;
function desiredCamXFor(w: number): number {
  const playerForCam = world.entities.find((e) => e.type === "player");
  return playerForCam ? playerForCam.x + playerForCam.w / 2 - w * 0.38 : world.camera.x;
}
function desiredCamYFor(h: number): number {
  const playerForCam = world.entities.find((e) => e.type === "player");
  return computeDesiredCamY(playerForCam, h, world.camera.y);
}
function fitRenderer(): void {
  const rect = stageWrapEl.getBoundingClientRect();
  const w = Math.max(320, Math.floor(rect.width));
  const h = Math.max(240, Math.floor(rect.height));
  const sizeChanged = app.screen.width !== w || app.screen.height !== h;
  if (sizeChanged) app.renderer.resize(w, h);
  app.canvas.style.width = `${w}px`;
  app.canvas.style.height = `${h}px`;
  if (sizeChanged) {
    camXSmooth = desiredCamXFor(w);
    camYSmooth = desiredCamYFor(h);
  }
}
fitRenderer();
drawerToggle.addEventListener("click", () => {
  const hidden = layoutEl.classList.toggle("drawer-hidden");
  drawerToggle.textContent = hidden ? "«" : "»";
  drawerToggle.setAttribute("aria-expanded", String(!hidden));
  fitRenderer();
  setTimeout(fitRenderer, 260);
  setTimeout(fitRenderer, 400);
});
addEventListener("resize", fitRenderer);
const RADIAL_PAD_X = 104;
const RADIAL_PAD_TOP = 134;
const RADIAL_PAD_BOTTOM = 128;
function formatRadialLabel(type: string): string {
  return type.replace(/^photo-\d+-?/, "").replace(/[-_]+/g, " ").trim() || type;
}
const scaleOverride = new Map<number, number>();

function hasDrawnArt(e: Entity): boolean {
  return framesFor(framesBySubject, e.type, e.type === "player", world.scene.playerSkin).length >= 1 && !kindOf(e.type);
}
world.hasArt = hasDrawnArt; // gear sockets measure the body the eye sees (ADR 0061)

function visualHeightOf(e: Entity): number {
  return visualHeight(e, hasDrawnArt(e));
}

function positionRadialMenu(e: Entity, camX: number, camY: number): void {
  const visH = visualHeightOf(e);
  const rawX = e.x - camX + e.w / 2;
  const rawY = e.y - camY + e.h - visH / 2;
  const w = app.screen.width || stageWrapEl.clientWidth;
  const h = app.screen.height || stageWrapEl.clientHeight;
  const x = w > RADIAL_PAD_X * 2 ? Math.min(w - RADIAL_PAD_X, Math.max(RADIAL_PAD_X, rawX)) : w / 2;
  const y = h > RADIAL_PAD_TOP + RADIAL_PAD_BOTTOM
    ? Math.min(h - RADIAL_PAD_BOTTOM, Math.max(RADIAL_PAD_TOP, rawY))
    : h / 2;
  radialMenu.style.left = `${Math.round(x)}px`;
  radialMenu.style.top = `${Math.round(y)}px`;
  radialMenu.style.setProperty("--ring-dx", `${Math.round(rawX - x)}px`);
  radialMenu.style.setProperty("--ring-dy", `${Math.round(rawY - y)}px`);
  radialMenu.style.setProperty("--ring-size", `${Math.round(Math.min(140, Math.max(44, Math.hypot(e.w, visH) + 12)))}px`);
}
function closeRadialMenu(): void {
  radialTargetId = null;
  radialMenu.hidden = true;
}
function openRadialMenu(e: Entity): void {
  const switched = radialTargetId !== null && radialTargetId !== e.id && !radialMenu.hidden;
  radialTargetId = e.id;
  radialCenter.textContent = formatRadialLabel(e.type);
  positionRadialMenu(e, camXSmooth ?? world.camera.x, camYSmooth ?? world.camera.y);
  if (switched) {
    radialMenu.hidden = true;
    void radialMenu.offsetWidth;
  }
  radialMenu.hidden = false;
}
function entityAt(wx: number, wy: number): Entity | undefined {
  const candidates = world.entities
    .map((e, index) => ({ e, index }))
    .filter(({ e }) => {
      const t = e.type.toLowerCase();
      if (t.includes("ground") || t.includes("platform")) return false;
      return wx >= e.x - 4 && wx <= e.x + e.w + 4 && wy >= e.y - 4 && wy <= e.y + e.h + 4;
    });
  candidates.sort((a, b) => {
    const playerDiff = Number(b.e.type === "player") - Number(a.e.type === "player");
    if (playerDiff !== 0) return playerDiff;
    const layerDiff = layerOf(b.e, subjectKeyFor(b.e)) - layerOf(a.e, subjectKeyFor(a.e));
    if (layerDiff !== 0) return layerDiff;
    return b.index - a.index;
  });
  return candidates[0]?.e;
}
let canvasDown: { x: number; y: number } | null = null;
// Pointer aim (ADR 0050): screen position + camera = world position, read into InputState each frame.
// clickAim: a click-fire is aimed (it may point behind the player) for its whole short B press.
const pointer: { sx: number; sy: number; down: boolean; seen: boolean; clickAim: boolean } = { sx: 0, sy: 0, down: false, seen: false, clickAim: false };
function trackPointer(ev: PointerEvent, down?: boolean): void {
  const rect = app.canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  pointer.sx = (ev.clientX - rect.left) * (app.screen.width / rect.width);
  pointer.sy = (ev.clientY - rect.top) * (app.screen.height / rect.height);
  pointer.seen = true;
  if (down !== undefined) pointer.down = down;
}
app.canvas.addEventListener("pointermove", (ev) => trackPointer(ev));
app.canvas.addEventListener("pointerleave", () => { pointer.seen = false; pointer.down = false; });
app.canvas.addEventListener("pointerdown", (ev) => { trackPointer(ev, true); canvasDown = { x: ev.clientX, y: ev.clientY }; });
addEventListener("pointerup", () => { pointer.down = false; });
app.canvas.addEventListener("pointerup", (ev) => {
  if (!canvasDown) return;
  const moved = Math.hypot(ev.clientX - canvasDown.x, ev.clientY - canvasDown.y);
  canvasDown = null;
  if (moved > 6) return;
  const rect = app.canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const sx = (ev.clientX - rect.left) * (app.screen.width / rect.width);
  const sy = (ev.clientY - rect.top) * (app.screen.height / rect.height);
  const hit = entityAt(sx + (camXSmooth ?? world.camera.x), sy + (camYSmooth ?? world.camera.y));
  if (hit) openRadialMenu(hit);
  else {
    closeRadialMenu();
    // A click on empty space (or terrain) fires a live grappling hook at the pointer (bead 40c, ADR 0050).
    if (ev.button === 0 && loader.list().some((m) => /grappl|hook|tether/i.test(m.id))) {
      pointer.clickAim = true; keys.add("KeyB"); syncInput();
      setTimeout(() => { pointer.clickAim = false; keys.delete("KeyB"); syncInput(); }, 90);
    }
  }
});
document.addEventListener("pointerdown", (ev) => {
  if (radialTargetId === null) return;
  const target = ev.target as Node | null;
  if (target && radialMenu.contains(target)) return;
  if (target === app.canvas) return;
  closeRadialMenu();
});
addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeRadialMenu(); });
document.querySelectorAll<HTMLButtonElement>("#radial-menu [data-action]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (radialTargetId === null) return;
    const e = world.entities.find((en) => en.id === radialTargetId);
    if (!e) { closeRadialMenu(); return; }
    const action = btn.dataset.action;
    if (action === "bigger" || action === "smaller") {
      const factor = action === "bigger" ? 1.15 : 0.87;
      const nw = Math.min(420, Math.max(10, e.w * factor));
      const nh = Math.min(420, Math.max(10, e.h * factor));
      e.x -= (nw - e.w) / 2;
      e.y -= (nh - e.h);
      e.w = nw; e.h = nh;
      const currentScale = (scaleOverride.get(e.id) ?? 1) * factor;
      scaleOverride.set(e.id, currentScale);
      if (e.data) {
        e.data.scale = currentScale;
        e.data.targetW = nw;
        e.data.targetH = nh;
      }
      positionRadialMenu(e, camXSmooth ?? world.camera.x, camYSmooth ?? world.camera.y);
    } else if (action === "front") {
      layerOverride.set(e.id, 5);
    } else if (action === "back") {
      layerOverride.set(e.id, -1);
    } else if (action === "remove") {
      const owner = e.owner;
      world.despawn(e.id);
      layerOverride.delete(e.id);
      scaleOverride.delete(e.id);
      closeRadialMenu();
      if (owner && owner !== "player" && owner !== "ground") {
        const remaining = world.entities.filter((en) => en.owner === owner);
        if (remaining.length === 0 && loader.list().some((mod) => mod.id === owner)) {
          loader.unload(owner);
          renderMods();
          sendWorldState();
        }
      }
    } else if (action === "thumbs-up" || action === "thumbs-down") {
      const modTitle = loader.list().find((m) => m.id === e.owner)?.title ?? formatRadialLabel(e.type);
      feedback.open({ modId: e.owner, title: modTitle, entityType: e.type, vote: action === "thumbs-up" ? "up" : "down" });
      closeRadialMenu();
    } else if (action === "explain") {
      const modTitle = loader.list().find((m) => m.id === e.owner)?.title ?? formatRadialLabel(e.type);
      closeRadialMenu();
      receipt.close();
      explain.open({ modId: e.owner, title: modTitle, entityType: e.type });
    } else if (action === "receipt") {
      const modTitle = loader.list().find((m) => m.id === e.owner)?.title ?? formatRadialLabel(e.type);
      closeRadialMenu();
      explain.close();
      receipt.open({ modId: e.owner, title: modTitle, entityType: e.type });
    }
  });
});

function render(): void {
  bgGfx.clear();
  gfx.clear();
  const W = app.screen.width;
  const H = app.screen.height;
  const camDt = Math.min(0.05, Math.max(0.001, (performance.now() - lastRenderAt) / 1000));
  const camPlayer = world.entities.find((e) => e.type === "player");
  const desiredCamX = desiredCamXFor(W) + feel.cam.lookahead(camPlayer, camDt);
  if (camXSmooth === null) camXSmooth = desiredCamX;
  else camXSmooth = feel.cam.smoothX(camXSmooth, desiredCamX, camDt);
  const camX = camXSmooth;
  const desiredCamY = desiredCamYFor(H);
  if (camYSmooth === null) camYSmooth = desiredCamY;
  else camYSmooth = feel.cam.smoothY(camYSmooth, desiredCamY, camDt, camPlayer?.onGround ?? true);
  feel.update(world.entities, camDt);
  // Radial menu follows its entity; close if it is gone.
  if (radialTargetId !== null) {
    const target = world.entities.find((e) => e.id === radialTargetId);
    if (!target) closeRadialMenu();
    else positionRadialMenu(target, camX, camYSmooth);
  }
  syncBackdrop();
  const inSpace = world.scene.backdrop === "space";
  const isDaytime = isDaytimeSky(mood, world.entities, SKY[0]);
  const sunEntity = world.entities.find((e) => {
    const t = e.type.toLowerCase();
    return t === "sun" || /\bsun\b/.test(t);
  });
  const skyEntity = world.entities.find((e) => isSkyOrBackgroundEntity(e) && typeof e.color === "number" && e.color > 0);
  const skyEntityCol = (!mood && skyEntity) ? skyEntity.color : undefined;

  drawSkyAndCelestials(
    bgGfx,
    W,
    H,
    camX,
    SKY_BANDS,
    SKY,
    pal,
    isDaytime,
    Boolean(sunEntity),
    skyEntityCol,
  );

  if (isDaytime && !world.entities.some((e) => e.type.toLowerCase().includes("cloud"))) {
    const skyBottomCol = SKY[SKY_BANDS - 1];
    const c1x = ((140 - camX * 0.08) % (W + 220) + W + 220) % (W + 220) - 110;
    drawFluffyCloud(bgGfx, c1x, 38, 120, 36, 0xffffff, pal.moon, skyBottomCol, 1);
    const c2x = ((W * 0.48 - camX * 0.12) % (W + 260) + W + 260) % (W + 260) - 130;
    drawFluffyCloud(bgGfx, c2x, 62, 150, 42, 0xffffff, pal.moon, skyBottomCol, 2);
    const c3x = ((W * 0.82 - camX * 0.06) % (W + 200) + W + 200) % (W + 200) - 100;
    drawFluffyCloud(bgGfx, c3x, 28, 95, 30, 0xffffff, pal.moon, skyBottomCol, 3);
  }
  // far hill silhouettes + parallax layers + atmospheric horizon mist (bead 1z7 & rm1)
  const horizon = H * 0.62 - camYSmooth * 0.1;
  // A themed backdrop (ADR 0067) brings its own skyline: farmland is flat, a medieval valley keeps the mountains.
  // A genre scene in space (ADR 0066) hides the terrain and scenery, backdrop included.
  const backdrop = inSpace ? undefined : mood?.backdrop;
  const amp = skylineAmplitude(backdrop);
  const fog = depthFog(mood?.name);
  if (!inSpace) {
    if (!backdrop || backdrop.skyline === "mountains") drawDistantMountains(bgGfx, camX, camYSmooth, W, H, pal, SKY[SKY_BANDS - 1]);
    drawRidge(bgGfx, ridgeFar, camX, 0.3, horizon, 0, mixC(pal.ridgeFar, SKY[SKY_BANDS - 1], fog.far), amp);
    drawRidge(bgGfx, ridgeNear, camX, 0.55, horizon + 34, 1, mixC(pal.ridgeNear, SKY[SKY_BANDS - 1], fog.near), amp);
  }
  // Starter-world scenery, unless a mod brings its own parallax backdrop (bead 5fl)
  if (backdrop && world.entities.some((e) => e.type === "ground")) {
    drawBackdrop(bgGfx, camX, camYSmooth, W, pal, SKY[SKY_BANDS - 1], fog.far, isDaytime, backdrop, mood?.name);
  } else if (!inSpace && world.entities.some((e) => e.type === "ground") && !world.entities.some(isParallaxOrSkyEntity)) {
    drawScenery(bgGfx, camX, camYSmooth, W, pal, SKY[SKY_BANDS - 1], fog.far, isDaytime, mood?.name);
  }
  // The backdrop replaces a parallax mod's silhouettes; its clouds still drift.
  drawParallaxEntities(bgGfx, backdrop ? world.entities.filter(isCloudEntity) : world.entities, camX, camYSmooth, W, H, pal, SKY[SKY_BANDS - 1], grade);
  if (!inSpace) drawHorizonMist(bgGfx, camX, camYSmooth, W, H, pal, SKY[SKY_BANDS - 1]);
  setPieceLayer.render(world.entities, camX, camYSmooth, framesBySubject);
  // solids-first, then contact shadows on solid surfaces, then dynamic entities
  order.length = 0;
  for (let i = 0; i < world.entities.length; i++) order.push(world.entities[i]);
  order.sort((a, b) => Number(b.solid) - Number(a.solid));
  let shadowsDrawn = false;
  for (let i = 0; i < order.length; i++) {
    if (!shadowsDrawn && !order[i].solid) {
      drawContactShadows(gfx, world.entities, camX, camYSmooth, W, H, isEffectType, celestialPos(W).x);
      shadowsDrawn = true;
    }
    drawEntity(order[i], camX, camYSmooth);
  }
  if (!shadowsDrawn) drawContactShadows(gfx, world.entities, camX, camYSmooth, W, H, isEffectType, celestialPos(W).x);
  for (const p of world.particles) {
    drawDebrisParticle(gfx, p, camX, camYSmooth);
  }
  // Sprite primaries: per owner+subject every entity at >=30% of the group's
  // max area gets the sprite; small assembled sub-parts stay rects under it.
  const seen = new Set<number>();
  const primaries = new Set<number>();
  {
    const groups = new Map<string, { maxArea: number; items: { id: number; area: number }[] }>();
    for (const e of world.entities) {
      if (isParallaxOrSkyEntity(e)) continue;
      const frames = framesFor(framesBySubject, e.type, e.type === "player", world.scene.playerSkin);
      if (frames.length < 1 || kindOf(e.type) || isTetherGear(e) || isSetPiece(e)) continue;
      const subject = Object.entries(framesBySubject).find(([, v]) => v === frames)?.[0] ?? e.type;
      const gk = `${e.owner}|${subject}`;
      const area = e.w * e.h;
      let g = groups.get(gk);
      if (!g) { g = { maxArea: area, items: [] }; groups.set(gk, g); }
      if (area > g.maxArea) g.maxArea = area;
      g.items.push({ id: e.id, area });
    }
    for (const g of groups.values()) {
      for (const item of g.items) {
        if (item.area >= 0.3 * g.maxArea) primaries.add(item.id);
      }
    }
  }
  drawnBodies.clear();
  const spriteDraw: { e: Entity; frame: Texture; subjectKey: string | undefined; bob: number }[] = [];
  for (const e of world.entities) {
    if (isParallaxOrSkyEntity(e)) continue;
    const frames = framesFor(framesBySubject, e.type, e.type === "player", world.scene.playerSkin);
    if (frames.length < 1 || !primaries.has(e.id) || kindOf(e.type) || (morph.size > 0 && isMorphing(e)) || isSetPiece(e)) continue;
    seen.add(e.id);
    const moving = Math.abs(e.vx) > 5;
    const subjectKey = Object.entries(framesBySubject).find(([, v]) => v === frames)?.[0];
    const pick = pickWalkFrame({ frameCount: frames.length, tick: world.tickCount, moving, onGround: e.onGround });
    const bobbing = e.onGround && entityKind(e) !== "prop" && !(subjectKey !== undefined && scenerySubjects.has(subjectKey));
    const frame = frames.length === 1 ? frames[0]
      : (subjectKey !== undefined && scenerySubjects.has(subjectKey)) || entityKind(e) === "prop" ? frames[e.id % frames.length]
      : !e.solid && !e.onGround && e.gravityScale === 0 && frames.length >= 2 ? frames[Math.floor(world.tickCount / 5) % frames.length]
      : frames[pick.index];
    spriteDraw.push({ e, frame, subjectKey, bob: bobbing ? pick.bob : 0 });
  }
  spriteDraw.sort((a, b) => layerOf(a.e, a.subjectKey) - layerOf(b.e, b.subjectKey));
  for (const { e, frame, subjectKey, bob } of spriteDraw) {
    const s = spriteFor(e.id);
    const targetH = visualHeightOf(e);
    const scale = targetH / frame.height;
    s.texture = frame;
    const sq = feel.scaleOf(e.id);
    s.scale.set(scale * e.facing * sq.sx, scale * sq.sy);
    s.tint = feel.tintOf(e.id);
    s.position.set(e.x - camX + e.w / 2, e.y - camYSmooth + e.h + 2 - bob);
    s.zIndex = layerOf(e, subjectKey);
    s.visible = true;
    drawnBodies.set(e.id, spriteBody(s.x, s.y, frame.width * Math.abs(s.scale.x), frame.height * Math.abs(s.scale.y)));
  }
  for (const [id, s] of spritePool) if (!seen.has(id)) { s.visible = false; scaleOverride.delete(id); }
  const nowMs = performance.now();
  feel.draw(camX, camYSmooth);
  fx.render(world, camX, camYSmooth, W, H, (nowMs - lastRenderAt) / 1000, isEffectType);
  portal.render(world, camX, camYSmooth, (nowMs - lastRenderAt) / 1000, (t) => isEffectType(t) || !canUseSpriteSheet(t));
  lastRenderAt = nowMs;
  app.stage.position.set(fx.shakeX, fx.shakeY);
  // health bars: single pass after rect and sprite passes (player included)
  barGfx.clear();
  for (const e of world.entities) {
    const x = e.x - camX;
    const y = e.y - camYSmooth;
    if (x + e.w < -40 || x > W + 40 || y + e.h < -40 || y > H + 40) continue;
    const bar = healthBarRect(drawnBodies.get(e.id) ?? rectBody(x, y, e.w), (e as { health?: number }).health);
    if (!bar) continue;
    barGfx.rect(bar.x, bar.y, bar.w, bar.h).fill({ color: 0x0b0e13, alpha: 0.7 });
    barGfx.rect(bar.x, bar.y, bar.fill, bar.h).fill(healthBarColor((e as { health: number }).health));
  }
  hud.render(world);
  speech.render(world, camX, camYSmooth, visualHeightOf);
}

// fixed-step loop: sim never reads wall-clock, accumulator only paces steps
let last = performance.now();
let acc = 0;
let noPlayerTicks = 0;
let frameFaultShown = false;
/** One animation frame. Whatever throws inside it, the next frame is still scheduled, so the game never freezes. */
function frame(now: number): void {
  try {
    stepAndRender(now);
  } catch (err) {
    if (!frameFaultShown) { frameFaultShown = true; console.error("frame failed:", err); log("a frame failed; the game keeps running"); }
  }
  requestAnimationFrame(frame);
}
function stepAndRender(now: number): void {
  // Sketch mode freezes the world (ADR 0028): you draw on a still frame, and the
  // accumulator is dropped so resuming does not fast-forward the sim.
  const sketching = sketch.active();
  acc = sketching ? 0 : acc + Math.min(100, now - last);
  last = now;
  const stepMs = SIM.dt * 1000;
  pollPad();
  if (pointer.seen) {
    world.input.pointerX = pointer.sx + (camXSmooth ?? world.camera.x);
    world.input.pointerY = pointer.sy + (camYSmooth ?? world.camera.y);
    world.input.pointerDown = pointer.down || pointer.clickAim;
  } else { delete world.input.pointerX; delete world.input.pointerY; delete world.input.pointerDown; }
  while (acc >= stepMs) {
    world.step(); acc -= stepMs;
    if (wheelTap.nextItem || wheelTap.prevItem) { wheelTap.nextItem = wheelTap.prevItem = false; syncInput(); } // a wheel notch lasts one step
    for (const [id, mult] of scaleOverride) {
      const ent = world.entities.find((x) => x.id === id);
      if (ent && ent.data?.targetW && ent.data?.targetH) {
        const tw = Number(ent.data.targetW);
        const th = Number(ent.data.targetH);
        if (ent.w !== tw || ent.h !== th) {
          ent.x -= (tw - ent.w) / 2;
          ent.y -= (th - ent.h);
          ent.w = tw;
          ent.h = th;
        }
      }
    }
    if (!loader.has("player") || world.entities.some((e) => e.type === "player")) noPlayerTicks = 0;
    else if (++noPlayerTicks > 90) { noPlayerTicks = 0; loadLocal(playerMod); say("Knocked out — you're back in!", "done"); }
  }
  render();
}
requestAnimationFrame(frame);

// --- input -------------------------------------------------------------------
const keys = new Set<string>();
addEventListener("keydown", (e) => {
  // Typing a command is not a game command (bead wgt): a text box keeps every key it gets,
  // including M (mute), B/X/J/F (fire), brackets (volume) and P (pipeline).
  if (!isGameKeyEvent(e)) return;
  if (e.code === "KeyM" && !e.repeat) { log(sound.toggleMute() ? "sound muted (M)" : "sound on (M)"); syncSoundButton(); return; }
  if (["KeyA", "KeyD", "KeyW", "Space", "ArrowLeft", "ArrowRight", "ArrowUp"].includes(e.code)) onboarding.event("move");
  if (e.code === "BracketLeft" || e.code === "BracketRight") sound.setVolume(sound.volume + (e.code === "BracketRight" ? 0.1 : -0.1));
  keys.add(e.code);
  syncInput();
  if (["ArrowUp", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
});
// A keyup always clears its code, whatever the target: losing a release can only stop an action.
addEventListener("keyup", (e) => { keys.delete(e.code); syncInput(); });
// A text field taking focus (or the window losing it mid-hold) drops every held game key, so a
// key pressed in the game never keeps the player running while the person types a command.
addEventListener("focusin", (e) => { if (isTypingTarget(e.target) && keys.size > 0) { keys.clear(); syncInput(); } });
addEventListener("blur", () => { if (keys.size > 0) { keys.clear(); syncInput(); } });
// Controller (bead 5p6, src/client/gamepad.ts): polled once per frame, merged with the keyboard.
const padTracker = new PadTracker();
let padInput = emptyInput();
let inputMode: InputMode = "key";
const hintEl = document.querySelector("#hint");
function setInputMode(src: InputMode): void {
  const next = nextMode(inputMode, src);
  if (next === inputMode) return;
  inputMode = next;
  if (hintEl) hintEl.textContent = HINT_TEXT[inputMode];
  onboarding.refresh();
}
addEventListener("keydown", () => setInputMode("key"));
function pollPad(): void {
  const f = padTracker.poll(navigator.getGamepads ? Array.from(navigator.getGamepads()) : []);
  for (const ev of f.events) showToast(ev === "connected" ? "Controller connected" : "Controller disconnected", "🎮");
  if (f.touched) setInputMode("pad");
  if (f.options) drawerToggle.click();
  padInput = f.input;
  syncInput();
}
// The mouse wheel over the game switches items (ADR 0070): a tap, held for one sim step.
const wheelTap = { nextItem: false, prevItem: false };
app.canvas.addEventListener("wheel", (ev) => {
  if (ev.deltaY === 0) return;
  if (ev.deltaY > 0) wheelTap.nextItem = true; else wheelTap.prevItem = true;
  syncInput();
  ev.preventDefault();
}, { passive: false });
function syncInput(): void {
  // One pure mapping for every key (src/client/keys.ts, ADR 0046): B is an action key, so
  // "pick it up and shoot with B" works without a special case per prompt.
  Object.assign(world.input, mergeInputs(inputFromKeys(keys), padInput));
  if (wheelTap.nextItem) world.input.nextItem = true;
  if (wheelTap.prevItem) world.input.prevItem = true;
}

// --- mod cards -----------------------------------------------------------------
function renderMods(): void {
  modsEl.innerHTML = "";
  moodCard.mount(modsEl); // the card keeps its own text; this only re-homes it (bug bv4)
  const mods = loader.list();
  if (mods.length === 0) {
    const li = document.createElement("li");
    li.textContent = "Empty world. The orb is waiting.";
    modsEl.appendChild(li);
    return;
  }
  for (const mod of mods) {
    const li = document.createElement("li");
    const head = document.createElement("div");
    head.className = "title";
    const name = document.createElement("span");
    name.textContent = mod.title;
    const undo = document.createElement("button");
    undo.className = "undo";
    undo.textContent = "Undo";
    undo.addEventListener("click", () => {
      loader.unload(mod.id);
      send({ kind: "undo", modId: mod.id });
      say(`${mod.title} removed.`, "done");
      renderMods();
    });
    head.append(name, feedback.createModActions(mod, () => undo.click()));
    li.appendChild(head);
    for (const [knob, def] of Object.entries(mod.knobDefs)) {
      if (typeof def.value !== "number") continue;
      const row = document.createElement("label");
      row.className = "knob";
      const label = document.createElement("span");
      label.textContent = def.label ?? knob;
      const range = document.createElement("input");
      range.type = "range";
      range.min = String(def.min ?? 0);
      range.max = String(def.max ?? 100);
      range.value = String(mod.values[knob]);
      const out = document.createElement("output");
      out.textContent = range.value;
      range.addEventListener("input", () => {
        out.textContent = range.value;
        loader.setKnob(mod.id, knob, Number(range.value));
        send({ kind: "knob", modId: mod.id, knob, value: Number(range.value) });
      });
      row.append(label, range, out);
      li.appendChild(row);
    }
    modsEl.appendChild(li);
  }
}

const timelineView = mountTimeline($("#timeline"), (n) => send({ kind: "timelineRestore", n }));

// --- commands -------------------------------------------------------------------
function sendWorldState(): void {
  if (ws?.readyState === WebSocket.OPEN) {
    send({ kind: "worldState", mods: loader.list().map((m) => ({ id: m.id, values: m.values })) });
  }
}

function loadLocal(def: ModDefinition): void {
  loader.load(def);
  say(`${def.title} materialized.`, "done");
  log(`loaded ${def.id}`);
  renderMods();
  sendWorldState();
}
let starterAutoLoaded = false;
function autoLoadStarterOnce(): void {
  if (starterAutoLoaded) return;
  starterAutoLoaded = true;
  if (loader.list().length === 0 && world.entities.length === 0) {
    loadLocal(playerMod);
    loadLocal(groundMod);
  }
  sendWorldState();
}
function handleLocal(text: string): boolean {
  const t = text.toLowerCase();
  if (mood && isMoodUndoAsk(t, mood.name)) { send({ kind: "undo", modId: "mood" }); revertMood(); say("Back to normal.", "done"); return true; }
  if (t.includes("undo") || t.startsWith("remove")) {
    // A mood is the latest change until a mod is added after it (ADR 0017): bare "undo" puts the world back first.
    if (mood && t.includes("undo") && loader.list().length === moodModCount) { send({ kind: "undo", modId: "mood" }); revertMood(); say("Back to normal.", "done"); return true; }
    const mods = loader.list();
    const last = mods[mods.length - 1];
    if (last) { loader.unload(last.id); say(`${last.title} removed.`, "done"); showToast(`${last.title} removed.`); renderMods(); }
    else say("Nothing to undo.");
    return true;
  }
  let n = t.trim().replace(/[.!?,;:]+$/, "").trim().replace(/\s+/g, " ");
  n = n.replace(/^(?:add|make|create|spawn|build|give|put)\s+/, "");
  while (/^(?:a|an|the)\s+/.test(n)) n = n.replace(/^(?:a|an|the)\s+/, "");
  // Exact matches only: anything with extra descriptive words falls through to the server.
  // Extra aliases are the normalized forms of the index.html chip commands, which must keep working:
  // "add some ground" -> "some ground", "make it rain" -> "it rain", "shoot fire arrows" (unchanged).
  const itemMod = resolveItemMod(t);
  if (itemMod) { loadLocal(itemMod); return true; }
  if (n === "starter world" || n === "starter") { loadLocal(playerMod); loadLocal(groundMod); return true; }
  if (n === "download game" || n === "download" || n === "export game" || n === "export") { $("#export-btn")?.click(); return true; }
  if (n === "player" || n === "ninja") { loadLocal(playerMod); return true; }
  if (n === "ground" || n === "some ground") { loadLocal(groundMod); return true; }
  if (n === "enemy" || n === "enemies" || n === "walker" || n === "walkers" || n === "turtle") { loadLocal(enemyMod); return true; }
  if (n === "rain" || n === "it rain") { loadLocal(rainMod); return true; }
  if (n === "coin" || n === "coins") { loadLocal(coinsMod); return true; }
  if (n === "moving platform") { loadLocal(movingPlatformMod); return true; }
  if (n === "fire arrow" || n === "fire arrows" || n === "arrow" || n === "arrows" || n === "shoot fire arrows") { loadLocal(fireArrowMod); return true; }
  if (n === "parallax" || n === "parallax background" || n === "parallax forest" || n === "parallax vista") { loadLocal(parallaxMod); return true; }
  if (n === "chicken") { loadLocal(chickenMod); return true; }
  if (n === "swarm" || n === "swarms" || n === "wave" || n === "waves") { loadLocal(swarmMod); return true; }
  // Only an ask about the player is answered here; pronouns and named things ("make the slimes
  // faster") go to the server, whose route rules pick the mod (bugs cps, 5w1).
  const serverUp = ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING;
  const localAsk = localRelativeAsk(t, serverUp);
  if (localAsk === "jump") { tweak("player", "jump", 880, "Jump raised."); return true; }
  // A local ask is about the player by construction, so it never speeds the walkers.
  if (localAsk === "speed") { tweak("player", "speed", 380, "Player sped up."); return true; }
  return false;
}
function tweak(modId: string, knob: string, value: KnobValue, message: string): void {
  if (loader.setKnob(modId, knob, value)) { say(message, "done"); renderMods(); }
  else say(`Add that mod first, then I can tweak it.`);
}

// --- server ---------------------------------------------------------------------
// `ws` and `WS_URL` live in the cold-start block at the top: the socket opens early.
function send(msg: ClientMsg): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function loadArtWithRetry(key: string, url: string, scenery = false): void {
  const attempt = (u: string, isRetry: boolean): void => {
    loadSpriteSheet(u).then((frames) => {
      if (frames.length > 0) {
        if (mood && origFrames.has(key)) origFrames.set(key, frames);
        else framesBySubject[key] = frames;
        if (scenery) scenerySubjects.add(key);
        pendingArt.delete(key);
        log(`art loaded for ${key} (${frames.length} frames)`);
      } else if (!isRetry) {
        setTimeout(() => attempt(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), true), 1500);
      } else {
        pendingArt.delete(key);
        log(`art failed for ${key}, keeping rect fallback`);
      }
    }).catch(() => {
      if (!isRetry) {
        setTimeout(() => attempt(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), true), 1500);
      } else {
        pendingArt.delete(key);
        log(`art failed for ${key}, keeping rect fallback`);
      }
    });
  };
  attempt(url, false);
}

// --- camera capture ----------------------------------------------------------
// "Hold an object up to the camera": upload or capture -> pending capture ->
// send {kind:"photoFind"} -> server segment box drawn as green box ->
// Bring cuts locally (SAM box or click box) -> photoBring/photoBringLocal.
// Upload is the default path and the dialog never touches a camera on its own
// (bead jd1): only the "Use camera" button may call getUserMedia. Geometry lives in
// ./camera-dialog, which the stylesheet and the tests share.
const cameraBtn = $<HTMLButtonElement>("#camera-btn");
const cameraModal = $<HTMLDivElement>("#camera-modal");
const cameraStage = $<HTMLDivElement>("#camera-stage");
const cameraVideo = $<HTMLVideoElement>("#camera-video");
const cameraPlaceholder = $<HTMLParagraphElement>("#camera-placeholder");
const cameraLabel = $<HTMLInputElement>("#camera-label");
const cameraPaper = document.querySelector<HTMLInputElement>("#camera-paper");
const cameraPixel = document.querySelector<HTMLInputElement>("#camera-pixel");
const cameraPreview = $<HTMLCanvasElement>("#camera-preview");
const cameraBg = $<HTMLButtonElement>("#camera-bg");
const cameraPreviewWrap = $<HTMLDivElement>("#camera-preview-wrap");
const cameraBoxEl = $("#camera-box");
const cameraDot = $("#camera-dot");
const cameraStatus = $("#camera-status");
const cameraFind = $<HTMLButtonElement>("#camera-find");
const cameraConfirm = $<HTMLButtonElement>("#camera-confirm");
const cameraStart = $<HTMLButtonElement>("#camera-start");
const cameraCapture = $<HTMLButtonElement>("#camera-capture");
const cameraUploadBtn = $<HTMLButtonElement>("#camera-upload-btn");
const cameraUpload = $<HTMLInputElement>("#camera-upload");
let cameraStream: MediaStream | null = null;
let cameraPhase: DialogPhase = "idle";
let pendingCapture: { canvas: HTMLCanvasElement; dataUrl: string } | null = null;
let currentKey: string | null = null;
let foundBox: SegmentBox | null = null;
let clickPoint: { fx: number; fy: number } | null = null;
let bgCanvas: HTMLCanvasElement | null = null;
type MaskInfo = { mask: Uint8Array; w: number; h: number; count: number };
let diffComponents: MaskInfo[] = [];
let selectedComponent = -1;
let wandMask: MaskInfo | null = null;
let lastWandPoint: { fx: number; fy: number } | null = null;
const wandSensEl = document.querySelector<HTMLInputElement>("#wand-sens");

cameraUploadBtn.textContent = UPLOAD_LABEL;
cameraStart.textContent = CAMERA_LABEL;
cameraCapture.textContent = CAPTURE_LABEL;

/** Apply the dialog's geometry to the CSS custom properties the stylesheet reads. */
function syncCameraLayout(): void {
  for (const [name, value] of Object.entries(dialogCssVars(dialogLayout({ w: innerWidth, h: innerHeight }, cameraPhase)))) {
    cameraModal.style.setProperty(name, value);
  }
}
/** Show the still at the largest size the reserved stage allows, exactly, so the green box lines up with the pointer. */
function syncCameraPreviewSize(): void {
  if (pendingCapture === null) return;
  const box = cameraStage.getBoundingClientRect();
  const fit = fitInside({ w: cameraPreview.width, h: cameraPreview.height }, { w: box.width - 2, h: box.height - 2 });
  cameraPreview.style.width = `${fit.w}px`;
  cameraPreview.style.height = `${fit.h}px`;
}
function setCameraPhase(phase: DialogPhase, note?: string): void {
  cameraPhase = phase;
  cameraModal.dataset.phase = phase;
  cameraVideo.hidden = phase !== "stream";
  cameraPreviewWrap.hidden = phase !== "preview";
  cameraPlaceholder.hidden = phase !== "idle";
  cameraPlaceholder.textContent = note ?? stageHint(phase, cameraStream !== null);
  // Upload stays reachable in every phase: a wrong photo must not cost a cancel and a re-pick.
  cameraStart.hidden = phase !== "idle" || !navigator.mediaDevices?.getUserMedia;
  cameraCapture.hidden = cameraStream === null;
  cameraFind.hidden = phase !== "preview";
  cameraBg.hidden = phase !== "preview";
  // One obvious next step per phase, highlighted (the same answer the model gives the tests).
  const next = defaultAction(phase);
  cameraUploadBtn.classList.toggle("primary", next === "upload");
  cameraCapture.classList.toggle("primary", next === "capture");
  cameraConfirm.classList.toggle("primary", next === "confirm");
  syncCameraLayout();
  syncCameraPreviewSize();
}
function setCameraStatus(text: string): void {
  cameraStatus.textContent = text;
}
// The find-the-object line is the one the panel got wrong (bead q4u): "Couldn't find it" outlived
// the photo that produced it and survived a close. ./camera-finder owns which line is true now;
// these two functions are the only way the finder writes to the strip.
let finder: FinderState = FINDER_IDLE;
function cameraFinder(ev: FinderEvent): void {
  finder = finderNext(finder, ev);
  const line = finderLine(finder);
  if (line !== null) setCameraStatus(line);
}
/** True when there is no builder to ask, so the panel has to say the AI is offline. */
function builderOffline(): boolean {
  return ws?.readyState !== WebSocket.OPEN;
}
function updateCameraConfirm(): void {
  if (cameraPaper?.checked) {
    cameraConfirm.textContent = "Build this level";
    cameraConfirm.disabled = !pendingCapture;
    return;
  }
  cameraConfirm.textContent = "Bring it into the game";
  cameraConfirm.disabled = !(
    (diffComponents.length > 0 && selectedComponent >= 0) ||
    (wandMask !== null && wandMask.count >= 300) ||
    foundBox !== null || clickPoint !== null
  );
}
function clearDetection(): void {
  foundBox = null;
  clickPoint = null;
  diffComponents = [];
  selectedComponent = -1;
  wandMask = null;
  lastWandPoint = null;
  cameraBoxEl.hidden = true;
  cameraDot.hidden = true;
  updateCameraConfirm();
}
function redrawPreview(): void {
  if (!pendingCapture) return;
  const src = pendingCapture.canvas;
  if (cameraPreview.width !== src.width) cameraPreview.width = src.width;
  if (cameraPreview.height !== src.height) cameraPreview.height = src.height;
  const ctx = cameraPreview.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, cameraPreview.width, cameraPreview.height);
  ctx.drawImage(src, 0, 0);
  const drawTint = (m: MaskInfo, alpha: number): void => {
    const tmp = document.createElement("canvas");
    tmp.width = m.w; tmp.height = m.h;
    const tctx = tmp.getContext("2d");
    if (!tctx) return;
    const img = tctx.createImageData(m.w, m.h);
    for (let p = 0; p < m.w * m.h; p++) {
      if (!m.mask[p]) continue;
      img.data[p * 4] = 63; img.data[p * 4 + 1] = 208; img.data[p * 4 + 2] = 106;
      img.data[p * 4 + 3] = Math.round(alpha * 255);
    }
    tctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, cameraPreview.width, cameraPreview.height);
    ctx.restore();
  };
  if (diffComponents.length > 0) {
    for (let i = 0; i < diffComponents.length; i++) drawTint(diffComponents[i], i === selectedComponent ? 0.65 : 0.45);
  } else if (wandMask) {
    drawTint(wandMask, 0.45);
  }
  syncCameraPreviewSize();
}
function workImage(src: HTMLCanvasElement, workW: number): { w: number; h: number; data: Uint8ClampedArray } | null {
  const w = Math.min(workW, src.width);
  const h = Math.max(1, Math.round(src.height * (w / src.width)));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, w, h);
  return { w, h, data: ctx.getImageData(0, 0, w, h).data };
}
function computeDiff(): void {
  if (!pendingCapture || !bgCanvas) return;
  const src = pendingCapture.canvas;
  if (bgCanvas.width !== src.width || bgCanvas.height !== src.height) {
    setCameraStatus("Background is a different size — capture the empty background again.");
    return;
  }
  const a = workImage(src, 384);
  const b = workImage(bgCanvas, 384);
  if (!a || !b || a.w !== b.w || a.h !== b.h) return;
  const { w, h } = a;
  const total = w * h;
  const changed = new Uint8Array(total);
  for (let p = 0; p < total; p++) {
    const o = p * 4;
    const d = Math.max(Math.abs(a.data[o] - b.data[o]), Math.abs(a.data[o + 1] - b.data[o + 1]), Math.abs(a.data[o + 2] - b.data[o + 2]));
    if (d > 40) changed[p] = 1;
  }
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const comps: MaskInfo[] = [];
  const minSize = Math.ceil(total * 0.0015);
  for (let s = 0; s < total; s++) {
    if (!changed[s] || visited[s]) continue;
    let qh = 0, qt = 0;
    queue[qt++] = s; visited[s] = 1;
    const pixels: number[] = [];
    while (qh < qt) {
      const p = queue[qh++];
      pixels.push(p);
      const x = p % w; const y = (p - x) / w;
      if (x > 0 && changed[p - 1] && !visited[p - 1]) { visited[p - 1] = 1; queue[qt++] = p - 1; }
      if (x < w - 1 && changed[p + 1] && !visited[p + 1]) { visited[p + 1] = 1; queue[qt++] = p + 1; }
      if (y > 0 && changed[p - w] && !visited[p - w]) { visited[p - w] = 1; queue[qt++] = p - w; }
      if (y < h - 1 && changed[p + w] && !visited[p + w]) { visited[p + w] = 1; queue[qt++] = p + w; }
    }
    if (pixels.length >= minSize) {
      const mask = new Uint8Array(total);
      for (const p of pixels) mask[p] = 1;
      comps.push({ mask, w, h, count: pixels.length });
    }
  }
  comps.sort((x, y) => y.count - x.count);
  diffComponents = comps.slice(0, 6);
  selectedComponent = diffComponents.length > 0 ? 0 : -1;
  redrawPreview();
  if (cameraPaper?.checked) {
    setCameraStatus("Drawing photo ready! Click 'Build this level' to make it playable.");
    updateCameraConfirm();
    return;
  }
  updateCameraConfirm();
  if (diffComponents.length > 0) {
    // The person already has a cut to click: that line outranks anything the finder waits for.
    cameraFinder({ kind: "covered" });
    setCameraStatus(`Found ${diffComponents.length} new thing(s). Click yours if I picked wrong, then Bring it in.`);
  }
}
function computeWand(fx: number, fy: number): void {
  if (!pendingCapture) return;
  lastWandPoint = { fx, fy };
  const sens = Math.min(60, Math.max(18, Number(wandSensEl?.value ?? 40) || 40));
  const src = pendingCapture.canvas;
  let workW = src.width;
  if (src.width * src.height > 1_500_000) workW = 384;
  const img = workImage(src, workW);
  if (!img) return;
  const { w, h, data } = img;
  const total = w * h;
  const sx = Math.min(w - 1, Math.max(0, Math.floor(fx * w)));
  const sy = Math.min(h - 1, Math.max(0, Math.floor(fy * h)));
  const seed = sy * w + sx;
  const so = seed * 4;
  const sr = data[so], sg = data[so + 1], sb = data[so + 2];
  const mask = new Uint8Array(total);
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let qh = 0, qt = 0, count = 0;
  const cap = Math.floor(total * 0.6);
  queue[qt++] = seed; visited[seed] = 1; mask[seed] = 1; count = 1;
  const distTo = (o: number, r: number, g: number, b: number): number => Math.max(Math.abs(data[o] - r), Math.abs(data[o + 1] - g), Math.abs(data[o + 2] - b));
  while (qh < qt && count < cap) {
    const p = queue[qh++];
    const po = p * 4;
    const pr = data[po], pg = data[po + 1], pb = data[po + 2];
    const x = p % w; const y = (p - x) / w;
    const neighbors = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
    for (const n of neighbors) {
      if (n < 0 || visited[n]) continue;
      visited[n] = 1;
      const o = n * 4;
      const dSeed = distTo(o, sr, sg, sb);
      const dNeighbor = distTo(o, pr, pg, pb);
      if (dSeed < sens && (dNeighbor < 10 || dSeed < 22)) {
        mask[n] = 1; count++;
        queue[qt++] = n;
        if (count >= cap) break;
      }
    }
  }
  // Erode by one pixel (4-neighbor) before tinting/using.
  const eroded = new Uint8Array(total);
  let erodedCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!mask[p]) continue;
      if (x <= 0 || x >= w - 1 || y <= 0 || y >= h - 1) continue;
      if (mask[p - 1] && mask[p + 1] && mask[p - w] && mask[p + w]) { eroded[p] = 1; erodedCount++; }
    }
  }
  wandMask = { mask: eroded, w, h, count: erodedCount };
  count = erodedCount;
  redrawPreview();
  const tip = cameraStream && !bgCanvas ? " Tip: 'Empty background' first gives the cleanest cut." : "";
  if (count < 300) {
    setCameraStatus("That highlighted almost nothing — try the background method: capture the empty scene first." + tip);
  } else {
    // A usable highlight of their own: keep its line even if a late SAM answer arrives.
    cameraFinder({ kind: "covered" });
    setCameraStatus("Highlighted your object — Bring it in, or click again to retry." + tip);
  }
  updateCameraConfirm();
}
function currentPrompt(): string {
  return cameraLabel.value.trim() || "object";
}
function sendPhotoFind(): void {
  if (!currentKey || !pendingCapture) return;
  send({ kind: "photoFind", key: currentKey, image: pendingCapture.dataUrl, prompt: currentPrompt() } as unknown as ClientMsg);
}

type SegmentBox = { x: number; y: number; w: number; h: number };

function normalizeBox(raw: unknown): SegmentBox | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const num = (...vals: unknown[]): number | null => {
    for (const v of vals) if (typeof v === "number" && Number.isFinite(v)) return v;
    return null;
  };
  if (Array.isArray(raw) && raw.length >= 4) {
    const [x, y, w, h] = raw as unknown[];
    if ([x, y, w, h].every((v) => typeof v === "number")) return { x: x as number, y: y as number, w: w as number, h: h as number };
  }
  const x = num(b.x, b.left, b.x0, b.minX);
  const y = num(b.y, b.top, b.y0, b.minY);
  let w = num(b.w, b.width);
  let h = num(b.h, b.height);
  if (w === null || h === null) {
    const x1 = num(b.x1, b.right, b.maxX);
    const y1 = num(b.y1, b.bottom, b.maxY);
    if (x !== null && x1 !== null) w = x1 - x;
    if (y !== null && y1 !== null) h = y1 - y;
  }
  if (x === null || y === null || w === null || h === null) return null;
  return { x, y, w, h };
}

function stopCamera(): void {
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop();
    cameraStream = null;
  }
  cameraVideo.srcObject = null;
}
function closeCameraModal(clearBg = true): void {
  stopCamera();
  cameraModal.hidden = true;
  if (clearBg) bgCanvas = null;
  // The line goes with the panel: reopening starts blank instead of showing the last photo's answer.
  cameraFinder({ kind: "close" });
}
function pixelateCut(cut: HTMLCanvasElement): { canvas: HTMLCanvasElement; pixelInfo: string } {
  const pixelOn = (cameraPixel?.checked ?? (document.querySelector("#camera-pixel") as HTMLInputElement | null)?.checked) !== false;
  if (!pixelOn) return { canvas: cut, pixelInfo: "pixel: off" };
  const GH = 56;
  const GW = Math.max(8, Math.round(cut.width * GH / cut.height));
  const small = document.createElement("canvas");
  small.width = GW; small.height = GH;
  const sctx = small.getContext("2d", { willReadFrequently: true });
  if (!sctx) return { canvas: cut, pixelInfo: "pixel: off" };
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(cut, 0, 0, GW, GH);
  const simg = sctx.getImageData(0, 0, GW, GH);
  const spx = simg.data;
  for (let i = 0; i < spx.length; i += 4) {
    if (spx[i + 3] < 128) spx[i + 3] = 0;
    else {
      spx[i + 3] = 255;
      spx[i] = Math.min(255, Math.round(spx[i] / 36) * 36);
      spx[i + 1] = Math.min(255, Math.round(spx[i + 1] / 36) * 36);
      spx[i + 2] = Math.min(255, Math.round(spx[i + 2] / 36) * 36);
    }
  }
  const alpha = new Uint8Array(GW * GH);
  for (let p = 0; p < GW * GH; p++) alpha[p] = spx[p * 4 + 3];
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const p = y * GW + x;
    if (alpha[p] === 0) continue;
    const up = y > 0 ? alpha[p - GW] : 0, down = y < GH - 1 ? alpha[p + GW] : 0, left = x > 0 ? alpha[p - 1] : 0, right = x < GW - 1 ? alpha[p + 1] : 0;
    if (up === 0 && down === 0 && left === 0 && right === 0) spx[p * 4 + 3] = 0;
  }
  sctx.putImageData(simg, 0, 0);
  return { canvas: small, pixelInfo: `pixel: on ${GW}x${GH}` };
}
function storeCutTexture(key: string, cut: HTMLCanvasElement, texCanvas: HTMLCanvasElement): void {
  const tex = Texture.from(texCanvas);
  if (texCanvas !== cut) { try { (tex.source as unknown as { scaleMode: string }).scaleMode = "nearest"; } catch { /* ignore */ } }
  framesBySubject[key] = [tex];
  pendingArt.delete(key);
  pendingPhotos.delete(key);
  log(`photo object in game: ${key}`);
}
function maskCutTexture(key: string, src: HTMLCanvasElement, m: MaskInfo, mode: "diff" | "wand"): HTMLCanvasElement | null {
  let minX = m.w, minY = m.h, maxX = -1, maxY = -1;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.mask[y * m.w + x]) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (maxX < minX || maxY < minY) return null;
  const scaleX = src.width / m.w, scaleY = src.height / m.h;
  const x0 = Math.max(0, Math.floor(minX * scaleX)), y0 = Math.max(0, Math.floor(minY * scaleY));
  const x1 = Math.min(src.width, Math.ceil((maxX + 1) * scaleX)), y1 = Math.min(src.height, Math.ceil((maxY + 1) * scaleY));
  const cw = x1 - x0, ch = y1 - y0;
  if (cw <= 0 || ch <= 0) return null;
  const cut = document.createElement("canvas");
  cut.width = cw; cut.height = ch;
  const cctx = cut.getContext("2d", { willReadFrequently: true });
  if (!cctx) return null;
  cctx.drawImage(src, x0, y0, cw, ch, 0, 0, cw, ch);
  const img = cctx.getImageData(0, 0, cw, ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const wx = Math.min(m.w - 1, Math.floor((x0 + x) * m.w / src.width));
    const wy = Math.min(m.h - 1, Math.floor((y0 + y) * m.h / src.height));
    if (!m.mask[wy * m.w + wx]) img.data[(y * cw + x) * 4 + 3] = 0;
  }
  cctx.putImageData(img, 0, 0);
  const { canvas: texCanvas, pixelInfo } = pixelateCut(cut);
  console.info(`[photo] key=${key} mode=${mode} component pixels=${m.count} mask=${m.w}x${m.h} src=${src.width}x${src.height} crop=${cw}x${ch} cut=${cut.width}x${cut.height} ${pixelInfo}`);
  storeCutTexture(key, cut, texCanvas);
  return texCanvas;
}
async function openCameraModal(paperMode = false): Promise<void> {
  if (cameraPaper) cameraPaper.checked = paperMode;
  cameraLabel.placeholder = paperMode ? "Level name (optional, e.g. Sky Castle)" : "What are you holding? e.g. coffee mug";
  pendingCapture = null;
  currentKey = null;
  bgCanvas = null;
  clearDetection();
  cameraFinder({ kind: "open" });
  cameraLabel.value = "";
  cameraPreview.width = 1; cameraPreview.height = 1;
  cameraPreview.getContext("2d")?.clearRect(0, 0, 1, 1);
  cameraConfirm.disabled = true;
  cameraModal.hidden = false;
  // Upload first (bead jd1): opening the dialog never asks for a camera, so the beat is
  // testable on a machine with none. "Use camera" is the only door to getUserMedia.
  setCameraPhase("idle");
  cameraLabel.focus();
}

/** The camera path, and only the camera path: pressed by the person, never on open. */
async function startCamera(): Promise<void> {
  setCameraStatus("Turning the camera on…");
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera API");
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
    cameraVideo.muted = true;
    cameraVideo.srcObject = cameraStream;
    setCameraPhase("stream");
    setCameraStatus("");
  } catch {
    stopCamera();
    setCameraPhase("idle", "No camera on this machine — upload a photo instead.");
    setCameraStatus("");
  }
}

function setPendingCapture(source: CanvasImageSource, sw: number, sh: number): void {
  if (sw <= 0 || sh <= 0) return;
  // A paper drawing is read as pencil lines, so it keeps more detail than a prop photo: its
  // own 1024 px budget (bead 9ch, ADR 0054) instead of the 768 px the cut-out path uses.
  const { w, h } = cameraPaper?.checked ? paperImageSize({ w: sw, h: sh }) : photoWorkSize({ w: sw, h: sh });
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  if (currentKey !== null && pendingPhotos.has(currentKey)) pendingPhotos.delete(currentKey);
  currentKey = `photo-${++photoSeq}`;
  pendingPhotos.set(currentKey, canvas);
  pendingCapture = { canvas, dataUrl };
  clearDetection();
  cameraConfirm.disabled = true;
  setCameraPhase("preview");
  redrawPreview();
  // A level drawing is read whole by Wonder (ADR 0040): no SAM cut-out, so no SAM call and no box.
  if (cameraPaper?.checked) {
    cameraConfirm.disabled = false;
    setCameraStatus("Drawing photo ready! Click 'Build this level' to make it playable.");
    return;
  }
  // A fresh look starts here, so any earlier "Couldn't find it" goes with the old photo.
  cameraFinder({ kind: "attempt", offline: builderOffline() });
  if (bgCanvas) computeDiff();
  send(photoFindMessage(currentKey, dataUrl, currentPrompt()));
}
function cutoutTexture(key: string, src: HTMLCanvasElement, box: SegmentBox): HTMLCanvasElement | null {
  // Map the 1600-space box to canvas pixels, pad 5%, clamp to canvas.
  const sx = src.width / 1600;
  const sy = src.height / 1600;
  const bw = box.w * sx;
  const bh = box.h * sy;
  const x0 = Math.max(0, Math.floor(box.x * sx - bw * 0.05));
  const y0 = Math.max(0, Math.floor(box.y * sy - bh * 0.05));
  const x1 = Math.min(src.width, Math.ceil(box.x * sx + bw + bw * 0.05));
  const y1 = Math.min(src.height, Math.ceil(box.y * sy + bh + bh * 0.05));
  const cw = x1 - x0;
  const ch = y1 - y0;
  if (cw <= 0 || ch <= 0) return null;
  const crop = document.createElement("canvas");
  crop.width = cw;
  crop.height = ch;
  const cctx = crop.getContext("2d", { willReadFrequently: true });
  if (!cctx) return null;
  cctx.drawImage(src, x0, y0, cw, ch, 0, 0, cw, ch);
  const img = cctx.getImageData(0, 0, cw, ch);
  const px = img.data;
  // Background colour = average of the 4 crop corners.
  const corners = [0, (cw - 1) * 4, (ch - 1) * cw * 4, ((ch - 1) * cw + cw - 1) * 4];
  let br = 0, bg = 0, bb = 0;
  for (const o of corners) { br += px[o]; bg += px[o + 1]; bb += px[o + 2]; }
  br /= 4; bg /= 4; bb /= 4;
  const dist = (i: number): number => Math.max(Math.abs(px[i] - br), Math.abs(px[i + 1] - bg), Math.abs(px[i + 2] - bb));
  // Border-seeded flood fill: a pixel joins the background when its
  // per-channel distance to the background colour is < 48.
  const visited = new Uint8Array(cw * ch);
  const queue = new Int32Array(cw * ch);
  let qh = 0, qt = 0;
  const push = (p: number): void => {
    if (visited[p]) return;
    visited[p] = 1;
    if (dist(p * 4) < 48) queue[qt++] = p;
  };
  for (let x = 0; x < cw; x++) { push(x); push((ch - 1) * cw + x); }
  for (let y = 0; y < ch; y++) { push(y * cw); push(y * cw + cw - 1); }
  while (qh < qt) {
    const p = queue[qh++];
    px[p * 4 + 3] = 0;
    const x = p % cw;
    const y = (p - x) / cw;
    if (x > 0) push(p - 1);
    if (x < cw - 1) push(p + 1);
    if (y > 0) push(p - cw);
    if (y < ch - 1) push(p + cw);
  }
  cctx.putImageData(img, 0, 0);
  // Trim fully-transparent borders.
  let minX = cw, minY = ch, maxX = -1, maxY = -1;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (px[(y * cw + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  const cut = document.createElement("canvas");
  cut.width = maxX - minX + 1;
  cut.height = maxY - minY + 1;
  cut.getContext("2d")!.drawImage(crop, minX, minY, cut.width, cut.height, 0, 0, cut.width, cut.height);
  const { canvas: texCanvas, pixelInfo } = pixelateCut(cut);
  console.info(`[photo] key=${key} box=${JSON.stringify(box)} src=${src.width}x${src.height} crop=${cw}x${ch} cut=${cut.width}x${cut.height} ${pixelInfo}`);
  storeCutTexture(key, cut, texCanvas);
  return texCanvas;
}
function handleSegment(key: string, rawBox: unknown): void {
  if (key !== currentKey || cameraModal.hidden) return;
  const box = rawBox === null ? null : normalizeBox(rawBox);
  if (box === null) {
    foundBox = null;
    cameraBoxEl.hidden = true;
    cameraFinder({ kind: "missed" });
    updateCameraConfirm();
    return;
  }
  foundBox = box;
  cameraBoxEl.style.left = `${box.x / 16}%`;
  cameraBoxEl.style.top = `${box.y / 16}%`;
  cameraBoxEl.style.width = `${box.w / 16}%`;
  cameraBoxEl.style.height = `${box.h / 16}%`;
  cameraBoxEl.hidden = false;
  cameraFinder({ kind: "found" });
  updateCameraConfirm();
}
cameraPaper?.addEventListener("change", () => {
  if (cameraPaper.checked) {
    cameraLabel.placeholder = "Level name (optional, e.g. Sky Castle)";
    // A drawing is read whole (ADR 0040): there is no finder answer to wait for on this photo.
    cameraFinder({ kind: "covered" });
    if (pendingCapture) { cameraConfirm.disabled = false; setCameraStatus("Drawing photo ready! Click 'Build this level' to make it playable."); }
    else setCameraStatus("Level drawing mode: upload or capture your paper drawing.");
  } else {
    cameraLabel.placeholder = "What are you holding? e.g. coffee mug";
    setCameraStatus("");
  }
  updateCameraConfirm();
});
cameraBtn.addEventListener("click", () => { void openCameraModal(); });
cameraStart.addEventListener("click", () => { if (wantsCameraStream("use-camera")) void startCamera(); }); // the only door to getUserMedia (bead jd1)
$("#camera-cancel").addEventListener("click", () => closeCameraModal());
cameraModal.addEventListener("click", (e) => { if (e.target === cameraModal) closeCameraModal(); });
addEventListener("resize", () => {
  if (cameraModal.hidden) return;
  syncCameraLayout();
  syncCameraPreviewSize();
});
$("#camera-capture").addEventListener("click", () => {
  if (cameraVideo.videoWidth > 0) setPendingCapture(cameraVideo, cameraVideo.videoWidth, cameraVideo.videoHeight);
});
$("#camera-upload-btn").addEventListener("click", () => cameraUpload.click());
cameraUpload.addEventListener("change", () => {
  const file = cameraUpload.files?.[0];
  cameraUpload.value = "";
  if (!file) return;
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    setPendingCapture(image, image.naturalWidth, image.naturalHeight);
    URL.revokeObjectURL(url);
  };
  image.onerror = () => URL.revokeObjectURL(url);
  image.src = url;
});
cameraFind.addEventListener("click", () => {
  if (!currentKey || !pendingCapture) return;
  cameraFinder({ kind: "attempt", offline: builderOffline() });
  sendPhotoFind();
});
cameraBg.addEventListener("click", () => {
  if (!pendingCapture) return;
  const clone = document.createElement("canvas");
  clone.width = pendingCapture.canvas.width; clone.height = pendingCapture.canvas.height;
  clone.getContext("2d")?.drawImage(pendingCapture.canvas, 0, 0);
  bgCanvas = clone;
  diffComponents = []; selectedComponent = -1; wandMask = null;
  foundBox = null; clickPoint = null; cameraBoxEl.hidden = true; cameraDot.hidden = true;
  redrawPreview();
  updateCameraConfirm();
  // Clear the masks and let this hint own the strip; a late answer about the old photo stays out.
  cameraFinder({ kind: "covered" });
  setCameraStatus(cameraStream ? "Background remembered. Hold the object up and press Capture again." : "Background remembered — pick the photo with the object in it.");
});
wandSensEl?.addEventListener("input", () => {
  if (wandMask && lastWandPoint) computeWand(lastWandPoint.fx, lastWandPoint.fy);
});
cameraPreview.addEventListener("click", (e) => {
  if (!pendingCapture) return;
  const rect = cameraPreview.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  const fy = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
  if (diffComponents.length > 0) {
    const m = diffComponents[0];
    const wx = Math.min(m.w - 1, Math.max(0, Math.floor(fx * m.w)));
    const wy = Math.min(m.h - 1, Math.max(0, Math.floor(fy * m.h)));
    const idx = diffComponents.findIndex((c) => c.mask[wy * c.w + wx] === 1);
    if (idx >= 0) {
      selectedComponent = idx;
      redrawPreview();
      updateCameraConfirm();
    }
    return;
  }
  computeWand(fx, fy);
});
cameraConfirm.addEventListener("click", () => {
  if (cameraPaper?.checked) {
    if (!pendingCapture) return;
    // A compact JPEG, not the raw photo (bead 9ch, ADR 0054): the drawing still travels at up
    // to 1024 px so Wonder can read it, but at tens of KB instead of megabytes of base64.
    const image = compactPaperImage(pendingCapture.canvas);
    if (!image) {
      setCameraStatus("That photo didn't come through — try taking it again.");
      return;
    }
    console.info(`[paper] image ${pendingCapture.canvas.width}x${pendingCapture.canvas.height} jpeg = ${Math.round(image.length / 1024)} KB`);
    send(paperLevelMessage(image, cameraLabel.value));
    closeCameraModal(false);
    say("Reading your paper level drawing...", "building");
    return;
  }
  if (!pendingCapture || !currentKey) return;
  const hasMask = (diffComponents.length > 0 && selectedComponent >= 0) || (wandMask !== null && wandMask.count >= 300);
  if (!hasMask && foundBox === null && clickPoint === null) return;
  const key = currentKey;
  const canvas = pendingPhotos.get(key) ?? pendingCapture.canvas;
  if (diffComponents.length > 0 && selectedComponent >= 0) {
    const cut = maskCutTexture(key, canvas, diffComponents[selectedComponent], "diff");
    if (!cut) { setCameraStatus("That spot cut out empty — try clicking the middle of the object."); return; }
    pendingArt.add(key);
    send({ kind: "photoBringLocal", key, prompt: currentPrompt(), aspect: cut.width / cut.height } as unknown as ClientMsg);
    closeCameraModal(false);
    return;
  }
  if (wandMask !== null && wandMask.count >= 300) {
    const cut = maskCutTexture(key, canvas, wandMask, "wand");
    if (!cut) { setCameraStatus("That spot cut out empty — try clicking the middle of the object."); return; }
    pendingArt.add(key);
    send({ kind: "photoBringLocal", key, prompt: currentPrompt(), aspect: cut.width / cut.height } as unknown as ClientMsg);
    closeCameraModal(false);
    return;
  }
  if (clickPoint !== null) {
    const side = 0.55 * Math.min(canvas.width, canvas.height);
    const cx = clickPoint.fx * canvas.width;
    const cy = clickPoint.fy * canvas.height;
    const clickBox: SegmentBox = {
      x: (cx - side / 2) * (1600 / canvas.width),
      y: (cy - side / 2) * (1600 / canvas.height),
      w: side * (1600 / canvas.width),
      h: side * (1600 / canvas.height),
    };
    const cut = cutoutTexture(key, canvas, clickBox);
    if (!cut) {
      setCameraStatus("That spot cut out empty — try clicking the middle of the object.");
      return;
    }
    pendingArt.add(key);
    send({ kind: "photoBringLocal", key, prompt: currentPrompt(), aspect: cut.width / cut.height } as unknown as ClientMsg);
    closeCameraModal(false);
    return;
  }
  const cut = cutoutTexture(key, canvas, foundBox!);
  if (!cut) {
    setCameraStatus("That spot cut out empty — try clicking the middle of the object.");
    return;
  }
  pendingArt.add(key);
  send({ kind: "photoBring", key } as unknown as ClientMsg);
  closeCameraModal(false);
});
// --- worlds, share links, visitor mode (ADR 0014, 0037) ----------------------
// The `w` id is already validated by the URL decoder: only a current-format id gets this far.
const worldParam = urlFlags.worldId;
let worldRequested = false;
let worldFallbackTimer = 0;

/** A link we could not open: say so in plain words, drop it from the URL, and load the starter instead. */
function openStarterAfterBadLink(issue: ShareIssue): void {
  log(`share link not opened: ${issue}`);
  try { history.replaceState(null, "", `${location.pathname}${urlWithoutWorld(location.search)}`); } catch { /* the starter still loads */ }
  // The starter's own "materialized" lines come first, so the last word on screen is the explanation.
  autoLoadStarterOnce();
  pendingNotice = shareIssueMessage(issue);
  say(pendingNotice);
}

// The server greets every connection with a `say`, which would bury the line a bad share link just
// showed (it arrives milliseconds after load). Keep it and show it once more in place of that
// greeting, until the visitor does something of their own (ADR 0037).
let pendingNotice: string | null = null;

async function importMod(compiled: string): Promise<ModDefinition> {
  const url = URL.createObjectURL(new Blob([compiled], { type: "text/javascript" }));
  try { return ((await import(/* @vite-ignore */ url)) as { default: ModDefinition }).default; }
  finally { URL.revokeObjectURL(url); }
}

/** Replace the running world with a saved one: built-ins from the bundle, AI mods from their verified compiled source. */
async function applyWorld(msg: Extract<ServerMsg, { kind: "world" }>): Promise<void> {
  restoreSheets();
  // A whole new world supersedes any step this client guessed locally (bug bv4); the server's own
  // timeline frame (a restore) or a fresh session (a link) is the truth from here.
  timelineView.clearLocal();
  applyMood(msg.mood ?? null);
  for (const m of loader.list()) loader.unload(m.id);
  let loaded = 0;
  for (const m of msg.mods) {
    try {
      if (m.builtin) {
        const def = BUILTINS[m.id];
        if (!def) continue;
        loader.load(def, m.values);
      } else {
        registerLook(m.look);
        loader.load(await importMod(m.compiled), m.values);
        for (const sheet of sheetsOf(m)) { pendingArt.add(sheet.key); loadArtWithRetry(sheet.key, sheet.url, sheet.scenery === true); }
        if (m.skinArt) { pendingArt.add(m.skinArt.key); loadArtWithRetry(m.skinArt.key, m.skinArt.url, false); }
      }
      loaded++;
    } catch { /* one bad mod must not stop the rest of the world loading */ }
  }
  moodModCount = mood ? loader.list().length : 0;
  if (msg.mood && msg.restyled) {
    for (const [key, url] of Object.entries(msg.restyled)) {
      void loadSpriteSheet(url).then((frames) => {
        if (frames.length < 1 || !mood || mood.name !== msg.mood?.name) return;
        if (!origFrames.has(key)) origFrames.set(key, framesBySubject[key] ?? []);
        framesBySubject[key] = frames;
      }).catch(() => {});
    }
  }
  renderMods();
  if (!msg.id) { say(`Restored a world of ${loaded} mods. The steps before it are still on the timeline.`, "done"); return; } // timeline restore (ADR 0041)
  history.replaceState(null, "", `?w=${msg.id}`);
  say(`Opened a world with ${loaded} mods. Keep building to remix it.`, "done");
}

function showDemos(demos: { id: string; title: string; blurb: string }[]): void {
  const box = $("#demo-worlds");
  box.replaceChildren();
  if (demos.length === 0) { box.hidden = true; return; }
  const h = document.createElement("h2");
  h.textContent = "Demo worlds";
  box.append(h);
  for (const d of demos) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = d.title;
    b.title = d.blurb;
    b.addEventListener("click", () => send({ kind: "worldLoad", id: d.id }));
    box.append(b);
  }
  box.hidden = false;
}

$("#share-btn").addEventListener("click", () => {
  if (ws?.readyState !== WebSocket.OPEN) { say("Sharing needs the server — start it with: npm run server", "failed"); return; }
  send({ kind: "worldSave", mods: loader.list().map((m) => ({ id: m.id, values: m.values })) });
});

$("#export-btn")?.addEventListener("click", () => {
  if (ws?.readyState !== WebSocket.OPEN) { say("Exporting needs the server — start it with: npm run server", "failed"); return; }
  say("Preparing single-file game export…", "building");
  send({ kind: "worldExport", mods: loader.list().map((m) => ({ id: m.id, values: m.values })) });
});

function shareUrl(id: string): string {
  return `${location.origin}${location.pathname}?w=${id}`;
}

// Anonymous family-test metrics, only with ?tester=N (ADR 0034).
const tester = createTester(new URLSearchParams(location.search), (m) => { if (ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(m)); return true; } return false; });
let inputVia: "typed" | "voice" = "typed";
addEventListener("pagehide", () => tester.close());
const voice = initVoice({
  bar: $("#orb-bar"), feedback: orbFeedback,
  isOpen: () => ws?.readyState === WebSocket.OPEN,
  sendJson: send, sendBinary: (b) => ws?.send(b),
  say, submit: (text) => { inputVia = "voice"; try { submitCommand(text); } finally { inputVia = "typed"; } }, log,
});

function connect(): void {
  try { ws = new WebSocket(WS_URL); }
  catch { serverStatus.textContent = "Server: offline (local mods still work)"; return; }
  ws.addEventListener("open", async () => {
    // Connected is safe to report at once; the rest touches state declared further down
    // this file, so it waits for the module to finish evaluating (cold start, bead q2s).
    serverStatus.textContent = `Server: connected on ${WS_URL}`;
    await boot.ready;
    voice.onOpen(); tester.onOpen(); sendWorldState();
    if (worldParam && !worldRequested) {
      worldRequested = true;
      say("Opening the world from that link…");
      send({ kind: "worldLoad", id: worldParam });
      // A well-formed id that no longer exists only fails here: the server's worlds are files.
      worldFallbackTimer = window.setTimeout(() => {
        if (loader.list().length > 0) return;
        openStarterAfterBadLink("invalid");
      }, 8000);
    }
  });
  ws.addEventListener("close", () => {
    serverStatus.textContent = "Server: offline (local mods still work)";
    setTimeout(connect, 3000);
  });
  ws.addEventListener("message", async (ev) => {
    await boot.ready; // frames that arrive before the module finishes wait here, in order
    let msg: ServerMsg;
    try { msg = JSON.parse(String(ev.data)) as ServerMsg; } catch { return; }
    pipeline.onMsg(msg);
    brain.onMsg(msg);
    theater.onMsg(msg);
    sketch.onServerMsg(msg);
    if (voice.onServerMsg(msg)) return;
    if (msg.kind === "world") { clearTimeout(worldFallbackTimer); await applyWorld(msg); return; }
    if (msg.kind === "mood") { onMood(msg.mood); return; }
    if (msg.kind === "restyled") { await onRestyled(msg); return; }
    if (msg.kind === "visitor") { showDemos(msg.demos); return; }
    if (msg.kind === "worldSaved") {
      const url = shareUrl(msg.id);
      history.replaceState(null, "", `?w=${msg.id}`);
      navigator.clipboard?.writeText(url).catch(() => {});
      say(`Share link copied: ${url}`, "done");
      log(`shared world: ${url}`);
      return;
    }
    if (msg.kind === "worldExported") {
      const blob = new Blob([msg.html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = msg.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const kb = Math.round(msg.html.length / 1024);
      say(`Downloaded single-file game (${kb} KB). Playable offline anywhere!`, "done");
      log(`exported game (${kb} KB)`);
      return;
    }
    if (msg.kind === "say") {
      // A pending share-link notice outranks the server's generic greeting (ADR 0037).
      if (pendingNotice) { const notice = pendingNotice; pendingNotice = null; say(notice); }
      else say(msg.text);
    }
    else if (msg.kind === "stage") {
      // A non-coder never sees a raw rejection or error: rejected and failed builds are reworded (onboard.ts).
      const shown = msg.stage === "rejected" || msg.stage === "failed" ? plainBuildMessage(msg.stage, msg.detail) : msg.detail;
      log(`${msg.stage}: ${shown}`);
      onboarding.event(msg.stage === "done" ? "built" : "working");
      tester.stage(msg.stage, msg.command);
      const sx = buildSfx(msg.stage);
      if (sx) sound.play(sx);
      if (msg.command) builds.stage(msg.command, msg.stage, msg.detail);
      if (builds.active() > 1) sayWhileBuilding();
      else if (msg.stage === "rejected") { rejectedAt = performance.now(); say(shown, "failed"); }
      else if (msg.stage === "fixing") {
        // Keep the red "why" on screen long enough to read before the fix status replaces it.
        const wait = Math.max(0, 2200 - (performance.now() - rejectedAt));
        window.setTimeout(() => say("Fixing it: building a better version…", "building"), wait);
      } else say(shown, msg.stage === "failed" ? "failed" : "building");
      if (msg.stage === "done" || msg.stage === "failed") ghost.hideSoon();
    }
    else if (msg.kind === "playtest") {
      void ghost.play({ base: loader.list().map((m) => ({ def: m.def, values: m.values })), candidate: msg.mod, replaces: msg.replaces, seed: msg.seed, inputs: msg.inputs, ok: msg.ok, plain: msg.plain });
    }
    else if (msg.kind === "routed") { routedBy(msg); }
    else if (msg.kind === "timing") { builds.finish(msg.command); log(`timing route ${msg.ms.route}ms write ${msg.ms.write}ms compile ${msg.ms.compile}ms verify ${msg.ms.verify}ms total ${msg.ms.total}ms`); }
    else if (msg.kind === "tweak") tweak(msg.modId, msg.knob, msg.value, "Tweaked.");
    else if (msg.kind === "order") {
      // A standing order for creatures already in the world (ADR 0059): the engine steers them, no build.
      const n = loader.order(msg.modId, msg.order);
      say(n > 0 ? `${n === 1 ? "It" : `${n} of them`} heard you: ${msg.order}.` : "Nothing here can take orders yet. Add a creature first!", n > 0 ? "done" : undefined);
    }
    else if (msg.kind === "timeline") timelineView.update(msg.steps, msg.current);
    else if (msg.kind === "explainResult") explain.onMsg(msg);
    else if (msg.kind === "receiptResult") receipt.onMsg(msg);
    else if (msg.kind === "removed") { loader.unload(msg.modId); renderMods(); }
    else if (msg.kind === "mod") {
      try {
        await ghost.idle(); // let the playtest replay finish before the mod lands
        const blob = new Blob([msg.mod.compiled], { type: "text/javascript" });
        const url = URL.createObjectURL(blob);
        const loaded = (await import(/* @vite-ignore */ url)) as { default: ModDefinition };
        URL.revokeObjectURL(url);
        loader.load(loaded.default);
        registerLook(msg.mod.look);
        if (!sayWhileBuilding()) say(`${msg.mod.title} verified and live.`, "done");
        renderMods();
        // Every sheet still being drawn gets its placeholder (a build can add several subjects); `artPending` is the first, for older servers.
        // Empty frames are "no sprite" (bead 8zu): a key can exist before its sheet lands.
        for (const artPending of pendingArtKeys(msg.mod)) {
          if ((framesBySubject[artPending]?.length ?? 0) > 0) pendingArt.delete(artPending); else pendingArt.add(artPending);
        }
        const art = msg.mod.art;
        if (art) {
          pendingArt.add(art.key);
          loadArtWithRetry(art.key, art.url, (art as { scenery?: boolean }).scenery === true);
        }
        const skinArt = (msg.mod as { skinArt?: { key: string; url: string } }).skinArt;
        if (skinArt) { pendingArt.add(skinArt.key); loadArtWithRetry(skinArt.key, skinArt.url, false); }
        const skinPending = (msg.mod as { skinPending?: string }).skinPending;
        if (skinPending) pendingArt.add(skinPending);
      } catch (err) {
        say(`That build failed to load here: ${err instanceof Error ? err.message : String(err)}`, "failed");
      }
    }
    else if ((msg as unknown as { kind: string }).kind === "art") {
      const artMsg = msg as unknown as { kind: "art"; modId: string; art: { key: string; url: string; scenery?: boolean } };
      pendingArt.add(artMsg.art.key);
      loadArtWithRetry(artMsg.art.key, artMsg.art.url, artMsg.art.scenery === true);
    }
    else if ((msg as unknown as { kind: string }).kind === "segment") {
      const segMsg = msg as unknown as { kind: "segment"; key: string; box: unknown };
      handleSegment(segMsg.key, segMsg.box ?? null);
    }
  });
}

function submitCommand(text: string): void {
  if (!text) return;
  pendingNotice = null; // the visitor's own words outrank a share-link notice
  // "let me draw a level" / "sketch" open the overlay locally (ADR 0028): no AI call,
  // no build slot. Anything else, including "draw a dragon", goes down the normal path.
  const sketchIntent = matchSketchIntent(text);
  if (sketchIntent === "open") { sketch.open(); return; }
  if (sketchIntent === "close") { sketch.close(); say("Sketch closed — the world is running again."); return; }
  if (matchPaperIntent(text)) { void openCameraModal(true); return; }
  say(`Building: ${text}`, "building");
  onboarding.event("submit");
  const modsBefore = loader.list().length;
  if (handleLocal(text)) { if (loader.list().length > modsBefore) onboarding.event("built"); }
  else {
    if (ws?.readyState === WebSocket.OPEN) send({ kind: "worldState", mods: loader.list().map((m) => ({ id: m.id, values: m.values })) });
    if (ws?.readyState === WebSocket.OPEN) { send({ kind: "command", text }); tester.attempt(inputVia, text); }
    else if (ws?.readyState === WebSocket.CONNECTING) {
      // Page just loaded and the socket is still opening: hold the command and send it the moment it is up.
      say("Connecting to the builder…", "building");
      const via = inputVia;
      ws.addEventListener("open", () => {
        sendWorldState();
        send({ kind: "command", text });
        tester.attempt(via, text);
      }, { once: true });
    }
    else say("That needs the AI server. Start it with: npm run server — local builds above still work.", "failed");
  }
}
$("#command-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = "";
  submitCommand(text);
});
$("#orb-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = orbInputEl.value.trim();
  if (!text) return;
  orbInputEl.value = "";
  submitCommand(text);
});
document.querySelectorAll<HTMLButtonElement>("#chips button").forEach((b) => {
  b.addEventListener("click", () => {
    say(`Building: ${b.dataset.cmd}`, "building");
    handleLocal(b.dataset.cmd ?? "");
  });
});

renderMods();
say("Say something — or type below. Try “add a player”.");
const onboarding = createOnboarding({ inputMode: () => inputMode, submit: (t) => submitCommand(t), orbInput: orbInputEl, mount: stageWrapEl, flags: urlFlags });
// A share link we could not decode (corrupted, truncated, oversized, old version) never reaches the
// server: say so and give the visitor the starter world. Works offline, too (ADR 0037).
if (urlFlags.shareIssue) openStarterAfterBadLink(urlFlags.shareIssue);
else if (!worldParam) autoLoadStarterOnce();

// Test hooks: deterministic stepping + text view of the world (no DOM reads needed to playtest).
// QA flag (?tester): what the URL decoder made of this page's flags, so a script can assert it.
if (urlFlags.tester) {
  (window as unknown as Record<string, unknown>).__urlFlags = {
    mute: urlFlags.mute, noShake: urlFlags.noShake, coach: urlFlags.coach, noCoach: urlFlags.noCoach,
    volume: urlFlags.volume, mood: urlFlags.mood, worldId: urlFlags.worldId, shareIssue: urlFlags.shareIssue,
  };
}
(window as unknown as Record<string, unknown>).advanceTime = (ms: number) => {
  const steps = Math.max(1, Math.round(ms / (SIM.dt * 1000)));
  for (let i = 0; i < steps; i++) world.step();
  render();
};
(window as unknown as Record<string, unknown>).art_state = () => JSON.stringify({
  subjects: Object.fromEntries(Object.entries(framesBySubject).map(([k, v]) => [k, v.map((t) => `${Math.round(t.width)}x${Math.round(t.height)}`)])),
  pendingArt: [...pendingArt],
  scenery: [...scenerySubjects],
  photoTex: Object.entries(framesBySubject).filter(([k]) => k.startsWith("photo")).map(([k, v]) => { const r = (v[0] as unknown as { source?: { resource?: unknown } })?.source?.resource; (window as unknown as Record<string, unknown>).__photoCanvas = r ?? null; return `${k}:${r instanceof HTMLCanvasElement ? `${r.width}x${r.height}` : typeof r}`; }),
  fxMs: Number(fx.lastMs.toFixed(3)),
  camera: { x: Math.round(world.camera.x), y: Math.round(world.camera.y) },
  sprites: [...spritePool.entries()].map(([id, s]) => ({ id, vis: s.visible, x: Math.round(s.position.x), y: Math.round(s.position.y), sx: Number(s.scale.x.toFixed(2)), sy: Number(s.scale.y.toFixed(2)), tex: s.texture ? `${Math.round(s.texture.width)}x${Math.round(s.texture.height)}` : "none" })),
});
(window as unknown as Record<string, unknown>).render_game_to_text = () => {
  const p = world.entities.find((e) => e.type === "player");
  return JSON.stringify({
    coordinateSystem: "pixels, origin top-left of world, +x right, +y down; camera offsets rendering only",
    tick: world.tickCount,
    mods: loader.list().map((m) => m.id),
    player: p ? { x: Math.round(p.x), y: Math.round(p.y), vx: Math.round(p.vx), vy: Math.round(p.vy), onGround: p.onGround } : null,
    entities: world.entities.slice(0, 30).map((e) => ({ type: e.type, x: Math.round(e.x), y: Math.round(e.y), vx: Math.round(e.vx), hp: Math.round(e.health), hostile: e.data.hostile === true, hero: e.data.hero === true })),
    particles: world.particles.length,
    hud: world.hudList().map((h) => ({
      id: h.id, owner: h.owner, kind: h.kind, label: h.label,
      value: h.value === undefined ? undefined : typeof h.value === "number" ? Math.round(h.value * 10) / 10 : h.value,
      max: h.max, text: h.text, position: h.position,
    })),
  });
};
(window as unknown as Record<string, unknown>).openRadialOn = (type: string): boolean => {
  const ent = world.entities.find((e) => e.type === type);
  if (ent) { openRadialMenu(ent); return true; }
  return false;
};

// Cold start (bead q2s): the module is fully evaluated, so the socket's queued frames and
// its "open" handler may run now. Keep this the last statement in the file.
boot.markReady();
