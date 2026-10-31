// The engine loadout (ADR 0074): one active held item, switch / drop / reload, a HUD line for it,
// a mounted vehicle that takes over the weapon slot, and vehicles that run over hostiles.
// Pure and deterministic: ticks, not clocks; no DOM, no Math.random.
//
// Why the engine owns this: every generated weapon used to read `input.shoot` itself, so a grapple and
// a gun both fired on one press, a tank's cannon fought the player's gun, and none of them could be
// switched or dropped. Now a mod's view of the input is gated by whether its item is the one in hand.
import type { Entity, GearDef, GearHandle, InputState } from "../contract";
import { isDamageableTarget, isHostileEnemy } from "./combat";
import { touches } from "./reach";
import type { World } from "./world";

/** Owners that never become gear by reading the input. */
const NOT_GEAR = new Set(["engine", "player", "ground"]);
/** A vehicle must be at least this fast (px/s) to hurt what it hits. */
export const RUN_OVER_SPEED = 90;
const RUN_OVER_GAP = 20; // ticks before the same target can be hit again
const DROP_PICKUP_DELAY = 45; // ticks before a dropped item can be picked up again
const DEFAULT_RELOAD = 60;

interface Ammo { mag: number; magSize: number; reserve: number; reloadTicks: number; reloadEnd: number }

interface Item {
  key: string;
  owner: string;
  id: string;
  label: string;
  icon?: string;
  implicit: boolean;
  entity?: Entity;
  ammo?: Ammo;
  cooldown: number;
  lastFire: number;
  /** In the player's hands (or an ability, which always is). */
  carried: boolean;
  /** Belongs to a vehicle: only active while that vehicle is mounted, never in the Q rotation. */
  vehicle: boolean;
}

const GATED_KEYS = new Set(["shoot", "use", "pointerDown"]);
const VIEW_KEYS = ["left", "right", "jump", "shoot", "use", "pointerX", "pointerY", "pointerDown", "reload"] as const;

/** An entity flag that says this thing is a ride: `mounted`, `driving` or `riding` exists on it, or its prompt says drive / ride. */
export function isVehicle(e: Entity): boolean {
  const d = e.data;
  if (d.mounted !== undefined || d.driving !== undefined || d.riding !== undefined) return true;
  return typeof d.interact === "string" && /\b(drive|ride|pilot|mount|board|saddle)\b/i.test(d.interact);
}

/** True while the player sits in it. */
export function isMounted(e: Entity): boolean {
  return e.data.mounted === true || e.data.driving === true || e.data.riding === true;
}

export class Loadout {
  private items: Item[] = [];
  private views = new Map<string, InputState>();
  private activeKey?: string;
  /** The item that may fire right now (the vehicle's own while mounted). */
  private current?: Item;
  /** The vehicle the player is in, if any. */
  mounted?: Entity;
  private prev = { next: false, prev: false, drop: false, reload: false, slot: 0 };
  private runHit = new Map<number, number>();
  /** Mods that registered with api.gear: reading the fire key never makes a second, implicit item for them. */
  private explicit = new Set<string>();
  private lastToast = "";
  private lastToastTick = -999;

  constructor(private readonly w: World) {}

  // --- what a mod sees ---------------------------------------------------------------------

  /** The mod's live view of the input: its fire keys read false while its item is not the one in hand. */
  view(owner: string): InputState {
    let v = this.views.get(owner);
    if (v) return v;
    const base = this.w;
    const self = this;
    v = {} as InputState;
    for (const k of VIEW_KEYS) {
      Object.defineProperty(v, k, {
        enumerable: true,
        get: () => {
          if (k === "shoot") self.adopt(owner); // reading the fire key makes a mod's weapon part of the loadout
          const raw = (base.input as unknown as Record<string, unknown>)[k];
          if (k === "reload") return raw === true && self.current?.owner === owner && !self.current.ammo ? true : undefined;
          return GATED_KEYS.has(k) && self.gated(owner) ? false : raw;
        },
      });
    }
    this.views.set(owner, v);
    return v;
  }

  /** Items of this mod are carried, yet none of them is the one in hand. */
  private gated(owner: string): boolean {
    let carried = false;
    for (const it of this.items) {
      if (it.owner !== owner || !it.carried) continue;
      if (it === this.current) return false;
      carried = true;
    }
    return carried;
  }

  // --- registering -------------------------------------------------------------------------

