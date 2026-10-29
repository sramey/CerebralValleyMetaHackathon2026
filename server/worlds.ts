// Worlds (ADR 0014): a world is its mod list. User worlds are JSON files under DATA_DIR/worlds
// named by a random id that goes in the share URL; curated demo worlds ship in the repo's
// worlds/ directory (ids start with "demo-"). The server only saves mods from its own verified
// session manifest, so opening a link never runs code a visitor uploaded.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { DemoWorld, KnobDefs, Look, KnobValue, KnobValues, WorldMod } from "../src/contract";

export const MAX_WORLD_MODS = 40;
export const MAX_WORLD_BYTES = 600_000;

export interface StoredWorld {
  v: 1;
  id: string;
  title?: string;
  blurb?: string;
  createdAt: string;
  mods: WorldMod[];
}

export const isWorldId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{4,40}$/.test(id);

/** Keep only finite numbers, short strings and booleans; at most 24 knobs. */
export function sanitizeValues(raw: unknown): KnobValues {
  const out: KnobValues = {};
  if (!raw || typeof raw !== "object") return out;
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= 24 || k.length > 40) break;
    if ((typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean" || (typeof v === "string" && v.length <= 80)) {
      out[k] = v as KnobValue;
      n++;
    }
  }
  return out;
}

export interface SessionMod {
  id: string;
  title: string;
  source: string;
  compiled: string;
  knobs: KnobDefs;
  art?: { key: string; url: string; scenery?: boolean };
  look?: Look;
}

/**
 * Turn "these ids are loaded, with these values" into storable world mods. Built-ins become a bare
 * reference (the client bundles them); anything else must exist in the server's verified manifest,
 * and its values come from the server's knob state. Unknown ids are dropped.
 */
export function snapshotWorld(
  requested: { id: string; values: KnobValues }[],
  manifest: ReadonlyMap<string, SessionMod>,
  builtinIds: ReadonlySet<string>,
): WorldMod[] {
  const mods: WorldMod[] = [];
  const seen = new Set<string>();
  for (const r of requested.slice(0, MAX_WORLD_MODS)) {
    if (!r || typeof r.id !== "string" || seen.has(r.id)) continue;
    seen.add(r.id);
    if (builtinIds.has(r.id)) {
      mods.push({ builtin: true, id: r.id, values: sanitizeValues(r.values) });
      continue;
    }
    const rec = manifest.get(r.id);
    if (!rec) continue;
    const values: KnobValues = {};
    for (const [k, d] of Object.entries(rec.knobs)) values[k] = d.value;
    mods.push({ id: rec.id, title: rec.title, source: rec.source, compiled: rec.compiled, knobs: rec.knobs, values, ...(rec.art ? { art: rec.art } : {}), ...(rec.look ? { look: rec.look } : {}) });
  }
  return mods;
}

/** Defensive parse of a stored file (a hand-edited or truncated file must not crash the server). */
export function parseWorld(text: string): StoredWorld | null {
  try {
    const w = JSON.parse(text) as Partial<StoredWorld>;
    if (!w || w.v !== 1 || !isWorldId(w.id) || !Array.isArray(w.mods)) return null;
    const mods: WorldMod[] = [];
    for (const m of w.mods.slice(0, MAX_WORLD_MODS)) {
      if (!m || typeof m.id !== "string") continue;
      if (m.builtin === true) mods.push({ builtin: true, id: m.id, values: sanitizeValues(m.values) });
      else if (typeof m.title === "string" && typeof m.source === "string" && typeof m.compiled === "string" && m.knobs && typeof m.knobs === "object") {
        mods.push({ id: m.id, title: m.title, source: m.source, compiled: m.compiled, knobs: m.knobs, values: sanitizeValues(m.values), ...(m.art ? { art: m.art } : {}), ...(m.look ? { look: m.look } : {}) });
      }
    }
    return { v: 1, id: w.id, title: w.title, blurb: w.blurb, createdAt: String(w.createdAt ?? ""), mods };
  } catch {
    return null;
  }
}

export class WorldStore {
  constructor(private userDir: string, private demoDir: string) {}

  save(mods: WorldMod[]): StoredWorld | { error: string } {
    if (mods.length === 0) return { error: "There's nothing in this world to share yet." };
    const id = randomBytes(6).toString("base64url");
    const world: StoredWorld = { v: 1, id, createdAt: new Date().toISOString(), mods };
    const text = JSON.stringify(world);
    if (text.length > MAX_WORLD_BYTES) return { error: "This world is too big to share." };
    mkdirSync(this.userDir, { recursive: true });
    writeFileSync(join(this.userDir, `${id}.json`), text);
    return world;
  }

  get(id: string): StoredWorld | null {
    if (!isWorldId(id)) return null;
    for (const dir of [this.demoDir, this.userDir]) {
      const file = join(dir, `${id}.json`);
      if (existsSync(file)) {
        const w = parseWorld(readFileSync(file, "utf8"));
        if (w && w.id === id) return w;
      }
    }
    return null;
  }

  demos(): DemoWorld[] {
    if (!existsSync(this.demoDir)) return [];
    const out: DemoWorld[] = [];
    for (const f of readdirSync(this.demoDir).sort()) {
      if (!f.startsWith("demo-") || !f.endsWith(".json")) continue;
      const w = parseWorld(readFileSync(join(this.demoDir, f), "utf8"));
      if (w) out.push({ id: w.id, title: w.title ?? w.id, blurb: w.blurb ?? "" });
    }
    return out;
  }
}
