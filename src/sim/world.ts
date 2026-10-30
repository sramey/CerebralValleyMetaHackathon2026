import { SIM, emptyInput } from "../contract";
import { entityKind } from "../ontology";
import { isDamageableTarget } from "./combat";
import type { Entity, HudDef, HudWidget, InputState, Particle, SpawnDef } from "../contract";
import { createRng } from "./rng";
import { landingVelocity } from "./bounce";

type TickHandler = (dt: number) => void;

/** HUD widget kinds the sim stores; anything else falls back to "stat". */
const HUD_KINDS = new Set(["bar", "hearts", "stat", "banner"]);
const HUD_POSITIONS = new Set([
  "top-left", "top-right", "top-center",
  "bottom-left", "bottom-right", "bottom-center",
  "center",
]);

export class World {
  tickCount = 0;
  input: InputState = emptyInput();
  entities: Entity[] = [];
  particles: Particle[] = [];
  camera = { x: 0, y: 0 };
  /** Declarative HUD widgets in creation order (ADR 0019). Pure data: the client renders. */
  hud = new Map<string, HudWidget>();
  private nextId = 1;
  private handlers = new Map<string, TickHandler[]>();
  private rng: () => number;

  constructor(seed = 1337) {
    this.rng = createRng(seed);
  }

  /** Create or update a HUD widget owned by `owner` (same id = in-place update). */
  setHud(owner: string, id: string, def: HudDef): void {
    const val = (v: unknown): number | string | undefined =>
      typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" ? v : undefined;
    const num = (v: unknown): number | undefined =>
      typeof v === "number" && Number.isFinite(v) ? v : undefined;
    const w: HudWidget = {
      id,
      owner,
      kind: HUD_KINDS.has(def.kind) ? def.kind : "stat",
      label: typeof def.label === "string" ? def.label : undefined,
      value: val(def.value),
      max: num(def.max),
      unit: typeof def.unit === "string" ? def.unit : undefined,
      icon: typeof def.icon === "string" ? def.icon : undefined,
      color: num(def.color),
      text: typeof def.text === "string" ? def.text : undefined,
      duration: num(def.duration),
      position: def.position !== undefined && HUD_POSITIONS.has(def.position) ? def.position : undefined,
      hidden: def.hidden === true ? true : undefined,
    };
    if (w.duration !== undefined && w.duration > 0) w.remaining = w.duration;
    this.hud.set(id, w);
  }

  /** Remove a HUD widget, but only one owned by `owner` (owner-scoped, like despawn). */
  removeHud(owner: string, id: string): void {
    const w = this.hud.get(id);
    if (w && w.owner === owner) this.hud.delete(id);
  }

  /** All HUD widgets in creation order. */
  hudList(): HudWidget[] {
    return [...this.hud.values()];
  }

  /** Age auto-removing banners on sim time (deterministic, never wall-clock). */
  private ageHud(dt: number): void {
    for (const [id, w] of this.hud) {
      if (w.remaining === undefined) continue;
      w.remaining -= dt;
      if (w.remaining <= 0) this.hud.delete(id);
    }
  }

  rand(): number {
    return this.rng();
  }

  addHandler(owner: string, fn: TickHandler): void {
    const list = this.handlers.get(owner) ?? [];
    list.push(fn);
    this.handlers.set(owner, list);
  }

  removeByOwner(owner: string): void {
    this.handlers.delete(owner);
    for (const e of this.entities) {
      if (e.owner === owner) {
        (e as any).dead = true;
        (e as any).despawned = true;
        (e as any).x = undefined;
        (e as any).y = undefined;
      }
    }
    this.entities = this.entities.filter((e) => e.owner !== owner);
    for (const [id, w] of this.hud) if (w.owner === owner) this.hud.delete(id);
  }

  spawn(def: SpawnDef, owner: string): Entity {
    // Hard cap: evict only as many as needed for this one spawn, in priority
    // order: (a) oldest entity owned by the spawning owner, (b) oldest
    // non-player entity that is not ground/platform, (c) oldest non-player.
    while (this.entities.length >= SIM.maxEntities) {
      let idx = this.entities.findIndex((e) => e.owner === owner && e.type !== "player");
      if (idx === -1) {
        idx = this.entities.findIndex(
          (e) => e.type !== "player" && e.type !== "ground" && e.type !== "platform" && e.kind !== "terrain",
        );
      }
      if (idx === -1) idx = this.entities.findIndex((e) => e.type !== "player");
      if (idx === -1) break;
      this.entities.splice(idx, 1);
    }
    const e: Entity = {
      id: this.nextId++,
      type: def.type,
      kind: def.kind ?? entityKind({ type: def.type, solid: def.solid ?? false, gravityScale: def.gravityScale ?? 1, vx: def.vx ?? 0, vy: def.vy ?? 0, data: def.data }),
      x: def.x, y: def.y, w: def.w, h: def.h,
      vx: def.vx ?? 0, vy: def.vy ?? 0,
      color: def.color ?? 0xffffff,
      solid: def.solid ?? false,
      gravityScale: def.gravityScale ?? 1,
      facing: 1, onGround: false, owner,
      health: def.health ?? 100,
      data: { ...(def.data ?? {}) },
    };
    this.entities.push(e);
    return e;
  }