  gear(owner: string, def: GearDef): GearHandle {
    this.explicit.add(owner);
    const id = typeof def.id === "string" && def.id ? def.id : owner;
    const key = `${owner}/${id}`;
    this.items = this.items.filter((it) => it.key !== key && !(it.implicit && it.owner === owner));
    const magSize = typeof def.magSize === "number" && def.magSize > 0 ? Math.floor(def.magSize) : 0;
    const it: Item = {
      key, owner, id,
      label: String(def.label ?? id).slice(0, 24),
      ...(typeof def.icon === "string" ? { icon: def.icon } : {}),
      implicit: false,
      ...(def.entity ? { entity: def.entity } : {}),
      cooldown: Math.max(0, Math.floor(Number(def.cooldown) || 0)),
      lastFire: -99999,
      carried: true,
      vehicle: false,
    };
    if (magSize > 0) {
      const reserve = typeof def.reserve === "number" && def.reserve >= 0 ? Math.floor(def.reserve) : magSize * 4;
      it.ammo = { mag: magSize, magSize, reserve, reloadTicks: Math.max(1, Math.floor(Number(def.reloadTicks) || DEFAULT_RELOAD)), reloadEnd: -1 };
    }
    this.add(it);
    const handle: GearHandle = {
      active: () => this.current === it,
      fire: () => this.fire(it),
      ammo: () => (it.ammo ? { mag: it.ammo.mag, magSize: it.ammo.magSize, reserve: it.ammo.reserve, reloading: it.ammo.reloadEnd >= 0 } : undefined),
      addAmmo: (n) => { if (it.ammo && Number.isFinite(n) && n > 0) it.ammo.reserve += Math.floor(n); },
    };
    return handle;
  }

  /** A mod that reads `input.shoot` without registering gets an item of its own, named after the mod. */
  private adopt(owner: string): void {
    if (NOT_GEAR.has(owner) || this.explicit.has(owner) || this.items.some((it) => it.owner === owner)) return;
    const it: Item = {
      key: `${owner}/${owner}`, owner, id: owner,
      label: this.w.modTitles.get(owner) ?? owner,
      implicit: true, cooldown: 0, lastFire: -99999, carried: true, vehicle: false,
    };
    this.bind(it);
    this.add(it);
  }

  private add(it: Item): void {
    this.refreshItem(it);
    const others = this.rotation().length;
    this.items.push(it);
    if (it.carried && !it.vehicle) {
      this.activeKey = it.key;
      if (others > 0) this.toast(`${it.label} equipped`);
    }
    this.pickCurrent();
    this.hud();
  }

  removeOwner(owner: string): void {
    this.views.delete(owner);
    this.explicit.delete(owner);
    const before = this.items.length;
    this.items = this.items.filter((it) => it.owner !== owner);
    if (this.items.length !== before) { this.settleActive(); this.pickCurrent(); this.hud(); }
  }

  // --- reading the world ---------------------------------------------------------------------

  /** An implicit item finds its body: an entity of its mod that looks like held gear. */
  private bind(it: Item): void {
    if (it.entity && !it.entity.dead) return;
    delete it.entity;
    for (const e of this.w.entities) {
      if (e.owner !== it.owner || e.dead) continue;
      const d = e.data;
      if (d.heldByPlayer !== undefined || d.equipped !== undefined || d.attachedTo === "player" || d.pickup === true) { it.entity = e; return; }
    }
  }

  private isCarried(it: Item): boolean {
    const e = it.entity;
    if (!e) return true;
    const d = e.data;
    return d.pickup !== true && (d.heldByPlayer === true || d.equipped === true || d.attachedTo === "player");
  }

  private refreshItem(it: Item): void {
    if (it.implicit && !it.entity) this.bind(it);
    it.vehicle = this.w.entities.some((e) => e.owner === it.owner && !e.dead && e.type !== "player" && isVehicle(e));
    it.carried = this.isCarried(it);
  }

  // --- each tick, before the mods run ------------------------------------------------------------

  begin(): void {
    const w = this.w;
    const player = w.entities.find((e) => e.type === "player");
    // Gear whose body was removed is gone from the loadout.
    this.items = this.items.filter((it) => !(it.entity && (it.entity.dead || it.entity.despawned)));
    const wasCarried = new Map(this.items.map((it) => [it.key, it.carried]));
    for (const it of this.items) this.refreshItem(it);
    this.mounted = w.entities.find((e) => !e.dead && e.type !== "player" && isMounted(e));
    if (this.mounted && player) player.facing = this.mounted.facing;

    // A newly carried item (picked up, or dropped back into hand) becomes the active one.
    for (const it of this.items) {
      if (it.carried && !it.vehicle && wasCarried.get(it.key) === false) {
        this.activeKey = it.key;
        this.toast(`${it.label} equipped`);
      }
    }

    this.edges(player);
    this.finishReloads();
    this.pickupDropped(player);
    this.settleActive();
    this.pickCurrent();
    this.stow();
    this.hud();
  }

  private rotation(): Item[] {
    return this.items.filter((it) => it.carried && !it.vehicle);
  }

