// Multi-layer fractional camera scroll, seamless horizontal wrapping, and procedural
// background silhouettes + fluffy clouds (bead rm1 & bead 196).
// Pure render-side: reads World/Entity state, never mutates sim state.

import type { Graphics } from "pixi.js";
import type { Entity } from "../contract";
import { type DepthPalette, mixColor, scaleColor } from "./depth";
import { isSetPiece } from "./setpieces";

const PARALLAX_TYPE_RE = /^(parallax|bg-|background-|far-mountain|distant-mountain|mountain-bg|hill-bg|forest-bg|treeline|sky-cloud|cloud\b)/i;

/**
 * Determine the fractional camera scroll factor for an entity (0.02 .. 0.92),
 * or null if the entity belongs to the 1.0x gameplay plane.
 */
export function parallaxFactorOf(e: Entity): number | null {
  if (e.solid || e.type === "player") return null;
  const rawPar = e.data?.parallax ?? e.data?.scrollFactor;
  if (typeof rawPar === "number" && Number.isFinite(rawPar) && rawPar > 0 && rawPar < 0.95) {
    return Math.max(0.02, Math.min(0.92, rawPar));
  }
  const rawDepth = e.data?.depth;
  if (typeof rawDepth === "number" && Number.isFinite(rawDepth) && rawDepth > 0) {
    if (rawDepth < 0.95) return Math.max(0.02, Math.min(0.92, rawDepth));
    return Math.max(0.05, Math.min(0.85, 1 / (1 + rawDepth * 0.5)));
  }

  const t = e.type.toLowerCase();
  // A landmark (ADR 0080) is drawn by the set-piece layer, on the ground at 1x. Letting this pass draw a
  // grey silhouette for it too put two mountains on screen, the second sliding at 0.22x.
  if (isSetPiece(e) && !/(parallax|bg-|background|far-|distant-|-bg\b)/.test(t)) return null;
  if (t === "sky" || t === "day-sky" || t === "night-sky" || t === "background") return 0.0;
  if (t.includes("cloud") || t.includes("cumulus")) return 0.18;
  if (t.includes("parallax-far") || t.includes("bg-far") || t.includes("far-mountain") || t.includes("peak") || t.includes("alps")) return 0.15;
  if (t.includes("mountain") || t.includes("crag") || t.includes("volcano")) return 0.22;
  if (t.includes("parallax-mid") || t.includes("bg-mid") || t.includes("hill") || t.includes("ridge") || t.includes("dune") || t.includes("ruin")) return 0.36;
  if (t.includes("parallax-near") || t.includes("bg-near") || t.includes("parallax-forest") || t.includes("forest") || t.includes("treeline") || t.includes("pine") || t.includes("bg-tree")) return 0.54;
  if (PARALLAX_TYPE_RE.test(t) || t.includes("parallax")) return 0.32;
  return null;
}

/** True when `e` is a sky/background or parallax-layer entity handled before the gameplay pass. */
export function isSkyOrBackgroundEntity(e: Entity): boolean {
  if (e.solid || e.type === "player") return false;
  const t = e.type.toLowerCase();
  return t === "sky" || t === "background" || t.includes("sky") || t.includes("background");
}

/** A cloud or cumulus layer entity: it still drifts in front of a themed backdrop (ADR 0067). */
export function isCloudEntity(e: Entity): boolean {
  if (e.solid || e.type === "player") return false;
  const t = e.type.toLowerCase();
  return t.includes("cloud") || t.includes("cumulus");
}

export function isParallaxOrSkyEntity(e: Entity): boolean {
  if (e.solid || e.type === "player") return false;
  const t = e.type.toLowerCase();
  if (isSkyOrBackgroundEntity(e)) return true;
  if (t.includes("cloud") || t.includes("cumulus")) return true;
  return parallaxFactorOf(e) !== null;
}

/**
 * Compute seamlessly wrapped screen X for a parallax entity so it tiles across
 * any camera position without scrolling permanently off-screen.
 */
export function wrapParallaxX(
  worldX: number,
  camX: number,
  factor: number,
  wrapSpan: number,
  entityW: number,
): number {
  const span = Math.max(320, wrapSpan);
  const shifted = worldX - camX * factor + entityW;
  const wrapped = ((shifted % span) + span) % span;
  return wrapped - entityW;
}

/**
 * Draw a soft, multi-lobe procedural fluffy cloud without any rectangular outline.
 */
