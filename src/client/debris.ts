// Debris, small hazards, and particle rendering (bead metabuild-ideation-bex).
// Small hazard things (lava, magma rocks, fireballs, embers, sparks, meteors, asteroids)
// should never be flat squares.
// - Rocks look like real rocks: irregular, faceted, and shaded, with molten cracks on magma rocks.
// - Glowing blobs are round, shaded, glowing droplets with trails and additive glow.
// - Particles are glowing streaks and round embers, never flat rectangles.

import type { Graphics } from "pixi.js";
import type { Entity, Particle } from "../contract";

export const ROCK_PATTERN = /\b(rock|rocks|magma-rock|lava-rock|space-rock|meteor-rock|stone|stones|boulder|boulders|pebble|pebbles|asteroid|asteroids|rubble|crag)\b/i;
export const GLOW_BLOB_PATTERN = /\b(lava|lava-drop|magma|magma-drop|fireball|fireballs|fire-drop|ember|embers|spark|sparks|meteor|meteors|plasma|comet|flame|flames|blob|blobs)\b/i;

export type DebrisKind = "rock" | "glowing-blob";

/** Deterministic 0..1 hash for consistent irregular geometry per entity id. */
export function hashDebris(id: number, salt: number): number {
  return ((((id * 2654435761) ^ (salt * 40503)) >>> 0) % 1000) / 1000;
}

