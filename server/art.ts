// On-demand subject art: generate a sprite sheet with Muse Image the first
// time a mod introduces a new drawable subject, then reuse the cached file.
// Never throws: every failure path returns null (the mod still loads, just
// without art). Files land under public/art/gen/<key>.webp served at
// /art/gen/<key>.webp.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadEnv } from "./meta";
import { logArt } from "./createlog";

const IMAGE_MODEL = "muse-image-1.0";
const IMAGE_URL = "https://api.meta.ai/v1/images/generations";

/** In-memory cache: sanitized key -> public URL. */
const artCache = new Map<string, string>();

export function sanitizeArtKey(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, 64);
}

const SCENERY_WORDS = [
  "tree",
  "pine",
  "oak",
  "birch",
  "bush",
  "shrub",
  "rock",
  "stone",
  "boulder",
  "flower",
  "grass",
  "plant",
  "cactus",
  "mushroom",
  "cloud",
  "mountain",
  "hill",
  "house",
  "hut",
  "cabin",
  "castle",
  "tower",
  "fence",
  "lamp",
  "bridge",
  "waterfall",
  "lake",
  "pond",
  "sign",
  "statue",
  "crystal",
  "coral",
  "seaweed",
  "stump",
  "log",
  "barrel",
  "crate",
  "door",
  "window",
  "treehouse",
  "sun",
  "moon",
  "star",
  "rainbow",
  "planet",
  "comet",
  "meteor",
  "aurora",
  "snowman",
  "igloo",
  "tent",
  "campfire",
  "volcano",
  "island",
  "icicle",
  "snowflake",
] as const;

export function isScenerySubject(text: string): boolean {
  const lower = text.toLowerCase();
  return SCENERY_WORDS.some((w) => lower.includes(w));
}

export function artUrlForKey(key: string): string {
  return `/art/gen/${key}.webp`;
}

export function artCachedUrl(keyRaw: string): string | null {
  try {
    const key = sanitizeArtKey(keyRaw);
    if (!key) return null;
    const cached = artCache.get(key);
    if (cached) return cached;
    const file = join(process.cwd(), "public", "art", "gen", `${key}.webp`);
    if (existsSync(file)) {
      const url = artUrlForKey(key);
      artCache.set(key, url);
      return url;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Generate sprite-sheet art for a subject, or reuse the cached file.
 * Returns the public URL, or null on any failure. Never throws.
 */
export async function generateSubjectArt(subject: string, keyRaw: string, scenery = false): Promise<string | null> {
  try {
    const key = sanitizeArtKey(keyRaw);
    if (!key) return null;
    const cached = artCache.get(key);
    if (cached) return cached;
    const url = artUrlForKey(key);
    const file = join(process.cwd(), "public", "art", "gen", `${key}.webp`);
    // Disk cache: still attach the URL without regenerating.
    if (existsSync(file)) {
      artCache.set(key, url);
      return url;
    }
    const apiKey = loadEnv();
    if (!apiKey) return null;
    const cleanSubject = subject.trim() || key;
    const prompt = scenery
      ? `Pixel art game scenery sprite sheet containing ONLY ${cleanSubject}: exactly 4 variants of that single object in one row, nothing else in the image, no landscape, no ground, no sky, no other objects or props. Each variant is the same object with a slightly different shape or size. NOT a character, no face, no eyes, no mouth, no arms, no legs, no animation poses. Flat solid magenta background (#FF00FF), chunky pixels, dark outline, 16-bit platformer style, no text, variants far apart with wide empty magenta gaps between them, bottoms aligned on the same baseline, variants must NOT touch or overlap each other`
      : `Pixel art game sprite sheet of ${cleanSubject}, side view, 4 poses in a row: ` +
        `idle, running, running, jumping. Flat solid magenta background (#FF00FF), ` +
        `chunky pixels, dark outline, 16-bit platformer style, no text, poses far apart with wide empty magenta gaps between them, poses must NOT touch or overlap each other`;
    const t0 = performance.now();
    const res = await fetch(IMAGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: IMAGE_MODEL, prompt, size: "1024x1024" }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) return null;
    const webp = Buffer.from(b64, "base64");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, webp);
    const ms = Math.round(performance.now() - t0);
    logArt({ subject: cleanSubject, key, file, ms });
    artCache.set(key, url);
    return url;
  } catch {
    return null;
  }
}

/** Entity types that never need generated art. */
const SKIP_TYPES = new Set([
  "player",
  "ground",
  "platform",
  "coin",
  "coins",
  "enemy",
  "enemies",
  "rain",
  "raindrop",
  "projectile",
  "arrow",
  "fire",
  "slime",
  "gel",
  "background",
  "platform-moving",
]);

function isSkippedType(type: string): boolean {
  const t = type.toLowerCase();
  if (SKIP_TYPES.has(t)) return true;
  return t.includes("string") || t.includes("tail") || t.includes("particle");
}

/**
 * Scan a mod source for spawned entity types (api.spawn({ type: "..." }) and
 * any other type: "..." literal), in first-seen order. Returns the FIRST type
 * that is not generic/known, or null when nothing needs art.
 */
export function pickArtType(source: string): string | null {
  const seen: string[] = [];
  const re = /type\s*:\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const t = m[1].trim();
    if (t && !seen.includes(t)) seen.push(t);
  }
  for (const t of seen) {
    if (!isSkippedType(t)) return t;
  }
  return null;
}

/**
 * Derive a human subject phrase from the player command: strip the leading
 * build verb + articles, keep the noun phrase up to the first comma / "and" /
 * "that" / "which". Falls back to the type token.
 */
export function deriveSubject(command: string, fallbackType: string): string {
  let s = command.trim().replace(/^(add|make|create|spawn|build)\s+/i, "");
  s = s.replace(/^(a|an|the)\s+/i, "");
  const head =
    (s.split(/\s*,\s*|\s+and\s+|\s+that\s+|\s+which\s+/i)[0] ?? "").split(
      /\s+(in|on|over|under|above|below)\s+(the|a|an)\s+/i,
    )[0] ?? "";
  s = head.trim().replace(/[.!?]+$/, "").trim();
  return s || fallbackType;
}

/**
 * Key for an entity type: last dash segment (e.g. "fire-dragon" -> "dragon"),
 * or the full type when short / dash-free. Always sanitized.
 */
export function artKeyForType(type: string): string {
  const lower = type.toLowerCase().trim();
  const base = lower.includes("-") ? (lower.split("-").pop() ?? lower) : lower;
  return sanitizeArtKey(base || lower);
}
