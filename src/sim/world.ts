import { SIM, emptyInput } from "../contract";
import { entityKind } from "../ontology";
import { DEFAULT_PROJECTILE_DAMAGE, isDamageableTarget, isFriendly, isPet } from "./combat";
import { stompableBy, stompBounce, stompDamage } from "./stomp";
import { faceToward, type FacingClock } from "./facing";
import type { CreatureOrder, Entity, SceneOptions, SceneState, HudDef, HudWidget, InputState, KnobValue, ModEvent, ModEventName, Particle, SpawnDef, Speech } from "../contract";
import { SolidGrid } from "./grid";
import { createRng } from "./rng";
import { landingVelocity } from "./bounce";
import { collectPickups } from "./collect";
import { canInteract, interactLabel, isOrderable, orderAck, ORDER_TICKS, steerByOrder } from "./interact";
import { touches } from "./reach";
import { mountGear, wearerOf } from "./sockets";
import { BACKDROPS, cleanSceneWord, isSceneScenery, isSceneTerrain, sceneOptionsOk, type SceneRec } from "./scene";

type TickHandler = (dt: number) => void;
type EventListener = (ev: ModEvent) => void;

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
  /** Banked engine-owned pickup totals per HUD id (ADR 0055), e.g. the shared "score". */
  readonly collected = new Map<string, number>();
  /** Speech bubbles by entity id (ADR 0059). Pure data: the client draws them over the entity. */
  speech = new Map<number, Speech>();
  /** What the action key would interact with right now (ADR 0059), for the client's "B: Talk" prompt. */
  interactable?: { id: number; label: string };
  /** Scene claims in load order (ADR 0066). The last claim with a backdrop or skin wins. */
  private scenes: SceneRec[] = [];
  private nextId = 1;
  private handlers = new Map<string, TickHandler[]>();
  /** api.on listeners per owner and event (ADR 0059). */
  private listeners = new Map<string, Map<ModEventName, EventListener[]>>();
  /** Events raised this tick, delivered at the start of the next one. Owner "*" broadcasts to every mod but the sender. */
  private pending: { owner: string; ev: ModEvent }[] = [];
  /** Entities the player is touching, so "touch" fires once per contact, not every frame. */
  private touching = new Set<number>();
  /** Standing orders by entity id and the tick each one lapses. */
  private orders = new Map<number, { order: CreatureOrder; until: number }>();
  private prevAction = false;
  private rng: () => number;
  private grid = new SolidGrid();

  /** Set by the client: does this entity have drawn art? Unset (headless) means yes (ADR 0061). */
  hasArt?: (e: Entity) => boolean;

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

  /** Listen for an event on `owner`'s entities (ADR 0059). */
  on(owner: string, type: ModEventName, fn: EventListener): void {
    let byType = this.listeners.get(owner);
    if (!byType) this.listeners.set(owner, (byType = new Map()));
    const list = byType.get(type) ?? [];
    list.push(fn);
    byType.set(type, list);
  }

  private listens(owner: string, type: ModEventName): boolean {
    return (this.listeners.get(owner)?.get(type)?.length ?? 0) > 0;
  }

  /** Raise an event for `owner`; it is delivered at the start of the next tick, so listeners never run inside another mod's code. */
  private raise(owner: string, ev: ModEvent): void {
    if (owner === "*" || this.listens(owner, ev.type)) this.pending.push({ owner, ev });
  }

  /** Put a speech bubble over an entity for `seconds` of sim time. */
  say(owner: string, entityId: number, text: unknown, seconds = 3): void {
    if (!this.entities.some((e) => e.id === entityId)) return;
    const t = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!t) { this.speech.delete(entityId); return; }
    const secs = typeof seconds === "number" && Number.isFinite(seconds) ? Math.min(10, Math.max(0.5, seconds)) : 3;
    this.speech.set(entityId, { entityId, owner, text: t, remaining: secs });
  }

  /** Tell every other mod something happened. */
  signal(from: string, name: unknown, value?: KnobValue): void {
    const n = String(name ?? "").slice(0, 40);
    if (n) this.raise("*", { type: "signal", name: n, value, from });
  }

  /**
   * Give `modId`'s creatures (every mod's, for "*") a standing order (ADR 0059). The engine steers them after
   * their own tick code, so it works on any creature without a rebuild. Returns how many took the order.
   */
  giveOrder(modId: string, order: CreatureOrder): number {
    let n = 0;
    for (const e of this.entities) {
      if ((modId !== "*" && e.owner !== modId) || !isOrderable(e)) continue;
      if (order === "free") this.orders.delete(e.id);
      else this.orders.set(e.id, { order, until: this.tickCount + ORDER_TICKS[order] });
      if (n === 0) this.say("engine", e.id, orderAck(order), 1.6);
      this.raise(e.owner, { type: "order", entity: e, order });
      n++;
    }
    return n;
  }

  /** The order an entity is under, if any. */
  orderOf(id: number): CreatureOrder | undefined {
    return this.orders.get(id)?.order;
  }

  /** Deliver last tick's events, with the same fault containment as tick handlers. */
  private deliverEvents(): void {
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    for (const { owner, ev } of batch) {
      const owners = owner === "*" ? [...this.listeners.keys()].filter((o) => o !== ev.from) : [owner];
      for (const o of owners) {
        const list = this.listeners.get(o)?.get(ev.type);
        if (!list) continue;
        for (const fn of [...list]) {
          if (!this.onFault) { fn(ev); continue; }
          try {
            fn(ev);
          } catch (err) {
            this.handlers.delete(o);
            this.listeners.delete(o);
            this.onFault(o, err);
            break;
          }
        }
      }
    }
  }

  private ageSpeech(dt: number): void {
    for (const [id, b] of this.speech) {
      b.remaining -= dt;
      if (b.remaining <= 0) this.speech.delete(id);
    }
  }

  /** "touch" fires when the player starts touching an entity whose mod listens for it. */
  private touchPass(player: Entity | undefined): void {
    if (!player || player.dead) { this.touching.clear(); return; }
    for (const e of this.entities) {
      if (e === player || e.dead || !this.listens(e.owner, "touch")) continue;
      if (touches(player, e)) {
        if (!this.touching.has(e.id)) { this.touching.add(e.id); this.raise(e.owner, { type: "touch", entity: e, other: player }); }
      } else this.touching.delete(e.id);
    }
  }

  /** The nearest entity with data.interact becomes the prompt; pressing the action key raises "interact" on it. */
  private interactPass(player: Entity | undefined): void {
    const action = this.input.use === true;
    const pressed = action && !this.prevAction;
    this.prevAction = action;
    this.interactable = undefined;
    if (!player || player.dead) return;
    let best: Entity | undefined;
    let bestD = Infinity;
    for (const e of this.entities) {
      if (e === player || e.dead || !canInteract(player, e)) continue;
      const d = Math.abs((e.x + e.w / 2) - (player.x + player.w / 2));
      if (d < bestD) { best = e; bestD = d; }
    }
    if (!best) return;
    this.interactable = { id: best.id, label: interactLabel(best) };
    if (pressed) this.raise(best.owner, { type: "interact", entity: best, other: player });
  }

  addHandler(owner: string, fn: TickHandler): void {
    const list = this.handlers.get(owner) ?? [];
    list.push(fn);
    this.handlers.set(owner, list);
  }

  /**
   * When set, a tick handler that throws is contained (ADR 0056): its owner's handlers stop and
   * this is called, and the rest of the world keeps stepping. Unset (verifier, playtest, tests),
   * the error propagates so a bad mod fails loudly.
   */
  onFault?: (owner: string, err: unknown) => void;

  /** Every mod's tick handlers, in load order. */
  private runHandlers(dt: number): void {
    for (const [owner, list] of [...this.handlers]) {
      if (this.handlers.get(owner) !== list) continue; // unloaded or reloaded earlier this tick
      for (const fn of [...list]) {
        if (!this.onFault) { fn(dt); continue; }
        try {
          fn(dt);
        } catch (err) {
          this.handlers.delete(owner);
          this.onFault(owner, err);
          break;
        }
      }
    }
  }

  /** Remove everything `owner` made. `keepSlot` keeps its place in the tick order, for a reload. */
  /** What the client should paint: the newest claim's backdrop and player skin. */
  get scene(): SceneState {
    const out: SceneState = {};
    for (const r of this.scenes) { if (r.backdrop) out.backdrop = r.backdrop; if (r.skin) out.playerSkin = r.skin; }
    return out;
  }

  /** Genre change (ADR 0066): take terrain/scenery out of the world, set a backdrop and player skin, all undone by `unscene`. */
  setScene(owner: string, raw: SceneOptions): void {
    const o = sceneOptionsOk(raw);
    let rec = this.scenes.find((r) => r.owner === owner);
    const player = this.entities.find((e) => e.type === "player");
    if (!rec) {
      const below = this.scenes[this.scenes.length - 1]?.prevGravity ?? player?.gravityScale;
      rec = { owner, stash: [], ...(below !== undefined ? { prevGravity: below } : {}) };
      this.scenes.push(rec);
    }
    const hideTerrain = o.hideTerrain === true;
    const hideScenery = o.hideScenery === true;
    if (hideTerrain || hideScenery) {
      const keep: Entity[] = [];
      for (const e of this.entities) {
        if ((hideTerrain && isSceneTerrain(e)) || (hideScenery && isSceneScenery(e))) rec.stash.push(e); else keep.push(e);
      }
      this.entities = keep;
    }
    const b = cleanSceneWord(o.backdrop);
    if (b && BACKDROPS.includes(b)) rec.backdrop = b;
    const skin = cleanSceneWord(o.playerSkin);
    if (skin) rec.skin = skin;
  }

  /** Undo one mod's scene claim. Out-of-order undo hands the saved gravity to the next claim up the stack, so the player ends as before the first scene. */
  private unscene(owner: string): void {
    const i = this.scenes.findIndex((r) => r.owner === owner);
    if (i < 0) return;
    const rec = this.scenes[i];
    this.scenes.splice(i, 1);
    // Back into the world in spawn order (ids only grow), skipping what its own mod has since unloaded.
    if (rec.stash.length > 0) {
      this.entities = [...this.entities, ...rec.stash].sort((a, b) => a.id - b.id);
    }
    const above = this.scenes[i];
    const player = this.entities.find((e) => e.type === "player");
    if (above) { if (above.prevGravity === undefined) above.prevGravity = rec.prevGravity; }
    else if (player && rec.prevGravity !== undefined) player.gravityScale = rec.prevGravity;
  }

  removeByOwner(owner: string, keepSlot = false): void {
    for (const r of this.scenes) r.stash = r.stash.filter((e) => e.owner !== owner);
    this.unscene(owner);
    if (keepSlot && this.handlers.has(owner)) this.handlers.set(owner, []);
    else this.handlers.delete(owner);
    for (const e of this.entities) {
      if (e.owner === owner) {
        retire(e);
        this.forget(e.id);
      }
    }
    this.entities = this.entities.filter((e) => e.owner !== owner);
    for (const [id, w] of this.hud) if (w.owner === owner) this.hud.delete(id);
    // A reload runs setup again, which registers its listeners again.
    this.listeners.delete(owner);
    this.pending = this.pending.filter((p) => p.owner !== owner);
    for (const [id, b] of this.speech) if (b.owner === owner) this.speech.delete(id);
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
      retire(e);
      this.forget(e.id);
    }
    this.entities = this.entities.filter((en) => en.id !== id);
  }

  /** `by`: the mod id that dealt the damage, or "engine" (ADR 0059: it rides on the hit and death events). */
  damage(id: number, amount: number, by = "engine"): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const e = this.entities.find((en) => en.id === id);
    if (!e) return;
    e.health -= amount;
    this.raise(e.owner, { type: "hit", entity: e, amount, by });
    if (e.health <= 0) {
      // A copy taken before the despawn clears x/y, so a death listener can drop loot where it fell.
      if (this.listens(e.owner, "death")) this.raise(e.owner, { type: "death", entity: { ...e, data: { ...e.data } }, amount, by });
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

  /** Drop the engine's per-entity bookkeeping for a despawned entity, so it never grows over a session. */
  private forget(id: number): void {
    this.blocked.delete(id);
    this.hopCooldown.delete(id);
    this.turning.delete(id);
    this.clearOfPlayer.delete(id);
    this.facingClock.delete(id);
    this.stomped.delete(id);
    this.speech.delete(id);
    this.touching.delete(id);
    this.orders.delete(id);
  }

  /** Ticks each mover has pushed into a wall, for stuck recovery (engine-side, so every creature gets it). */
  private blocked = new Map<number, number>();
  private hopCooldown = new Map<number, number>();
  /** Non-player projectiles that have been clear of the player at least once (they may hit the player from then on). */
  private clearOfPlayer = new Set<number>();
  /** Hostiles the player landed on this tick: their body cannot also hurt the player (ADR 0071). */
  private stomped = new Set<number>();
  /** When each creature last flipped its sprite, so facing never flips every frame (ADR 0071). */
  private facingClock: FacingClock = new Map();

  /** Creatures told to walk the other way: direction and the tick the order lapses (ADR 0051). */
  private turning = new Map<number, { dir: number; until: number }>();

  /** Make a mover head `dir` for the next `ticks` ticks, whatever sign its own code gives vx. */
  private turnAway(e: Entity, dir: number, ticks: number): void {
    this.turning.set(e.id, { dir, until: this.tickCount + ticks });
    faceToward(e, dir, this.facingClock, this.tickCount);
  }

  /** A creature grinding into an obstacle hops it, then turns around if that fails. Fliers just turn: they cannot hop. */
  private unstick(e: Entity, pushing: boolean, pushDir: number): void {
    if (!pushing) { if (this.blocked.has(e.id)) this.blocked.delete(e.id); return; }
    const n = (this.blocked.get(e.id) ?? 0) + 1;
    const flier = e.gravityScale === 0;
    if (n === 6 && e.onGround) e.vy = -380;
    if (n >= (flier ? 4 : 24)) {
      this.turnAway(e, pushDir > 0 ? -1 : 1, flier ? 60 : 40);
      this.blocked.delete(e.id);
      return;
    }
    this.blocked.set(e.id, n);
  }

  /** True when a body's foot-front probe finds nothing to stand on within a short drop (hops and steps under 40 px are not ledges). */
  private ledgeAhead(e: Entity, solids: Entity[], dir: number): boolean {
    const px = dir > 0 ? e.x + e.w + 4 : e.x - 4;
    const probe = { x: px, y: e.y + e.h, w: 1, h: 40 };
    return !this.grid.query(probe).some((i) => solids[i] !== e && overlap(probe, solids[i]));
  }

  /** Engine-side behaviour states for hostile creatures (ADR 0051): data.aiState is patrol, notice, attack or cooldown. Mods read it, they never have to track it. */
  private aiState(e: Entity, player: Entity | undefined): void {
    if (e.data.hostile !== true || !player || e.type === "player") return;
    const dx = (player.x + player.w / 2) - (e.x + e.w / 2);
    const dy = (player.y + player.h / 2) - (e.y + e.h / 2);
    const dist = Math.hypot(dx, dy);
    const since = this.tickCount - (typeof e.data.lastHit === "number" ? e.data.lastHit : -9999);
    e.data.aiState = since < 45 ? "cooldown" : dist < (player.w + e.w) / 2 + 36 ? "attack" : dist < 280 ? "notice" : "patrol";
    e.data.aiDir = dx >= 0 ? 1 : -1;
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

  /**
   * There is no kill floor, and a hopper is airborne at the slab's end, so the ledge guard never
   * sees it: a creature that falls far below the main ground slab would be gone for good (bead 5yy).
   * It goes back on the slab near the player, standing, keeping its own velocity so the mod's
   * steering is untouched. Mods and their entities are not changed anywhere else.
   */
  private rescueFallen(solids: Entity[], player: Entity | undefined): void {
    let slab: Entity | undefined;
    for (const s of solids) if (isGroundSlab(s) && (!slab || s.w > slab.w)) slab = s;
    if (!slab) return;
    const floor = slab.y + RESCUE_DEPTH;
    for (const e of this.entities) {
      if (e.y <= floor || e.type === "player" || e.solid || e.gravityScale <= 0 || e.dead) continue;
      if ((e.kind ?? entityKind(e)) !== "creature" || e.data.tetherTo !== undefined || traitsOf(e.type).scenery) continue;
      // Stand beside the player on the side that faces the slab's middle, inside the slab's ends.
      const mid = slab.x + slab.w / 2;
      const want = player ? player.x + (player.x < mid ? 1 : -1) * RESCUE_BESIDE : mid;
      e.x = Math.max(slab.x + RESCUE_MARGIN, Math.min(slab.x + slab.w - RESCUE_MARGIN - e.w, want));
      e.y = slab.y - e.h;
      e.vy = 0;
      e.onGround = true;
    }
  }

  step(): void {
    const dt = SIM.dt;
    this.tickCount++;
    this.ageHud(dt);
    this.ageSpeech(dt);
    this.deliverEvents();
    this.runHandlers(dt);

    const solids = this.entities.filter((e) => e.solid);
    const grid = this.grid;
    grid.build(solids);
    const solidIndex = new Map<Entity, number>();
    solids.forEach((s, i) => solidIndex.set(s, i));
    /** A solid that moved this pass is re-filed so the movers after it collide with where it is now. */
    const refile = (e: Entity): void => { if (e.solid) { const i = solidIndex.get(e); if (i !== undefined) grid.update(i); } };
    const player = this.entities.find((e) => e.type === "player");
    for (const e of this.entities) {
      // Static solids (gravityScale 0) never move. A solid with gravity still
      // gets physics: it collides with other solids, it just also blocks them.
      if (e.solid && e.gravityScale === 0) continue;
      if (e.data.tetherTo !== undefined) { e.x += e.vx * dt; e.y += e.vy * dt; refile(e); continue; } // grappling gear flies free; the mod latches it by raycast (ADR 0050)
      if (typeof e.data.parallax === "number" || traitsOf(e.type).scenery) {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        refile(e);
        continue;
      }
      const wantsMove = e.vx !== 0 && e.type !== "player";
      const isCreature = e.type !== "player" && (e.kind ?? entityKind(e)) === "creature";
      this.casualHop(e, player);
      if (isCreature) {
        this.aiState(e, player);
        // A hostile that just landed a hit backs off a beat instead of grinding on the player.
        if (e.data.aiState === "cooldown") e.vx *= 0.25;
        const order = this.turning.get(e.id);
        if (order) {
          if (this.tickCount >= order.until) this.turning.delete(e.id);
          else if (e.vx !== 0) e.vx = Math.abs(e.vx) * order.dir;
        }
        // The player's standing order (ADR 0059) wins over the mod's own steering for this tick.
        const told = this.orders.get(e.id);
        if (told) {
          if (this.tickCount >= told.until) this.orders.delete(e.id);
          else if (player && steerByOrder(e, told.order, player)) this.orders.delete(e.id);
        }
        // Walkers stop at a ledge: patrollers turn back, hostiles hold the edge facing the player.
        if (e.gravityScale > 0 && e.onGround && e.vx !== 0 && e.data.ledge !== false) {
          const dir = e.vx > 0 ? 1 : -1;
          if (this.ledgeAhead(e, solids, dir)) {
            e.vx = 0;
            // A narrow perch has a drop on BOTH sides. Turning round every tick made a big pet
            // spin left-right in place and never move (ADR 0071): stand still and keep facing.
            const trapped = this.ledgeAhead(e, solids, -dir);
            if (!trapped) {
              if (e.data.hostile !== true) this.turnAway(e, -dir, 40);
              else faceToward(e, dir, this.facingClock, this.tickCount);
            }
          }
        }
      }
      const pushDir = Math.sign(e.vx);
      e.vy = Math.min(e.vy + SIM.gravity * e.gravityScale * dt, 1100); // terminal velocity
      // X axis. One-way platforms (data.oneWay) never block sideways.
      // One broad-phase query covers both axes: PAD outruns a tick of travel at terminal velocity.
      let region = padded(e);
      const nearBoth = grid.query(region);
      let near = nearBoth;
      e.x += e.vx * dt;
      let blockedX = false;
      if (!inside(e, region)) { region = padded(e); near = grid.query(region); }
      for (let c = 0; c < near.length; c++) {
        const si = near[c];
        const s = solids[si];
        if (s !== e && !s.data.oneWay && overlap(e, s)) {
          const stepHeight = (e.y + e.h) - s.y;
          let stepped = false;
          if (e.onGround && e.vx !== 0 && stepHeight > 0 && stepHeight <= 28) {
            const steppedBox = { x: e.x, y: s.y - e.h, w: e.w, h: e.h };
            const headBlocked = grid.query(steppedBox).some((i2) => { const s2 = solids[i2]; return s2 !== e && s2 !== s && !s2.data.oneWay && overlap(steppedBox, s2); });
            if (!headBlocked) {
              e.y = s.y - e.h;
              e.onGround = true;
              stepped = true;
            }
          }
          if (!stepped && !(!e.solid && isGroundSlab(s))) {
            if (e.vx > 0) e.x = s.x - e.w;
            else if (e.vx < 0) e.x = s.x + s.w;
            else e.x = (e.x + e.w / 2 < s.x + s.w / 2) ? s.x - e.w : s.x + s.w;
            e.vx = 0;
            blockedX = true;
          }
        }
        // A resolution can push the mover out of the queried area: re-query the rest of the scan.
        if (!inside(e, region)) { region = padded(e); near = grid.query(region).filter((i) => i > si); c = -1; }
      }
      this.unstick(e, wantsMove && blockedX && pushDir !== 0, pushDir);
      // Y axis. One-way platforms only catch a falling entity that was above them.
      const prevBottom = e.y + e.h;
      e.y += e.vy * dt;
      const fallSpeed = e.vy;
      e.onGround = false;
      if (near !== nearBoth || !inside(e, region)) { region = padded(e); near = grid.query(region); } else near = nearBoth;
      for (let c = 0; c < near.length; c++) {
        const si = near[c];
        const s = solids[si];
        if (s !== e && overlap(e, s) && !(s.data.oneWay && !(e.vy > 0 && prevBottom <= s.y + 0.5))) {
          if (!e.solid && isGroundSlab(s)) { e.y = s.y - e.h; e.onGround = true; } else if (e.vy > 0) { e.y = s.y - e.h; e.onGround = true; }
          else if (e.vy < 0) {
            // Rising into a ceiling pushes a body DOWN. But a body that was already inside the
            // solid (a pet that hopped or was placed into it) used to be shoved out of its
            // underside, straight through the floor (ADR 0071). When the head is above the
            // solid's top it is a body standing on it, not a head bump: put it back on top.
            const ceiling = s.y + s.h;
            const cameFromBelow = prevBottom - e.h >= ceiling - 0.5;
            if (cameFromBelow || e.y >= s.y) e.y = ceiling;
            else { e.y = s.y - e.h; e.onGround = true; }
          }
          else if (e.y + e.h / 2 < s.y + s.h / 2) { e.y = s.y - e.h; e.onGround = true; }
          else e.y = s.y + s.h;
          e.vy = fallSpeed > 0 ? landingVelocity(e, fallSpeed) : 0; // elastic landing (data.bounce, ADR 0053); no bounce = the old stop
        }
        if (!inside(e, region)) { region = padded(e); near = grid.query(region).filter((i) => i > si); c = -1; }
      }
      refile(e);
    }
    this.rescueFallen(solids, player);
    for (const p of this.particles) {
      p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt;
    }
    this.particles = this.particles.filter((p) => p.life < p.maxLife);
    // Post-step 1: Rigid player equipment / weapon mounting (bead qwc). An item flagged held
    // always mounts; one that is merely named like gear mounts unless it says it is not the
    // player's (a pickup still lying in the level, another creature's weapon) (ADR 0057).
    // Sockets sit on the drawn body (ADR 0061): src/sim/sockets.ts. Gear may also be attached to
    // any entity (data.attachedTo = id or creature type), so a dragon can wear a hat.
    for (const e of this.entities) {
      if (e === player) continue;
      const a = e.data.attachedTo;
      if (a !== undefined && a !== "player" && (typeof a === "number" || typeof a === "string")) {
        const wearer = wearerOf(e, this.entities, player);
        if (wearer && e.data.pickup !== true) mountGear(e, wearer, undefined, this.hasArt?.(wearer) ?? true);
        continue;
      }
      if (!player) continue;
      const isHeld = e.data.heldByPlayer === true || e.data.equipped === true || a === "player";
      if (isHeld || (traitsOf(e.type).equipment && !notPlayersGear(e))) mountGear(e, player, undefined, this.hasArt?.(player) ?? true);
    }

    // Post-step 2: Universal projectile collision & enemy combat (bead 578). A projectile a mod
    // already resolves through api.damageHit is the mod's: the engine leaves it alone, so the
    // mod's damage, filter and piercing hold (ADR 0057).
    const projectiles = this.entities.filter((e) => e.data.tetherTo === undefined && e.data.modCombat !== true && !traitsOf(e.type).tether && (e.data.visual === "projectile" || entityKind(e) === "projectile" || traitsOf(e.type).projectile)); // grappling gear latches instead (ADR 0050)
    for (const proj of projectiles) {
      if (proj.dead) continue;
      const damage = typeof proj.data.damage === "number" ? proj.data.damage : DEFAULT_PROJECTILE_DAMAGE;
      // A shot that is not the player's must leave the player once before it can hit them, so it never hits on the frame it spawns.
      if (player && !this.clearOfPlayer.has(proj.id) && !overlap(proj, player)) this.clearOfPlayer.add(proj.id);
      for (const target of this.entities) {
        if (target.id === proj.id || target.dead) continue;
        if (target === player && proj.data.fromPlayer !== true && !this.clearOfPlayer.has(proj.id)) continue;
        if (isDamageableTarget(target, proj) && overlap(proj, target)) {
          this.burst(proj.x + proj.w / 2, proj.y + proj.h / 2, proj.color || 0xffd700, 8);
          this.damage(target.id, damage);
          this.despawn(proj.id);
          break;
        }
      }
      // Despawn on solid obstacles
      if (!proj.dead) {
        for (const i of grid.query(proj)) {
          const s = solids[i];
          if (!s.dead && !s.data.oneWay && overlap(proj, s)) {
            this.burst(proj.x + proj.w / 2, proj.y + proj.h / 2, proj.color || 0xffd700, 4);
            this.despawn(proj.id);
            break;
          }
        }
      }
    }

    // Post-step 3: Enemy contact damage to player with brief invulnerability timer.
    // Post-step 3a first: stomping (ADR 0071). A falling player who lands on a hostile's head
    // finishes it and bounces, for every hostile — drawn, spawned by a wave, or built by a mod.
    this.stomped.clear();
    if (player && !player.dead) {
      for (const en of this.entities) {
        if (!stompableBy(player, en)) continue;
        this.burst(en.x + en.w / 2, en.y + en.h / 2, en.color, 12);
        this.stomped.add(en.id);
        this.damage(en.id, stompDamage(en));
        player.vy = -stompBounce(en);
        player.data.stomps = (typeof player.data.stomps === "number" ? player.data.stomps : 0) + 1;
        break;
      }
    }
    if (player && !player.dead) {
      const hitCd = typeof player.data.hitCooldown === "number" ? player.data.hitCooldown : 0;
      if (hitCd > 0) {
        player.data.hitCooldown = hitCd - 1;
      } else {
        for (const en of this.entities) {
          if (en.id === player.id || en.dead) continue;
          if (this.stomped.has(en.id)) continue; // the head you just landed on is not a body check
          if (hurtsOnContact(en) && overlap(player, en)) {
            const dmg = typeof en.data.damage === "number" ? en.data.damage : 10;
            this.damage(player.id, dmg);
            player.data.hitCooldown = 30; // 0.5s cooldown at 60Hz
            this.burst(player.x + player.w / 2, player.y + player.h / 2, 0xff3b30, 8);
            break;
          }
        }
      }
    }

    // Post-step 4: engine-owned pickups (ADR 0055): tag an entity data.collectible and
    // the engine collects it into one shared HUD. Everything else lives in collect.ts.
    collectPickups(this, player);

    // Post-step 5: touch and interact events (ADR 0059).
    this.touchPass(player);
    this.interactPass(player);

    // A player killed this step is already despawned (no x/y left): keep the last camera instead of NaN.
    if (player && !(player as any).dead) {
      this.camera.x = player.x + player.w / 2 - 480;
      this.camera.y = Math.min(0, player.y + player.h / 2 - 270);
    }
  }
}

/** Mark a removed entity so a mod still holding it sees it is gone (bead dbj): dead, with no coordinates. */
function retire(e: Entity): void {
  e.dead = true;
  e.despawned = true;
  (e as { x: number | undefined }).x = undefined;
  (e as { y: number | undefined }).y = undefined;
}

/** What an entity's type name alone says about it. Cached per type: the step asks every tick. */
interface TypeTraits { scenery: boolean; equipment: boolean; projectile: boolean; tether: boolean; enemyName: boolean }
const traitCache = new Map<string, TypeTraits>();
function traitsOf(type: string): TypeTraits {
  let t = traitCache.get(type);
  if (!t) {
    t = {
      scenery: /^(cloud|sky|day-sky|night-sky|background|parallax)/i.test(type),
      equipment: /^(gun|blaster|sword|jetpack|backpack|shield|weapon|bow|wand|dagger|spear|axe|hat|crown|helmet|cape)$/i.test(type),
      projectile: /^(bullet|projectile|laser|arrow|fireball|plasma|shot)$/i.test(type),
      tether: /hook|grappl|tether/i.test(type),
      enemyName: /^(enemy|walker|turtle|boss|monster|zombie|goblin|slime|spider|bat|skeleton|demon|orc)$/i.test(type),
    };
    if (traitCache.size > 4096) traitCache.clear();
    traitCache.set(type, t);
  }
  return t;
}

/** Gear named like equipment that explicitly is not the player's: a pickup still in the level, or another creature's. */
function notPlayersGear(e: Entity): boolean {
  return e.data.pickup === true || e.data.heldByPlayer === false || e.data.equipped === false
    || (typeof e.data.attachedTo === "string" && e.data.attachedTo !== "player")
    || e.data.hostile === true || e.data.enemy === true;
}

/** Contact damage: flagged hostiles, or enemy-named types that did not opt out (friendly, casual or hero). */
function hurtsOnContact(e: Entity): boolean {
  // A companion, an ally or a bystander never hurts the player, whatever else its mod set
  // (ADR 0071): a "hostile" pet that chews on its owner is not a thing a request can produce.
  if (isPet(e) || isFriendly(e)) return false;
  if (e.data.hostile === true || e.data.enemy === true) return true;
  if (e.data.hostile === false || e.data.casual === true || e.data.hero === true) return false;
  return traitsOf(e.type).enemyName;
}

/** The world's main ground slab: non-solid movers are never blocked sideways by it and always land on top. */
function isGroundSlab(s: Entity): boolean {
  return s.type === "ground";
}

/** How far below the ground slab's top a creature must be before it is put back (px), and where it lands. */
const RESCUE_DEPTH = 900;
const RESCUE_BESIDE = 220;
const RESCUE_MARGIN = 80;

const PAD = 32;
function padded(e: Box): Box {
  return { x: e.x - PAD, y: e.y - PAD, w: e.w + 2 * PAD, h: e.h + 2 * PAD };
}
function inside(e: Box, r: Box): boolean {
  return e.x >= r.x && e.y >= r.y && e.x + e.w <= r.x + r.w && e.y + e.h <= r.y + r.h;
}

type Box = { x: number; y: number; w: number; h: number };

function overlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