export function scaleRgb(color: number, f: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((color >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((color >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((color & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

export function mixRgb(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(((a >> 16) & 255) * (1 - k) + ((b >> 16) & 255) * k);
  const g = Math.round(((a >> 8) & 255) * (1 - k) + ((b >> 8) & 255) * k);
  const bl = Math.round((a & 255) * (1 - k) + (b & 255) * k);
  return (r << 16) | (g << 8) | bl;
}

/** Classify entity into a specific debris/hazard rendering kind, or undefined if not debris. */
export function debrisKindOf(
  e: Pick<Entity, "type"> & Partial<Pick<Entity, "w" | "h" | "data">>,
): DebrisKind | undefined {
  const t = e.type.toLowerCase();
  // Large terrain or platforms are never debris
  if (t === "player" || t.includes("ground") || t.includes("platform") || t.includes("cliff")) {
    return undefined;
  }
  if (ROCK_PATTERN.test(t)) return "rock";
  if (GLOW_BLOB_PATTERN.test(t)) return "glowing-blob";
  if (e.data?.debris === "rock" || e.data?.debris === true) return "rock";
  if (e.data?.debris === "blob" || e.data?.hazard === true) return "glowing-blob";
  return undefined;
}

export function isDebrisOrHazard(
  e: Pick<Entity, "type"> & Partial<Pick<Entity, "w" | "h" | "data">>,
): boolean {
  return debrisKindOf(e) !== undefined;
}

/**
 * Generate irregular polygon points for a faceted rock silhouette based on entity id.
 * Pure and deterministic: no Math.random.
 */
export function computeRockVertices(
  cx: number,
  cy: number,
  radius: number,
  id: number,
  rotation = 0,
  pointCount = 7,
): number[] {
  const pts: number[] = [];
  for (let i = 0; i < pointCount; i++) {
    const angle = rotation + (i * Math.PI * 2) / pointCount;
    const dist = radius * (0.72 + 0.38 * hashDebris(id, i + 1));
    pts.push(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist);
  }
  return pts;
}

const OUTLINE = 0x0b0e13;

/**
 * Draw an irregular, faceted, 3D-shaded rock.
 * Magma/molten rocks receive glowing fissure cracks and warm ambient aura.
 */
export function drawRock(
  g: Graphics,
  e: Entity,
  x: number,
  y: number,
  tick: number,
): void {
  const w = e.w;
  const h = e.h;
  const cx = x + w * 0.5;
  const cy = y + h * 0.5;
  const r = Math.max(4, Math.min(w, h) * 0.5);
  const color = e.color || 0x7c6953;
  const t = e.type.toLowerCase();
  const isMagma = /magma|lava|fire|molten|burning|hot/i.test(t) || (color >> 16 > 160 && (color & 255) < 90);

  // Tumbling rotation based on velocity or tick
  const spinDir = e.vx >= 0 ? 1 : -1;
  const rot = (e.id * 1.57) + tick * 0.04 * spinDir;

  // 1. Soft additive thermal aura for molten rocks
  if (isMagma) {
    g.circle(cx, cy, r * 2.0).fill({ color: 0xff4b1f, alpha: 0.16 });
    g.circle(cx, cy, r * 1.35).fill({ color: 0xffa02a, alpha: 0.28 });
  }

  // 2. Main irregular faceted rock polygon
  const pts = computeRockVertices(cx, cy, r, e.id, rot, 7);
  // Outer silhouette outline
  g.poly(pts).fill(OUTLINE).stroke({ width: 2, color: OUTLINE, join: "round" });
  // Base shaded rock body
  g.poly(pts).fill(scaleRgb(color, 0.72));

  // 3. Highlighted upper facet (sunlit facet)
  const topPts = [
    cx, cy,
    pts[0], pts[1],
    pts[2], pts[3],
    pts[4], pts[5],
  ];
  g.poly(topPts).fill({ color: scaleRgb(color, 1.35), alpha: 0.65 });

  // 4. Shadowed underside facet
  const botPts = [
    cx, cy,
    pts[6], pts[7],
    pts[8], pts[9],
    pts[10], pts[11],
  ];
  g.poly(botPts).fill({ color: scaleRgb(color, 0.42), alpha: 0.75 });

  // 5. Rock fissures & cracks
  const crackAngle = rot + hashDebris(e.id, 9) * Math.PI;
  const kx1 = cx + Math.cos(crackAngle) * r * 0.65;
  const ky1 = cy + Math.sin(crackAngle) * r * 0.65;
  const kx2 = cx - Math.cos(crackAngle) * r * 0.65;
  const ky2 = cy - Math.sin(crackAngle) * r * 0.65;
  const midX = cx + Math.sin(crackAngle) * r * 0.25;
  const midY = cy - Math.cos(crackAngle) * r * 0.25;

  if (isMagma) {
    // Glowing molten fissures
    g.moveTo(kx1, ky1).lineTo(midX, midY).lineTo(kx2, ky2).stroke({ width: 2.5, color: 0xff3b10, alpha: 0.9 });
    g.moveTo(kx1, ky1).lineTo(midX, midY).lineTo(kx2, ky2).stroke({ width: 1.2, color: 0xffea55, alpha: 0.95 });
  } else {
    // Cold rock dark fracture
    g.moveTo(kx1, ky1).lineTo(midX, midY).lineTo(kx2, ky2).stroke({ width: 1.5, color: scaleRgb(color, 0.3), alpha: 0.8 });
  }

  // 6. Flying motion trail for fast tumbling rocks
  const sp = Math.hypot(e.vx, e.vy);
  if (sp > 40 && isMagma) {
    const trailLen = Math.min(28, sp * 0.05);
    const ang = Math.atan2(e.vy, e.vx);
    for (let i = 1; i <= 3; i++) {
      const dist = (trailLen * i) / 3;
      const tx = cx - Math.cos(ang) * dist + (hashDebris(e.id, i) - 0.5) * 6;
      const ty = cy - Math.sin(ang) * dist + (hashDebris(e.id, i + 5) - 0.5) * 6;
      const sparkR = Math.max(1.2, r * 0.28 * (1 - i * 0.25));
      g.circle(tx, ty, sparkR).fill({ color: 0xff8811, alpha: 0.8 * (1 - i * 0.25) });
      g.circle(tx, ty, sparkR * 0.5).fill({ color: 0xffffff, alpha: 0.9 });
    }
  }
}

/**
 * Draw round, shaded, glowing blob / droplet / fireball with trails and additive glow.
 * Stretched dynamically along the velocity vector.
 */
export function drawGlowingBlob(
  g: Graphics,
  e: Entity,
  x: number,
  y: number,
): void {
  const w = e.w;
  const h = e.h;
  const cx = x + w * 0.5;
  const cy = y + h * 0.5;
  const r = Math.max(3, Math.min(w, h) * 0.5);
  const color = e.color || 0xffa02a;

  const sp = Math.hypot(e.vx, e.vy);
  const moving = sp > 15;
  const ang = moving ? Math.atan2(e.vy, e.vx) : 0;
  const stretch = moving ? Math.min(1.8, 1 + sp / 450) : 1;

  // 1. Soft wide additive glow aura
  g.circle(cx, cy, r * 2.4).fill({ color, alpha: 0.22 });
  g.circle(cx, cy, r * 1.5).fill({ color: scaleRgb(color, 1.25), alpha: 0.38 });

  // 2. Motion stretch droplet body
  if (moving) {
    // Teardrop / stretched oval pointing toward velocity
    const tailLen = Math.min(24, sp * 0.05);
    const tx = cx - Math.cos(ang) * tailLen;
    const ty = cy - Math.sin(ang) * tailLen;

    // Glowing comet tail streak
    g.moveTo(tx, ty).lineTo(cx, cy).stroke({ width: r * 1.8, color, alpha: 0.72, cap: "round" });
    g.moveTo(tx * 0.5 + cx * 0.5, ty * 0.5 + cy * 0.5).lineTo(cx, cy).stroke({
      width: r * 1.1,
      color: mixRgb(color, 0xffffff, 0.6),
      alpha: 0.9,
      cap: "round",
    });

    // Trailing ember sparks
    for (let i = 1; i <= 3; i++) {
      const dropDist = tailLen + i * (r * 1.1);
      const ex = cx - Math.cos(ang) * dropDist;
      const ey = cy - Math.sin(ang) * dropDist;
      const sparkR = Math.max(1, r * (0.55 - i * 0.12));
      g.circle(ex, ey, sparkR).fill({ color, alpha: 0.65 * (1 - i * 0.25) });
      g.circle(ex, ey, sparkR * 0.5).fill({ color: 0xffffff, alpha: 0.9 * (1 - i * 0.25) });
    }
  }

  // 3. Concentric core shading
  // Outer perimeter
  g.circle(cx, cy, r * 1.05).fill(OUTLINE);
  g.circle(cx, cy, r).fill(color);
  // Mid warm tone
  g.circle(cx - (moving ? Math.cos(ang) * r * 0.15 : 0), cy - (moving ? Math.sin(ang) * r * 0.15 : 0), r * 0.7).fill({
    color: mixRgb(color, 0xffe270, 0.65),
    alpha: 0.9,
  });
  // Incandescent white-hot center
  g.circle(cx - (moving ? Math.cos(ang) * r * 0.25 : 0), cy - (moving ? Math.sin(ang) * r * 0.25 : 0), r * 0.35).fill({
    color: 0xffffff,
    alpha: 0.95,
  });
}

/** Main dispatcher to render any debris or hazard entity. */
export function drawDebris(
  g: Graphics,
  e: Entity,
  x: number,
  y: number,
  tick: number,
): void {
  const kind = debrisKindOf(e);
  if (kind === "rock") {
    drawRock(g, e, x, y, tick);
  } else if (kind === "glowing-blob") {
    drawGlowingBlob(g, e, x, y);
  } else {
    // Fallback: smooth rounded droplet instead of flat rectangle
    g.circle(x + e.w * 0.5, y + e.h * 0.5, Math.min(e.w, e.h) * 0.5).fill(e.color);
  }
}

/**
 * Draw a glowing particle or flying streak.
 * Replaces flat `gfx.rect(p.x, p.y, p.size, p.size)` with smooth incandescent particles.
 */
export function drawDebrisParticle(
  g: Graphics,
  p: Particle,
  camX: number,
  camY: number,
): void {
  const x = p.x - camX;
  const y = p.y - camY;
  const q = Math.max(0, Math.min(1, p.life / p.maxLife));
  const alpha = 1 - q;
  if (alpha <= 0.01) return;

  const sp = Math.hypot(p.vx, p.vy);
  const size = Math.max(1.5, p.size);

  if (sp > 25) {
    // Fast moving incandescent spark/streak
    const streakX = x - p.vx * 0.024;
    const streakY = y - p.vy * 0.024;
    g.moveTo(streakX, streakY).lineTo(x, y).stroke({
      width: Math.max(1.2, size * 0.7),
      color: p.color,
      alpha: alpha * 0.88,
      cap: "round",
    });
    // Glowing head
    g.circle(x, y, size * 0.55).fill({ color: 0xffffff, alpha: alpha * 0.95 });
  } else {
    // Soft glowing round ember
    g.circle(x, y, size * 1.4).fill({ color: p.color, alpha: alpha * 0.3 });
    g.circle(x, y, size * 0.75).fill({ color: mixRgb(p.color, 0xffffff, 0.45), alpha: alpha * 0.95 });
  }
}