  private settleActive(): void {
    const rot = this.rotation();
    if (!rot.some((it) => it.key === this.activeKey)) this.activeKey = rot[rot.length - 1]?.key;
  }

  private pickCurrent(): void {
    if (this.mounted) {
      const own = this.items.filter((it) => it.owner === this.mounted!.owner && it.carried);
      this.current = own.find((it) => it.key === this.activeKey) ?? own[0];
      return;
    }
    this.current = this.items.find((it) => it.key === this.activeKey && it.carried && !it.vehicle);
  }

  // --- switching, dropping, reloading ------------------------------------------------------------

  private edges(player: Entity | undefined): void {
    const inp = this.w.input;
    const next = inp.nextItem === true, prev = inp.prevItem === true, drop = inp.drop === true, reload = inp.reload === true;
    const slot = typeof inp.slot === "number" ? inp.slot : 0;
    const e = { next: next && !this.prev.next, prev: prev && !this.prev.prev, drop: drop && !this.prev.drop, reload: reload && !this.prev.reload, slot: slot > 0 && slot !== this.prev.slot ? slot : 0 };
    this.prev = { next, prev, drop, reload, slot };
    if (this.mounted) {
      if (e.reload) this.startReload(this.current);
      if (e.drop) this.toast("Jump to get out first");
      return;
    }
    const rot = this.rotation();
    const at = rot.findIndex((it) => it.key === this.activeKey);
    const go = (i: number): void => {
      if (rot.length === 0) return;
      const to = rot[((i % rot.length) + rot.length) % rot.length];
      if (to.key === this.activeKey) { if (rot.length === 1) this.toast(`${to.label} is all you have`); return; }
      this.activeKey = to.key;
      this.toast(`${to.label} in hand`);
    };
    if (e.next) go(at + 1);
    else if (e.prev) go(at - 1);
    else if (e.slot > 0 && e.slot <= rot.length) go(e.slot - 1);
    if (e.reload) this.startReload(rot.find((it) => it.key === this.activeKey));
    if (e.drop) this.drop(rot.find((it) => it.key === this.activeKey), player);
  }

  private startReload(it: Item | undefined): void {
    const a = it?.ammo;
    if (!it || !a) return;
    if (a.reloadEnd >= 0 || a.mag >= a.magSize) return;
    if (a.reserve <= 0) { this.toast(`${it.label}: no spare ammo`); return; }
    a.reloadEnd = this.w.tickCount + a.reloadTicks;
    this.toast("Reloading...");
  }

  private finishReloads(): void {
    for (const it of this.items) {
      const a = it.ammo;
      if (!a || a.reloadEnd < 0 || this.w.tickCount < a.reloadEnd) continue;
      const take = Math.min(a.magSize - a.mag, a.reserve);
      a.mag += take;
      a.reserve -= take;
      a.reloadEnd = -1;
    }
  }

  private fire(it: Item): boolean {
    if (this.current !== it) return false;
    const a = it.ammo;
    const t = this.w.tickCount;
    if (a) {
      if (a.reloadEnd >= 0) return false;
      if (a.mag <= 0) {
        if (a.reserve > 0) this.startReload(it); else this.toast(`${it.label}: out of ammo`);
        return false;
      }
    }
    if (t - it.lastFire < it.cooldown) return false;
    it.lastFire = t;
    if (a) {
      a.mag--;
      if (a.mag === 0) this.toast(a.reserve > 0 ? "Empty: press R to reload" : `${it.label}: out of ammo`);
    }
    return true;
  }

  private drop(it: Item | undefined, player: Entity | undefined): void {
    if (!it) { this.toast("Nothing in hand to drop"); return; }
    const e = it.entity;
    if (!e || !player) { this.toast(`${it.label} can't be dropped. Q switches items`); return; }
    const d = e.data;
    d.heldByPlayer = false;
    d.equipped = false;
    d.pickup = true;
    d.dropped = true;
    d.dropTick = this.w.tickCount;
    if (d.attachedTo === "player") delete d.attachedTo;
    if (typeof d.gearGravity !== "number") d.gearGravity = e.gravityScale;
    if (typeof d.gearSocket === "string") { if (d.gearSocket) d.socket = d.gearSocket; else delete d.socket; delete d.gearSocket; }
    e.gravityScale = 1;
    e.vx = 0;
    e.vy = -150;
    e.x = player.facing >= 0 ? player.x + player.w + 6 : player.x - e.w - 6;
    e.y = player.y + player.h - e.h - 4;
    it.carried = false;
    this.toast(`Dropped ${it.label}`);
  }

