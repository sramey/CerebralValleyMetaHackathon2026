import { Application, Graphics, Sprite, Texture } from "pixi.js";
import { SIM, emptyInput } from "../contract";
import type { Entity, Look, ModApi, ModDefinition, MoodSpec, WorldMod } from "../contract";
import { canUseSpriteSheet, entityKind } from "../ontology";
import { World } from "../sim/world";
import { ModLoader } from "../sim/loader";
import playerMod from "../mods/player";
import groundMod from "../mods/ground";
import enemyMod from "../mods/enemy";
import rainMod from "../mods/rain";
import coinsMod from "../mods/coins";
import movingPlatformMod from "../mods/platform-moving";
import fireArrowMod from "../mods/fire-arrow";
import chickenMod from "../mods/chicken";
import parallaxMod from "../mods/parallax";
import swarmMod from "../mods/swarm";
import { gunMod } from "../client/items";
import { Sound } from "../client/sound";
import { Fx } from "../client/fx";
import { Feel } from "../client/feel";
import { Portal } from "../client/portal";
import { createHud } from "../client/hud";
import { computePrimaries, framesFor, isProjectileType, loadSpriteSheet } from "../client/sprites";
import { drawCliff, drawShape, isCliff, kindOf, registerLook, scale, setGrade, setSnowy } from "../client/shapes";
import {
  celestialPos,
  computeDesiredCamY,
  depthFog,
  drawContactShadows,
  drawDistantMountains,
  drawGround25D,
  drawHorizonMist,
  drawSkyAndCelestials,
  drawSunEntity,
  isDaytimeSky,
} from "../client/depth";
import { drawBackdrop, drawScenery, skylineAmplitude } from "../client/scenery";
import { drawFluffyCloud, drawParallaxEntities, isCloudEntity, isParallaxOrSkyEntity, isSkyOrBackgroundEntity } from "../client/parallax";

declare global {
  interface Window {
    __EXPORTED_WORLD__?: {
      title?: string;
      mods: WorldMod[];
      mood?: MoodSpec;
      restyled?: Record<string, string>;
    };
    __EXPORTED_SPRITES__?: Record<string, string>;
  }
}

const BUILTINS: Record<string, ModDefinition> = {
  player: playerMod,
  ground: groundMod,
  enemies: enemyMod,
  rain: rainMod,
  coins: coinsMod,
  "moving-platform": movingPlatformMod,
  "fire-arrow": fireArrowMod,
  chicken: chickenMod,
  parallax: parallaxMod,
  swarm: swarmMod,
  gun: gunMod,
};

