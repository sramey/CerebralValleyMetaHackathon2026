// 2.5D visual depth & lighting polish (bead 1z7):
// - Raycasted ground contact shadows + ambient occlusion under grounded & airborne entities
// - 2.5D terrain volume: grass overhang AO band, top specular catch-light, soil/bedrock strata, platform bevels & drop shadows
// - Atmospheric horizon mist & foreground depth framing
// - Dynamic point-light halos, celestial volumetric shafts & surface light bounce via Fx's pooled radial sprites
// Pure render-side: reads World/Entity state, never mutates sim state.

import type { Graphics } from "pixi.js";
import type { Entity, MoodSpec } from "../contract";
import type { World } from "../sim/world";

export interface DepthPalette {
  grass: number;
  soil: number;
  ridgeFar: number;
  ridgeNear: number;
  moon: number;
  star: number;
}

export interface SurfaceHit {
  surface: Entity;
  y: number;
  height: number;
  /** 1.0 when resting on the surface, scaling linearly down to 0.0 at maxDist. */
  factor: number;
}

export type PuffFn = (x: number, y: number, r: number, color: number, alpha: number, add?: boolean) => void;

const TERRAIN_TYPE_RE = /^(ground|platform|wall|cliff|sky|day-sky|night-sky|background|cloud)$/i;
const EMISSIVE_TYPE_RE = /coin|fire|arrow|projectile|shot|laser|bolt|spark|ember|flame|torch|lantern|lamp|light|glow|star|portal|orb|gem|crystal|lava|sun/i;

export function mixColor(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(((a >> 16) & 255) * (1 - k) + ((b >> 16) & 255) * k);
  const g = Math.round(((a >> 8) & 255) * (1 - k) + ((b >> 8) & 255) * k);
  const bl = Math.round((a & 255) * (1 - k) + (b & 255) * k);
  return (r << 16) | (g << 8) | bl;
}