export function drawFluffyCloud(
  gfx: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  baseColor: number,
  moonOrSunColor: number,
  skyBottom: number,
  seed = 1,
): void {
  const cw = Math.max(48, w);
  const ch = Math.max(22, h);
  const cx = x + cw * 0.5;
  const cy = y + ch * 0.58;

  const isDarkSky = ((skyBottom >> 16) & 255) + ((skyBottom >> 8) & 255) + (skyBottom & 255) < 180;
  const bodyCol = isDarkSky
    ? mixColor(skyBottom, moonOrSunColor, 0.32)
    : mixColor(baseColor || 0xffffff, 0xffffff, 0.72);
  const topHighlight = isDarkSky
    ? mixColor(bodyCol, moonOrSunColor, 0.38)
    : 0xffffff;
  const underShade = isDarkSky
    ? scaleColor(bodyCol, 0.68)
    : mixColor(bodyCol, skyBottom, 0.35);

  const alpha = isDarkSky ? 0.52 : 0.90;

  // Soft outer atmospheric glow
  gfx.ellipse(cx, cy, cw * 0.52, ch * 0.48).fill({ color: bodyCol, alpha: alpha * 0.32 });

  // Shaded cloud belly
  gfx.ellipse(cx, cy + ch * 0.14, cw * 0.46, ch * 0.30).fill({ color: underShade, alpha });

  // 5 overlapping rounded puffs
  const lobes = [
    { dx: -0.28, dy: 0.04, rx: 0.24, ry: 0.32 },
    { dx: 0.27, dy: 0.06, rx: 0.23, ry: 0.30 },
    { dx: -0.10, dy: -0.10, rx: 0.28, ry: 0.38 },
    { dx: 0.12, dy: -0.06, rx: 0.25, ry: 0.35 },
    { dx: 0.0, dy: 0.06, rx: 0.36, ry: 0.30 },
  ];
  const asym = ((seed * 37) % 7 - 3) * 0.015;
  for (let i = 0; i < lobes.length; i++) {
    const l = lobes[i];
    const lx = cx + (l.dx + asym) * cw;
    const ly = cy + l.dy * ch;
    const rx = l.rx * cw;
    const ry = l.ry * ch;
    gfx.ellipse(lx, ly, rx, ry).fill({ color: bodyCol, alpha });
    if (l.dy <= 0) {
      gfx.ellipse(lx - rx * 0.12, ly - ry * 0.22, rx * 0.72, ry * 0.55).fill({
        color: topHighlight,
        alpha: alpha * 0.65,
      });
    }
  }
}

function drawMountainSilhouette(
  gfx: Graphics,
  x: number,
  groundY: number,
  w: number,
  h: number,
  color: number,
  moonColor: number,
  skyBottom: number,
  seed: number,
): void {
  const mw = Math.max(180, w);
  const mh = Math.max(90, h);
  const peakX = x + mw * (0.42 + ((seed * 19) % 17) * 0.01);
  const peakY = groundY - mh;
  const subPeakX = x + mw * (0.74 - ((seed * 31) % 13) * 0.01);
  const subPeakY = groundY - mh * 0.72;

  const baseCol = mixColor(color, skyBottom, 0.28);
  const litSlope = mixColor(baseCol, moonColor, 0.16);
  const shadowSlope = scaleColor(baseCol, 0.76);
  const rimCol = mixColor(litSlope, moonColor, 0.28);

  // Main mountain mass
  gfx.poly([
    x, groundY,
    peakX, peakY,
    subPeakX, subPeakY,
    x + mw, groundY,
  ]).fill(shadowSlope);

  // Lit left-facing slope facet
  gfx.poly([
    x, groundY,
    peakX, peakY,
    peakX + mw * 0.08, groundY,
  ]).fill(litSlope);

  // Secondary peak lit facet
  gfx.poly([
    peakX + mw * 0.14, groundY,
    subPeakX, subPeakY,
    subPeakX + mw * 0.05, groundY,
  ]).fill({ color: litSlope, alpha: 0.75 });

  // Snow/mist ridge catch-light on the upper crest
  gfx.moveTo(x + mw * 0.05, groundY - mh * 0.12)
    .lineTo(peakX, peakY)
    .lineTo(subPeakX, subPeakY)
    .stroke({ width: 1.8, color: rimCol, alpha: 0.42 });
}

function drawHillSilhouette(
  gfx: Graphics,
  x: number,
  groundY: number,
  w: number,
  h: number,
  color: number,
  moonColor: number,
  skyBottom: number,
): void {
  const hw = Math.max(140, w);
  const hh = Math.max(50, h);
  const fillCol = mixColor(color, skyBottom, 0.18);
  const rimCol = mixColor(fillCol, moonColor, 0.20);

  const steps = 12;
  const pts: number[] = [x, groundY];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = x + t * hw;
    const arch = Math.sin(t * Math.PI);
    const py = groundY - arch * hh;
    pts.push(px, py);
  }
  pts.push(x + hw, groundY);
  gfx.poly(pts).fill(fillCol);

  for (let i = 2; i + 3 < pts.length - 2; i += 2) {
    gfx.moveTo(pts[i], pts[i + 1]).lineTo(pts[i + 2], pts[i + 3]).stroke({
      width: 1.5,
      color: rimCol,
      alpha: 0.30,
    });
  }
}

