// Worlds (ADR 0014): a world is its mod list. User worlds are JSON files under DATA_DIR/worlds
// named by a random id that goes in the share URL; curated demo worlds ship in the repo's
// worlds/ directory (ids start with "demo-"). The server only saves mods from its own verified
// session manifest, so opening a link never runs code a visitor uploaded.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { HOME_WORLD_PREFIX, isHomeWorldId, sheetsOf } from "../src/contract";
import type { ArtSheet, DemoWorld, KnobDefs, Look, KnobValue, KnobValues, MoodSpec, WorldMod } from "../src/contract";
import { scrubWorld } from "./hygiene";
import { moodKey, parseBackdrop, restyledUrl } from "./mood";
import { clampKnobValue } from "./validate";

export const MAX_WORLD_MODS = 40;
export const MAX_WORLD_BYTES = 600_000;
/** How long a browser's autosaved world is kept after it stops being used (ADR 0070). */
export const HOME_SLOT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface StoredWorld {
  v: 1;
  id: string;
  title?: string;
  blurb?: string;
  createdAt: string;
  mods: WorldMod[];
  mood?: MoodSpec;
  restyled?: Record<string, string>;
}

const AMBIENTS: readonly MoodSpec["ambient"][] = ["none", "fog", "snow", "embers", "sparks"];

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

const clampColor = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(0xffffff, Math.round(v))) : null);
const clampFloat = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);

/** Validate a stored MoodSpec so a hand-edited file cannot poison client palette state. */
export function sanitizeMood(raw: unknown): MoodSpec | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const m = raw as Record<string, unknown>;
  if (typeof m.name !== "string" || !m.name.trim() || typeof m.anchor !== "string" || !m.anchor.trim()) return undefined;
  const skyTop = clampColor(m.skyTop), skyBottom = clampColor(m.skyBottom);
  const ridgeFar = clampColor(m.ridgeFar), ridgeNear = clampColor(m.ridgeNear);
  const moon = clampColor(m.moon), star = clampColor(m.star);
  const grass = clampColor(m.grass), soil = clampColor(m.soil), tint = clampColor(m.tint);
  const grade = clampFloat(m.grade, 0, 1), dim = clampFloat(m.dim, 0, 2);
  const fog = clampFloat(m.fog, 0, 1), vignette = clampFloat(m.vignette, 0, 1);
  if ([skyTop, skyBottom, ridgeFar, ridgeNear, moon, star, grass, soil, tint, grade, dim, fog, vignette].some((x) => x === null)) return undefined;
  const ambient = AMBIENTS.includes(m.ambient as MoodSpec["ambient"]) ? (m.ambient as MoodSpec["ambient"]) : "none";
  return {
    name: moodKey(m.name),
    anchor: m.anchor.slice(0, 240),
    skyTop: skyTop!, skyBottom: skyBottom!, ridgeFar: ridgeFar!, ridgeNear: ridgeNear!,
    moon: moon!, star: star!, grass: grass!, soil: soil!, tint: tint!,
    grade: grade!, dim: dim!, fog: fog!, vignette: vignette!, ambient,
    ...(parseBackdrop(m.backdrop) ? { backdrop: parseBackdrop(m.backdrop) } : {}),
    ...(m.scope === "background" ? { scope: "background" as const } : {}),
  };
}

/** Validate restyled sheet map: only valid sprite keys -> `/art/gen/<key>--<mood>.webp` URLs. */
export function sanitizeRestyled(raw: unknown, moodName?: string): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const suffix = moodName ? `--${moodKey(moodName)}.webp` : undefined;
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= 24) break;
    if (!/^[a-z0-9-]{1,64}$/.test(k) || k.startsWith("photo") || k.includes("--")) continue;
    if (typeof v !== "string" || !/^\/art\/gen\/[a-z0-9-]+--[a-z0-9-]+\.webp$/.test(v)) continue;
    if (suffix && v !== `/art/gen/${k}${suffix}`) continue;
    out[k] = v;
    n++;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Gather restyled sheet URLs for a world's active mood from session state + cached files on disk. */