  despawn(id: number): void {
    const e = this.entities.find((en) => en.id === id);
    if (e) {
      (e as any).dead = true;
      (e as any).despawned = true;
      (e as any).x = undefined;
      (e as any).y = undefined;
    }
    this.entities = this.entities.filter((en) => en.id !== id);
  }

  damage(id: number, amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const e = this.entities.find((en) => en.id === id);
    if (!e) return;
    e.health -= amount;
    if (e.health <= 0) {
      this.burst(e.x + e.w / 2, e.y + e.h / 2, e.color, 10);
      this.despawn(e.id);
    }
  }

  burst(x: number, y: number, color: number, n = 10): void {
    for (let i = 0; i < n; i++) {
      const a = this.rng() * Math.PI * 2;
      const sp = 40 + this.rng() * 120;
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        life: 0, maxLife: 0.4 + this.rng() * 0.4, color, size: 2 + this.rng() * 2,
      });
    }
    if (this.particles.length > 1000) this.particles.splice(0, this.particles.length - 1000);
  }

  /** Ticks each mover has pushed into a wall, for stuck recovery (engine-side, so every creature gets it). */
  private blocked = new Map<number, number>();
  private hopCooldown = new Map<number, number>();

  /** A creature grinding into an obstacle hops it, then turns around if that fails. */
  private unstick(e: Entity, pushing: boolean): void {
    if (!pushing) { if (this.blocked.has(e.id)) this.blocked.delete(e.id); return; }
    const n = (this.blocked.get(e.id) ?? 0) + 1;
    if (n === 6 && e.onGround) e.vy = -380;
    if (n >= 24) { e.facing = e.facing === 1 ? -1 : 1; this.blocked.delete(e.id); return; }
    this.blocked.set(e.id, n);
  }

  /** Casual creatures (data.casual) hop over the player instead of walking through them. */
  private casualHop(e: Entity, player: Entity | undefined): void {
    const cd = this.hopCooldown.get(e.id) ?? 0;
    if (cd > 0) this.hopCooldown.set(e.id, cd - 1);
    if (!player || e.data.casual !== true || e.vx === 0 || !e.onGround || cd > 0) return;
    const dx = (player.x + player.w / 2) - (e.x + e.w / 2);
    const reach = (player.w + e.w) / 2 + 24;
    const closing = (dx > 0) === (e.vx > 0);
    if (closing && Math.abs(dx) < reach && Math.abs((player.y + player.h / 2) - (e.y + e.h / 2)) < (player.h + e.h) / 2 + 8) {
      e.vy = -340;
      this.hopCooldown.set(e.id, 45);
    }
  }

  step(): void {
    const dt = SIM.dt;
    this.tickCount++;
    this.ageHud(dt);
    for (const list of [...this.handlers.values()]) for (const fn of [...list]) fn(dt);

    const solids = this.entities.filter((e) => e.solid);
    const player = this.entities.find((e) => e.type === "player");
    for (const e of this.entities) {
      // Static solids (gravityScale 0) never move. A solid with gravity still
      // gets physics: it collides with other solids, it just also blocks them.
      if (e.solid && e.gravityScale === 0) continue;
      if (typeof e.data.parallax === "number" || /^(cloud|sky|day-sky|night-sky|background|parallax)/i.test(e.type)) {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        continue;
      }
      const wantsMove = e.vx !== 0 && e.type !== "player";
      this.casualHop(e, player);
      e.vy = Math.min(e.vy + SIM.gravity * e.gravityScale * dt, 1100); // terminal velocity
      // X axis. One-way platforms (data.oneWay) never block sideways.
      e.x += e.vx * dt;
      let blockedX = false;
      for (const s of solids) if (s !== e && !s.data.oneWay && overlap(e, s)) {
        const stepHeight = (e.y + e.h) - s.y;
        if (e.onGround && e.vx !== 0 && stepHeight > 0 && stepHeight <= 28) {
          const steppedBox = { x: e.x, y: s.y - e.h, w: e.w, h: e.h };
          const headBlocked = solids.some((s2) => s2 !== e && s2 !== s && !s2.data.oneWay && overlap(steppedBox, s2));
          if (!headBlocked) {
            e.y = s.y - e.h;
            e.onGround = true;
            continue;
          }
        }
        if (!e.solid && s.y === 400) continue;
        if (e.vx > 0) e.x = s.x - e.w;
        else if (e.vx < 0) e.x = s.x + s.w;
        else e.x = (e.x + e.w / 2 < s.x + s.w / 2) ? s.x - e.w : s.x + s.w;
        e.vx = 0;
        blockedX = true;
      }
      this.unstick(e, wantsMove && blockedX);
      // Y axis. One-way platforms only catch a falling entity that was above them.
      const prevBottom = e.y + e.h;
      e.y += e.vy * dt;
      const fallSpeed = e.vy;
      e.onGround = false;
      for (const s of solids) if (s !== e && overlap(e, s)) {
        if (s.data.oneWay && !(e.vy > 0 && prevBottom <= s.y + 0.5)) continue;
        if (!e.solid && s.y === 400) { e.y = s.y - e.h; e.onGround = true; } else if (e.vy > 0) { e.y = s.y - e.h; e.onGround = true; }
        else if (e.vy < 0) e.y = s.y + s.h;
        else if (e.y + e.h / 2 < s.y + s.h / 2) { e.y = s.y - e.h; e.onGround = true; }
        else e.y = s.y + s.h;
        // A landing can be elastic (data.bounce, ADR 0053): a dropped coin settles instead
        // of freezing. With no data.bounce this is exactly the old stop (0).
        e.vy = fallSpeed > 0 ? landingVelocity(e, fallSpeed) : 0;
      }
    }
    for (const p of this.particles) {
      p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt;
    }
    this.particles = this.particles.filter((p) => p.life < p.maxLife);
    // Post-step 1: Rigid player equipment / weapon mounting (bead qwc)
    if (player) {
      for (const e of this.entities) {
        if (e === player) continue;
        const isHeld = e.data.heldByPlayer === true || e.data.equipped === true || e.data.attachedTo === "player";
        const isEquipment = /^(gun|blaster|sword|jetpack|backpack|shield|weapon|bow|wand|dagger|spear|axe|hat|crown|helmet|cape)$/i.test(e.type);
        if (isHeld || isEquipment) {
          e.facing = player.facing;
          const socket = e.data.socket || (/^(jetpack|backpack|cape)$/i.test(e.type) ? "back" : /^(hat|crown|helmet)$/i.test(e.type) ? "head" : "hand");
          if (socket === "back") {
            const ox = typeof e.data.offsetX === "number" ? e.data.offsetX : 8;
            const oy = typeof e.data.offsetY === "number" ? e.data.offsetY : 6;
            e.x = player.facing >= 0 ? player.x - e.w + ox : player.x + player.w - ox;
            e.y = player.y + oy;
          } else if (socket === "head") {
            e.x = player.x + (player.w - e.w) / 2;
            e.y = player.y - e.h + 2;
          } else {
            // Hand socket: held in front at chest/waist height (player.h * 0.45)
            const ox = typeof e.data.offsetX === "number" ? e.data.offsetX : 4;
            const oy = typeof e.data.offsetY === "number" ? e.data.offsetY : Math.round(player.h * 0.45);
            e.x = player.facing >= 0 ? player.x + player.w - ox : player.x - e.w + ox;
            e.y = player.y + oy;
          }
          e.vx = player.vx;
          e.vy = player.vy;
        }
      }
    }

    // Post-step 2: Universal projectile collision & enemy combat (bead 578)
    const projectiles = this.entities.filter((e) => e.data.visual === "projectile" || entityKind(e) === "projectile" || /^(bullet|projectile|laser|arrow|fireball|plasma|shot)$/i.test(e.type));
    for (const proj of projectiles) {
      if ((proj as any).dead) continue;
      const damage = typeof proj.data.damage === "number" ? proj.data.damage : 25;
      for (const target of this.entities) {
        if (target.id === proj.id || (target as any).dead) continue;
        if (isDamageableTarget(target, proj) && overlap(proj, target)) {
          this.burst(proj.x + proj.w / 2, proj.y + proj.h / 2, proj.color || 0xffd700, 8);
          this.damage(target.id, damage);
          this.despawn(proj.id);
          break;
        }
      }
      // Despawn on solid obstacles
      if (!(proj as any).dead) {
        for (const s of solids) {
          if (!s.data.oneWay && overlap(proj, s)) {
            this.burst(proj.x + proj.w / 2, proj.y + proj.h / 2, proj.color || 0xffd700, 4);
            this.despawn(proj.id);
            break;
          }
        }
      }
    }

    // Post-step 3: Enemy contact damage to player with brief invulnerability timer
    if (player && !(player as any).dead) {
      const hitCd = typeof player.data.hitCooldown === "number" ? player.data.hitCooldown : 0;
      if (hitCd > 0) {
        player.data.hitCooldown = hitCd - 1;
      } else {
        for (const en of this.entities) {
          if (en.id === player.id || (en as any).dead) continue;
          const isEnemy = en.data.hostile === true || en.data.enemy === true || /^(enemy|walker|turtle|boss|monster|zombie|goblin|slime|spider|bat|skeleton|demon|orc)$/i.test(en.type);
          if (isEnemy && overlap(player, en)) {
            const dmg = typeof en.data.damage === "number" ? en.data.damage : 10;
            this.damage(player.id, dmg);
            player.data.hitCooldown = 30; // 0.5s cooldown at 60Hz
            this.burst(player.x + player.w / 2, player.y + player.h / 2, 0xff3b30, 8);
            break;
          }
        }
      }
    }

    if (player) {
      this.camera.x = player.x + player.w / 2 - 480;
      this.camera.y = Math.min(0, player.y + player.h / 2 - 270);
    }
  }
}

function overlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
