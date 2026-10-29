// On-demand subject art: generate a sprite sheet with Muse Image the first
// time a mod introduces a new drawable subject, then reuse the cached file.
// Never throws: every failure path returns null (the mod still loads, just
// without art). Files land under public/art/gen/<key>.webp served at
// /art/gen/<key>.webp.
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canUseSpriteSheet, detectMoodCommand, entityKind, extractSpawnedEntities, isHeldItemType } from "../src/ontology";
import { loadEnv } from "./meta";
import { logArt } from "./createlog";
import { loadRules } from "./learn";

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
  "lantern",
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
  "chest",
  "door",
  "window",
  "treehouse",
  "sun",
  "moon",
  "rainbow",
  "planet",
  "comet",
  "meteor",
  "snowman",
  "igloo",
  "tent",
  "campfire",
  "volcano",
  "island",
  "icicle",
  "tornado",
  "twister",
  "cyclone",
  "whirlwind",
  "vortex",
  "hurricane",
  "waterspout",
  "gift",
  "present",
  "ornament",
  "wreath",
  "sleigh",
  "stocking",
  "candycane",
  "gingerbread",
  "bell",
  "candle",
  "pumpkin",
  "cauldron",
  "gravestone",
  "tombstone",
  "chair",
  "table",
  "bench",
  "throne",
  "altar",
  "fountain",
  "well",
  "cart",
  "wagon",
  "car",
  "racecar",
  "boat",
  "ship",
  "airplane",
  "anchor",
  "flag",
  "trophy",
  "prize",
  "crown",
  "gun",
  "pistol",
  "rifle",
  "blaster",
  "shotgun",
  "cannon",
  "launcher",
  "sword",
  "blade",
  "dagger",
  "katana",
  "shield",
  "bow",
  "crossbow",
  "wand",
  "staff",
  "hammer",
  "axe",
  "spear",
  "key",
  "potion",
  "flask",
  "heart",
  "jetpack",
  "umbrella",
  "torch",
  "pickaxe",
  "shovel",
  "weapon",
] as const;

export function isScenerySubject(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (!lower) return false;
  if (entityKind(lower) === "creature" || entityKind(lower) === "player") return false;
  if (isHeldItemType(lower)) return true;
  if (entityKind(lower) === "prop") return true;
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.some((tok) => {
    const singular = tok.endsWith("s") && tok.length > 3 ? tok.slice(0, -1) : tok;
    return (SCENERY_WORDS as readonly string[]).includes(tok) || (SCENERY_WORDS as readonly string[]).includes(singular);
  });
}

/** Clear cached sprite sheet in memory and on disk so a bad art sheet can be regenerated or replaced. */
export function clearCachedArt(keyRaw: string): boolean {
  try {
    const key = sanitizeArtKey(keyRaw);
    if (!key) return false;
    const hadMem = artCache.delete(key);
    const file = join(process.cwd(), "public", "art", "gen", `${key}.webp`);
    if (existsSync(file)) {
      unlinkSync(file);
      return true;
    }
    return hadMem;
  } catch {
    return false;
  }
}

