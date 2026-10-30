// Game feel (bead a5q): a smooth follow camera and per-entity juice, all render-side. Nothing here writes to the
// world: it only reads entities each frame, keys its own state by entity id, and draws into its own Graphics.
import { Graphics } from "pixi.js";
import type { Container } from "pixi.js";
import type { Entity } from "../contract";
import { isProjectileOrAttachment } from "./portal";

/** Things that happened this frame, for sound (bead 6d3). Observed from the world, never fed back into it. */
export type FeelEvent =
  | { kind: "jump" }
  | { kind: "land"; impact: number }
  | { kind: "step" }
  | { kind: "coin" }
  | { kind: "hit"; damage: number; self: boolean }
  | { kind: "shoot" }
  | { kind: "die" };

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Camera that leads the player's movement and ignores small vertical moves while airborne. */
export class FollowCam {
  /** Vertical band (px) the camera ignores while the player is in the air. */
  static readonly DEADZONE = 34;
  /** Furthest the camera looks ahead of the player (px). */
  static readonly LOOKAHEAD = 72;
  private la = 0;

  /** Horizontal offset towards where the player is heading, eased so turning around never snaps. */
  lookahead(player: Pick<Entity, "vx"> | undefined, dt: number): number {
    const target = player ? clamp(player.vx * 0.28, -FollowCam.LOOKAHEAD, FollowCam.LOOKAHEAD) : 0;
    this.la += (target - this.la) * (1 - Math.exp(-dt * 3.5));
    return this.la;
  }

  /** Frame-rate independent follow (matches the old 0.12-per-frame ease at 60 fps). */
  smoothX(cur: number, target: number, dt: number): number {
    return cur + (target - cur) * (1 - Math.exp(-dt * 7.5));
  }

  /** Vertical follow: on the ground it settles on the target, in the air it only moves once the target leaves the deadzone. */
  smoothY(cur: number, target: number, dt: number, grounded: boolean): number {
    let t = target;
    if (!grounded) {
      const d = target - cur;
      t = Math.abs(d) <= FollowCam.DEADZONE ? cur : target - Math.sign(d) * FollowCam.DEADZONE;
    }
    return cur + (t - cur) * (1 - Math.exp(-dt * (grounded ? 6 : 7.5)));
  }
}

interface Track {
  seen: number;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  vy: number;
  onGround: boolean;
  health: number;
  /** Distance walked since the last footstep (px). */
  stride: number;
  /** Spring-driven scale (1 = rest) and its velocity. */
  sx: number;
  sy: number;
  svx: number;
  svy: number;
  flash: number;
}

/** kind: 0 dust puff, 1 spark, 2 ring */
interface Particle {
  kind: 0 | 1 | 2;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: number;
}

const MAX_PARTICLES = 160;
const FLASH_TIME = 0.14;
const REST = { sx: 1, sy: 1 };
const TRACKED_MAX_W = 160;
const STRIDE_PX = 46;

export class Feel {
  readonly cam = new FollowCam();
  /** Colour of landing dust; the client tints it to the world's ground. */
  dustColor = 0xd8ccb2;
  private tracks = new Map<number, Track>();
  private coins = new Map<number, { seen: number; x: number; y: number; w: number; h: number }>();
  private parts: Particle[] = [];
  private frame = 0;
  private g = new Graphics();
  private shots = new Set<number>();
  private shotsPrimed = false;
  /** Last frame's player and projectile positions: something that vanishes next to one of them was knocked out. */
  private hitters: { x: number; y: number }[] = [];

  /** `kick` nudges the screen shake (Fx owns the shake); impacts below the "big" threshold never call it. */
  constructor(stage: Container, private kick: (amp: number) => void, private shakeOn = true, private emit: (e: FeelEvent) => void = () => {}) {
    this.g.zIndex = 10.5;
    stage.addChild(this.g);
  }

  scaleOf(id: number): { sx: number; sy: number } {
    return this.tracks.get(id) ?? REST;
  }

  tintOf(id: number): number {
    const t = this.tracks.get(id);
    return t && t.flash > 0 ? 0xff8f8f : 0xffffff;
  }