function drawForestTreeline(
  gfx: Graphics,
  x: number,
  groundY: number,
  w: number,
  h: number,
  color: number,
  moonColor: number,
  skyBottom: number,
  seed: number,
): void {
  const fw = Math.max(80, w);
  const fh = Math.max(48, h);
  const foliageCol = mixColor(color, skyBottom, 0.12);
  const foliageLit = mixColor(foliageCol, moonColor, 0.16);
  const trunkCol = scaleColor(foliageCol, 0.52);

  const count = Math.max(2, Math.min(9, Math.round(fw / 38)));
  const spacing = fw / count;
  for (let i = 0; i < count; i++) {
    const hsh = (((seed * 31 + i * 73) * 2654435761) >>> 0) % 100;
    const tx = x + (i + 0.5) * spacing + ((hsh % 9) - 4);
    const th = fh * (0.72 + (hsh % 35) * 0.01);
    const tw = Math.max(20, Math.min(44, th * 0.52));

    // Trunk
    gfx.rect(tx - 2.5, groundY - th * 0.24, 5, th * 0.24).fill(trunkCol);

    // 3 tiered pine bough triangles
    for (let tier = 0; tier < 3; tier++) {
      const ty = groundY - th * (0.20 + tier * 0.24);
      const tierH = th * (0.42 - tier * 0.05);
      const tierW = tw * (1.0 - tier * 0.18);
      gfx.poly([
        tx, ty - tierH,
        tx + tierW * 0.5, ty,
        tx - tierW * 0.5, ty,
      ]).fill(foliageCol);
      // Rim catch-light on left side of each bough
      gfx.poly([
        tx, ty - tierH,
        tx, ty,
        tx - tierW * 0.5, ty,
      ]).fill({ color: foliageLit, alpha: 0.35 });
    }
  }
}

function drawSingleParallaxEntity(
  gfx: Graphics,
  e: Entity,
  sx: number,
  sy: number,
  groundScreenY: number,
  pal: DepthPalette,
  skyBottom: number,
  grade: (c: number) => number,
): void {
  const t = e.type.toLowerCase();
  const c = grade(e.color || pal.ridgeNear);

  if (t.includes("cloud") || t.includes("cumulus")) {
    drawFluffyCloud(gfx, sx, sy, e.w, e.h, c, pal.moon, skyBottom, e.id);
    return;
  }
  if (t.includes("mountain") || t.includes("peak") || t.includes("alps") || t.includes("crag") || t.includes("parallax-far")) {
    drawMountainSilhouette(gfx, sx, groundScreenY, e.w, e.h, c, pal.moon, skyBottom, e.id);
    return;
  }
  if (t.includes("forest") || t.includes("pine") || t.includes("tree") || t.includes("woods") || t.includes("canopy") || t.includes("parallax-near")) {
    drawForestTreeline(gfx, sx, groundScreenY, e.w, e.h, c, pal.moon, skyBottom, e.id);
    return;
  }
  drawHillSilhouette(gfx, sx, groundScreenY, e.w, e.h, c, pal.moon, skyBottom);
}

/**
 * Render all parallax & cloud background entities in back-to-front order
 * with fractional camera scroll and seamless horizontal wrapping.
 */
export function drawParallaxEntities(
  gfx: Graphics,
  entities: readonly Entity[],
  camX: number,
  camY: number,
  W: number,
  H: number,
  pal: DepthPalette,
  skyBottom: number,
  grade: (c: number) => number = (c) => c,
): number {
  const items: { e: Entity; factor: number }[] = [];
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const t = e.type.toLowerCase();
    if (isSkyOrBackgroundEntity(e)) continue;
    const factor = parallaxFactorOf(e);
    if (factor !== null) items.push({ e, factor });
  }
  if (items.length === 0) return 0;

  items.sort((a, b) => a.factor - b.factor);
  const groundScreenY = Math.min(H + 40, 400 - camY);
  let drawn = 0;

  for (let i = 0; i < items.length; i++) {
    const { e, factor } = items[i];
    const t = e.type.toLowerCase();
    const isCloud = t.includes("cloud") || t.includes("cumulus");
    const wrapW = Math.max(W + e.w + 220, Number(e.data?.wrapWidth) || 1800);
    const sx = wrapParallaxX(e.x, camX, factor, wrapW, e.w);

    // Clouds sit in the upper sky; ground-anchored vistas sit on the horizon/ground plane
    const baseCamY = 400 - H * 0.88;
    const vFactor = isCloud ? 0.15 : 0.25 + factor * 0.55;
    let sy: number;
    if (isCloud) {
      const skyBaseY = e.y < 0 ? Math.max(36, Math.min(H * 0.34, (e.y + 460) * 0.65 + 48)) : 52 + (e.y % 150);
      sy = skyBaseY - (camY - baseCamY) * vFactor;
    } else {
      sy = (e.y - baseCamY) - (camY - baseCamY) * vFactor;
    }

    if (sx + e.w >= -80 && sx <= W + 80) {
      drawSingleParallaxEntity(gfx, e, sx, sy, groundScreenY, pal, skyBottom, grade);
      drawn++;
    }
    const sxTwin = sx + wrapW;
    if (sxTwin + e.w >= -80 && sxTwin <= W + 80) {
      drawSingleParallaxEntity(gfx, e, sxTwin, sy, groundScreenY, pal, skyBottom, grade);
      drawn++;
    }
  }
  return drawn;
}
