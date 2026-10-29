// Atmosphere and juice (ADR 0015). Render-only: reads the sim, never writes it, so determinism is untouched.
// Rain is slanted streaks with ground splashes and mist; fog is soft drifting puffs; every burst of sim
// particles becomes a real explosion (flash, fireball ramp, sparks, smoke, shockwave, light screen shake).
// Effect entities never get the dark outline.
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { Entity, Particle } from "../contract";
import type { World } from "../sim/world";

const FIRE_RAMP = [0xfff6c8, 0xffd34d, 0xff8a1f, 0xd8321f, 0x4a3030];

function ramp(t: number): number {
  const f = Math.min(0.999, Math.max(0, t)) * (FIRE_RAMP.length - 1);
  const i = Math.floor(f), k = f - i;
  const a = FIRE_RAMP[i], b = FIRE_RAMP[i + 1];
  const mix = (s: number) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

function puffTexture(): Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return Texture.from(c);
}

interface Spark { vx: number; vy: number; hot: number }
interface Puff { dx: number; dy: number; vy: number; r: number; delay: number; smoke: boolean }
interface Blast { x: number; y: number; age: number; size: number; sparks: Spark[]; puffs: Puff[] }
interface Splash { x: number; y: number; age: number }

const BLAST_LIFE = 0.9;
const SPLASH_LIFE = 0.45;
const MAX_PUFFS = 220;

export class Fx {
  private layer = new Container();
  private g = new Graphics();
  private tex = puffTexture();
  private pool: Sprite[] = [];
  private used = 0;
  private seen = new WeakSet<Particle>();
  private blasts: Blast[] = [];
  private splashes: Splash[] = [];
  private lastDrops = new Map<number, { x: number; y: number }>();
  private clock = 0;
  private shake = 0;
  private mist = 0;
  private camX = 0;
  private camY = 0;
  shakeX = 0;
  shakeY = 0;
  /** ms spent in the last render(), for the frame-cost report. */
  lastMs = 0;

  constructor(stage: Container) {
    this.layer.zIndex = 10;
    this.g.zIndex = 11;
    stage.addChild(this.layer, this.g);
  }

  private puff(x: number, y: number, r: number, color: number, alpha: number, add = false): void {
    if (this.used >= MAX_PUFFS) return;
    let s = this.pool[this.used];
    if (!s) {
      s = new Sprite(this.tex);
      s.anchor.set(0.5);
      this.layer.addChild(s);
      this.pool.push(s);
    }
    this.used++;
    s.visible = true;
    s.position.set(x, y);
    s.width = s.height = r * 2;
    s.tint = color;
    s.alpha = alpha;
    s.blendMode = add ? "add" : "normal";
  }

  /** Call once per frame after the world is drawn. `dt` is seconds since the last frame. */
  render(world: World, camX: number, camY: number, W: number, H: number, dt: number, isEffect: (type: string) => boolean): void {
    const t0 = performance.now();
    dt = Math.min(0.05, Math.max(0, dt));
    this.clock += dt;
    this.used = 0;
    this.camX = camX;
    this.camY = camY;
    this.g.clear();

    this.detectBursts(world);
    const drops = this.entities(world, W, H, isEffect);
    this.drawMist(drops, world, W, H);
    this.drawBlasts(dt);
    this.drawSplashes(dt);

    for (let i = this.used; i < this.pool.length; i++) this.pool[i].visible = false;
    this.shake = Math.max(0, this.shake - dt * 28);
    const amp = this.shake;
    this.shakeX = amp ? (Math.sin(this.clock * 83) + Math.sin(this.clock * 51)) * 0.5 * amp : 0;
    this.shakeY = amp ? (Math.cos(this.clock * 71) + Math.sin(this.clock * 97)) * 0.5 * amp : 0;
    this.lastMs = performance.now() - t0;
  }

  /** Rain streaks and fog puffs. Returns how many rain drops are on screen. */
  private entities(world: World, W: number, H: number, isEffect: (type: string) => boolean): number {
    const g = this.g;
    let drops = 0;
    const now = new Map<number, { x: number; y: number }>();
    for (const e of world.entities) {
      if (!isEffect(e.type)) continue;
      const t = e.type.toLowerCase();
      const x = e.x - this.camX, y = e.y - this.camY;
      if (x + e.w < -200 || x > W + 200 || y + e.h < -200 || y > H + 200) continue;
      if (t.includes("rain") || t.includes("drop")) {
        drops++;
        const cx = x + e.w / 2;
        g.moveTo(cx - e.vx * 0.03, y - e.vy * 0.03).lineTo(cx, y + e.h).stroke({ width: 1.6, color: 0xbfe6ff, alpha: 0.55, cap: "round" });
        now.set(e.id, { x: e.x + e.w / 2, y: e.y + e.h });
      } else if (t.includes("fog") || t.includes("mist") || t.includes("haze") || t.includes("smoke")) {
        this.fogPuffs(e, x, y, t.includes("smoke"));
      }
    }
    // A drop that left the world splashes where it was; a mass removal (undo) stays quiet.
    let gone = 0;
    for (const id of this.lastDrops.keys()) if (!now.has(id)) gone++;
    if (gone > 0 && gone < 40) {
      for (const [id, p] of this.lastDrops) if (!now.has(id)) this.splashes.push({ x: p.x, y: p.y, age: 0 });
      if (this.splashes.length > 60) this.splashes.splice(0, this.splashes.length - 60);
    }
    this.lastDrops = now;
    return drops;
  }