  private spawn(p: Particle): void {
    if (this.parts.length < MAX_PARTICLES) this.parts.push(p);
  }

  private dust(x: number, y: number, n: number, spread: number): void {
    for (let i = 0; i < n; i++) {
      const dir = i % 2 ? 1 : -1;
      const k = (i + 1) / n;
      this.spawn({
        kind: 0, x: x + dir * k * 4, y,
        vx: dir * (24 + 70 * k) * spread, vy: -(10 + 26 * (1 - k)),
        life: 0, max: 0.32 + 0.16 * k, size: 3 + 3 * (1 - k * 0.4), color: this.dustColor,
      });
    }
  }

  private coinPop(x: number, y: number): void {
    this.spawn({ kind: 2, x, y, vx: 0, vy: 0, life: 0, max: 0.28, size: 22, color: 0xffe27a });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      const sp = 70 + (i % 3) * 38;
      this.spawn({ kind: 1, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0, max: 0.42 + (i % 3) * 0.07, size: 3.2, color: i % 2 ? 0xfff3b0 : 0xffd54a });
    }
  }

  /** Observe the world for this frame (read-only) and advance springs, particles and flashes. */
  update(entities: readonly Entity[], dt: number): void {
    this.frame++;
    const f = this.frame;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      const type = e.type;
      // A pickup: a coin/gem by name, or anything the engine collects (data.collectible,
      // ADR 0055). Tracking it here is what gives an engine-collected pickup its pop and
      // its coin sound when it vanishes next to the player.
      if (!e.solid && (type.includes("coin") || type.includes("gem") || Boolean(e.data && e.data.collectible))) {
        const c = this.coins.get(e.id);
        if (c) { c.seen = f; c.x = e.x; c.y = e.y; c.w = e.w; c.h = e.h; }
        else this.coins.set(e.id, { seen: f, x: e.x, y: e.y, w: e.w, h: e.h });
        continue;
      }
      if (e.solid || e.gravityScale <= 0 || e.w > TRACKED_MAX_W) continue;
      let t = this.tracks.get(e.id);
      if (!t) {
        t = { seen: f, type, x: e.x, y: e.y, w: e.w, h: e.h, vy: e.vy, onGround: e.onGround, health: e.health, stride: 0, sx: 1, sy: 1, svx: 0, svy: 0, flash: 0 };
        this.tracks.set(e.id, t);
        continue;
      }
      const feetX = e.x + e.w / 2;
      const feetY = e.y + e.h;
      if (t.onGround && !e.onGround && e.vy < -150) {
        // Take-off: stretch tall and thin.
        t.sx = 0.84; t.sy = 1.2;
        if (type === "player") this.emit({ kind: "jump" });
      } else if (!t.onGround && e.onGround && t.vy > 160) {
        // Landing: squash flat, harder the faster we came down; kick up dust.
        const impact = clamp(t.vy / 900, 0, 1);
        t.sx = 1.08 + 0.26 * impact; t.sy = 0.94 - 0.28 * impact;
        this.dust(feetX, feetY, 4 + Math.round(6 * impact), 0.6 + 0.6 * impact);
        if (type === "player") this.emit({ kind: "land", impact });
        if (impact > 0.85 && this.shakeOn) this.kick(1.8);
      } else if (t.onGround && e.onGround && e.y < t.y - 3 && e.y > t.y - 22) {
        // Stepped up onto a ledge or stair.
        this.dust(feetX, feetY, 3, 0.5);
        t.sx = 1.05; t.sy = 0.95;
      }
      if (type === "player" && e.onGround && t.onGround && Math.abs(e.vx) > 40) {
        t.stride += Math.abs(e.vx) * dt;
        if (t.stride >= STRIDE_PX) { t.stride -= STRIDE_PX; this.emit({ kind: "step" }); }
      } else t.stride = 0;
      if (e.health < t.health - 0.5) {
        this.emit({ kind: "hit", damage: t.health - e.health, self: type === "player" });
        t.flash = FLASH_TIME;
        if (t.health - e.health >= 20 && this.shakeOn) this.kick(1.6);
      }
      // Damped spring back to rest (a little overshoot reads as bounce).
      const k = 260, c = 18;
      t.svx += ((1 - t.sx) * k - t.svx * c) * dt; t.sx += t.svx * dt;
      t.svy += ((1 - t.sy) * k - t.svy * c) * dt; t.sy += t.svy * dt;
      t.flash = Math.max(0, t.flash - dt);
      t.x = e.x; t.y = e.y; t.w = e.w; t.h = e.h; t.vy = e.vy; t.onGround = e.onGround; t.health = e.health; t.seen = f;
    }
    // Coins that vanished near the player were collected: pop them.
    const player = entities.find((e) => e.type === "player");
    this.watchShots(entities, player);
    for (const [id, c] of this.coins) {
      if (c.seen === f) continue;
      this.coins.delete(id);
      if (player && Math.abs(player.x + player.w / 2 - (c.x + c.w / 2)) < 90 && Math.abs(player.y + player.h / 2 - (c.y + c.h / 2)) < 90) {
        this.coinPop(c.x + c.w / 2, c.y + c.h / 2);
        this.emit({ kind: "coin" });
      }
    }
    for (const [id, t] of this.tracks) {
      if (t.seen === f) continue;
      this.tracks.delete(id);
      // A creature that disappears right beside the player or a shot was defeated (not despawned by an undo).
      if (t.type !== "player" && t.health > 0 && this.hitters.some((h) => Math.abs(h.x - (t.x + t.w / 2)) < 70 && Math.abs(h.y - (t.y + t.h / 2)) < 70)) {
        this.emit({ kind: "die" });
        this.dust(t.x + t.w / 2, t.y + t.h, 6, 1);
      }
    }
    this.hitters.length = 0;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e.type === "player" || isProjectileOrAttachment(e)) this.hitters.push({ x: e.x + e.w / 2, y: e.y + e.h / 2 });
    }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life += dt;
      if (p.life >= p.max) { this.parts[i] = this.parts[this.parts.length - 1]; this.parts.pop(); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 0) { p.vx *= Math.exp(-dt * 5); p.vy *= Math.exp(-dt * 3); }
      else if (p.kind === 1) p.vy += 260 * dt;
    }
  }

  /** A projectile that first appears next to the player was fired by them. A world load (many at once) is not a volley. */
  private watchShots(entities: readonly Entity[], player: Entity | undefined): void {
    let fresh = 0, fired = false;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (this.shots.has(e.id)) continue;
      this.shots.add(e.id);
      fresh++;
      if (player && isProjectileOrAttachment(e) && Math.abs(e.x - player.x) < 140 && Math.abs(e.y - player.y) < 140) fired = true;
    }
    if (this.shots.size > 4000) this.shots = new Set(entities.map((e) => e.id));
    if (this.shotsPrimed && fresh <= 4 && fired) this.emit({ kind: "shoot" });
    this.shotsPrimed = true;
  }

  /** Draw the particles and hit flashes in screen space. */
  draw(camX: number, camY: number): void {
    const g = this.g;
    g.clear();
    for (const t of this.tracks.values()) {
      if (t.flash <= 0) continue;
      g.circle(t.x + t.w / 2 - camX, t.y + t.h / 2 - camY, Math.max(t.w, t.h) * 0.75).fill({ color: 0xffffff, alpha: 0.5 * (t.flash / FLASH_TIME) });
    }
    for (const p of this.parts) {
      const q = p.life / p.max;
      const x = p.x - camX, y = p.y - camY;
      if (p.kind === 0) g.circle(x, y, p.size * (1 + q * 0.9)).fill({ color: p.color, alpha: 0.55 * (1 - q) });
      else if (p.kind === 1) {
        const s = p.size * (1 - q * 0.5);
        g.poly([x, y - s * 1.6, x + s * 0.6, y, x, y + s * 1.6, x - s * 0.6, y]).fill({ color: p.color, alpha: 1 - q * q });
      } else g.circle(x, y, p.size * (0.3 + q)).stroke({ width: 2, color: p.color, alpha: 0.9 * (1 - q) });
    }
  }
}