/** Entity types that never need generated art (terrain, level geometry, effects, projectiles, primitives, built-in creatures). */
const SKIP_TYPES = new Set([
  "player",
  "ground",
  "platform",
  "platforms",
  "platform-moving",
  "moving-platform",
  "stair",
  "stairs",
  "staircase",
  "step",
  "steps",
  "ramp",
  "ramps",
  "ladder",
  "ladders",
  "ledge",
  "ledges",
  "wall",
  "walls",
  "block",
  "blocks",
  "brick",
  "bricks",
  "pillar",
  "pillars",
  "column",
  "floor",
  "ceiling",
  "slope",
  "bridge",
  "cliff",
  "terrain",
  "surface",
  "tile",
  "road",
  "path",
  "soil",
  "dirt",
  "mud",
  "slab",
  "coin",
  "coins",
  "enemy",
  "enemies",
  "rain",
  "raindrop",
  "raindrops",
  "projectile",
  "projectiles",
  "bullet",
  "bullets",
  "shot",
  "shots",
  "arrow",
  "arrows",
  "fireball",
  "bolt",
  "beam",
  "laser",
  "plasma",
  "missile",
  "rocket",
  "shuriken",
  "pellet",
  "fire",
  "slime",
  "gel",
  "background",
  // weather and effects are engine fx, never sprite sheets (ADR 0015 & ADR 0023)
  "fog",
  "mist",
  "haze",
  "smoke",
  "snow",
  "snowflake",
  "snowflakes",
  "blizzard",
  "explosion",
  "explosions",
  "blast",
  "shockwave",
  "spark",
  "sparks",
  "ember",
  "embers",
  "lightning",
  "glow",
  "firefly",
  "fireflies",
  "light",
  "lights",
  "garland",
  "aurora",
  "particle",
  "particles",
  "trail",
  // primitives / shapes (ADR 0015 & ADR 0023)
  "ball",
  "orb",
  "bubble",
  "sphere",
  "circle",
  "ring",
  "halo",
  "hoop",
  "spike",
  "spikes",
  "thorn",
  "triangle",
  "cone",
  "wedge",
  "diamond",
  "gem",
  "star",
  "pill",
  "capsule",
  "bomb",
]);

// Purge any corrupted terrain/geometry sprite sheets on startup (x9i, cjj, 98v).
for (const forbidden of ["ground", "stair", "stairs", "step", "wall", "walls", "platform", "block", "brick"]) {
  clearCachedArt(forbidden);
}

export function isSkippedType(type: string): boolean {
  const t = type.toLowerCase().trim();
  if (!t) return true;
  if (SKIP_TYPES.has(t)) return true;
  if (!canUseSpriteSheet(t)) return true;
  return t.includes("string") || t.includes("tail") || t.includes("particle");
}

export function artUrlForKey(key: string): string {
  return `/art/gen/${key}.webp`;
}

