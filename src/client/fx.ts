// Atmosphere and juice (ADR 0015). Render-only: reads the sim, never writes it, so determinism is untouched.
// Rain is slanted streaks with ground splashes and mist; fog is soft drifting puffs; every burst of sim
// particles becomes a real explosion (flash, fireball ramp, sparks, smoke, shockwave, light screen shake).
// Effect entities never get the dark outline.
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { Entity, MoodSpec, Particle } from "../contract";
import type { World } from "../sim/world";
import { drawDynamicLighting } from "./depth";

const FIRE_RAMP = [0xfff6c8, 0xffd34d, 0xff8a1f, 0xd8321f, 0x4a3030];

function ramp(t: number): number {
  const f = Math.min(0.999, Math.max(0, t)) * (FIRE_RAMP.length - 1);
  const i = Math.floor(f), k = f - i;
  const a = FIRE_RAMP[i], b = FIRE_RAMP[i + 1];
  const mix = (s: number) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

function puffTexture(): Texture { if (typeof document === "undefined") return Texture.EMPTY;
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

function vignetteTexture(): Texture { if (typeof document === "undefined") return Texture.EMPTY;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(128, 128, 70, 128, 128, 182);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return Texture.from(c);
}

interface Spark { vx: number; vy: number; hot: number }
interface Puff { dx: number; dy: number; vy: number; r: number; delay: number; smoke: boolean }
interface Blast { x: number; y: number; age: number; size: number; sparks: Spark[]; puffs: Puff[] }
interface Splash { x: number; y: number; age: number }

const BLAST_LIFE = 1.1;
const SPLASH_LIFE = 0.45;
const MAX_PUFFS = 280;

export class Fx {
  private layer = new Container();
  private g = new Graphics();
  private tex = puffTexture();
  private vig = new Sprite(vignetteTexture());
  private mood: MoodSpec | null = null;
  private pool: Sprite[] = [];
  private used = 0;
  private seen = new WeakSet<Particle>();
  private blasts: Blast[] = [];
  private splashes: Splash[] = [];
  private lastDrops = new Map<number, { x: number; y: number; land: boolean }>();
  private clock = 0;
  private shake = 0;
  private mist = 0;
  private camX = 0;
  private camY = 0;
  shakeX = 0;
  shakeY = 0;
  /** ms spent in the last render(), for the frame-cost report. */
  lastMs = 0;

  /** Ask for a small screen shake (game-feel impacts); never lowers a bigger shake already running. */
  kick(amp: number): void {
    this.shake = Math.max(this.shake, amp);
  }

  constructor(stage: Container) {
    this.layer.zIndex = 10;
    this.g.zIndex = 11;
    this.vig.zIndex = 12;
    this.vig.visible = false;
    stage.addChild(this.layer, this.g, this.vig);
  }

  /** The world's mood: a color wash, vignette and ambient drift on top of everything (render-only). */
  setMood(m: MoodSpec | null): void { this.mood = m; }

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

    this.ambience(W, H);
    drawDynamicLighting(
      this.g,
      (x, y, r, color, alpha, add) => this.puff(x, y, r, color, alpha, add),
      world,
      camX,
      camY,
      W,
      H,
      this.clock,
      this.mood,
      this.mood?.moon ?? 0xf2ead0,
    );
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

  /** Mood overlay: wash, vignette, and slow ambient motion (fog banks, snow, embers, neon sparks). */
  private ambience(W: number, H: number): void {
    const m = this.mood;
    this.vig.visible = true;
    this.vig.width = W; this.vig.height = H;
    this.vig.alpha = m ? m.vignette : 0.24;
    if (!m) return;
    const g = this.g;
    if (m.grade > 0) g.rect(0, 0, W, H).fill({ color: m.tint, alpha: m.grade * 0.22 });
    const t = this.clock;
    if (m.fog > 0 || m.ambient === "fog") {
      const n = Math.min(10, 4 + Math.round(m.fog * 8));
      for (let i = 0; i < n; i++) {
        const px = ((i * (W / (n - 1)) + t * (10 + (i % 3) * 5)) % (W + 400)) - 200;
        this.puff(px, H * (0.66 + 0.2 * ((i * 37) % 10) / 10) + Math.sin(t * 0.4 + i) * 10, 150 + (i % 3) * 40, m.ambient === "fog" ? 0xb9a9d6 : 0xdce6ee, 0.1 + 0.12 * m.fog);
      }
    }
    if (m.ambient === "snow" || m.ambient === "embers" || m.ambient === "sparks") {
      const snow = m.ambient === "snow";
      const col = snow ? 0xffffff : m.ambient === "embers" ? 0xffa040 : m.star;
      for (let i = 0; i < 70; i++) {
        const sp = 18 + (i % 5) * 9;
        const x = ((i * 97.3 + Math.sin(t * 0.7 + i) * 18) % W + W) % W;
        const y = snow ? (t * sp + i * 53) % (H + 20) : H - ((t * sp * 1.4 + i * 53) % (H + 20));
        g.rect(x, y - 10, snow ? 2.4 : 2, snow ? 2.4 : 2).fill({ color: col, alpha: snow ? 0.85 : 0.7 });
      }
    }
  }

  /** True when the mood's sky is light enough that white snow needs an outline (daytime, beach). */
  private brightSky(): boolean {
    const m = this.mood;
    if (!m) return false;
    const c = m.skyBottom;
    return 0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255) > 150;
  }

  /** Weather effects (rain, snow), atmospheric fog, and particle effects. Returns count of active weather drops. */
  private entities(world: World, W: number, H: number, isEffect: (type: string) => boolean): number {
    const g = this.g;
    let drops = 0;
    const now = new Map<number, { x: number; y: number; land: boolean }>();
    const solids = world.entities.filter((o) => o.solid && !isEffect(o.type));
    /** Top of the first solid surface under x at or below fromY, or null over a pit (weather must not splash in mid-air). */
    const surfaceUnder = (x: number, fromY: number): number | null => {
      let best: number | null = null;
      for (const s of solids) if (x >= s.x && x <= s.x + s.w && s.y >= fromY - 2 && (best === null || s.y < best)) best = s.y;
      return best;
    };
    for (const e of world.entities) {
      if (!isEffect(e.type)) continue;
      const t = e.type.toLowerCase();
      const isWeather = t.includes("rain") || t.includes("drop") || t.includes("snow") || t.includes("blizzard");

      // Cull weather effects completely if underground (y >= 400)
      if (isWeather && e.y >= 400) continue;

      const x = e.x - this.camX, y = e.y - this.camY;
      if (x + e.w < -200 || x > W + 200 || y + e.h < -200 || y > H + 200) continue;

      if (t.includes("rain") || t.includes("drop")) {
        drops++;
        const cx = x + e.w / 2;
        const surf = surfaceUnder(e.x + e.w / 2, e.y);
        const endY = surf === null ? y + e.h : Math.min(y + e.h, surf - this.camY);
        if (endY > y - e.vy * 0.03) {
          g.moveTo(cx - e.vx * 0.03, y - e.vy * 0.03).lineTo(cx, endY).stroke({ width: 1.6, color: 0xbfe6ff, alpha: 0.55, cap: "round" });
        }
        now.set(e.id, { x: e.x + e.w / 2, y: surf === null ? e.y + e.h : Math.min(e.y + e.h, surf), land: surf !== null });
      } else if (t.includes("snow") || t.includes("blizzard")) {
        drops++;
        const cx = x + e.w * 0.5;
        const cy = y + e.h * 0.5;
        const sizeSeed = ((e.id * 17 + 7) % 5);
        const sz = 2.0 + sizeSeed * 0.6; // 2.0 .. 4.4px
        const alpha = 0.72 + (sizeSeed % 3) * 0.12;
        const color = e.color || 0xffffff;

        // Soft additive aura on larger snowflakes
        if (sz >= 3.6 && !this.brightSky()) {
          this.puff(cx, cy, sz * 3.2, 0xffffff, 0.12, true);
        }

        if (this.brightSky()) {
          // White crosses vanish into (or read as stars on) a daytime sky: draw soft round flakes with a pale-blue rim.
          g.circle(cx, cy, sz * 0.95).fill({ color, alpha: 0.95 }).stroke({ width: 1.2, color: 0x6f98c4, alpha: 0.85 });
        } else {
          // 4-point snowflake crystal
          const arm = sz * 0.85;
          g.moveTo(cx - arm, cy).lineTo(cx + arm, cy).stroke({ width: 1.2, color, alpha, cap: "round" });
          g.moveTo(cx, cy - arm).lineTo(cx, cy + arm).stroke({ width: 1.2, color, alpha, cap: "round" });
          g.rect(cx - 0.7, cy - 0.7, 1.4, 1.4).fill({ color, alpha });
        }

        // Soft snow puff & accumulation when touching ground
        const snowSurf = surfaceUnder(e.x + e.w * 0.5, e.y);
        if (snowSurf !== null && (e.onGround || e.y + e.h >= snowSurf - 4)) {
          const groundScreenY = snowSurf - this.camY;
          this.puff(cx, groundScreenY - 1, 7 + sizeSeed * 2, 0xffffff, 0.18, false);
          g.ellipse(cx, groundScreenY, 4 + sizeSeed, 1.4).fill({ color: 0xffffff, alpha: 0.65 });
        }
        now.set(e.id, { x: e.x + e.w * 0.5, y: snowSurf === null ? e.y + e.h : Math.min(e.y + e.h, snowSurf), land: snowSurf !== null });
      } else if (t.includes("spark") || t.includes("ember") || t.includes("firefly")) {
        const cx = x + e.w * 0.5;
        const cy = y + e.h * 0.5;
        if (t.includes("firefly")) {
          const pulse = 0.5 + 0.5 * Math.sin(this.clock * 4.5 + e.id * 2.3);
          const col = e.color || 0xd4ff59;
          this.puff(cx, cy, 18, col, 0.18 * pulse, true);
          g.circle(cx, cy, 2.2).fill({ color: col, alpha: 0.65 + 0.35 * pulse });
        } else {
          const isEmber = t.includes("ember");
          const col = e.color || (isEmber ? 0xff7b24 : 0xffea60);
          const sz = Math.max(1.8, Math.min(4.5, Math.max(e.w, e.h) * 0.6));
          if (Math.abs(e.vx) > 10 || Math.abs(e.vy) > 10) {
            g.moveTo(cx - e.vx * 0.025, cy - e.vy * 0.025).lineTo(cx, cy).stroke({ width: sz * 0.8, color: col, alpha: 0.85, cap: "round" });
          } else {
            g.circle(cx, cy, sz).fill({ color: col, alpha: 0.85 });
          }
          this.puff(cx, cy, sz * 4, col, 0.14, true);
        }
      } else if (t.includes("explosion") || t.includes("blast") || t.includes("shockwave")) {
        const cx = x + e.w * 0.5;
        const cy = y + e.h * 0.5;
        const r = Math.max(16, Math.max(e.w, e.h) * 0.6);
        g.circle(cx, cy, r).stroke({ width: 2, color: e.color || 0xffe9b0, alpha: 0.7 });
        this.puff(cx, cy, r * 1.2, e.color || 0xffaa40, 0.25, true);
      } else if (t.includes("fog") || t.includes("mist") || t.includes("haze") || t.includes("smoke")) {
        this.fogPuffs(e, x, y, t.includes("smoke"));
      }
    }
    // A drop that left the world splashes where it was; a mass removal (undo) stays quiet.
    let gone = 0;
    for (const id of this.lastDrops.keys()) if (!now.has(id)) gone++;
    if (gone > 0 && gone < 40) {
      for (const [id, p] of this.lastDrops) if (!now.has(id) && p.land) this.splashes.push({ x: p.x, y: p.y, age: 0 });
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
      const syClamped = s.y;
      const x = s.x - this.camX, y = syClamped - this.camY;
      g.ellipse(x, y, 3 + q * 9, 1.2 + q * 3).stroke({ width: 1, color: 0xdff3ff, alpha: (1 - q) * 0.7 });
      for (const vx of [-34, 0, 34]) {
        const a = s.age;
        g.rect(x + vx * a, y - (vx === 0 ? 120 : 90) * a + 420 * a * a, 1.6, 1.6).fill({ color: 0xdff3ff, alpha: 1 - q });
      }
    }
    this.splashes = this.splashes.filter((s) => s.age < SPLASH_LIFE);
  }

  /** A batch of fresh sim particles clustered at one spot is a burst: dress it as an explosion. */
  private detectBursts(world: World): void {
    const fresh: Particle[] = [];
    for (const p of world.particles) {
      if (this.seen.has(p)) continue;
      this.seen.add(p);
      fresh.push(p);
    }
    if (fresh.length < 6) return;

    // Cluster fresh particles that originate near the same point (< 48 px)
    const clusters: { count: number; sx: number; sy: number }[] = [];
    for (const p of fresh) {
      let matched = false;
      for (const c of clusters) {
        const cx = c.sx / c.count;
        const cy = c.sy / c.count;
        const distSq = (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy);
        if (distSq < 48 * 48) {
          c.count++;
          c.sx += p.x;
          c.sy += p.y;
          matched = true;
          break;
        }
      }
      if (!matched) {
        clusters.push({ count: 1, sx: p.x, sy: p.y });
      }
    }

    // Only clusters with at least 6 particles at that specific spot trigger an explosion blast
    for (const c of clusters) {
      if (c.count < 6) continue;
      const n = c.count;
      const size = Math.min(2.5, 0.9 + n / 16);
      const sparks: Spark[] = [];
      const sparkCount = Math.min(50, Math.round(n * 2.2));
      for (let i = 0; i < sparkCount; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (180 + Math.random() * 320) * size * 0.75;
        sparks.push({ vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 70, hot: Math.random() });
      }
      const puffs: Puff[] = [];
      // Fire core puffs (dense, expanding fast)
      for (let i = 0; i < 6; i++) {
        puffs.push({ dx: (Math.random() - 0.5) * 36 * size, dy: (Math.random() - 0.5) * 28 * size, vy: -25 - Math.random() * 35, r: (24 + Math.random() * 16) * size, delay: i * 0.02, smoke: false });
      }
      // Billowing smoke puffs (rising, churning outward)
      for (let i = 0; i < 8; i++) {
        puffs.push({ dx: (Math.random() - 0.5) * 48 * size, dy: (Math.random() - 0.5) * 32 * size, vy: -38 - Math.random() * 45, r: (26 + Math.random() * 20) * size, delay: 0.06 + i * 0.03, smoke: true });
      }
      this.blasts.push({ x: c.sx / n, y: c.sy / n, age: 0, size, sparks, puffs });
      if (this.blasts.length > 12) this.blasts.shift();
      this.shake = Math.max(this.shake, 6 + 4 * size);
    }
  }

  private drawBlasts(dt: number): void {
    const g = this.g;
    for (const b of this.blasts) {
      b.age += dt;
      const a = b.age, k = a / BLAST_LIFE;
      const x = b.x - this.camX, y = b.y - this.camY;
      const isLegacy = typeof window !== "undefined" && Boolean((window as any).__LEGACY_RENDER__);
      if (isLegacy) {
        if (a < 0.4) {
          const q = a / 0.4;
          g.circle(x, y, (14 + q * 70) * b.size).stroke({ width: Math.max(1, 5 * (1 - q)), color: 0xffe9b0, alpha: (1 - q) * 0.7 });
        }
      } else {
        // Punchy flash bloom (bright white-hot core expanding and vanishing in 0.18s)
        if (a < 0.18) {
          const fq = a / 0.18;
          this.puff(x, y, (45 + a * 600) * b.size, 0xffffff, (1 - fq) * 1.0, true);
          this.puff(x, y, (28 + a * 350) * b.size, 0xffd044, (1 - fq) * 0.9, true);
        }
      }
      for (const p of b.puffs) {
        const pa = a - p.delay;
        if (pa < 0) continue;
        const q = pa / (p.smoke ? 0.95 : 0.45);
        if (q >= 1) continue;
        const r = p.r * (0.6 + q * (p.smoke ? 1.6 : 1.2));
        const px = x + p.dx, py = y + p.dy + p.vy * pa;
        if (p.smoke) this.puff(px, py, r, 0x2b2e35, (1 - q) * 0.55);
        else this.puff(px, py, r, ramp(q), (1 - q) * 0.95, true);
      }
      for (const s of b.sparks) {
        const q = Math.min(1, k * 1.15 + s.hot * 0.15);
        if (q >= 1) continue;
        const px = x + s.vx * a, py = y + s.vy * a + 280 * a * a;
        const vy = s.vy + 560 * a;
        g.moveTo(px - s.vx * 0.028, py - vy * 0.028).lineTo(px, py).stroke({ width: 2.6 * (1 - q * 0.6), color: ramp(q * 0.8), alpha: 1 - q * q, cap: "round" });
        if (q < 0.4) {
          g.circle(px, py, 1.2).fill({ color: 0xffffff, alpha: (1 - q / 0.4) });
        }
      }
    }
    this.blasts = this.blasts.filter((b) => b.age < BLAST_LIFE);
  }
}
