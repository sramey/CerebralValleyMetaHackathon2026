import { Application, Graphics } from "pixi.js";
import { SIM } from "../contract";
import type { ClientMsg, Entity, KnobValue, ModDefinition, ServerMsg } from "../contract";
import { ModLoader } from "../sim/loader";
import { World } from "../sim/world";
import playerMod from "../mods/player";
import groundMod from "../mods/ground";
import enemyMod from "../mods/enemy";
import rainMod from "../mods/rain";
import coinsMod from "../mods/coins";
import movingPlatformMod from "../mods/platform-moving";
import fireArrowMod from "../mods/fire-arrow";

const BUILTINS: Record<string, ModDefinition> = {
  player: playerMod, ground: groundMod, enemies: enemyMod, rain: rainMod,
  coins: coinsMod, "moving-platform": movingPlatformMod, "fire-arrow": fireArrowMod,
};

const world = new World(1337);
const loader = new ModLoader(world);
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const stageEl = $("#stage");
const orb = $("#orb");
const orbState = $("#orb-state");
const orbSay = $("#orb-say");
const modsEl = $("#mods");
const logEl = $("#log");
const serverStatus = $("#server-status");
const inputEl = $<HTMLInputElement>("#command");

function say(text: string, state = "idle"): void {
  orbSay.textContent = text;
  orb.dataset.state = state;
  orbState.textContent = state === "building" ? "Building" : state === "failed" ? "Rolled back" : state === "done" ? "Done" : "Listening";
}
function log(text: string): void {
  const li = document.createElement("li");
  li.textContent = `${new Date().toLocaleTimeString()} ${text}`;
  logEl.prepend(li);
  while (logEl.children.length > 30) logEl.lastChild?.remove();
}

// --- rendering -------------------------------------------------------------
const app = new Application();
await app.init({ resizeTo: stageEl, background: 0x05070a, antialias: false });
stageEl.appendChild(app.canvas);
const gfx = new Graphics();
app.stage.addChild(gfx);

// --- code-drawn art (no image assets) ----------------------------------------
// Palette: near-black blue sky family, amber player accent, no purple.
const OUTLINE = 0x0b0e13;
const AMBER = 0xffc94d;
const GRASS = 0x3fd06a;
const SOIL_DARK = 0x1d3320;
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

function drawRidge(pts: number[], camX: number, par: number, baseY: number, seed: number, color: number): void {
  const W = app.screen.width;
  const H = app.screen.height;
  pts.length = 0;
  const step = 32;
  for (let sx = -step; sx <= W + step; sx += step) {
    pts.push(sx, baseY - ridgeY(sx + camX * par, seed));
  }
  pts.push(W + step, H, -step, H);
  gfx.poly(pts).fill(color);
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
  // dome top + blocky base = rounded-ish walker
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
  gfx.ellipse(cx, cy, rx, r).fill(GOLD);
  gfx.ellipse(cx - rx * 0.2, cy - r * 0.25, Math.max(1, rx * 0.35), Math.max(1, r * 0.3)).fill(SHINE);
}

