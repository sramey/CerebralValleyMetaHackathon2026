import type { KnobDefs, KnobValues, ModApi, ModDefinition, TestApi } from "../contract";
import { emptyInput } from "../contract";
import { checkProjectileHitAndDamage } from "./combat";
import { touches } from "./reach";
import { aimFrom, raycastSolid, winchToward } from "./tether";
import { World } from "./world";

export interface LoadedMod { id: string; title: string; knobDefs: KnobDefs; values: KnobValues; def: ModDefinition }

export class ModLoader {
  private loaded = new Map<string, LoadedMod>();
  constructor(readonly world: World) {}

  private apiFor(owner: string): ModApi {
    const w = this.world;
    return {
      spawn: (def) => w.spawn(def, owner),
      despawn: (id) => {
        const e = w.entities.find((en) => en.id === id);
        if (e && e.owner === owner) w.despawn(id);
      },
      damage: (id, amt) => w.damage(id, amt),
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
      damageHit: (proj, opts) => checkProjectileHitAndDamage(this.apiFor(owner), proj, opts),
      raycast: (x, y, dx, dy, max, ignore) => raycastSolid(w.entities, x, y, dx, dy, max, ignore),
      winch: (e, ax, ay, speed) => winchToward(e, ax, ay, speed),
      aim: (from) => aimFrom(from, w.input),
    };
  }

  load(def: ModDefinition, overrides: KnobValues = {}): LoadedMod {
    if (this.loaded.has(def.id)) this.unload(def.id);
    const knobDefs = def.knobs ?? {};
    const values: KnobValues = {};
    for (const [k, d] of Object.entries(knobDefs)) values[k] = overrides[k] ?? d.value;
    const rec: LoadedMod = { id: def.id, title: def.title, knobDefs, values, def };
    this.loaded.set(def.id, rec);
    def.setup(this.apiFor(def.id), values);
    return rec;
  }

  unload(id: string): boolean {
    const rec = this.loaded.get(id);
    if (!rec) return false;
    try { rec.def.dispose(this.apiFor(id)); } catch { /* loader cleanup below still runs */ }
    this.world.removeByOwner(id);
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

  list(): LoadedMod[] { return [...this.loaded.values()]; }
  has(id: string): boolean { return this.loaded.has(id); }
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
        api: {
          spawn: (d) => world.spawn(d, def.id),
          despawn: (id) => {
            const e = world.entities.find((en) => en.id === id);
            if (e && e.owner === def.id) world.despawn(id);
          },
          damage: (id, amt) => world.damage(id, amt),
          entities: () => world.entities,
          byType: (type) => world.entities.filter((e) => e.type === type),
          touches: (a, b) => touches(a, b),
          player: () => world.entities.find((e) => e.type === "player"),
          input: () => world.input,
          onTick: (fn) => world.addHandler(def.id, fn),
          burst: (x, y, c, n) => world.burst(x, y, c, n),
          rand: () => world.rand(),
          tick: () => world.tickCount,
          setHud: (hid, hdef) => world.setHud(def.id, hid, hdef),
          removeHud: (hid) => world.removeHud(def.id, hid),
          hud: (hid) => world.hud.get(hid),
          hudList: () => world.hudList(),
          damageHit: (proj, opts) => checkProjectileHitAndDamage(t.api, proj, opts),
          raycast: (x, y, dx, dy, max, ignore) => raycastSolid(world.entities, x, y, dx, dy, max, ignore),
          winch: (e, ax, ay, speed) => winchToward(e, ax, ay, speed),
          aim: (from) => aimFrom(from, world.input),
        },
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