export function artCachedUrl(keyRaw: string): string | null {
  try {
    const key = artKeyForType(keyRaw);
    if (!key) {
      clearCachedArt(keyRaw);
      return null;
    }
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
    const key = artKeyForType(keyRaw);
    if (!key) {
      clearCachedArt(keyRaw);
      return null;
    }
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
    const heldItem = isHeldItemType(cleanSubject) || isHeldItemType(key);
    const effectiveScenery = scenery || heldItem || isScenerySubject(cleanSubject) || isScenerySubject(key);
    const prompt = heldItem
      ? `Pixel art game held item icon sheet containing ONLY the isolated object ${cleanSubject} by itself (side view, pointing right): exactly 4 variants of that single item in one row, nothing else in the image, no landscape, no ground, no sky. ONLY the standalone weapon or item itself — NO character, NO person, NO warrior, NO ninja, NO hands holding it, NO body, NO head, NO face, NO eyes, NO arms, NO legs, NO animation poses. Flat solid magenta background (#FF00FF), chunky pixels, dark outline, 16-bit platformer style, no text, variants far apart with wide empty magenta gaps between them, variants must NOT touch or overlap each other`
      : effectiveScenery
        ? `Pixel art game scenery sprite sheet containing ONLY ${cleanSubject}: exactly 4 variants of that single object in one row, nothing else in the image, no landscape, no ground, no sky, no other objects or props. Each variant is the same object with a slightly different shape or size. NOT a character, no face, no eyes, no mouth, no arms, no legs, no animation poses. Flat solid magenta background (#FF00FF), chunky pixels, dark outline, 16-bit platformer style, no text, variants far apart with wide empty magenta gaps between them, bottoms aligned on the same baseline, variants must NOT touch or overlap each other`
        : `Pixel art game sprite sheet of ${cleanSubject}, side view, 4 poses in a row: ` +
          `idle, running, running, jumping. Flat solid magenta background (#FF00FF), ` +
          `chunky pixels, dark outline, 16-bit platformer style, no text, poses far apart with wide empty magenta gaps between them, poses must NOT touch or overlap each other`;
    const t0 = performance.now();
    const res = await fetch(IMAGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: IMAGE_MODEL, prompt: [prompt, ...loadRules().filter((r) => r.subsystem === "art").slice(-5).map((r) => r.rule)].join(". "), size: "1024x1024" }),
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

/**
 * Scan a mod source for spawned entity types (api.spawn({ type: "..." }) and
 * any other type: "..." literal), in first-seen order. Returns the FIRST type
 * that is a drawable creature or prop (never terrain, static solid geometry,
 * effects, projectiles, or shapes), or null when nothing needs art.
 */
export function pickArtType(source: string): string | null {
  const spawned = extractSpawnedEntities(source);
  for (const s of spawned) {
    if (s.solid && s.gravityScale === 0) continue;
    if (s.kind !== "creature" && s.kind !== "prop") continue;
    if (isSkippedType(s.type)) continue;
    if (!artKeyForType(s.type)) continue;
    return s.type;
  }
  return null;
}

const QUANTIFIER_OR_ARTICLE_RE =
  /^(?:a\s+few|a\s+bunch\s+of|a\s+lot\s+of|lots\s+of|some|many|several|more|few|all|a|an|the|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+/i;

/**
 * Derive a human subject phrase from the player command: strip the leading
 * build verb + indirect player references + articles/quantifiers, keep the noun
 * phrase up to the first clause boundary. Falls back to the type token.
 */
export function deriveSubject(command: string, fallbackType: string): string {
  const fallbackClean = fallbackType.replace(/[-_]+/g, " ").trim() || fallbackType;
  if (detectMoodCommand(command)) return fallbackClean;
  let s = command.trim();
  s = s.replace(/^(?:(?:please|can\s+you|could\s+you)\s+)?(?:add|make|create|spawn|build|give|equip|put|let|have)\s+/i, "");
  s = s.replace(/^(?:it\s+so(?:\s+that)?\s+)/i, "");
  s = s.replace(
    /^(?:me|us|my\s+(?:character|player|ninja|guy|hero)|the\s+(?:player|ninja)|him|her)\s+(?:have\s+|hold\s+|use\s+|wield\s+|carry\s+|get\s+|shoot\s+|with\s+)?/i,
    "",
  );
  while (QUANTIFIER_OR_ARTICLE_RE.test(s)) {
    s = s.replace(QUANTIFIER_OR_ARTICLE_RE, "");
  }
  const head =
    (s.split(/\s*,\s*|\s+and\s+|\s+that\s+|\s+which\s+|\s+so\s+|\s+when\s+|\s+if\s+/i)[0] ?? "").split(
      /\s+(?:in|on|over|under|above|below|near|by|around)\s+(?:the|a|an|my)\s+/i,
    )[0] ?? "";
  s = head.trim().replace(/[.!?]+$/, "").trim();
  while (QUANTIFIER_OR_ARTICLE_RE.test(s)) {
    s = s.replace(QUANTIFIER_OR_ARTICLE_RE, "").trim();
  }
  if (!s || /\bthemed?\b/i.test(s) || /^(?:this|it|everything)\b/i.test(s)) {
    return fallbackClean;
  }
  return s;
}

/**
 * Key for an entity type: last dash segment (e.g. "fire-dragon" -> "dragon"),
 * or the full type when short / dash-free. Always sanitized and checked against
 * the entity ontology so compound terrain/effect/projectile/shape types
 * (e.g. "snow-ground", "brick-wall", "boss-bullet", "christmas-light", "christmas-star")
 * NEVER produce a sprite key.
 */
export function artKeyForType(type: string): string {
  const lower = type.toLowerCase().trim();
  if (!lower || isSkippedType(lower) || !canUseSpriteSheet(lower)) return "";
  const parts = lower.split("-").filter(Boolean);
  const base = parts.length > 1 ? (parts[parts.length - 1] ?? lower) : lower;
  const key = sanitizeArtKey(base || lower);
  if (!key || isSkippedType(key) || !canUseSpriteSheet(key)) return "";
  return key;
}
