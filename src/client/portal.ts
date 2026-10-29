// Screen-rip entrance (bead yzd). When a new entity first appears, the game screen tears open at its spawn
// point like a zipper, showing the glowing code layer behind the world; the seam holds the entity out of
// sight for a beat, then zips shut to reveal it. Render-only: it watches the world, never writes to it.
// Cost per frame is a couple of Graphics polygons and one masked, pre-rendered code sprite per live portal.
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { Entity, MoodSpec } from "../contract";
import type { World } from "../sim/world";

const OPEN = 0.2; // seconds: the tear opens
const HOLD = 0.3; // the seam holds open while the object is "behind the screen"
const CLOSE = 0.3; // zips shut, revealing the object
const LIFE = OPEN + HOLD + CLOSE;
const MAX_LIVE = 6;
const MAX_BIG = 320; // ground, towers and the like never get a portal
const CODE = [
  "function setup(api) {", "  const p = api.spawn({", "    type: 'thing',", "    x: 240, y: 0xA0,", "    w: 32, h: 48 });",
  "  api.onStep(dt => {", "    p.vx = knob('speed');", "    p.vy += GRAV * dt;", "  });", "  return () => p.dispose();", "}",
  "0x3F 0xA2 0x7C 0x01", "{ ok: true, frames: 120 }", "test(world => assert(p.y > 0));", "exports.knobs = { speed };",
];

function codeTexture(): Texture {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#04070d";
  ctx.fillRect(0, 0, 256, 512);
  ctx.font = "bold 13px monospace";
  for (let i = 0; i < 40; i++) {
    const line = CODE[i % CODE.length];
    ctx.fillStyle = i % 5 === 2 ? "#ffc94d" : i % 3 === 0 ? "#58e6ff" : "#2f9fc0";
    ctx.globalAlpha = 0.55 + 0.45 * ((i * 7) % 5) / 4;
    ctx.fillText(line, 6 + ((i * 13) % 20), 14 + i * 13);
  }
  return Texture.from(c);
}

interface Rip { x: number; y: number; w: number; h: number; age: number; seed: number }

export class Portal {
  private layer = new Container();
  private rim = new Graphics();
  private tex = codeTexture();
  private sprites: Sprite[] = [];
  private masks: Graphics[] = [];
  private seen = new Set<number>();
  private rips: Rip[] = [];
  private primed = false;
  private accent = 0x58e6ff;
  private base = 0x04070d;
  private reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  lastMs = 0;

  constructor(stage: Container) {
    this.layer.zIndex = 11;
    this.layer.addChild(this.rim);
    stage.addChild(this.layer);
    if (typeof matchMedia === "function") {
      matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", (ev) => { this.reduced = ev.matches; });
    }
  }

  /** The mood recolors the rift (rim glow and the dark behind the screen) so it fits a spooky or neon world. */
  setMood(m: MoodSpec | null): void {
    this.accent = m ? m.star : 0x58e6ff;
    this.base = m ? m.skyTop : 0x04070d;
  }

  /** Call once per frame. `isEffect` skips weather and explosions. */
  render(world: World, camX: number, camY: number, dt: number, isEffect: (type: string) => boolean): void {
    const t0 = performance.now();
    dt = Math.min(0.05, Math.max(0, dt)) * ((window as unknown as { __portalSlow?: number }).__portalSlow ?? 1); // __portalSlow: slow-mo for review captures
    this.watch(world.entities, isEffect);
    this.rim.clear();
    let used = 0;
    for (let i = this.rips.length - 1; i >= 0; i--) {
      const r = this.rips[i];
      r.age += dt;
      if (r.age >= LIFE) { this.rips.splice(i, 1); continue; }
      used += this.draw(r, used, camX, camY);
    }
    for (let i = used; i < this.sprites.length; i++) { this.sprites[i].visible = false; this.sprites[i].mask = null; }
    this.lastMs = performance.now() - t0;
  }