export function scaleColor(color: number, f: number): number {
  const r = Math.max(0, Math.min(255, Math.round(((color >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((color >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((color & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

export function colorLuminance(color: number): number {
  const r = ((color >> 16) & 255) / 255;
  const g = ((color >> 8) & 255) / 255;
  const b = (color & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Compute target camera Y so the main ground (y = 400..448) stays anchored at the bottom
 * of the viewport during normal jumps and platforming, only panning upward when the player
 * climbs into the top 28% of the screen (bead 98v item 3).
 */
export function computeDesiredCamY(
  player: Pick<Entity, "y" | "h"> | undefined,
  screenH: number,
  fallbackCamY = 0,
): number {
  const groundAnchorY = 400 - screenH * 0.89;
  if (!player) return Math.min(fallbackCamY, groundAnchorY);
  const footY = player.y + player.h;
  const topDeadzone = groundAnchorY + screenH * 0.28;
  if (player.y < topDeadzone) {
    return player.y - screenH * 0.28;
  }
  if (footY > 420) {
    return footY - screenH * 0.89;
  }
  return groundAnchorY;
}

/** True when a mood or world state represents a bright daytime sky. */
export function isDaytimeSky(mood: MoodSpec | null, entities: readonly Entity[], skyTopColor?: number): boolean {
  if (mood) {
    const n = mood.name.toLowerCase();
    if (n === "daytime" || n === "day" || n === "sunny" || n === "morning" || n === "noon" || n === "bright" || n === "clear" || n === "sunset" || n === "dusk" || n === "golden" || n === "twilight" || n === "dawn" || n === "sunrise") {
      return true;
    }
    if (colorLuminance(mood.skyTop) > 0.30) return true;
  }
  if (skyTopColor !== undefined && colorLuminance(skyTopColor) > 0.30) return true;
  for (let i = 0; i < entities.length; i++) {
    const t = entities[i].type.toLowerCase();
    if (t === "sun" || t === "day-sky" || /\bsun\b/.test(t)) return true;
  }
  return false;
}

/** True for entities that cast a contact shadow onto the ground/platform below them. */
export function castsContactShadow(e: Entity, isEffect?: (type: string) => boolean): boolean {
  const t = e.type.toLowerCase();
  if (TERRAIN_TYPE_RE.test(t)) return false;
  if (t.includes("ground") || t.includes("platform") || t.includes("cliff") || t.includes("wall") || t.includes("sky") || t.includes("cloud") || t.includes("parallax") || t.includes("bg-") || t === "sun" || /\bsun\b/.test(t)) {
    return false;
  }
  if (typeof e.data?.parallax === "number" && e.data.parallax < 0.95) return false;
  if (isEffect && isEffect(e.type)) return false;
  return true;
}

/**
 * Raycast straight down from the bottom-center of `e` to find the highest solid
 * ground or platform surface directly underneath it within `maxDist` pixels.
 */
export function findSurfaceBelow(entities: readonly Entity[], e: Entity, maxDist = 220): SurfaceHit | null {
  const cx = e.x + e.w * 0.5;
  const footY = e.y + e.h;
  let best: Entity | null = null;
  let bestY = Infinity;

  for (let i = 0; i < entities.length; i++) {
    const s = entities[i];
    if (!s.solid || s === e) continue;
    // Skip tall hanging cliff overhangs as floor shadow receivers when the entity is below their top.
    if (s.h >= 300 && s.y < 0) continue;
    if (cx < s.x - 4 || cx > s.x + s.w + 4) continue;
    if (s.y < footY - 8) continue;
    if (s.y < bestY) {
      bestY = s.y;
      best = s;
    }
  }

  if (!best) return null;
  const height = Math.max(0, bestY - footY);
  if (height > maxDist) return null;
  const factor = Math.max(0, Math.min(1, 1 - height / maxDist));
  return { surface: best, y: bestY, height, factor };
}

/**
 * Draw soft layered ground contact shadows on the nearest solid surface below each entity.
 * Call after solid terrain is drawn and before dynamic entities/sprites are drawn.
 */
export function drawContactShadows(
  gfx: Graphics,
  entities: readonly Entity[],
  camX: number,
  camY: number,
  W: number,
  H: number,
  isEffect?: (type: string) => boolean,
  lightX?: number,
): number {
  let count = 0;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!castsContactShadow(e, isEffect)) continue;
    const hit = findSurfaceBelow(entities, e, 220);
    if (!hit) continue;

    const cxScreen = e.x + e.w * 0.5 - camX;
    // The shadow slides away from the sun/moon the higher the entity is above the surface.
    const lean = lightX === undefined ? 0 : (cxScreen < lightX ? -1 : 1) * Math.min(26, hit.height * 0.18);
    const sx = cxScreen + lean;
    const sy = hit.y - camY + 1.5;
    if (sx < -80 || sx > W + 80 || sy < -40 || sy > H + 40) continue;

    const k = hit.factor;
    const isPlayer = e.type === "player";
    const baseRx = isPlayer ? 15 : Math.min(52, Math.max(8, e.w * 0.54));
    const rx1 = baseRx * (0.38 + 0.62 * k);
    const ry1 = Math.max(2.0, 4.2 * (0.45 + 0.55 * k));

    // Outer ambient shadow ellipse
    gfx.ellipse(sx, sy, rx1, ry1).fill({ color: 0x030508, alpha: 0.28 * k * k });
    // Inner crisp ambient-occlusion core directly under the feet
    gfx.ellipse(sx, sy - 0.4, rx1 * 0.62, Math.max(1.3, ry1 * 0.56)).fill({
      color: 0x010204,
      alpha: 0.40 * k * k * k,
    });
    count++;
  }
  return count;
}

/** The lighter upper surface of a slab: a trapezoid above the front edge, with a dark outline and a darker back edge. */
function drawTopFace(gfx: Graphics, x: number, y: number, w: number, depth: number, inL: number, grass: number, inR = inL): void {
  const face = mixColor(grass, 0xffffff, 0.2);
  gfx.poly([x - 1, y + 0.5, x + inL - 0.5, y - depth - 1.5, x + w - inR + 0.5, y - depth - 1.5, x + w + 1, y + 0.5]).fill(0x0b0e13);
  gfx.poly([x, y + 0.5, x + inL, y - depth, x + w - inR, y - depth, x + w, y + 0.5]).fill(face);
  gfx.rect(x + inL, y - depth, Math.max(0, w - inL - inR), 1.2).fill({ color: scaleColor(grass, 0.6), alpha: 0.55 });
  gfx.rect(x, y - 1.5, w, 1.5).fill({ color: scaleColor(grass, 0.7), alpha: 0.35 });
}

/**
 * Draw 2.5D ground and floating platforms with:
 * - Top specular catch-light & grass tufts
 * - 4-5px dark ambient-occlusion overhang shadow directly under the grass turf lip
 * - Vertical subsurface soil/bedrock depth strata & recessed stone blocks
 * - Floating platform underside bevel & soft projected drop-shadow
 */
export function drawGround25D(
  gfx: Graphics,
  e: Entity,
  x: number,
  y: number,
  pal: DepthPalette,
  W: number,
  H: number,
  grade: (c: number) => number = (c) => c,
): void {
  const isFloating = e.h < 36 || (e.type.toLowerCase().includes("platform") && e.y < 385);
  const vx0 = Math.max(-48, x);
  const vx1 = Math.min(W + 48, x + e.w);
  const vw = vx1 - vx0;
  if (vw <= 0) return;

  const gh = isFloating
    ? Math.min(7, Math.max(4, Math.round(e.h * 0.30)))
    : Math.min(10, Math.max(6, Math.round(e.h * 0.20)));

  const grassTop = mixColor(pal.grass, 0xffffff, 0.40);
  const grassMid = pal.grass;
  const grassDeep = scaleColor(pal.grass, 0.72);

  if (isFloating) {
    // 1. Soft multi-layered drop shadow beneath floating platform
    gfx.roundRect(x + 2, y + e.h + 1, e.w - 4, 6, 3).fill({ color: 0x020407, alpha: 0.38 });
    gfx.roundRect(x + 8, y + e.h + 4, Math.max(8, e.w - 16), 7, 3).fill({ color: 0x020407, alpha: 0.18 });

    // 2. Dark outline
    gfx.roundRect(x - 1.5, y - 1.5, e.w + 3, e.h + 3, 3).fill(0x0b0e13);

    // 3. Stone/wood body with vertical shading & underside bevel
    const bodyBase = mixColor(e.color, grade(0x6e5338), 0.35);
    const bodyDark = scaleColor(bodyBase, 0.58);
    const bodyHighlight = scaleColor(bodyBase, 1.22);
    gfx.rect(x, y + gh, e.w, e.h - gh).fill(bodyBase);
    // Underside 3D bevel
    const bevH = Math.min(5, Math.max(3, (e.h - gh) * 0.35));
    gfx.rect(x, y + e.h - bevH, e.w, bevH).fill(bodyDark);
    // Left light bevel & right shadow bevel
    gfx.rect(x, y + gh, 3, e.h - gh).fill({ color: bodyHighlight, alpha: 0.42 });
    gfx.rect(x + e.w - 4, y + gh, 4, e.h - gh).fill({ color: 0x06090e, alpha: 0.38 });

    // 4. Deterministic stone/plank block seams
    const step = 26;
    const k0 = Math.max(0, Math.floor((vx0 - x) / step));
    const k1 = Math.min(Math.floor(e.w / step), Math.ceil((vx1 - x) / step));
    for (let k = k0; k < k1; k++) {
      const bx = x + k * step;
      if (k > 0) {
        gfx.rect(bx, y + gh + 1, 1.5, e.h - gh - 2).fill({ color: 0x080b10, alpha: 0.36 });
        gfx.rect(bx + 1.5, y + gh + 1, 1, e.h - gh - 3).fill({ color: bodyHighlight, alpha: 0.22 });
      }
    }

    // 5. AO shadow band directly under the grass overhang
    gfx.rect(x, y + gh, e.w, 2.5).fill({ color: 0x04070a, alpha: 0.52 });
    gfx.rect(x, y + gh + 2.5, e.w, 2).fill({ color: 0x04070a, alpha: 0.22 });

    // 5b. Top face: the slab's upper surface, lighter than the front lip and narrowing towards the back
    drawTopFace(gfx, x, y, e.w, 5, 3, grassMid);

    // 6. Grass lip + overhang scallops + top catch-light
    gfx.rect(x, y, e.w, gh).fill(grassMid);
    gfx.rect(x, y + gh - 2, e.w, 2).fill(grassDeep);
    gfx.rect(x, y, e.w, 1.6).fill({ color: grassTop, alpha: 0.85 });

    const turfStep = 18;
    const t0 = Math.max(0, Math.floor((vx0 - x) / turfStep));
    const t1 = Math.min(Math.floor((e.w - 6) / turfStep), Math.ceil((vx1 - x) / turfStep));
    for (let k = t0; k <= t1; k++) {
      const hsh = (((Math.floor(e.x) + k * 43) * 2654435761) >>> 0) % 100;
      const tx = x + 4 + k * turfStep + (hsh % 5);
      if (tx + 6 > x + e.w - 2) continue;
      const th = 2 + (hsh % 2);
      gfx.rect(tx, y + gh - 1, 5 + (hsh % 4), th).fill(grassDeep);
      if (hsh % 3 === 0) {
        gfx.rect(tx + 1, y - 2, 2, 2).fill(grassMid);
      }
    }
    return;
  }

  // --- Main Ground Slab (deep 2.5D cross-section) ---
  const visH = Math.max(e.h, H - y + 12);
  // Warm rich earth tones derived from pal.soil so ground never looks like a flat neon-green bar
  const topSoil = mixColor(pal.soil, grade(0x3a2618), 0.48);
  const midSoil = scaleColor(topSoil, 0.74);
  const deepSoil = scaleColor(topSoil, 0.50);
  const rockCol = mixColor(topSoil, grade(0x4c4642), 0.45);
  const rockHi = scaleColor(rockCol, 1.28);
  const rockLo = scaleColor(rockCol, 0.55);

  // Dark outline along top and exposed sides
  gfx.rect(vx0 - 1.5, y - 1.5, vw + 3, visH + 3).fill(0x0b0e13);

  // 1. Subsurface vertical depth strata
  const band1 = Math.min(visH - gh, 18);
  const band2 = Math.min(Math.max(0, visH - gh - band1), 26);
  gfx.rect(vx0, y + gh, vw, visH - gh).fill(deepSoil);
  if (band1 > 0) gfx.rect(vx0, y + gh, vw, band1).fill(topSoil);
  if (band2 > 0) gfx.rect(vx0, y + gh + band1, vw, band2).fill(midSoil);

  // Subtle horizontal strata separator lines
  if (visH > gh + 18) {
    gfx.rect(vx0, y + gh + band1, vw, 2).fill({ color: 0x05080c, alpha: 0.25 });
  }
  if (visH > gh + 44) {
    gfx.rect(vx0, y + gh + band1 + band2, vw, 2).fill({ color: 0x05080c, alpha: 0.30 });
  }

  // Left/right side bevels if the slab ends on screen
  if (x >= -10 && x <= W + 10) {
    gfx.rect(x, y + gh, 4, visH - gh).fill({ color: rockHi, alpha: 0.35 });
  }
  if (x + e.w >= -10 && x + e.w <= W + 10) {
    gfx.rect(x + e.w - 5, y + gh, 5, visH - gh).fill({ color: 0x04060a, alpha: 0.45 });
  }

  // 2. Deterministic stone/cobble strata blocks & pebbles (culled to visible screen X)
  const cellW = 28;
  const firstCol = Math.floor((vx0 - x) / cellW);
  const lastCol = Math.ceil((vx1 - x) / cellW);
  const baseYSeed = Math.floor(e.y) * 13;
  for (let col = firstCol; col <= lastCol; col++) {
    const wx = x + col * cellW;
    if (wx < x + 2 || wx + cellW > x + e.w - 2) continue;
    const h1 = (((col * 73856093) ^ (baseYSeed + 19349663)) >>> 0) % 1000;
    const bx = wx + (h1 % 7);
    const by = y + gh + 6 + ((h1 >> 3) % 10);
    const bw = 12 + (h1 % 10);
    const bh = 6 + ((h1 >> 5) % 4);
    gfx.rect(bx, by, bw, bh).fill(rockCol);
    gfx.rect(bx, by, bw, 1.5).fill({ color: rockHi, alpha: 0.45 });
    gfx.rect(bx, by + bh - 1.5, bw, 1.5).fill({ color: rockLo, alpha: 0.55 });

    // Deeper second-row stone block
    if (visH > gh + 30 && (h1 & 1) === 0) {
      const bx2 = wx + 4 + ((h1 >> 4) % 8);
      const by2 = y + gh + 22 + ((h1 >> 6) % 12);
      const bw2 = 14 + ((h1 >> 2) % 10);
      const bh2 = 7 + ((h1 >> 7) % 5);
      gfx.rect(bx2, by2, bw2, bh2).fill(scaleColor(rockCol, 0.82));
      gfx.rect(bx2, by2, bw2, 1.2).fill({ color: rockHi, alpha: 0.30 });
      gfx.rect(bx2, by2 + bh2 - 1.5, bw2, 1.5).fill({ color: 0x05080c, alpha: 0.45 });
    }
  }

  // 3. Dark ambient-occlusion shadow band directly under the grass overhang (y + gh)
  gfx.rect(vx0, y + gh, vw, 3.5).fill({ color: 0x030609, alpha: 0.58 });
  gfx.rect(vx0, y + gh + 3.5, vw, 2.5).fill({ color: 0x030609, alpha: 0.26 });

  // 3b. Top face: the walkable surface seen slightly from above, so the ground reads as a slab, not a strip
  drawTopFace(gfx, vx0, y, vw, 11, x >= -10 ? 5 : 0, grassMid, x + e.w <= W + 10 ? 5 : 0);

  // 4. Grass turf layer, overhanging turf scallops, grass blades, and top specular catch-light
  gfx.rect(vx0, y, vw, gh).fill(grassMid);
  gfx.rect(vx0, y + gh - 2.5, vw, 2.5).fill(grassDeep);
  gfx.rect(vx0, y, vw, 1.8).fill({ color: grassTop, alpha: 0.82 });

  const turfCell = 20;
  const tc0 = Math.floor((vx0 - x) / turfCell);
  const tc1 = Math.ceil((vx1 - x) / turfCell);
  for (let c = tc0; c <= tc1; c++) {
    const tx = x + c * turfCell;
    if (tx < x + 2 || tx + turfCell > x + e.w - 2) continue;
    const hsh = (((c * 83492791) ^ (baseYSeed + 514229)) >>> 0) % 100;
    const ox = tx + (hsh % 6);
    const ow = 6 + (hsh % 7);
    const oh = 2 + (hsh % 3);
    // Overhanging turf tooth casting micro-AO
    gfx.rect(ox, y + gh - 1, ow, oh).fill(grassDeep);
    gfx.rect(ox + 1, y + gh + oh - 1, ow - 1, 1.5).fill({ color: 0x020407, alpha: 0.42 });

    // Small pixel grass tuft above top surface
    if (hsh % 2 === 0) {
      const gx = tx + 3 + ((hsh >> 2) % 11);
      gfx.rect(gx, y - 2.5, 2, 2.5).fill(grassMid);
      gfx.rect(gx + 2, y - 1.5, 2, 1.5).fill(grassTop);
    }
  }
}

/**
 * Distant mountain silhouette behind ridgeFar (0.16x parallax) + volumetric celestial shafts
 * in the sky plane (occluded naturally by the mountains and terrain in front).
 */
/** Sun/moon spot: left of the starter cliff and clear of the orb bar, so the overhang never hides it. */
export function celestialPos(W: number): { x: number; y: number } {
  return { x: W * 0.76, y: 96 };
}

export function drawDistantMountains(
  gfx: Graphics,
  camX: number,
  camY: number,
  W: number,
  H: number,
  pal: DepthPalette,
  skyBottom: number,
): void {
  const horizon = H * 0.62 - camY * 0.1;

  // Subtle diagonal volumetric sky shafts behind the mountain ridges (occluded at the bottom by the ridges)
  const { x: cx, y: cy } = celestialPos(W);
  for (let i = 0; i < 3; i++) {
    const topX = cx - 14 + i * 14;
    const topY = cy + 6;
    const botX = cx - 280 - i * 140;
    const botY = horizon + 40;
    const wTop = 22 + i * 8;
    const wBot = 95 + i * 32;
    gfx.poly([
      topX - wTop * 0.5, topY,
      topX + wTop * 0.5, topY,
      botX + wBot * 0.5, botY,
      botX - wBot * 0.5, botY,
    ]).fill({ color: pal.moon, alpha: 0.028 - i * 0.005 });
  }

  const farMistRidge = mixColor(pal.ridgeFar, skyBottom, 0.45);
  const rimCol = mixColor(farMistRidge, pal.moon, 0.26);
  const step = 36;
  const pts: number[] = [];
  for (let sx = -step; sx <= W + step; sx += step) {
    const wx = sx + camX * 0.16;
    const dy = Math.sin(wx * 0.0055 + 0.8) * 44 + Math.sin(wx * 0.014 + 2.4) * 18 + Math.cos(wx * 0.027) * 7;
    pts.push(sx, horizon - 32 - dy);
  }
  const topCount = pts.length;
  pts.push(W + step, H, -step, H);
  gfx.poly(pts).fill(farMistRidge);
  for (let i = 0; i + 3 < topCount; i += 2) {
    gfx.moveTo(pts[i], pts[i + 1]).lineTo(pts[i + 2], pts[i + 3]).stroke({ width: 1.5, color: rimCol, alpha: 0.30 });
  }
}

/**
 * Atmospheric perspective & horizon mist bands separating distant mountain/ridge planes
 * from the midground play plane. Call after ridgeFar and ridgeNear are drawn.
 */
export function drawHorizonMist(
  gfx: Graphics,
  _camX: number,
  camY: number,
  W: number,
  H: number,
  pal: DepthPalette,
  skyBottom: number,
): void {
  const horizon = H * 0.62 - camY * 0.1;
  const mistColor = mixColor(skyBottom, pal.moon, 0.22);
  // Graduated atmospheric haze across the lower ridges and valley floor
  const groundY = Math.min(H, 400 - camY);
  const span = Math.max(40, groundY - (horizon - 10));
  const bands = 8;
  const bandH = span / bands;
  for (let i = 0; i < bands; i++) {
    const t = (i + 1) / bands;
    const alpha = 0.018 + 0.075 * t * t;
    gfx.rect(0, horizon - 10 + i * bandH, W, bandH + 1).fill({ color: mistColor, alpha });
  }
}

/**
 * Dynamic point lights, celestial bloom/volumetric shafts, player presence rim light,
 * and surface light bounce using Fx's pooled radial gradient sprites.
 */
export function drawDynamicLighting(
  gfx: Graphics,
  puff: PuffFn,
  world: World,
  camX: number,
  camY: number,
  W: number,
  H: number,
  clock: number,
  mood: MoodSpec | null,
  moonColor: number,
  skyTopColor?: number,
): void {
  const daytime = isDaytimeSky(mood, world.entities, skyTopColor);

  // 1. Celestial bloom & soft diagonal volumetric light shafts
  const sunEntity = world.entities.find((e) => {
    const t = e.type.toLowerCase();
    return t === "sun" || /\bsun\b/.test(t);
  });
  const cx = sunEntity ? sunEntity.x + sunEntity.w * 0.5 - camX : W - 70;
  const cy = sunEntity ? sunEntity.y + sunEntity.h * 0.5 - camY : 60;
  const celColor = daytime ? 0xffe478 : moonColor;

  let occludedBySolid = false;
  if (!sunEntity) {
    const wx = cx + camX;
    const wy = cy + camY;
    for (let i = 0; i < world.entities.length; i++) {
      const s = world.entities[i];
      if (s.solid && wx >= s.x - 16 && wx <= s.x + s.w + 16 && wy >= s.y - 16 && wy <= s.y + s.h + 16) {
        occludedBySolid = true;
        break;
      }
    }
  }

  if (!occludedBySolid && cx >= -120 && cx <= W + 120 && cy >= -120 && cy <= H + 120) {
    puff(cx, cy, daytime ? 120 : 88, celColor, daytime ? 0.16 : 0.10, true);
    puff(cx, cy, daytime ? 58 : 42, 0xfff8dc, daytime ? 0.22 : 0.14, true);
  }

  // 2. Subtle player presence light & ground foot bounce
  const player = world.entities.find((e) => e.type === "player");
  if (player) {
    const px = player.x + player.w * 0.5 - camX;
    const py = player.y + player.h * 0.5 - camY;
    if (px >= -80 && px <= W + 80 && py >= -80 && py <= H + 80) {
      const pAlpha = daytime ? 0.045 : 0.095;
      puff(px, py, 58, 0xffe8c2, pAlpha, true);
      const hit = findSurfaceBelow(world.entities, player, 110);
      if (hit) {
        puff(px, hit.y - camY + 2, 34 * (0.4 + 0.6 * hit.factor), 0xffe2b0, pAlpha * 0.85 * hit.factor, true);
      }
    }
  }

  // 3. Emissive entities: additive point-light halo + ground light spill
  let lightCount = 0;
  for (let i = 0; i < world.entities.length; i++) {
    if (lightCount >= 28) break;
    const e = world.entities[i];
    const t = e.type.toLowerCase();
    if (!EMISSIVE_TYPE_RE.test(t)) continue;

    const ex = e.x + e.w * 0.5 - camX;
    const ey = e.y + e.h * 0.5 - camY;
    if (ex < -100 || ex > W + 100 || ey < -100 || ey > H + 100) continue;

    const isCoin = t.includes("coin");
    const isFire = t.includes("fire") || t.includes("arrow") || t.includes("flame") || t.includes("torch") || t.includes("ember") || t.includes("lava");
    const lightCol = isCoin
      ? 0xffd84d
      : isFire
        ? 0xff7b24
        : mixColor(e.color || 0xffe082, 0xffffff, 0.25);

    const pulse = 0.92 + 0.08 * Math.sin(clock * 5.2 + e.id * 1.7);
    const radius = (isCoin ? 28 : Math.max(34, Math.min(84, Math.max(e.w, e.h) * 2.1))) * pulse;
    const haloAlpha = isCoin ? (daytime ? 0.12 : 0.18) : (daytime ? 0.16 : 0.24);

    puff(ex, ey, radius, lightCol, haloAlpha, true);

    const hit = findSurfaceBelow(world.entities, e, 125);
    if (hit) {
      const sy = hit.y - camY + 2;
      const bounceR = radius * 0.82 * (0.45 + 0.55 * hit.factor);
      const bounceAlpha = haloAlpha * 0.72 * hit.factor;
      puff(ex, sy, bounceR, lightCol, bounceAlpha, true);
    }
    lightCount++;
  }

  const lightCol = daytime ? 0xfff0c0 : moonColor;
  drawRimLights(gfx, world.entities, camX, camY, W, lightCol);
  drawForegroundLayer(gfx, camX, camY, W, H, mixColor(0x04070a, mood?.skyBottom ?? 0x0d1b20, 0.18));
}

/** A soft light edge on the side of each creature that faces the sun/moon. */
export function drawRimLights(gfx: Graphics, entities: readonly Entity[], camX: number, camY: number, W: number, color: number): void {
  const lx = celestialPos(W).x;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (e.solid || !castsContactShadow(e)) continue;
    const cx = e.x + e.w * 0.5 - camX;
    if (cx < -60 || cx > W + 60) continue;
    const cy = e.y + e.h * 0.5 - camY;
    const side = cx < lx ? 1 : -1;
    const ex = cx + side * e.w * 0.42;
    gfx.ellipse(ex, cy, Math.max(2, e.w * 0.14), e.h * 0.4).fill({ color, alpha: 0.07 });
    gfx.ellipse(ex, cy - e.h * 0.04, Math.max(1.2, e.w * 0.07), e.h * 0.3).fill({ color, alpha: 0.13 });
  }
}

/**
 * Sparse dark silhouettes (grass clusters, rocks) in FRONT of the play plane, sliding faster than the
 * camera. They stay in the soil strip below the walking surface so they never cover gameplay.
 */
export function drawForegroundLayer(gfx: Graphics, camX: number, camY: number, W: number, H: number, base: number): void {
  const floorTop = 400 - camY + 4;
  const room = H - floorTop;
  if (room < 14) return;
  const step = 150;
  const par = 1.5;
  const first = Math.floor((camX * par - 100) / step);
  const last = Math.ceil((camX * par + W + 100) / step);
  for (let c = first; c <= last; c++) {
    const h = ((c * 2654435761) >>> 0) % 1000;
    if (h < 380) continue; // sparse: most cells are empty
    const cx = c * step + (h % 90) - camX * par;
    const maxH = Math.min(room - 2, 90);
    if (h < 860) {
      for (let b = 0; b < 9; b++) {
        const hb = ((h * (b + 3) * 40503) >>> 0) % 100;
        const bx = cx + b * 6 - 24;
        const bh = Math.max(14, maxH * (0.4 + hb / 140));
        const lean = (hb % 2 ? 1 : -1) * (3 + (hb % 5));
        gfx.poly([bx - 4.5, H + 2, bx + 4.5, H + 2, bx + lean, H - bh]).fill({ color: base, alpha: 1 });
      }
    } else {
      const rw = 34 + (h % 30);
      const rh = Math.min(maxH * 0.6, 20 + (h % 12));
      gfx.poly([cx - rw, H + 2, cx - rw * 0.7, H - rh * 0.7, cx - rw * 0.2, H - rh, cx + rw * 0.4, H - rh * 0.8, cx + rw, H + 2]).fill({ color: base, alpha: 0.94 });
    }
  }
  // Darkened bottom edge, as if the camera looks past the near plane
  for (let i = 0; i < 4; i++) gfx.rect(0, H - 10 - i * 10, W, 10).fill({ color: base, alpha: 0.07 });
}

/** How much the far and near ridges blend into the sky colour: more haze in moody/low-light worlds. */
export function depthFog(moodName: string | undefined): { far: number; near: number } {
  switch (moodName) {
    case "spooky": return { far: 0.5, near: 0.28 };
    case "daytime": return { far: 0.42, near: 0.2 };
    case "christmas": case "snowy": return { far: 0.4, near: 0.2 };
    case "neon": return { far: 0.18, near: 0.08 };
    default: return { far: 0.3, near: 0.14 };
  }
}

/**
 * Render the vertical sky gradient, parallax night stars, and celestial body
 * (radiant multi-ring golden Sun in daytime, Crescent Moon with shadow cutout at night).
 * If a mod spawned an explicit sun entity, the fixed top-right celestial body is hidden.
 */
export function drawSkyAndCelestials(
  gfx: Graphics,
  W: number,
  H: number,
  camX: number,
  skyBands: number,
  skyColors: readonly number[],
  pal: DepthPalette,
  isDaytime: boolean,
  hasSunEntity: boolean,
  skyEntityColor?: number,
): void {
  // Enough bands that the steps are finer than the gradient's colour steps (12 bands read as visible stripes at 1080p).
  const bands = Math.max(skyBands, 72);
  const bandH = Math.ceil(H / bands);
  let topColor = skyColors[0] ?? 0x05070a;
  let bottomColor = skyColors[skyColors.length - 1] ?? 0x0d2229;
  if (skyEntityColor !== undefined && skyEntityColor > 0) {
    topColor = mixColor(topColor, skyEntityColor, 0.65);
    bottomColor = mixColor(bottomColor, skyEntityColor, 0.88);
  }

  for (let i = 0; i < bands; i++) {
    const col = mixColor(topColor, bottomColor, i / (bands - 1));
    gfx.rect(0, i * bandH, W, bandH + 1).fill(col);
  }

  if (!isDaytime) {
    // 14 night stars (parallax markers)
    for (let i = 0; i < 14; i++) {
      const sx = ((i * 173 - camX * 0.3) % (W + 80) + W + 80) % (W + 80) - 40;
      gfx.rect(sx, 40 + (i % 5) * 22, 3, 3).fill(pal.star);
    }
  }

  // Celestial body: only drawn if mod did not spawn an explicit sun entity
  if (!hasSunEntity) {
    const { x: cx, y: cy } = celestialPos(W);
    if (isDaytime) {
      // Radiant Sun: multi-ring warm golden glow + bright sun disc (NO crescent shadow cutout!)
      gfx.circle(cx, cy, 38).fill({ color: 0xffd952, alpha: 0.16 });
      gfx.circle(cx, cy, 26).fill({ color: 0xffe875, alpha: 0.30 });
      gfx.circle(cx, cy, 18).fill(pal.moon || 0xffe042);
      gfx.circle(cx, cy, 12).fill(0xfffae0);
    } else {
      // Crescent Moon in a soft halo, so dark moods have a focal light
      for (let i = 0; i < 4; i++) gfx.circle(cx, cy, 120 - i * 26).fill({ color: pal.moon, alpha: 0.035 });
      gfx.circle(cx, cy, 24).fill({ color: pal.moon, alpha: 0.15 });
      gfx.circle(cx, cy, 17).fill(pal.moon);
      // The cutout takes the sky's colour at the moon's height (a flat band colour would show as a dark disc on the halo).
      const skyAtMoon = mixColor(skyColors[0] ?? 0x05070a, skyColors[skyColors.length - 1] ?? 0x05070a, cy / H);
      gfx.circle(cx - 6, cy - 6, 14).fill(mixColor(skyAtMoon, pal.moon, 0.1));
    }
  }
}

/**
 * Render an explicit sun entity as a radiant sun disc without rectangular outlines.
 */
export function drawSunEntity(
  gfx: Graphics,
  e: Entity,
  x: number,
  y: number,
): void {
  const cx = x + e.w * 0.5;
  const cy = y + e.h * 0.5;
  const r = Math.max(16, Math.min(e.w, e.h) * 0.5);
  gfx.circle(cx, cy, r * 2.2).fill({ color: 0xffd952, alpha: 0.18 });
  gfx.circle(cx, cy, r * 1.5).fill({ color: 0xffe875, alpha: 0.32 });
  gfx.circle(cx, cy, r).fill(e.color || 0xffe042);
  gfx.circle(cx, cy, r * 0.65).fill(0xfffae0);
}