export function restyledForWorld(
  mood: MoodSpec | undefined,
  mods: readonly WorldMod[],
  sessionRestyled?: Record<string, string>,
  root = process.cwd(),
): Record<string, string> | undefined {
  if (!mood) return undefined;
  const out: Record<string, string> = sanitizeRestyled(sessionRestyled, mood.name) ?? {};
  const keys = new Set<string>();
  for (const m of mods) {
    if (m.id === "player") keys.add("ninja");
    else if (m.id === "chicken") keys.add("chicken");
    if (!m.builtin) for (const s of sheetsOf(m)) keys.add(s.key);
    if (!m.builtin && m.skinArt?.key) keys.add(m.skinArt.key);
  }
  const mk = moodKey(mood.name);
  for (const k of keys) {
    if (out[k] || !/^[a-z0-9-]{1,64}$/.test(k) || k.startsWith("photo") || k.includes("--")) continue;
    if (existsSync(join(root, "public", "art", "gen", `${k}--${mk}.webp`))) {
      out[k] = restyledUrl(k, mood.name);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const MAX_SHEETS = 24;
const SHEET_KEY = /^[a-z0-9-]{1,64}$/;

/** A stored sheet list, defensively: a hand-edited world must not smuggle a path or a script in as art. */
function cleanSheets(v: unknown): ArtSheet[] {
  if (!Array.isArray(v)) return [];
  const out: ArtSheet[] = [];
  for (const s of v.slice(0, MAX_SHEETS)) {
    const o = s as Partial<ArtSheet> | null;
    if (!o || typeof o.key !== "string" || !SHEET_KEY.test(o.key) || typeof o.url !== "string" || !/^\/art\/gen\/[a-z0-9-]+(--[a-z0-9-]+)?\.webp$/.test(o.url)) continue;
    out.push({ key: o.key, url: o.url, ...(o.scenery === true ? { scenery: true } : {}) });
  }
  return out;
}

/** The art fields a stored mod carries: `arts` (all sheets) plus `art` (the first, which older readers know). */
function artFields(m: { art?: ArtSheet; arts?: unknown }): { art?: ArtSheet; arts?: ArtSheet[] } {
  const all = sheetsOf({ arts: cleanSheets(m.arts), ...(m.art ? { art: m.art } : {}) });
  return all.length > 0 ? { art: all[0], arts: all } : {};
}

export interface SessionMod {
  id: string;
  title: string;
  source: string;
  compiled: string;
  knobs: KnobDefs;
  art?: { key: string; url: string; scenery?: boolean };
  arts?: ArtSheet[];
  skinArt?: { key: string; url: string };
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
    mods.push({ id: rec.id, title: rec.title, source: rec.source, compiled: rec.compiled, knobs: rec.knobs, values, ...artFields(rec), ...(rec.skinArt ? { skinArt: rec.skinArt } : {}), ...(rec.look ? { look: rec.look } : {}) });
  }
  return mods;
}

/**
 * The mods an autosave should write (ADR 0070): the session's own verified records, plus — for any id
 * the client still has loaded but this server no longer holds — the record the slot file already had.
 *
 * A restarted server (or any reconnect: sessions are per socket) forgets its manifest, while the page
 * still shows the world. Without this, the very next autosave would write a file containing only the
 * built-ins and the player's AI mods would be gone at the next reload. The reused record comes from
 * the server's own previously verified file, never from the client, so the trust model is unchanged.
 */
export function reuseStoredMods(
  requested: readonly { id: string }[],
  mods: readonly WorldMod[],
  previous: StoredWorld | null,
): WorldMod[] {
  if (!previous || previous.mods.length === 0) return [...mods];
  const byId = new Map(mods.map((m) => [m.id, m]));
  const stored = new Map(previous.mods.map((m) => [m.id, m]));
  const out: WorldMod[] = [];
  const seen = new Set<string>();
  for (const r of requested) {
    if (!r || typeof r.id !== "string" || seen.has(r.id)) continue;
    seen.add(r.id);
    const fresh = byId.get(r.id);
    if (fresh) { out.push(fresh); continue; }
    const kept = stored.get(r.id);
    if (kept) out.push(kept);
  }
  return out;
}

/**
 * The mods a reconnecting session adopts from its own slot file (ADR 0077): the ones the page still
 * has loaded, that this session does not already know, with the client's own knob values laid over
 * the file's. A restarted server (or any reconnect: sessions are per socket) holds no manifest for
 * the world on screen, so without this an edit, an undo or a knob change fails until the page is
 * reloaded. Ids the session already holds are never touched (a build made after the reconnect wins),
 * an id the file does not have is not invented, and built-ins are left to `adoptBuiltins`.
 */
export function adoptStoredMods(
  requested: readonly { id: string; values?: KnobValues }[],
  manifest: ReadonlyMap<string, SessionMod>,
  previous: StoredWorld | null,
): Extract<WorldMod, { builtin?: false }>[] {
  if (!previous) return [];
  const stored = new Map(previous.mods.map((m) => [m.id, m]));
  const out: Extract<WorldMod, { builtin?: false }>[] = [];
  const seen = new Set<string>();
  for (const r of requested) {
    if (!r || typeof r.id !== "string" || seen.has(r.id) || manifest.has(r.id)) continue;
    seen.add(r.id);
    const kept = stored.get(r.id);
    if (!kept || kept.builtin === true) continue;
    out.push({ ...kept, values: { ...kept.values, ...sanitizeValues(r.values) } });
  }
  return out;
}

/**
 * A stored world mod as the session record the server needs to edit, undo and tweak it again.
 * Knob values from the mod (and any the client reported on top) become each knob's current value,
 * clamped exactly like a live knob message, so a re-adopted mod keeps the size the player chose
 * instead of snapping back to the mod's default on the next autosave.
 */
export function sessionRecOf(m: Extract<WorldMod, { builtin?: false }>, overrides?: KnobValues): SessionMod {
  const knobs = structuredClone(m.knobs ?? {});
  for (const [k, v] of Object.entries({ ...m.values, ...sanitizeValues(overrides) })) {
    const def = Object.prototype.hasOwnProperty.call(knobs, k) ? knobs[k] : undefined;
    if (def) knobs[k] = { ...def, value: clampKnobValue(def, v) };
  }
  const sheets = sheetsOf(m);
  return {
    id: m.id,
    title: m.title,
    source: m.source,
    compiled: m.compiled,
    knobs,
    ...(sheets.length > 0 ? { art: sheets[0], arts: sheets } : {}),
    ...(m.skinArt ? { skinArt: m.skinArt } : {}),
    ...(m.look ? { look: m.look } : {}),
  };
}

/** Defensive parse of a stored file (a hand-edited or truncated file must not crash the server). */export function parseWorld(text: string): StoredWorld | null {
  try {
    const w = JSON.parse(text) as Partial<StoredWorld>;
    if (!w || w.v !== 1 || !isWorldId(w.id) || !Array.isArray(w.mods)) return null;
    const mods: WorldMod[] = [];
    for (const m of w.mods.slice(0, MAX_WORLD_MODS)) {
      if (!m || typeof m.id !== "string") continue;
      if (m.builtin === true) mods.push({ builtin: true, id: m.id, values: sanitizeValues(m.values) });
      else if (typeof m.title === "string" && typeof m.source === "string" && typeof m.compiled === "string" && m.knobs && typeof m.knobs === "object") {
        mods.push({ id: m.id, title: m.title, source: m.source, compiled: m.compiled, knobs: m.knobs, values: sanitizeValues(m.values), ...artFields(m), ...(m.look ? { look: m.look } : {}) });
      }
    }
    const mood = sanitizeMood(w.mood);
    const restyled = mood ? sanitizeRestyled(w.restyled, mood.name) : undefined;
    return {
      v: 1,
      id: w.id,
      title: w.title,
      blurb: w.blurb,
      createdAt: String(w.createdAt ?? ""),
      mods,
      ...(mood ? { mood } : {}),
      ...(restyled ? { restyled } : {}),
    };
  } catch {
    return null;
  }
}

export class WorldStore {
  constructor(private userDir: string, private demoDir: string) {}

  save(mods: WorldMod[], mood?: MoodSpec, restyled?: Record<string, string>): StoredWorld | { error: string } {
    if (mods.length === 0) return { error: "There's nothing in this world to share yet." };
    const id = randomBytes(6).toString("base64url");
    return this.write(id, mods, mood, restyled, false);
  }

  /**
   * The browser's own autosave (ADR 0070): the same file every time, titled by the client's slot id.
   * Unlike `save` (the share button), an empty world is a real answer here: if the player undid
   * everything, the next reload must come back empty instead of raising the old world.
   */
  saveSlot(slot: string, mods: WorldMod[], mood?: MoodSpec, restyled?: Record<string, string>): StoredWorld | { error: string } {
    if (!isHomeWorldId(slot)) return { error: "That isn't one of this browser's own worlds." };
    return this.write(slot, mods.slice(0, MAX_WORLD_MODS), mood, restyled, true);
  }

  private write(id: string, mods: WorldMod[], mood: MoodSpec | undefined, restyled: Record<string, string> | undefined, allowEmpty: boolean): StoredWorld | { error: string } {
    if (!allowEmpty && mods.length === 0) return { error: "There's nothing in this world to share yet." };
    const cleanMood = sanitizeMood(mood);
    const cleanRestyled = cleanMood ? sanitizeRestyled(restyled, cleanMood.name) : undefined;
    const draft: StoredWorld = {
      v: 1,
      id,
      createdAt: new Date().toISOString(),
      mods,
      ...(cleanMood ? { mood: cleanMood } : {}),
      ...(cleanRestyled ? { restyled: cleanRestyled } : {}),
    };
    // A world file is a file: no key and no personal detail goes in it (ADR 0070).
    const world = scrubWorld(draft);
    const text = JSON.stringify(world);
    if (text.length > MAX_WORLD_BYTES) return { error: allowEmpty ? "This world has grown too big to save." : "This world is too big to share." };
    mkdirSync(this.userDir, { recursive: true });
    writeFileSync(join(this.userDir, `${id}.json`), text);
    return world;
  }

  /**
   * Drop autosaved worlds nobody has opened for `ttlMs` (ADR 0070). Only `home-*` files are ever
   * deleted: a shared world or a curated demo is never touched, whatever its age.
   */
  pruneSlots(now = Date.now(), ttlMs = HOME_SLOT_TTL_MS): number {
    if (!existsSync(this.userDir)) return 0;
    let removed = 0;
    for (const f of readdirSync(this.userDir)) {
      if (!f.startsWith(HOME_WORLD_PREFIX) || !f.endsWith(".json")) continue;
      const file = join(this.userDir, f);
      try {
        if (now - statSync(file).mtimeMs < ttlMs) continue;
        unlinkSync(file);
        removed++;
      } catch { /* another process is using it: leave it */ }
    }
    return removed;
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

  /**
   * Adopt this browser's own slot back into a session that has just reconnected (ADR 0077). The page
   * kept its world in memory across a dropped socket or a server restart, but sessions are per socket,
   * so a fresh session knows none of those mods and "edit it", undo and the knobs would all fail until
   * a reload. Only ids the client still lists are adopted, only out of this server's own stored file,
   * and only when the session does not already know that id. Returns the records the session gained;
   * nothing is written and nothing is sent to the client.
   */
  adoptSlot(
    slot: string,
    requested: readonly { id: string; values?: KnobValues }[],
    manifest: Map<string, SessionMod>,
  ): SessionMod[] {
    if (!isHomeWorldId(slot)) return [];
    const gained: SessionMod[] = [];
    for (const m of adoptStoredMods(requested, manifest, this.get(slot))) {
      const rec = sessionRecOf(m);
      manifest.set(rec.id, rec);
      gained.push(rec);
    }
    return gained;
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