  /** New entity ids become rips. The first sighting of a whole world (load, share link) is not an entrance. */
  private watch(entities: Entity[], isEffect: (type: string) => boolean): void {
    let fresh = 0;
    const found: Entity[] = [];
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (this.seen.has(e.id)) continue;
      this.seen.add(e.id);
      fresh++;
      if (e.w > MAX_BIG || e.h > MAX_BIG || e.w < 6 || isEffect(e.type)) continue;
      found.push(e);
    }
    if (!this.primed) { this.primed = true; return; }
    if (fresh > 4) return; // a world load, not a spawn
    if (this.seen.size > 4000) this.seen = new Set(entities.map((e) => e.id));
    for (const e of found) {
      if (this.rips.length >= MAX_LIVE) break;
      this.rips.push({ x: e.x + e.w / 2, y: e.y + e.h / 2, w: e.w, h: e.h, age: 0, seed: (e.id * 2654435761) >>> 0 });
    }
  }

  private draw(r: Rip, slot: number, camX: number, camY: number): number {
    const cx = r.x - camX, cy = r.y - camY;
    const halfH = Math.max(r.h, 40) * 0.85 + 14;
    const halfW = Math.max(r.w, 24) * 0.75 + 10;
    const open = r.age < OPEN ? easeOut(r.age / OPEN) : r.age < OPEN + HOLD ? 1 : 1 - easeIn((r.age - OPEN - HOLD) / CLOSE);
    if (this.reduced) {
      // A soft fade-in/out glow ring instead of a tear: no sudden motion.
      const a = Math.sin((r.age / LIFE) * Math.PI);
      this.rim.ellipse(cx, cy, halfW * 0.9, halfH * 0.7).stroke({ width: 3, color: this.accent, alpha: a * 0.6 });
      return 0;
    }
    // Jagged lens: points down the left edge then back up the right, widest at the middle, with seeded jitter.
    const steps = 9;
    const pts: number[] = [];
    const jag = (k: number, side: number) => (((r.seed >>> (k * 3 + side)) & 7) / 7 - 0.5) * 0.35;
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      const y = cy - halfH * open + 2 * halfH * open * u;
      const bulge = Math.sin(u * Math.PI);
      pts.push(cx - halfW * open * (bulge * (1 + jag(k, 0)) + 0.04), y);
    }
    for (let k = steps; k >= 0; k--) {
      const u = k / steps;
      const y = cy - halfH * open + 2 * halfH * open * u;
      const bulge = Math.sin(u * Math.PI);
      pts.push(cx + halfW * open * (bulge * (1 + jag(k, 1)) + 0.04), y);
    }
    // The dark code layer behind the screen: a pre-rendered code sprite scrolling inside the lens mask.
    let s = this.sprites[slot];
    if (!s) { s = new Sprite(this.tex); this.sprites.push(s); this.layer.addChildAt(s, 0); }
    let m = this.masks[slot];
    if (!m) { m = new Graphics(); this.masks.push(m); this.layer.addChild(m); }
    m.clear().poly(pts).fill(0xffffff);
    s.visible = true;
    s.mask = m;
    s.tint = this.base === 0x04070d ? 0xffffff : mixTint(0xffffff, this.accent, 0.35);
    s.width = halfW * 2.4; s.height = halfH * 2.6;
    s.x = cx - halfW * 1.2;
    s.y = cy - halfH * 1.3 - ((r.age * 140) % (halfH * 2.6)) * 0.5; // scrolls up
    s.alpha = 0.95;
    // Edge glow: wide soft stroke, then a bright thin one, plus braces pulling apart at the tips.
    const glow = Math.min(1, open * 1.4);
    this.rim.poly(pts).stroke({ width: 7, color: this.accent, alpha: 0.18 * glow });
    this.rim.poly(pts).stroke({ width: 2, color: 0xffd98a, alpha: 0.9 * glow });
    const bx = halfW * open * 0.9 + 8;
    this.rim.moveTo(cx - bx, cy - 9).lineTo(cx - bx - 5, cy).lineTo(cx - bx, cy + 9).stroke({ width: 2, color: this.accent, alpha: 0.8 * glow });
    this.rim.moveTo(cx + bx, cy - 9).lineTo(cx + bx + 5, cy).lineTo(cx + bx, cy + 9).stroke({ width: 2, color: this.accent, alpha: 0.8 * glow });
    return 1;
  }
}

const easeOut = (t: number): number => 1 - Math.pow(1 - Math.min(1, t), 3);
const easeIn = (t: number): number => Math.min(1, t) * Math.min(1, t);
function mixTint(a: number, b: number, t: number): number {
  const m = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}
