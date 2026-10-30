// Procedural shapes (ADR 0015): primitives are drawn in code, never sent to Muse Image as "poses".
import type { Graphics } from "pixi.js";
import type { Entity, Look, ShapeName } from "../contract";
import { HOOP, isHoopType } from "../sim/hoop";

const OUTLINE = 0x0b0e13;

/** The active mood's color grade (ADR 0017); identity when no mood is on. */
let gradeFn: (c: number) => number = (c) => c;
export function setGrade(f: (c: number) => number): void { gradeFn = f; }
let snowyWorld = false;
/** Snowy moods frost the overhang's moss instead of leaving it grass green. */
export function setSnowy(b: boolean): void { snowyWorld = b; }

/** What Spark said about each type this session (server `look`), so the word fallback below only covers router misses. */
const looks: Look[] = [];
export function registerLook(look: Look | undefined): void {
  if (look && !looks.includes(look)) looks.push(look);
}
export function clearLooks(): void { looks.length = 0; }

const SHAPE_WORDS: [ShapeName, RegExp][] = [
  ["ring", /ring|halo|hoop/],
  ["spikes", /spike|thorn/],
  ["triangle", /triangle|cone|wedge/],
  ["diamond", /diamond|rhombus/],
  ["star", /^star$|-star$|^star-/],
  ["circle", /ball|orb|bubble|sphere|circle|marble|pearl|bomb/],
];
const EFFECT_RE = /rain|fog|mist|haze|smoke|snow|explosion|blast|shockwave|spark|ember/;
const PROJECTILE_RE = /bullet|shot|projectile|arrow|fireball|laser|bolt|pellet|plasma/i;
/** Round leather balls: drawn as a sphere with seams, never squashed into an egg (bead z1d). */
const BALL_RE = /ball|sphere|marble/;
const BASKETBALL_RE = /basket/;

export type Kind = { kind: "shape"; shape: ShapeName } | { kind: "effect" };

/** The code-drawn kind of an entity type, or undefined for sprites and the engine's own looks. */
export function kindOf(type: string): Kind | undefined {
  const t = type.toLowerCase();
  if (t === "player" || t === "ground" || t.includes("platform") || t.includes("coin") || PROJECTILE_RE.test(t)) return undefined;
  if (isHoopType(t)) return undefined; // a goal has its own structure (drawHoop), never a ring or a ball
  for (const l of looks) {
    if (l.types.some((x) => t.includes(x))) return l.visual === "effect" ? { kind: "effect" } : { kind: "shape", shape: l.shape ?? "circle" };
  }
  if (EFFECT_RE.test(t) || t.includes("drop")) return { kind: "effect" };
  for (const [shape, re] of SHAPE_WORDS) if (re.test(t)) return { kind: "shape", shape };
  return undefined;
}

export function scale(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * f));
  const b = Math.min(255, Math.round((color & 255) * f));
  return (r << 16) | (g << 8) | b;
}

function poly(g: Graphics, pts: number[], color: number): void {
  g.poly(pts).fill(OUTLINE).stroke({ width: 3, color: OUTLINE, join: "round" });
  g.poly(pts).fill(color);
}