async function boot(): Promise<void> {
  const worldData = window.__EXPORTED_WORLD__ ?? { mods: [] };
  const spritesData = window.__EXPORTED_SPRITES__ ?? {};

  const stageWrapEl = document.getElementById("stage-wrap")!;
  const stageEl = document.getElementById("stage")!;
  const soundBtn = document.getElementById("sound-btn") as HTMLButtonElement | null;

  const world = new World(1337);
  const loader = new ModLoader(world);
  // A mod that crashes mid-game is taken out and the rest keeps running (ADR 0056).
  loader.isolateFaults((mod, message) => console.warn(`mod ${mod.id} crashed and was unloaded:`, message));

  const app = new Application();
  await app.init({
    background: 0x05070a,
    antialias: false,
    preference: "webgl",
  });
  stageEl.appendChild(app.canvas);

  const gfx = new Graphics();
  app.stage.addChild(gfx);
  app.stage.sortableChildren = true;
  gfx.zIndex = -100;

  const sound = new Sound({});
  const unlockSound = (): void => { sound.unlock(); };
  window.addEventListener("pointerdown", unlockSound, { once: true });
  window.addEventListener("keydown", unlockSound, { once: true });

  const updateSoundBtn = (): void => {
    if (soundBtn) {
      soundBtn.textContent = sound.muted ? "🔇 Sound: Off (M)" : "🔊 Sound: On (M)";
    }
  };
  updateSoundBtn();
  soundBtn?.addEventListener("click", () => {
    unlockSound();
    sound.toggleMute();
    updateSoundBtn();
  });

  const fx = new Fx(app.stage);
  const feel = new Feel(app.stage, (amp) => fx.kick(amp), true, (ev) => sound.playEvent(ev));
  const portal = new Portal(app.stage);
  portal.onRip = () => sound.play("portal");
  const hud = createHud(stageWrapEl);

  let lastRenderAt = performance.now();
  const isEffectType = (type: string): boolean => kindOf(type)?.kind === "effect";

  // Palette & mood setup
  const OUTLINE = 0x0b0e13;
  const AMBER = 0xffc94d;
  const GRASS = 0x3fd06a;
  const SOIL_DARK = 0x1d3320;
  const pal = { grass: GRASS, soil: SOIL_DARK, ridgeFar: 0x0a1418, ridgeNear: 0x0d1b20, moon: 0xf2ead0, star: 0x33404f };
  const GOLD = 0xffd34d;
  const SHINE = 0xfff2c0;
  const TRAIL = 0xff8c2e;

  const SKY_BANDS = 12;
  const SKY_TOP = [5, 7, 10] as const;
  const SKY_BOTTOM = [13, 34, 41] as const;
  const SKY: number[] = [];

  function mixC(a: number, b: number, t: number): number {
    const m = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
    return (m(16) << 16) | (m(8) << 8) | m(0);
  }

  for (let i = 0; i < SKY_BANDS; i++) {
    SKY.push(mixC((SKY_TOP[0] << 16) | (SKY_TOP[1] << 8) | SKY_TOP[2], (SKY_BOTTOM[0] << 16) | (SKY_BOTTOM[1] << 8) | SKY_BOTTOM[2], i / (SKY_BANDS - 1)));
  }

  let mood: MoodSpec | null = null;
  function grade(c: number): number {
    if (!mood) return c;
    const w = mixC(c, mood.tint, mood.grade);
    const f = (s: number) => Math.min(255, Math.round(((w >> s) & 255) * mood!.dim));
    return (f(16) << 16) | (f(8) << 8) | f(0);
  }

  function applyMood(m: MoodSpec | null): void {
    mood = m;
    if (m) {
      pal.grass = m.grass; pal.soil = m.soil; pal.ridgeFar = m.ridgeFar; pal.ridgeNear = m.ridgeNear; pal.moon = m.moon; pal.star = m.star;
      for (let i = 0; i < SKY_BANDS; i++) SKY[i] = mixC(m.skyTop, m.skyBottom, i / (SKY_BANDS - 1));
    } else {
      pal.grass = GRASS; pal.soil = SOIL_DARK; pal.ridgeFar = 0x0a1418; pal.ridgeNear = 0x0d1b20; pal.moon = 0xf2ead0; pal.star = 0x33404f;
      for (let i = 0; i < SKY_BANDS; i++) SKY[i] = mixC((SKY_TOP[0] << 16) | (SKY_TOP[1] << 8) | SKY_TOP[2], (SKY_BOTTOM[0] << 16) | (SKY_BOTTOM[1] << 8) | SKY_BOTTOM[2], i / (SKY_BANDS - 1));
    }
    setGrade(grade);
    setSnowy(Boolean(m && (m.ambient === "snow" || m.name === "christmas" || m.name === "snowy")));
    fx.setMood(m);
    portal.setMood(m);
    sound.setMood(m);
  }

  if (worldData.mood) {
    applyMood(worldData.mood);
  }

  // Load inlined sprites
  const framesBySubject: Record<string, Texture[]> = {};
  for (const [key, dataUri] of Object.entries(spritesData)) {
    try {
      framesBySubject[key] = await loadSpriteSheet(dataUri);
    } catch {
      framesBySubject[key] = [];
    }
  }

  // Load mods
  async function importMod(compiled: string): Promise<ModDefinition> {
    const url = URL.createObjectURL(new Blob([compiled], { type: "text/javascript" }));
    try {
      const res = (await import(/* @vite-ignore */ url)) as { default: ModDefinition };
      return res.default;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  for (const m of worldData.mods) {
    try {
      if (m.builtin) {
        const def = BUILTINS[m.id];
        if (def) loader.load(def, m.values);
      } else {
        if (m.look) registerLook(m.look);
        const def = await importMod(m.compiled);
        loader.load(def, m.values);
      }
    } catch (err) {
      console.warn("Failed to load mod in export:", m.id, err);
    }
  }

  // Sprite pooling & rendering
  const spritePool = new Map<number, Sprite>();
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

  function visualHeightOf(e: Entity): number {
    const frames = framesFor(framesBySubject, e.type, e.type === "player");
    if (frames.length >= 1 && !kindOf(e.type)) {
      return e.type === "player" ? 56 * (e.h / 34) : Math.min(630, Math.max(34, e.h * 1.5));
    }
    return e.h;
  }

  function squash(e: Entity): { bw: number; bh: number } {
    if (e.onGround) return { bw: e.w * 1.06, bh: e.h * 0.92 };
    if (e.vy < -40) return { bw: e.w * 0.95, bh: e.h * 1.06 };
    return { bw: e.w, bh: e.h };
  }

  function drawPlayer(e: Entity, x: number, y: number): void {
    const { bw, bh } = squash(e);
    const bx = x + (e.w - bw) / 2;
    const by = y + (e.h - bh);
    const right = e.facing > 0;
    gfx.rect(bx - 1.5, by - 1.5, bw + 3, bh + 3).fill(OUTLINE);
    gfx.rect(bx, by, bw, bh).fill(e.color);
    const bandH = Math.max(3, bh * 0.12);
    gfx.rect(bx, by + 2, bw, bandH).fill(AMBER);
    const tailLen = 6;
    const tailX = right ? bx - tailLen : bx + bw;
    gfx.rect(tailX, by + 3, tailLen, 2).fill(AMBER);
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
    const o = 1.5;
    gfx.ellipse(cx, by + r, r + o, r * 0.9 + o).fill(OUTLINE);
    gfx.rect(bx - o, by + r * 0.7, bw + 2 * o, bh - r * 0.7 + o).fill(OUTLINE);
    gfx.ellipse(cx, by + r, r, r * 0.9).fill(e.color);
    gfx.rect(bx, by + r * 0.7, bw, bh - r * 0.7).fill(e.color);
    gfx.rect(bx + 1, by + bh - 3, 6, 3).fill(OUTLINE);
    gfx.rect(bx + bw - 7, by + bh - 3, 6, 3).fill(OUTLINE);
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
  }

  function drawGround(e: Entity, x: number, y: number): void {
    drawGround25D(gfx, e, x, y, pal, app.screen.width, app.screen.height, grade);
  }

  function drawShot(e: Entity, x: number, y: number): void {
    const dir = e.vx !== 0 ? (e.vx > 0 ? 1 : -1) : e.facing;
    for (let i = 1; i <= 3; i++) {
      const tw = e.w * 0.5;
      const tx = dir > 0 ? x - i * tw : x + e.w + (i - 1) * tw;
      gfx.rect(tx, y + e.h * 0.25, tw, e.h * 0.5).fill({ color: TRAIL, alpha: 0.36 / i });
    }
    gfx.rect(x, y, e.w, e.h).fill(e.color);
    gfx.rect(x + e.w * 0.2, y + e.h * 0.3, e.w * 0.6, e.h * 0.4).fill(0xfff6d8);
  }

  function drawHealthBar(e: Entity, x: number, y: number): void {
    const health = (e as { health?: number }).health;
    if (typeof health !== "number" || health <= 0 || health >= 100) return;
    gfx.rect(x, y - 9, e.w, 4).fill({ color: 0x0b0e13, alpha: 0.7 });
    const color = health > 50 ? 0x3fd06a : health > 25 ? 0xffc94d : 0xff5a4d;
    gfx.rect(x, y - 9, (e.w * health) / 100, 4).fill(color);
  }

  function drawEntityRaw(e: Entity, camX: number, camY: number): void {
    if (isParallaxOrSkyEntity(e)) return;
    const x = e.x - camX;
    const y = e.y - camY;
    const W = app.screen.width;
    const H = app.screen.height;
    if (x + e.w < -40 || x > W + 40 || y + e.h < -40 || y > H + 40) return;
    const t = e.type;
    const look = kindOf(t);
    if (look) {
      if (look.kind === "shape") drawShape(gfx, e, x, y, look.shape);
      return;
    }
    if (t === "sun" || /\bsun\b/i.test(t)) {
      drawSunEntity(gfx, e, x, y);
      return;
    }
    if (t.includes("cloud") || t.includes("cumulus")) {
      drawFluffyCloud(gfx, x, y, e.w, e.h, e.color, pal.moon, SKY[SKY_BANDS - 1], e.id);
      return;
    }
    if (isCliff(e)) {
      drawCliff(gfx, e, x, y);
      return;
    }
    if (t.includes("ground") || t.includes("platform") || /floor|bridge/i.test(t)) {
      drawGround(e, x, y);
      return;
    }
    if (t === "player") {
      drawPlayer(e, x, y);
      return;
    }
    if (t.includes("coin")) {
      drawCoin(e, x, y);
      return;
    }
    if (t.includes("slime") || t.includes("gel") || t.includes("enemy") || t.includes("walker") || t.includes("turtle")) {
      drawBlob(e, x, y);
      return;
    }
    gfx.rect(x - 1.5, y - 1.5, e.w + 3, e.h + 3).fill(OUTLINE);
    if (t.includes("stair") || t.includes("step") || t.includes("wall") || t.includes("block") || t.includes("brick") || t.includes("pillar") || t.includes("ledge") || t.includes("ramp") || entityKind(e) === "terrain") {
      drawStair(e, x, y);
      return;
    }
    if (isProjectileType(t) || entityKind(e) === "projectile" || t.includes("arrow") || t.includes("fire")) {
      drawShot(e, x, y);
      return;
    }
    gfx.rect(x, y, e.w, e.h).fill(e.color);
  }

  function drawEntity(e: Entity, camX: number, camY: number): void {
    if (!mood) {
      drawEntityRaw(e, camX, camY);
      return;
    }
    const c = e.color;
    e.color = grade(c);
    drawEntityRaw(e, camX, camY);
    e.color = c;
  }

  function ridgeY(wx: number, seed: number): number {
    return seed === 0
      ? Math.sin(wx * 0.008) * 26 + Math.sin(wx * 0.021 + 1.7) * 10
      : Math.sin(wx * 0.011 + 4.0) * 20 + Math.sin(wx * 0.033) * 8;
  }

  const ridgeFar: number[] = [];
  const ridgeNear: number[] = [];
  function drawRidge(pts: number[], camX: number, par: number, baseY: number, seed: number, color: number, amp = 1): void {
    const W = app.screen.width;
    const H = app.screen.height;
    pts.length = 0;
    const step = 32;
    for (let sx = -step; sx <= W + step; sx += step) {
      pts.push(sx, baseY - ridgeY(sx + camX * par, seed) * amp);
    }
    const topCount = pts.length;
    pts.push(W + step, H, -step, H);
    gfx.poly(pts).fill(color);
    const rim = mixC(color, pal.moon, 0.22);
    for (let i = 0; i + 3 < topCount; i += 2) {
      gfx.moveTo(pts[i], pts[i + 1]).lineTo(pts[i + 2], pts[i + 3]).stroke({ width: 1.5, color: rim, alpha: 0.3 });
    }
  }

  // Camera & positioning
  let camXSmooth: number | null = null;
  let camYSmooth: number | null = null;

  function desiredCamXFor(w: number): number {
    const p = world.entities.find((e) => e.type === "player");
    return p ? p.x + p.w / 2 - w * 0.38 : world.camera.x;
  }

  function desiredCamYFor(h: number): number {
    const p = world.entities.find((e) => e.type === "player");
    return computeDesiredCamY(p, h, world.camera.y);
  }

  function fitRenderer(): void {
    const rect = stageWrapEl.getBoundingClientRect();
    const w = Math.max(320, Math.floor(rect.width));
    const h = Math.max(240, Math.floor(rect.height));
    if (app.screen.width !== w || app.screen.height !== h) {
      app.renderer.resize(w, h);
      camXSmooth = desiredCamXFor(w);
      camYSmooth = desiredCamYFor(h);
    }
    app.canvas.style.width = `${w}px`;
    app.canvas.style.height = `${h}px`;
  }
  fitRenderer();
  window.addEventListener("resize", fitRenderer);

  const order: Entity[] = [];

  function render(): void {
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

    const isDaytime = isDaytimeSky(mood, world.entities, SKY[0]);
    const sunEntity = world.entities.find((e) => {
      const t = e.type.toLowerCase();
      return t === "sun" || /\bsun\b/.test(t);
    });
    const skyEntity = world.entities.find((e) => isSkyOrBackgroundEntity(e) && typeof e.color === "number" && e.color > 0);
    const skyEntityCol = !mood && skyEntity ? skyEntity.color : undefined;

    drawSkyAndCelestials(gfx, W, H, camX, SKY_BANDS, SKY, pal, isDaytime, Boolean(sunEntity), skyEntityCol);

    if (isDaytime && !world.entities.some((e) => e.type.toLowerCase().includes("cloud"))) {
      const skyBottomCol = SKY[SKY_BANDS - 1];
      const c1x = ((((140 - camX * 0.08) % (W + 220)) + W + 220) % (W + 220)) - 110;
      drawFluffyCloud(gfx, c1x, 38, 120, 36, 0xffffff, pal.moon, skyBottomCol, 1);
      const c2x = ((((W * 0.48 - camX * 0.12) % (W + 260)) + W + 260) % (W + 260)) - 130;
      drawFluffyCloud(gfx, c2x, 62, 150, 42, 0xffffff, pal.moon, skyBottomCol, 2);
      const c3x = ((((W * 0.82 - camX * 0.06) % (W + 200)) + W + 200) % (W + 200)) - 100;
      drawFluffyCloud(gfx, c3x, 28, 95, 30, 0xffffff, pal.moon, skyBottomCol, 3);
    }

    const horizon = H * 0.62 - camYSmooth * 0.1;
    // A themed backdrop (ADR 0066) brings its own skyline: farmland is flat, a medieval valley keeps the mountains.
    const backdrop = mood?.backdrop;
    const amp = skylineAmplitude(backdrop);
    if (!backdrop || backdrop.skyline === "mountains") drawDistantMountains(gfx, camX, camYSmooth, W, H, pal, SKY[SKY_BANDS - 1]);
    const fog = depthFog(mood?.name);
    drawRidge(ridgeFar, camX, 0.3, horizon, 0, mixC(pal.ridgeFar, SKY[SKY_BANDS - 1], fog.far), amp);
    drawRidge(ridgeNear, camX, 0.55, horizon + 34, 1, mixC(pal.ridgeNear, SKY[SKY_BANDS - 1], fog.near), amp);

    if (backdrop && world.entities.some((e) => e.type === "ground")) {
      drawBackdrop(gfx, camX, camYSmooth, W, pal, SKY[SKY_BANDS - 1], fog.far, isDaytime, backdrop, mood?.name);
    } else if (world.entities.some((e) => e.type === "ground") && !world.entities.some(isParallaxOrSkyEntity)) {
      drawScenery(gfx, camX, camYSmooth, W, pal, SKY[SKY_BANDS - 1], fog.far, isDaytime, mood?.name);
    }
    // The backdrop replaces a parallax mod's silhouettes; its clouds still drift.
    drawParallaxEntities(gfx, backdrop ? world.entities.filter(isCloudEntity) : world.entities, camX, camYSmooth, W, H, pal, SKY[SKY_BANDS - 1], grade);
    drawHorizonMist(gfx, camX, camYSmooth, W, H, pal, SKY[SKY_BANDS - 1]);

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
      gfx.rect(p.x - camX, p.y - camYSmooth, p.size, p.size).fill({ color: p.color, alpha: Math.max(0, 1 - p.life / p.maxLife) });
    }

    const primaries = computePrimaries(world.entities, framesBySubject, (type) => Boolean(kindOf(type)));
    const seen = new Set<number>();
    const spriteDraw: { e: Entity; frame: Texture; subjectKey: string | undefined }[] = [];

    for (const e of world.entities) {
      if (isParallaxOrSkyEntity(e)) continue;
      const frames = framesFor(framesBySubject, e.type, e.type === "player");
      if (frames.length < 1 || !primaries.has(e.id) || kindOf(e.type)) continue;
      seen.add(e.id);
      const moving = Math.abs(e.vx) > 5;
      const subjectKey = Object.entries(framesBySubject).find(([, v]) => v === frames)?.[0];
      const frame =
        frames.length === 1
          ? frames[0]
          : entityKind(e) === "prop"
          ? frames[e.id % frames.length]
          : !e.solid && !e.onGround && e.gravityScale === 0 && frames.length >= 2
          ? frames[Math.floor(world.tickCount / 5) % frames.length]
          : frames.length >= 4 && !e.onGround
          ? frames[3]
          : moving
          ? frames[1 + (Math.floor(world.tickCount / 8) % Math.min(2, frames.length - 1))]
          : frames[0];
      spriteDraw.push({ e, frame, subjectKey });
    }

    for (const { e, frame } of spriteDraw) {
      const s = spriteFor(e.id);
      const targetH = visualHeightOf(e);
      const sc = targetH / frame.height;
      s.texture = frame;
      const sq = feel.scaleOf(e.id);
      s.scale.set(sc * e.facing * sq.sx, sc * sq.sy);
      s.tint = feel.tintOf(e.id);
      s.position.set(e.x - camX + e.w / 2, e.y - camYSmooth + e.h + 2);
      s.visible = true;
    }

    for (const [id, s] of spritePool) {
      if (!seen.has(id)) s.visible = false;
    }

    const nowMs = performance.now();
    feel.draw(camX, camYSmooth);
    fx.render(world, camX, camYSmooth, W, H, (nowMs - lastRenderAt) / 1000, isEffectType);
    portal.render(world, camX, camYSmooth, (nowMs - lastRenderAt) / 1000, (t) => isEffectType(t) || !canUseSpriteSheet(t));
    lastRenderAt = nowMs;

    app.stage.position.set(fx.shakeX, fx.shakeY);

    for (const e of world.entities) {
      const x = e.x - camX;
      const y = e.y - camYSmooth;
      if (x + e.w < -40 || x > W + 40 || y + e.h < -40 || y > H + 40) continue;
      drawHealthBar(e, x, y);
    }

    hud.render(world);
  }

  // Fixed 60Hz step
  let last = performance.now();
  let acc = 0;
  let noPlayerTicks = 0;

  let frameFaultShown = false;
  function frame(now: number): void {
    try {
      stepAndRender(now);
    } catch (err) {
      if (!frameFaultShown) { frameFaultShown = true; console.error("frame failed:", err); }
    }
    requestAnimationFrame(frame);
  }

  function stepAndRender(now: number): void {
    acc += Math.min(100, now - last);
    last = now;
    const stepMs = SIM.dt * 1000;
    while (acc >= stepMs) {
      world.step();
      acc -= stepMs;
      if (!loader.has("player") || world.entities.some((e) => e.type === "player")) {
        noPlayerTicks = 0;
      } else if (++noPlayerTicks > 90) {
        noPlayerTicks = 0;
        loader.load(playerMod);
      }
    }
    render();
  }
  requestAnimationFrame(frame);

  // Keyboard controls
  const keys = new Set<string>();
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyM" && !e.repeat) {
      sound.toggleMute();
      updateSoundBtn();
      return;
    }
    keys.add(e.code);
    syncInput();
    if (["ArrowUp", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
      e.preventDefault();
    }
  });

  window.addEventListener("keyup", (e) => {
    keys.delete(e.code);
    syncInput();
  });

  function syncInput(): void {
    world.input.left = keys.has("ArrowLeft") || keys.has("KeyA");
    world.input.right = keys.has("ArrowRight") || keys.has("KeyD");
    world.input.jump = keys.has("Space") || keys.has("ArrowUp") || keys.has("KeyW");
    world.input.shoot = keys.has("KeyX");
    world.input.use = keys.has("KeyF") || keys.has("KeyE") || keys.has("KeyJ");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void boot());
} else {
  void boot();
}
