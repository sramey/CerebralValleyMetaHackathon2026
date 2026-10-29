// Procedural shapes (ADR 0015): primitives are drawn in code, never sent to Muse Image as "poses".
import type { Graphics } from "pixi.js";
import type { Entity, Look, ShapeName } from "../contract";

const OUTLINE = 0x0b0e13;

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

export type Kind = { kind: "shape"; shape: ShapeName } | { kind: "effect" };

/** The code-drawn kind of an entity type, or undefined for sprites and the engine's own looks. */
export function kindOf(type: string): Kind | undefined {
  const t = type.toLowerCase();
  if (t === "player" || t === "ground" || t.includes("platform") || t.includes("coin")) return undefined;
  for (const l of looks) {
    if (l.types.some((x) => t.includes(x))) return l.visual === "effect" ? { kind: "effect" } : { kind: "shape", shape: l.shape ?? "circle" };
  }
  if (EFFECT_RE.test(t) || t.includes("drop")) return { kind: "effect" };
  for (const [shape, re] of SHAPE_WORDS) if (re.test(t)) return { kind: "shape", shape };
  return undefined;
}

function scale(color: number, f: number): number {
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
      // squash and stretch: long on the fall/rise, flat on contact
      const sy = e.onGround ? 0.8 : 1 + Math.min(0.28, Math.abs(e.vy) / 1500);
      const sx = 1 / sy;
      const rx = r * sx, ry = r * sy;
      const cx = x + w / 2, cy = y + h - ry;
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