function drawGround(e: Entity, x: number, y: number): void {
  gfx.rect(x, y, e.w, e.h).fill(e.color);
  const gh = Math.min(8, Math.max(3, e.h * 0.22));
  gfx.rect(x, y, e.w, gh).fill(GRASS);
  // deterministic speckles from world coords (no per-frame random)
  const base = Math.floor(e.x) * 31 + Math.floor(e.y) * 7;
  const n = Math.floor(e.w / 14);
  for (let k = 0; k < n; k++) {
    const hsh = ((base + k * 57) % 11 + 11) % 11;
    if (hsh % 2 !== 0) continue;
    const px = x + k * 14 + (hsh % 5);
    const span = e.h - gh - 6;
    const py = y + gh + 3 + (span > 0 ? hsh % span : 0);
    gfx.rect(px, py, 3, 2).fill(SOIL_DARK);
  }
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

function drawEntity(e: Entity, camX: number, camY: number): void {
  const x = e.x - camX;
  const y = e.y - camY;
  const W = app.screen.width;
  const H = app.screen.height;
  if (x + e.w < -40 || x > W + 40 || y + e.h < -40 || y > H + 40) return; // off-screen cull
  // dark outline behind every entity
  gfx.rect(x - 1.5, y - 1.5, e.w + 3, e.h + 3).fill(OUTLINE);
  const t = e.type;
  if (t === "player") { drawPlayer(e, x, y); return; }
  if (t.indexOf("coin") >= 0) { drawCoin(e, x, y); return; }
  if (t.indexOf("ground") >= 0 || t.indexOf("platform") >= 0) { drawGround(e, x, y); return; }
  if (t.indexOf("projectile") >= 0 || t.indexOf("arrow") >= 0 || t.indexOf("fire") >= 0) { drawShot(e, x, y); return; }
  if (t.indexOf("rain") >= 0 || t.indexOf("drop") >= 0) {
    gfx.rect(x, y, e.w, e.h).fill({ color: RAIN_BLUE, alpha: 0.55 });
    return;
  }
  if (t.indexOf("slime") >= 0 || t.indexOf("gel") >= 0 || t.indexOf("enemy") >= 0 ||
    t.indexOf("walker") >= 0 || t.indexOf("turtle") >= 0) { drawBlob(e, x, y); return; }
  gfx.rect(x, y, e.w, e.h).fill(e.color);
}

function render(): void {
  gfx.clear();
  const { x: camX, y: camY } = world.camera;
  const W = app.screen.width;
  const H = app.screen.height;
  // vertical sky gradient via stacked bands
  const bandH = Math.ceil(H / SKY_BANDS);
  for (let i = 0; i < SKY_BANDS; i++) {
    gfx.rect(0, i * bandH, W, bandH + 1).fill(SKY[i]);
  }
  // stars (parallax markers)
  for (let i = 0; i < 14; i++) {
    const sx = ((i * 173 - camX * 0.3) % (W + 80) + W + 80) % (W + 80) - 40;
    gfx.rect(sx, 40 + (i % 5) * 22, 3, 3).fill(0x33404f);
  }
  // moon, fixed top-right
  gfx.circle(W - 70, 60, 24).fill({ color: 0xf2ead0, alpha: 0.15 });
  gfx.circle(W - 70, 60, 17).fill(0xf2ead0);
  gfx.circle(W - 76, 54, 14).fill(SKY[1]);
  // far hill silhouettes
  const horizon = H * 0.62 - camY * 0.1;
  drawRidge(ridgeFar, camX, 0.3, horizon, 0, 0x0a1418);
  drawRidge(ridgeNear, camX, 0.55, horizon + 34, 1, 0x0d1b20);
  // solids-first, reuse scratch array
  order.length = 0;
  for (let i = 0; i < world.entities.length; i++) order.push(world.entities[i]);
  order.sort((a, b) => Number(b.solid) - Number(a.solid));
  for (let i = 0; i < order.length; i++) drawEntity(order[i], camX, camY);
  for (const p of world.particles) {
    gfx.rect(p.x - camX, p.y - camY, p.size, p.size).fill(p.color);
  }
  // subtle vignette: 4 edge rects
  const V = 26;
  gfx.rect(0, 0, W, V).fill({ color: 0x000000, alpha: 0.28 });
  gfx.rect(0, H - V, W, V).fill({ color: 0x000000, alpha: 0.28 });
  gfx.rect(0, 0, V, H).fill({ color: 0x000000, alpha: 0.22 });
  gfx.rect(W - V, 0, V, H).fill({ color: 0x000000, alpha: 0.22 });
}

// fixed-step loop: sim never reads wall-clock, accumulator only paces steps
let last = performance.now();
let acc = 0;
function frame(now: number): void {
  acc += Math.min(100, now - last);
  last = now;
  const stepMs = SIM.dt * 1000;
  while (acc >= stepMs) { world.step(); acc -= stepMs; }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- input -------------------------------------------------------------------
const keys = new Set<string>();
addEventListener("keydown", (e) => {
  if (e.target === inputEl) return;
  keys.add(e.code);
  syncInput();
  if (["ArrowUp", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
});
addEventListener("keyup", (e) => { keys.delete(e.code); syncInput(); });
function syncInput(): void {
  world.input.left = keys.has("ArrowLeft") || keys.has("KeyA");
  world.input.right = keys.has("ArrowRight") || keys.has("KeyD");
  world.input.jump = keys.has("ArrowUp") || keys.has("KeyW") || keys.has("Space");
  world.input.shoot = keys.has("KeyX") || keys.has("KeyJ");
}

// --- mod cards -----------------------------------------------------------------
function renderMods(): void {
  modsEl.innerHTML = "";
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
    head.append(name, undo);
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

// --- commands -------------------------------------------------------------------
function loadLocal(def: ModDefinition): void {
  loader.load(def);
  say(`${def.title} materialized.`, "done");
  log(`loaded ${def.id}`);
  renderMods();
}
function handleLocal(text: string): boolean {
  const t = text.toLowerCase();
  if (t.includes("starter")) { loadLocal(playerMod); loadLocal(groundMod); return true; }
  if (t.includes("undo") || t.startsWith("remove")) {
    const mods = loader.list();
    const last = mods[mods.length - 1];
    if (last) { loader.unload(last.id); say(`${last.title} removed.`, "done"); renderMods(); }
    else say("Nothing to undo.");
    return true;
  }
  if (t.includes("player") || t.includes("ninja")) { loadLocal(playerMod); return true; }
  if (t.includes("ground") || t.includes("platform")) { loadLocal(groundMod); return true; }
  if (t.includes("enem") || t.includes("walker") || t.includes("turtle")) { loadLocal(enemyMod); return true; }
  if (t.includes("rain")) { loadLocal(rainMod); return true; }
  if (t.includes("coin") || t.includes("score")) { loadLocal(coinsMod); return true; }
  if (t.includes("moving platform")) { loadLocal(movingPlatformMod); return true; }
  if (t.includes("arrow") || t.includes("shoot")) { loadLocal(fireArrowMod); return true; }
  if (t.includes("jump higher")) { tweak("player", "jump", 880, "Jump raised."); return true; }
  if (t.includes("faster")) {
    if (loader.has("enemies")) tweak("enemies", "speed", 140, "Walkers sped up.");
    else tweak("player", "speed", 380, "Player sped up.");
    return true;
  }
  return false;
}
function tweak(modId: string, knob: string, value: KnobValue, message: string): void {
  if (loader.setKnob(modId, knob, value)) { say(message, "done"); renderMods(); }
  else say(`Add that mod first, then I can tweak it.`);
}

// --- server ---------------------------------------------------------------------
let ws: WebSocket | null = null;
function send(msg: ClientMsg): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function connect(): void {
  try { ws = new WebSocket("ws://127.0.0.1:8787"); }
  catch { serverStatus.textContent = "Server: offline (local mods still work)"; return; }
  ws.addEventListener("open", () => { serverStatus.textContent = "Server: connected on 8787"; });
  ws.addEventListener("close", () => {
    serverStatus.textContent = "Server: offline (local mods still work)";
    setTimeout(connect, 3000);
  });
  ws.addEventListener("message", async (ev) => {
    let msg: ServerMsg;
    try { msg = JSON.parse(String(ev.data)) as ServerMsg; } catch { return; }
    if (msg.kind === "say") say(msg.text);
    else if (msg.kind === "stage") { say(msg.detail, msg.stage === "failed" ? "failed" : "building"); log(`${msg.stage}: ${msg.detail}`); }
    else if (msg.kind === "timing") log(`timing route ${msg.ms.route}ms write ${msg.ms.write}ms compile ${msg.ms.compile}ms verify ${msg.ms.verify}ms total ${msg.ms.total}ms`);
    else if (msg.kind === "tweak") tweak(msg.modId, msg.knob, msg.value, "Tweaked.");
    else if (msg.kind === "removed") { loader.unload(msg.modId); renderMods(); }
    else if (msg.kind === "mod") {
      try {
        const blob = new Blob([msg.mod.compiled], { type: "text/javascript" });
        const url = URL.createObjectURL(blob);
        const loaded = (await import(/* @vite-ignore */ url)) as { default: ModDefinition };
        URL.revokeObjectURL(url);
        loader.load(loaded.default);
        say(`${msg.mod.title} verified and live.`, "done");
        renderMods();
      } catch (err) {
        say(`That build failed to load here: ${err instanceof Error ? err.message : String(err)}`, "failed");
      }
    }
  });
}
connect();

$("#command-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = "";
  say(`Building: ${text}`, "building");
  if (!handleLocal(text)) {
    if (ws?.readyState === WebSocket.OPEN) send({ kind: "command", text });
    else say("That needs the AI server. Start it with: npm run server — local builds above still work.", "failed");
  }
});
document.querySelectorAll<HTMLButtonElement>("#chips button").forEach((b) => {
  b.addEventListener("click", () => {
    say(`Building: ${b.dataset.cmd}`, "building");
    handleLocal(b.dataset.cmd ?? "");
  });
});

renderMods();
say("Say something — or type below. Try “add a player”.");

// Test hooks: deterministic stepping + text view of the world (no DOM reads needed to playtest).
(window as unknown as Record<string, unknown>).advanceTime = (ms: number) => {
  const steps = Math.max(1, Math.round(ms / (SIM.dt * 1000)));
  for (let i = 0; i < steps; i++) world.step();
  render();
};
(window as unknown as Record<string, unknown>).render_game_to_text = () => {
  const p = world.entities.find((e) => e.type === "player");
  return JSON.stringify({
    coordinateSystem: "pixels, origin top-left of world, +x right, +y down; camera offsets rendering only",
    tick: world.tickCount,
    mods: loader.list().map((m) => m.id),
    player: p ? { x: Math.round(p.x), y: Math.round(p.y), vx: Math.round(p.vx), vy: Math.round(p.vy), onGround: p.onGround } : null,
    entities: world.entities.slice(0, 30).map((e) => ({ type: e.type, x: Math.round(e.x), y: Math.round(e.y) })),
    particles: world.particles.length,
  });
};