export function drawShape(g: Graphics, e: Entity, x: number, y: number, shape: ShapeName): void {
  const c = e.color;
  const w = e.w, h = e.h;
  switch (shape) {
    case "circle": {
      const r = Math.min(w, h) / 2;
      const t = e.type.toLowerCase();
      const ball = BALL_RE.test(t) || BASKETBALL_RE.test(t);
      // squash and stretch: long on the fall/rise, flat on contact. Balls are exempt: a squashed
      // basketball reads as an egg on the ground, not as a ball (bead z1d).
      const sy = ball ? 1 : e.onGround ? 0.8 : 1 + Math.min(0.28, Math.abs(e.vy) / 1500);
      const sx = ball ? 1 : 1 / sy;
      const rx = r * sx, ry = r * sy;
      const cx = x + w / 2, cy = ball ? y + h / 2 : y + h - ry;
      if (ball) { drawBall(g, cx, cy, r, BASKETBALL_RE.test(t) ? 0xe8702a : c); return; }
      g.ellipse(cx, cy, rx + 1.5, ry + 1.5).fill(OUTLINE);
      g.ellipse(cx, cy, rx, ry).fill(scale(c, 0.55));
      g.ellipse(cx - rx * 0.1, cy - ry * 0.1, rx * 0.9, ry * 0.9).fill(c);
      g.ellipse(cx - rx * 0.28, cy - ry * 0.3, rx * 0.5, ry * 0.46).fill({ color: scale(c, 1.35), alpha: 0.55 });
      g.ellipse(cx - rx * 0.36, cy - ry * 0.42, rx * 0.2, ry * 0.15).fill({ color: 0xffffff, alpha: 0.9 });
      return;
    }
    case "ring": {
      const r = Math.min(w, h) / 2;
      const t = Math.max(3, r * 0.3);
      const cx = x + w / 2, cy = y + h / 2;
      g.circle(cx, cy, r - t / 2).stroke({ width: t + 3, color: OUTLINE });
      g.circle(cx, cy, r - t / 2).stroke({ width: t, color: c });
      g.circle(cx, cy, r - t / 2).stroke({ width: Math.max(1, t * 0.3), color: scale(c, 1.4), alpha: 0.7 });
      return;
    }
    case "triangle":
      poly(g, [x + w / 2, y, x + w, y + h, x, y + h], c);
      g.poly([x + w / 2, y + 3, x + w / 2, y + h - 1, x + 2, y + h - 1]).fill({ color: scale(c, 1.3), alpha: 0.5 });
      return;
    case "spikes": {
      const n = Math.max(1, Math.round(w / Math.max(10, h * 0.7)));
      const sw = w / n;
      for (let i = 0; i < n; i++) {
        const sx = x + i * sw;
        poly(g, [sx + sw / 2, y, sx + sw, y + h, sx, y + h], c);
        g.poly([sx + sw / 2, y + 2, sx + sw / 2, y + h - 1, sx + 1.5, y + h - 1]).fill({ color: scale(c, 1.35), alpha: 0.55 });
      }
      return;
    }
    case "pill": {
      const r = Math.min(w, h) / 2;
      g.roundRect(x - 1.5, y - 1.5, w + 3, h + 3, r + 1.5).fill(OUTLINE);
      g.roundRect(x, y, w, h, r).fill(c);
      if (w >= h) g.roundRect(x + r * 0.6, y + h * 0.18, w - r * 1.2, Math.max(1.5, h * 0.2), h * 0.1).fill({ color: 0xffffff, alpha: 0.45 });
      else g.roundRect(x + w * 0.18, y + r * 0.6, Math.max(1.5, w * 0.2), h - r * 1.2, w * 0.1).fill({ color: 0xffffff, alpha: 0.45 });
      return;
    }
    case "diamond":
      poly(g, [x + w / 2, y, x + w, y + h / 2, x + w / 2, y + h, x, y + h / 2], c);
      g.poly([x + w / 2, y + 2, x + w / 2, y + h / 2, x + 2, y + h / 2]).fill({ color: 0xffffff, alpha: 0.4 });
      return;
    case "star": {
      const cx = x + w / 2, cy = y + h / 2, ro = Math.min(w, h) / 2, ri = ro * 0.45;
      const rot = -Math.PI / 2;
      const pts: number[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? ro : ri;
        const a = rot + (i * Math.PI) / 5;
        pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      poly(g, pts, c);
      return;
    }
    default:
      g.rect(x - 1.5, y - 1.5, w + 3, h + 3).fill(OUTLINE);
      g.rect(x, y, w, h).fill(c);
      g.rect(x, y, w, Math.max(2, h * 0.14)).fill({ color: scale(c, 1.35), alpha: 0.8 });
      g.rect(x, y + h - Math.max(2, h * 0.14), w, Math.max(2, h * 0.14)).fill({ color: scale(c, 0.6), alpha: 0.8 });
  }
}

/** True for the level's cliff overhang: a platform far taller than any ledge (the starter ground's `overhang` knob). */
export function isCliff(e: Entity): boolean {
  return e.type.toLowerCase().includes("platform") && e.h >= 300 && e.w >= 120;
}

/** A round leather ball: pebbled shading plus the iconic seams, so it reads as a basketball at any size. */
function drawBall(g: Graphics, cx: number, cy: number, r: number, leather: number): void {
  const k = gradeFn;
  g.circle(cx, cy, r + 1.5).fill(OUTLINE);
  g.circle(cx, cy, r).fill(k(scale(leather, 0.6)));
  g.circle(cx - r * 0.05, cy - r * 0.06, r * 0.95).fill(k(leather));
  g.circle(cx - r * 0.22, cy - r * 0.24, r * 0.6).fill({ color: k(scale(leather, 1.22)), alpha: 0.5 });
  g.circle(cx - r * 0.32, cy - r * 0.36, r * 0.24).fill({ color: 0xffffff, alpha: 0.4 });
  // Seams: one down the middle, one across, and the two bowed arcs that make it unmistakable.
  const seam = Math.max(1.1, r * 0.1);
  const ink = { width: seam, color: OUTLINE, alpha: 0.88 };
  g.moveTo(cx, cy - r + seam).lineTo(cx, cy + r - seam).stroke(ink);
  g.moveTo(cx - r + seam, cy).lineTo(cx + r - seam, cy).stroke(ink);
  for (const side of [-1, 1]) {
    g.moveTo(cx, cy - r * 0.9);
    for (let i = 1; i <= 10; i++) {
      const t = -1 + (2 * i) / 10;
      g.lineTo(cx + side * r * 0.84 * (1 - t * t), cy + t * r * 0.9);
    }
    g.stroke(ink);
  }
}

/**
 * A real basketball goal (bead z1d): a steel post standing on the ground, a backboard with its inner
 * target square, an orange rim seen in perspective and a mesh net under it. Every size comes from
 * HOOP, the same ratios rimOf() scores with, so the mouth you see is the mouth that scores.
 */
export function drawHoop(g: Graphics, e: Entity, x: number, y: number): void {
  const k = gradeFn;
  const w = e.w, h = e.h;
  const bottom = y + h;
  const cx = x + w * (HOOP.boardX + HOOP.boardW / 2);
  const boardX = x + w * HOOP.boardX;
  const boardW = w * HOOP.boardW;
  const boardY = y + h * HOOP.boardY;
  const boardH = h * HOOP.boardH;
  const rimY = y + h * HOOP.rimY;
  const rimR = w * HOOP.rimR;
  const rimRy = rimR * 0.34;
  const netBottom = rimY + h * HOOP.netH;
  const rimColor = e.color || 0xe8702a;

  // 1. Post: steel, behind the board, standing on the ground on a base plate.
  const postW = Math.max(6, w * HOOP.postW);
  const postX = cx - postW / 2;
  const postTop = boardY - 6;
  g.rect(postX - postW * 0.65, bottom - 7, postW * 2.3, 7).fill(OUTLINE);
  g.rect(postX - postW * 0.5, bottom - 6, postW * 2, 5).fill(k(0x59626d));
  g.rect(postX - 1.5, postTop, postW + 3, bottom - postTop).fill(OUTLINE);
  g.rect(postX, postTop, postW, bottom - postTop).fill(k(0x707b88));
  g.rect(postX, postTop, postW * 0.34, bottom - postTop).fill(k(0xa9b6c4));
  g.rect(postX + postW * 0.7, postTop, postW * 0.3, bottom - postTop).fill({ color: k(0x3a434d), alpha: 0.9 });

  // 2. Backboard: white, framed, with the orange target square behind the rim.
  g.rect(boardX - 2, boardY - 2, boardW + 4, boardH + 4).fill(OUTLINE);
  g.rect(boardX, boardY, boardW, boardH).fill(k(0xf2f6fb));
  g.rect(boardX, boardY, boardW, boardH * 0.16).fill({ color: k(0xc9d4e2), alpha: 0.5 });
  g.rect(boardX + boardW * 0.78, boardY, boardW * 0.22, boardH).fill({ color: 0x93a5ba, alpha: 0.26 });
  const sqW = boardW * 0.44, sqH = boardH * 0.38;
  const sqX = cx - sqW / 2;
  const sqY = boardY + boardH - sqH - boardH * 0.08;
  g.rect(sqX, sqY, sqW, sqH).stroke({ width: 2.5, color: k(0xe8572c) });
  g.rect(boardX, boardY, boardW, boardH).stroke({ width: 2, color: k(0x8f9cad) });

  // 3. Rim: an orange ring in perspective, mounted at the board's lower edge, jutting forward.
  g.rect(cx - 3.5, rimY - rimRy - 7, 7, rimRy + 7).fill(k(0x9c3a16));
  g.ellipse(cx, rimY + 2, rimR + 2.5, rimRy + 1.5).fill({ color: 0x000000, alpha: 0.22 });
  g.ellipse(cx, rimY, rimR, rimRy).stroke({ width: 5, color: OUTLINE });
  g.ellipse(cx, rimY, rimR, rimRy).stroke({ width: 3, color: k(rimColor) });
  g.ellipse(cx, rimY - 0.5, rimR, rimRy).stroke({ width: 1.2, color: k(scale(rimColor, 1.55)), alpha: 0.85 });

  // 4. Net: white mesh hanging from the rim, tapering in, rows sagging a little.
  const topL = cx - rimR * 0.94, topR = cx + rimR * 0.94;
  const botL = cx - rimR * HOOP.netTaper, botR = cx + rimR * HOOP.netTaper;
  const netTopY = rimY + rimRy * 0.6;
  const strands = 6, rows = 4;
  for (let i = 0; i <= strands; i++) {
    const t = i / strands;
    g.moveTo(topL + (topR - topL) * t, netTopY)
      .lineTo(botL + (botR - botL) * t, netBottom)
      .stroke({ width: 1.2, color: k(0xdfe7f0), alpha: 0.9 });
  }
  for (let r = 1; r <= rows; r++) {
    const f = r / rows;
    const yy = netTopY + (netBottom - netTopY) * f;
    const l = topL + (botL - topL) * f;
    const rr = topR + (botR - topR) * f;
    g.moveTo(l, yy);
    for (let i = 1; i <= 6; i++) {
      const t = i / 6;
      g.lineTo(l + (rr - l) * t, yy + Math.sin(Math.PI * t) * 2.5);
    }
    g.stroke({ width: 1.1, color: k(0xe8eef6), alpha: 0.72 });
  }
}

/** A 2.5D stone cliff archway & overhang with full-height masonry courses, recessed tunnel pillars, and mossy arch lintel. */
export function drawCliff(g: Graphics, e: Entity, x: number, y: number): void {
  const k = gradeFn;
  const w = e.w, h = e.h;
  const bottom = y + h;
  const teeth = 18;

  // 1. Recessed background archway pillars & shadowed tunnel interior below the overhang (y + h down to ground y = 400)
  // The pillars end on the ground (world y 400), whatever clearance the level gives the tunnel.
  const tunnelH = Math.max(40, 400 - (e.y + e.h));
  const pillarW = Math.min(28, Math.max(18, Math.round(w * 0.13)));
  // Deep shadowed tunnel backdrop (drawn before dynamic entities so the player walks through the archway in front of it)
  g.rect(x + 4, bottom - teeth, w - 8, tunnelH + teeth).fill({ color: 0x05070a, alpha: 0.52 });
  // Recessed left & right stone support columns connecting the overhang to the ground
  for (const px of [x + 2, x + w - pillarW - 2]) {
    g.rect(px - 1.5, bottom - teeth, pillarW + 3, tunnelH + teeth).fill(OUTLINE);
    g.rect(px, bottom - teeth, pillarW, tunnelH + teeth).fill(k(0x3a2f25));
    g.rect(px, bottom - teeth, 3, tunnelH + teeth).fill({ color: k(0x6e5a47), alpha: 0.45 });
    g.rect(px + pillarW - 4, bottom - teeth, 4, tunnelH + teeth).fill({ color: 0x080a0e, alpha: 0.55 });
    for (let row = 0; row < 5; row++) {
      const by = bottom + row * 20;
      g.rect(px, by, pillarW, 2).fill({ color: k(0x1f1812), alpha: 0.65 });
    }
  }
  // Inner arch corbels under the lintel corners
  g.poly([x + pillarW + 2, bottom - 2, x + pillarW + 24, bottom - 2, x + pillarW + 2, bottom + 22]).fill(k(0x2f251d));
  g.poly([x + w - pillarW - 2, bottom - 2, x + w - pillarW - 24, bottom - 2, x + w - pillarW - 2, bottom + 22]).fill(k(0x271f18));

  // 2. Main cliff overhang body & full-height masonry courses (no hardcoded 760px screen-Y cutoff!)
  g.rect(x - 2, y - 2, w + 4, h - teeth + 2).fill(OUTLINE);
  g.rect(x, y, w, h - teeth).fill(k(0x524336));
  const hash = (a: number, b: number) => (((a * 73856093) ^ (b * 19349663)) >>> 0) % 1000 / 1000;
  const cell = 28;
  const first = Math.max(0, Math.floor((Math.max(y, -40) - y) / cell));
  for (let r = first; r * cell < h - teeth; r++) {
    const ry = y + r * cell;
    if (ry > bottom - teeth || ry > 2400) break;
    const rh = Math.min(cell, h - teeth - r * cell);
    let cx = 0;
    while (cx < w) {
      const hv = hash(r + 7, Math.floor(cx / 10) + 3);
      const bw = Math.min(w - cx, 26 + Math.floor(hv * 42));
      const tone = hv < 0.33 ? k(0x635040) : hv < 0.66 ? k(0x564537) : k(0x4a3b2e);
      g.rect(x + cx, ry, bw, rh).fill(tone);
      g.rect(x + cx, ry, bw, 2).fill({ color: k(0x8c755c), alpha: 0.42 });
      g.rect(x + cx, ry + rh - 2, bw, 2).fill({ color: k(0x241b14), alpha: 0.55 });
      g.rect(x + cx + bw - 1.5, ry, 1.5, rh).fill({ color: k(0x241b14), alpha: 0.62 });
      cx += bw;
    }
  }

  // 3. 2.5D side bevels: sunlit left face, deep ambient-occluded right face, and bottom arch lintel beam
  g.rect(x, y, 8, h - teeth).fill({ color: k(0x9e8568), alpha: 0.45 });
  g.rect(x + w - 12, y, 12, h - teeth).fill({ color: k(0x1f1710), alpha: 0.55 });
  const lintelY = bottom - teeth - 14;
  g.rect(x - 1, lintelY, w + 2, 14).fill(k(0x46382c));
  g.rect(x, lintelY, w, 2).fill({ color: k(0x9e8568), alpha: 0.55 });
  g.rect(x, bottom - teeth - 3, w, 3).fill({ color: 0x080b10, alpha: 0.55 });

  // 4. Deterministic weathering cracks
  for (let i = 0; i < 4; i++) {
    const cx = x + 22 + i * 44 + (Math.floor(e.x) % 7);
    let py = Math.max(y, bottom - 260) + i * 17;
    let px = cx;
    for (let s = 0; s < 6 && py < lintelY - 4; s++) {
      const nx = px + (s % 2 === 0 ? 5 : -4), ny = py + 18 + ((i + s) % 3) * 4;
      g.moveTo(px, py).lineTo(nx, ny).stroke({ width: 1.5, color: k(0x241b14), alpha: 0.68 });
      px = nx; py = ny;
    }
  }

  // 5. Archway keystone teeth & hanging moss overgrowth along the tunnel lip
  const n = Math.max(4, Math.round(w / 24));
  const tw = w / n;
  for (let i = 0; i < n; i++) {
    const tx = x + i * tw;
    // Shorter teeth near the center so the underside curves slightly like a natural stone arch
    const archCurve = Math.sin(((i + 0.5) / n) * Math.PI);
    const th = Math.max(6, Math.round(teeth * (1 - 0.38 * archCurve)));
    g.poly([tx - 1.5, bottom - teeth - 1, tx + tw + 1.5, bottom - teeth - 1, tx + tw / 2, bottom - teeth + th + 1.5]).fill(OUTLINE);
    g.poly([tx, bottom - teeth, tx + tw, bottom - teeth, tx + tw / 2, bottom - teeth + th]).fill(i % 2 ? k(0x46382b) : k(0x574637));
  }
  // Moss turf & hanging vine droplets along the arch lintel
  const mossA = snowyWorld ? 0xdfeaf5 : 0x3fd06a;
  const mossB = snowyWorld ? 0xffffff : 0x8ff2a7;
  const vine = snowyWorld ? 0xb9d2e8 : 0x34ad58;
  g.rect(x, lintelY - 3, w, 4).fill({ color: k(mossA), alpha: snowyWorld ? 0.95 : 0.68 });
  g.rect(x, lintelY - 3, w, 1.5).fill({ color: k(mossB), alpha: snowyWorld ? 0.9 : 0.55 });
  for (let i = 0; i < n * 2; i++) {
    const vx = x + 6 + i * (w / (n * 2));
    const vh = 4 + ((i * 7) % 9);
    g.rect(vx, lintelY + 1, 2.5, vh).fill({ color: k(vine), alpha: 0.65 });
  }
}

/** True for grappling gear: a hook claw or anything carrying data.tetherTo. Drawn in code, never as a sprite (ADR 0050). */
export function isTetherGear(e: Entity): boolean {
  return e.data?.tetherTo !== undefined || /hook|grappl|tether/i.test(e.type);
}

/** A taut rope from the entity to the one it is tethered to (data.tetherTo = entity id, or "player"), then the steel claw on top. */
export function drawTetherGear(g: Graphics, e: Entity, x: number, y: number, target: Entity | undefined, camX: number, camY: number): void {
  const hx = x + e.w / 2, hy = y + e.h / 2;
  if (target) {
    const tx = target.x + target.w / 2 - camX, ty = target.y + target.h / 2 - camY;
    const dist = Math.hypot(hx - tx, hy - ty);
    const sag = Math.max(0, 14 - dist * 0.04) * (e.data.slack === true ? 1 : 0.35);
    const mx = (hx + tx) / 2, my = (hy + ty) / 2 + sag;
    const seg = 14;
    const pts: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg, u = 1 - t;
      pts.push(u * u * tx + 2 * u * t * mx + t * t * hx, u * u * ty + 2 * u * t * my + t * t * hy);
    }
    g.poly(pts, false).stroke({ width: 5, color: OUTLINE, alpha: 0.85 });
    g.poly(pts, false).stroke({ width: 3, color: gradeFn(0xc9a46a) });
    for (let i = 1; i < seg; i += 2) g.circle(pts[i * 2], pts[i * 2 + 1], 1.2).fill(gradeFn(0x8a6a3a)); // twist marks
  }
  // the claw: three curved prongs around a steel ring, pointing along the rope's pull
  const ang = target ? Math.atan2(hy - (target.y + target.h / 2 - camY), hx - (target.x + target.w / 2 - camX)) : 0;
  const r = Math.max(5, Math.min(e.w, e.h) / 2);
  for (const off of [-0.7, 0, 0.7]) {
    const a = ang + off;
    const tipX = hx + Math.cos(a) * r * 1.6, tipY = hy + Math.sin(a) * r * 1.6;
    g.poly([hx, hy, hx + Math.cos(a + 0.5) * r, hy + Math.sin(a + 0.5) * r, tipX, tipY], true).fill(gradeFn(0xb8c4d0)).stroke({ width: 1.5, color: OUTLINE });
  }
  g.circle(hx, hy, r * 0.6).fill(gradeFn(0x6f7c8a)).stroke({ width: 1.5, color: OUTLINE });
}