  private pickupDropped(player: Entity | undefined): void {
    if (!player || player.dead) return;
    for (const it of this.items) {
      const e = it.entity;
      if (!e || it.carried || e.dead) continue;
      const dropped = e.data.dropped === true;
      if (!dropped && (it.implicit || e.data.pickup !== true)) continue; // a mod's own pickup logic handles its level pickups
      if (dropped && this.w.tickCount - Number(e.data.dropTick ?? 0) < DROP_PICKUP_DELAY) continue;
      if (!touches(player, e)) continue;
      const d = e.data;
      d.heldByPlayer = true;
      d.equipped = true;
      d.pickup = false;
      delete d.dropped;
      delete d.dropTick;
      if (typeof d.gearGravity === "number") { e.gravityScale = d.gearGravity; delete d.gearGravity; }
      this.w.burst(e.x + e.w / 2, e.y + e.h / 2, 0xffd34d, 8);
      it.carried = true;
      this.activeKey = it.key;
      this.toast(`${it.label} equipped`);
    }
  }

  /** Gear not in hand rides on the back; the active one goes back to its own socket. */
  private stow(): void {
    for (const it of this.items) {
      const e = it.entity;
      if (!e || !it.carried || e.dead) continue;
      const d = e.data;
      if (this.current === it) {
        if (typeof d.gearSocket === "string") { if (d.gearSocket) d.socket = d.gearSocket; else delete d.socket; delete d.gearSocket; }
      } else if (typeof d.gearSocket !== "string") {
        d.gearSocket = typeof d.socket === "string" ? d.socket : "";
        d.socket = "back";
      }
    }
  }

  // --- HUD -----------------------------------------------------------------------------------------

  private toast(text: string): void {
    const t = this.w.tickCount;
    if (text === this.lastToast && t - this.lastToastTick < 60) return;
    this.lastToast = text;
    this.lastToastTick = t;
    this.w.setHud("engine", "gear-toast", { kind: "banner", text, duration: 1.4, position: "bottom-center" });
  }

  private hud(): void {
    const w = this.w;
    const rot = this.rotation();
    const it = this.current;
    if (!it && !this.mounted && rot.length === 0) {
      w.removeHud("engine", "gear");
      w.removeHud("engine", "gear-slots");
      return;
    }
    if (it) {
      const a = it.ammo;
      const value = a ? (a.reloadEnd >= 0 ? "reloading..." : `${a.mag}/${a.magSize}  ·  ${a.reserve} spare`) : "ready";
      const others = rot.filter((x) => x !== it);
      const hint = this.mounted ? "Jump: get out" : others.length > 0 ? "Q: switch" : "";
      w.setHud("engine", "gear", { kind: "stat", label: it.label, icon: it.icon ?? "🎒", value, unit: hint, position: "bottom-left" });
    } else {
      w.setHud("engine", "gear", { kind: "stat", label: this.mounted ? "Riding" : "Hands free", icon: "🎒", value: this.mounted ? "no weapon" : "", unit: "", position: "bottom-left" });
    }
    if (rot.length > 1 && !this.mounted) {
      const line = rot.map((x, i) => (x.key === this.activeKey ? `[${i + 1} ${x.label}]` : `${i + 1} ${x.label}`)).join("  ");
      w.setHud("engine", "gear-slots", { kind: "stat", label: "Items", icon: "🧰", value: line, position: "bottom-left" });
    } else w.removeHud("engine", "gear-slots");
  }

  // --- vehicles hurt what they hit -------------------------------------------------------------------

  /** After movement: a mounted vehicle at speed damages hostiles it overlaps. */
  runOver(): void {
    const v = this.mounted;
    if (!v || v.dead || v.data.runOver === false) return;
    const speed = Math.abs(v.vx);
    if (speed < RUN_OVER_SPEED) return;
    const t = this.w.tickCount;
    const dmg = typeof v.data.runOver === "number" && v.data.runOver > 0 ? v.data.runOver : Math.max(30, Math.round(speed * 0.4));
    const dir = v.vx >= 0 ? 1 : -1;
    const probe = { type: "vehicle", data: { fromPlayer: true } } as unknown as Entity;
    for (const e of [...this.w.entities]) {
      if (e === v || e.dead || e.type === "player" || !boxesOverlap(v, e)) continue;
      if (!isHostileEnemy(e) || !isDamageableTarget(e, probe)) continue;
      if (t - (this.runHit.get(e.id) ?? -999) < RUN_OVER_GAP) continue;
      this.runHit.set(e.id, t);
      this.w.burst(e.x + e.w / 2, e.y + e.h / 2, 0xff7733, 8);
      this.w.damage(e.id, dmg, v.owner);
      if (!e.dead) { e.vx = dir * Math.min(140, speed * 0.6); e.vy = -220; } // a shove the vehicle outruns, so it can hit again
    }
    if (this.runHit.size > 200) for (const [id, at] of this.runHit) if (t - at > 120) this.runHit.delete(id);
  }
}

function boxesOverlap(a: Entity, b: Entity): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
