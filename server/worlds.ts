// Worlds (ADR 0014): a world is its mod list. User worlds are JSON files under DATA_DIR/worlds
// named by a random id that goes in the share URL; curated demo worlds ship in the repo's
// worlds/ directory (ids start with "demo-"). The server only saves mods from its own verified
// session manifest, so opening a link never runs code a visitor uploaded.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { DemoWorld, KnobDefs, Look, KnobValue, KnobValues, MoodSpec, WorldMod } from "../src/contract";
import { moodKey, restyledUrl } from "./mood";

export const MAX_WORLD_MODS = 40;
export const MAX_WORLD_BYTES = 600_000;

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
    if (!m.builtin && m.art?.key) keys.add(m.art.key);
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

export interface SessionMod {
  id: string;
  title: string;
  source: string;
  compiled: string;
  knobs: KnobDefs;
  art?: { key: string; url: string; scenery?: boolean };
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
    mods.push({ id: rec.id, title: rec.title, source: rec.source, compiled: rec.compiled, knobs: rec.knobs, values, ...(rec.art ? { art: rec.art } : {}), ...(rec.skinArt ? { skinArt: rec.skinArt } : {}), ...(rec.look ? { look: rec.look } : {}) });
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
    const cleanMood = sanitizeMood(mood);
    const cleanRestyled = cleanMood ? sanitizeRestyled(restyled, cleanMood.name) : undefined;
    const world: StoredWorld = {
      v: 1,
      id,
      createdAt: new Date().toISOString(),
      mods,
      ...(cleanMood ? { mood: cleanMood } : {}),
      ...(cleanRestyled ? { restyled: cleanRestyled } : {}),
    };
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