  private fogPuffs(e: Entity, x: number, y: number, smoke: boolean): void {
    const n = Math.max(2, Math.min(7, Math.round(e.w / 70)));
    const white = (e.color & 0xffffff) === 0xffffff || e.color === 0;
    const tint = smoke ? 0x8a8f99 : white ? 0xdce6ee : e.color;
    const r = Math.max(70, Math.max(e.h, e.w / n) * 0.9);
    for (let i = 0; i < n; i++) {
      const ph = e.id * 1.7 + i * 2.3;
      const px = x + ((i + 0.5) / n) * e.w + Math.sin(this.clock * 0.35 + ph) * 22;
      const py = y + e.h * 0.5 + Math.cos(this.clock * 0.27 + ph) * 8 - (smoke ? (this.clock * 14 + i * 9) % 50 : 0);
      this.puff(px, py, r * (0.85 + 0.2 * Math.sin(ph)), tint, smoke ? 0.22 : 0.2);
    }
  }

  private drawMist(drops: number, world: World, W: number, H: number): void {
    this.mist += ((drops >= 8 ? 1 : 0) - this.mist) * 0.04;
    if (this.mist < 0.02) return;
    const p = world.entities.find((e) => e.type === "player");
    const ground = p ? p.y + p.h - this.camY : H * 0.8;
    for (let i = 0; i < 6; i++) {
      const px = ((i * (W / 5) + this.clock * 14) % (W + 360)) - 180;
      this.puff(px, ground - 6 + Math.sin(this.clock * 0.5 + i) * 6, 110, 0xcfe0ee, 0.1 * this.mist);
    }
  }

  private drawSplashes(dt: number): void {
    const g = this.g;
    for (const s of this.splashes) {
      s.age += dt;
      const q = s.age / SPLASH_LIFE;
      if (q >= 1) continue;
      const x = s.x - this.camX, y = s.y - this.camY;
      g.ellipse(x, y, 3 + q * 9, 1.2 + q * 3).stroke({ width: 1, color: 0xdff3ff, alpha: (1 - q) * 0.7 });
      for (const vx of [-34, 0, 34]) {
        const a = s.age;
        g.rect(x + vx * a, y - (vx === 0 ? 120 : 90) * a + 420 * a * a, 1.6, 1.6).fill({ color: 0xdff3ff, alpha: 1 - q });
      }
    }
    this.splashes = this.splashes.filter((s) => s.age < SPLASH_LIFE);
  }

  /** A batch of fresh sim particles at one spot is a burst: dress it as an explosion. */
  private detectBursts(world: World): void {
    let n = 0, sx = 0, sy = 0;
    for (const p of world.particles) {
      if (this.seen.has(p)) continue;
      this.seen.add(p);
      n++; sx += p.x; sy += p.y;
    }
    if (n < 6) return;
    const size = Math.min(2.4, 0.8 + n / 18);
    const sparks: Spark[] = [];
    for (let i = 0; i < Math.min(40, n * 2); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (140 + Math.random() * 260) * size * 0.7;
      sparks.push({ vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, hot: Math.random() });
    }
    const puffs: Puff[] = [];
    for (let i = 0; i < 5; i++) puffs.push({ dx: (Math.random() - 0.5) * 30 * size, dy: (Math.random() - 0.5) * 24 * size, vy: -20 - Math.random() * 30, r: (22 + Math.random() * 14) * size, delay: 0, smoke: false });
    for (let i = 0; i < 4; i++) puffs.push({ dx: (Math.random() - 0.5) * 40 * size, dy: (Math.random() - 0.5) * 20 * size, vy: -28 - Math.random() * 30, r: (20 + Math.random() * 12) * size, delay: 0.12, smoke: true });
    this.blasts.push({ x: sx / n, y: sy / n, age: 0, size, sparks, puffs });
    if (this.blasts.length > 12) this.blasts.shift();
    this.shake = Math.max(this.shake, 3 + 3 * size);
  }

  private drawBlasts(dt: number): void {
    const g = this.g;
    for (const b of this.blasts) {
      b.age += dt;
      const a = b.age, k = a / BLAST_LIFE;
      const x = b.x - this.camX, y = b.y - this.camY;
      if (a < 0.16) this.puff(x, y, (30 + a * 700) * b.size, 0xfff2c0, (1 - a / 0.16) * 0.95, true);
      for (const p of b.puffs) {
        const pa = a - p.delay;
        if (pa < 0) continue;
        const q = pa / (p.smoke ? 0.8 : 0.45);
        if (q >= 1) continue;
        const r = p.r * (0.6 + q * (p.smoke ? 1.5 : 1.1));
        const px = x + p.dx, py = y + p.dy + p.vy * pa;
        if (p.smoke) this.puff(px, py, r, 0x3a3d45, (1 - q) * 0.45);
        else this.puff(px, py, r, ramp(q), (1 - q) * 0.9, true);
      }
      if (a < 0.4) {
        const q = a / 0.4;
        g.circle(x, y, (14 + q * 70) * b.size).stroke({ width: Math.max(1, 5 * (1 - q)), color: 0xffe9b0, alpha: (1 - q) * 0.7 });
      }
      for (const s of b.sparks) {
        const q = Math.min(1, k * 1.15 + s.hot * 0.15);
        if (q >= 1) continue;
        const px = x + s.vx * a, py = y + s.vy * a + 260 * a * a;
        const vy = s.vy + 520 * a;
        g.moveTo(px - s.vx * 0.028, py - vy * 0.028).lineTo(px, py).stroke({ width: 2.2 * (1 - q * 0.6), color: ramp(q * 0.8), alpha: 1 - q * q, cap: "round" });
      }
    }
    this.blasts = this.blasts.filter((b) => b.age < BLAST_LIFE);
  }
}
