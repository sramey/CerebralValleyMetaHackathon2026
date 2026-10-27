import { SIM, emptyInput } from "../contract";
import type { Entity, InputState, Particle, SpawnDef } from "../contract";
import { createRng } from "./rng";

type TickHandler = (dt: number) => void;

export class World {
  tickCount = 0;
  input: InputState = emptyInput();
  entities: Entity[] = [];
  particles: Particle[] = [];
  camera = { x: 0, y: 0 };
  private nextId = 1;
  private handlers = new Map<string, TickHandler[]>();
  private rng: () => number;

  constructor(seed = 1337) {
    this.rng = createRng(seed);
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
    this.entities = this.entities.filter((e) => e.owner !== owner);
  }

  spawn(def: SpawnDef, owner: string): Entity {
    // Hard cap: evict oldest non-player entity rather than growing unbounded.
    while (this.entities.length >= SIM.maxEntities) {
      const idx = this.entities.findIndex((e) => e.type !== "player");
      if (idx === -1) break;
      this.entities.splice(idx, 1);
    }
    const e: Entity = {
      id: this.nextId++,
      type: def.type,
      x: def.x, y: def.y, w: def.w, h: def.h,
      vx: def.vx ?? 0, vy: def.vy ?? 0,
      color: def.color ?? 0xffffff,
      solid: def.solid ?? false,
      gravityScale: def.gravityScale ?? 1,
      facing: 1, onGround: false, owner,
      data: { ...(def.data ?? {}) },
    };
    this.entities.push(e);
    return e;
  }

  despawn(id: number): void {
    this.entities = this.entities.filter((e) => e.id !== id);
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

  step(): void {
    const dt = SIM.dt;
    this.tickCount++;
    for (const list of [...this.handlers.values()]) for (const fn of [...list]) fn(dt);

    const solids = this.entities.filter((e) => e.solid);
    for (const e of this.entities) {
      // Static solids (gravityScale 0) never move. A solid with gravity still
      // gets physics: it collides with other solids, it just also blocks them.
      if (e.solid && e.gravityScale === 0) continue;
      e.vy += SIM.gravity * e.gravityScale * dt;
      // X axis
      e.x += e.vx * dt;
      for (const s of solids) if (s !== e && overlap(e, s)) {
        if (e.vx > 0) e.x = s.x - e.w;
        else if (e.vx < 0) e.x = s.x + s.w;
        else e.x = (e.x + e.w / 2 < s.x + s.w / 2) ? s.x - e.w : s.x + s.w;
        e.vx = 0;
      }
      // Y axis
      e.y += e.vy * dt;
      e.onGround = false;
      for (const s of solids) if (s !== e && overlap(e, s)) {
        if (e.vy > 0) { e.y = s.y - e.h; e.onGround = true; }
        else if (e.vy < 0) e.y = s.y + s.h;
        else if (e.y + e.h / 2 < s.y + s.h / 2) { e.y = s.y - e.h; e.onGround = true; }
        else e.y = s.y + s.h;
        e.vy = 0;
      }
    }
    for (const p of this.particles) {
      p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt;
    }
    this.particles = this.particles.filter((p) => p.life < p.maxLife);
    const player = this.entities.find((e) => e.type === "player");
    if (player) {
      this.camera.x = player.x + player.w / 2 - 480;
      this.camera.y = Math.min(0, player.y + player.h / 2 - 270);
    }
  }
}

function overlap(a: Entity, b: Entity): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
