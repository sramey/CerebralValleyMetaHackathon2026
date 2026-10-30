import type { CreatureOrder, KnobDefs, KnobValues, ModApi, ModDefinition, TestApi } from "../contract";
import { emptyInput } from "../contract";
import { checkProjectileHitAndDamage } from "./combat";
import { touches } from "./reach";
import { aimFrom, raycastSolid, winchToward } from "./tether";
import { applySwarmSeparation, createWaveController, spawnWaveUnit } from "./waves";
import { World } from "./world";

export interface LoadedMod { id: string; title: string; knobDefs: KnobDefs; values: KnobValues; def: ModDefinition }

export class ModLoader {
  private loaded = new Map<string, LoadedMod>();
  constructor(readonly world: World) {}

  private apiFor(owner: string): ModApi {
    return modApiFor(this.world, owner);
  }

  /**
   * Contain crashing mods (ADR 0056): a tick handler that throws unloads its mod and reports it,
   * instead of stopping the whole world. The live client and the exported game turn this on.
   */
  isolateFaults(onQuarantine: (mod: LoadedMod, message: string) => void): void {
    this.world.onFault = (owner, err) => {
      const rec = this.loaded.get(owner);
      if (!rec) return;
      this.unload(owner);
      onQuarantine(rec, err instanceof Error ? err.message : String(err));
    };
  }

  load(def: ModDefinition, overrides: KnobValues = {}): LoadedMod {
    if (this.loaded.has(def.id)) this.unload(def.id, true); // a reload keeps the mod's place in the tick order
    const knobDefs = def.knobs ?? {};
    const values: KnobValues = {};
    for (const [k, d] of Object.entries(knobDefs)) values[k] = overrides[k] ?? d.value;
    const rec: LoadedMod = { id: def.id, title: def.title, knobDefs, values, def };
    this.loaded.set(def.id, rec);
    try {
      def.setup(this.apiFor(def.id), values);
    } catch (err) {
      this.unload(def.id); // a setup that throws halfway must not leave its handlers or entities behind
      throw err;
    }
    return rec;
  }

  unload(id: string, keepSlot = false): boolean {
    const rec = this.loaded.get(id);
    if (!rec) return false;
    try { rec.def.dispose(this.apiFor(id)); } catch { /* loader cleanup below still runs */ }
    this.world.removeByOwner(id, keepSlot);
    this.loaded.delete(id);
    return true;
  }

  setKnob(id: string, knob: string, value: KnobValues[string]): boolean {
    const rec = this.loaded.get(id);
    if (!rec || !(knob in rec.knobDefs)) return false;
    const { def } = rec;
    this.load(def, { ...rec.values, [knob]: value });
    return true;
  }

  /** A standing order for `id`'s creatures, or every mod's for "*" (ADR 0059). Returns how many took it. */
  order(id: string, order: CreatureOrder): number {
    if (id !== "*" && !this.loaded.has(id)) return 0;
    return this.world.giveOrder(id, order);
  }

  list(): LoadedMod[] { return [...this.loaded.values()]; }
  has(id: string): boolean { return this.loaded.has(id); }
}

/** The one ModApi a mod gets, scoped to `owner`: the live loader and runModTest share it. */
export function modApiFor(w: World, owner: string): ModApi {
  const api: ModApi = {
    spawn: (def) => w.spawn(def, owner),
    despawn: (id) => {
      const e = w.entities.find((en) => en.id === id);
      if (e && e.owner === owner) w.despawn(id);
    },
    damage: (id, amt) => w.damage(id, amt, owner),
    entities: () => w.entities,
    byType: (type) => w.entities.filter((e) => e.type === type),
    touches: (a, b) => touches(a, b),
    player: () => w.entities.find((e) => e.type === "player"),
    input: () => w.input,
    onTick: (fn) => w.addHandler(owner, fn),
    burst: (x, y, color, n) => w.burst(x, y, color, n),
    rand: () => w.rand(),
    tick: () => w.tickCount,
    setHud: (id, def) => w.setHud(owner, id, def),
    removeHud: (id) => w.removeHud(owner, id),
    hud: (id) => w.hud.get(id),
    hudList: () => w.hudList(),
    damageHit: (proj, opts) => checkProjectileHitAndDamage(api, proj, opts),
    raycast: (x, y, dx, dy, max, ignore) => raycastSolid(w.entities, x, y, dx, dy, max, ignore),
    winch: (e, ax, ay, speed) => winchToward(e, ax, ay, speed),
    aim: (from) => aimFrom(from, w.input),
    camera: () => {
      const p = w.entities.find((e) => e.type === "player");
      if (p) return { x: p.x + p.w / 2 - 480, y: Math.min(0, p.y + p.h / 2 - 270) };
      return { x: w.camera.x, y: w.camera.y };
    },
    spawnWaveUnit: (opts) => spawnWaveUnit(api, opts),
    applySeparation: (entities, opts) => applySwarmSeparation(entities, opts),
    createWaveController: (opts) => createWaveController(api, opts),
    on: (event, fn) => w.on(owner, event, fn),
    say: (e, text, seconds) => w.say(owner, e?.id, text, seconds),
    signal: (name, value) => w.signal(owner, name, value),
  };
  return api;
}

export function runModTest(def: ModDefinition): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const world = new World(42);
  const loader = new ModLoader(world);
  try {
    loader.load(def);
    if (def.test) {
      const t: TestApi = {
        expect: (cond, msg) => { if (!cond) errors.push(msg); },
        api: modApiFor(world, def.id),
        step: (n, input) => {
          const prev = world.input;
          world.input = { ...emptyInput(), ...input };
          for (let i = 0; i < n; i++) world.step();
          world.input = prev;
        },
      };
      def.test(t);
    }
    for (const e of world.entities) {
      if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) errors.push(`non-finite position on ${e.type}#${e.id}`);
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    try { loader.unload(def.id); } catch { /* ignore */ }
  }
  return { ok: errors.length === 0, errors };
}
