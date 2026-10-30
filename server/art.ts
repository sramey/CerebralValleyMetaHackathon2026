// On-demand subject art: generate a sprite sheet with Muse Image the first
// time a mod introduces a new drawable subject, then reuse the cached file.
// Never throws: every failure path returns null (the mod still loads, just
// without art). Files land under public/art/gen/<key>.webp served at
// /art/gen/<key>.webp.
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { artPlanFor, canUseSpriteSheet, detectMoodCommand, extractSpawnedEntities, isHeldItemType } from "../src/ontology";
import { loadEnv } from "./meta";
import { logArt } from "./createlog";
import { loadRules } from "./learn";
import { screenArtPrompt } from "./safety";

export const IMAGE_MODEL = "muse-image-1.0";
const IMAGE_URL = "https://api.meta.ai/v1/images/generations";

/** In-memory cache: sanitized key -> public URL. */
const artCache = new Map<string, string>();

/**
 * Directory that holds generated sheets on disk, served at /art/gen/<key>.webp.
 * `ART_GEN_DIR` overrides it so a test run can point the cache at a throwaway folder and
 * never read the checkout's `public/art/gen/`, where a live session leaves real sheets
 * that would make an art test skip generation (bead cvu). Production keeps the default.
 */
export function artGenDir(): string {
  const override = (process.env.ART_GEN_DIR ?? "").trim();
  return override || join(process.cwd(), "public", "art", "gen");
}

/** Path of a cached sheet on disk. Every cache read, write and delete goes through this. */
export function artFilePath(key: string): string {
  return join(artGenDir(), `${key}.webp`);
}

export function sanitizeArtKey(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, 64);
}

/**
 * True when a subject or type wants static scenery art rather than animated
 * poses. Derived from the ontology (ADR 0009, ADR 0031): props and held items
 * are scenery, creatures and the player are not.
 */
export function isScenerySubject(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (!lower) return false;
  const plan = artPlanFor(lower);
  return plan === "scenery" || plan === "held-item";
}

/** Clear cached sprite sheet in memory and on disk so a bad art sheet can be regenerated or replaced. */
export function clearCachedArt(keyRaw: string): boolean {
  try {
    const key = sanitizeArtKey(keyRaw);
    if (!key) return false;
    const hadMem = artCache.delete(key);
    const file = artFilePath(key);
    if (existsSync(file)) {
      unlinkSync(file);
      return true;
    }
    return hadMem;
  } catch {
    return false;
  }
}

/**
 * True when the ontology says this type is drawn procedurally in code instead
 * of getting generated sprite art (ADR 0015, ADR 0023, ADR 0031). Terrain and
 * static structure, effects, projectiles and shapes are code-drawn; the player's
 * sheet ships with the engine, so it is never generated either.
 */
export function isSkippedType(type: string): boolean {
  const t = type.toLowerCase().trim();
  if (!t) return true;
  const plan = artPlanFor(t);
  if (plan === "none") return true;
  return plan === "sheet" && !canUseSpriteSheet(t);
}

/**
 * Legacy sheet keys written by pre-ontology code (x9i, cjj, 98v). New bad keys
 * cannot appear: artKeyForType derives from the ontology, so terrain and static
 * geometry never produce a key. This is a one-time cleanup of files on disk and
 * is called explicitly at server startup, never as an import side effect.
 * Exported so tests can prove none of them is valid art.
 */
export const LEGACY_PURGE_KEYS: readonly string[] = ["ground", "stair", "stairs", "step", "wall", "walls", "platform", "block", "brick"];

/** Delete legacy corrupted terrain sheets. Returns the keys that existed on disk. */
export function purgeLegacyArt(): string[] {
  const purged: string[] = [];
  for (const key of LEGACY_PURGE_KEYS) {
    if (clearCachedArt(key)) purged.push(key);
  }
  return purged;
}

export function artUrlForKey(key: string): string {
  return `/art/gen/${key}.webp`;
}

export function artCachedUrl(keyRaw: string, variant?: string): string | null {
  try {
    const key = artKeyForType(keyRaw, variant);
    if (!key) {
      clearCachedArt(keyRaw);
      return null;
    }
    const cached = artCache.get(key);
    if (cached) return cached;
    const file = artFilePath(key);
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
 * True when the request (or the entity type) is about something that flies, so the sheet
 * should show airborne poses instead of the walk/run cycle (ADR 0053, bead 2yt). Word list,
 * not a model call: it only picks which pose prompt Muse Image gets.
 */
const FLYING_WORD = /\b(?:fly|flys|flies|flying|floats?|floating|hover(?:s|ed|ing)?|soar(?:s|ed|ing)?|glide|glides|gliding|winged?|wings|airborne)\b/i;
const FLYING_TYPE = /\b(?:bird|bat|dragon|fairy|angel|bee|butterfly|moth|drone|ufo|rocket|spaceship|space-ship|jet|plane|blimp|zeppelin|helicopter|hawk|eagle|owl|crow|raven|pigeon|phoenix|griffin|wyvern|wisp)\b/i;

export function isFlyingRequest(text: string, type = ""): boolean {
  // "a slime on the floating platform": a floating/flying PLACE says where it stands, not that it flies.
  const own = text.replace(/\b(?:floating|flying|hovering|sky)\s+(?:platforms?|islands?|blocks?|ledges?|steps?|stairs?|bridges?|rocks?)\b/gi, " ");
  if (FLYING_WORD.test(own)) return true;
  return FLYING_TYPE.test(type.replace(/[-_]+/g, " "));
}

/**
 * The sprite-sheet prompt for one subject, exactly as Muse Image receives it (the kid-safe screen
 * reads this string too, so it can be screened without spending an image call — bead 82z).
 */
export function spritePrompt(cleanSubject: string, form: { held: boolean; scenery: boolean; flying?: boolean; skin?: boolean }): string {
  if (form.skin) {
    // A player skin (ADR 0066): the player's own character redrawn as this subject, for a game where it flies.
    return `Pixel art game sprite sheet of ${cleanSubject}, the player's own character, for a 2D side-scrolling flight game, side view strictly facing right: ` +
      `exactly 4 poses of the SAME ${cleanSubject} in 1 single horizontal row from left to right: idle hovering level, flying forward with thrust, banking upward, diving downward. ` +
      `Orientation: every pose MUST face right in side profile — NEVER face backwards or away from the camera, NEVER front-facing, no top-down angles, NEVER multiple rows or a 2D grid. ` +
      `Same design, colors and size in every pose; nothing underneath it, no ground line, no shadow, no landscape, no sky, no other objects. ` +
      `Flat solid magenta background (#FF00FF), chunky pixels, dark outline, 16-bit platformer style, no text, poses far apart with wide empty magenta gaps between them, poses must NOT touch or overlap each other`;
  }
  if (form.held) {
    return `Pixel art game held item icon sheet containing ONLY the isolated object ${cleanSubject} by itself (side view, pointing right): exactly 4 variants of that single item in one row, nothing else in the image, no landscape, no ground, no sky. ONLY the standalone weapon or item itself — NO character, NO person, NO warrior, NO ninja, NO hands holding it, NO body, NO head, NO face, NO eyes, NO arms, NO legs, NO animation poses. Flat solid magenta background (#FF00FF), chunky pixels, dark outline, 16-bit platformer style, no text, variants far apart with wide empty magenta gaps between them, variants must NOT touch or overlap each other`;
  }
  if (form.scenery) {
    return `Pixel art game scenery sprite sheet containing ONLY ${cleanSubject}: exactly 4 variants of that single object in one row, nothing else in the image, no landscape, no ground, no sky, no other objects or props. Each variant is the same object with a slightly different shape or size. NOT a character, no face, no eyes, no mouth, no arms, no legs, no animation poses. Flat solid magenta background (#FF00FF), chunky pixels, dark outline, 16-bit platformer style, no text, variants far apart with wide empty magenta gaps between them, bottoms aligned on the same baseline, variants must NOT touch or overlap each other`;
  }
  if (form.flying) {
    return `Pixel art game sprite sheet of ${cleanSubject} in flight for a 2D side-scrolling platformer, side view strictly facing right, AIRBORNE: ` +
      `exactly 4 airborne flight action poses in 1 single horizontal row from left to right: hovering idle facing right, gliding forward with wings spread flat facing right, strong forward wing-flap stroke pushed down facing right, diving swooping down facing right. ` +
      `Orientation: all poses MUST face right in side profile — NEVER face backwards or away from the camera (no rear view), NEVER front-facing, no top-down angles, NEVER multiple rows or a 2D grid. ` +
      `The ${cleanSubject} is off the ground in every pose — ` +
      `feet and paws lifted, wings or arms spread, cape or tail streaming behind it, nothing underneath to stand on, no ground line, no shadow, no landscape, no sky. ` +
      `Flat solid magenta background (#FF00FF), chunky pixels, dark outline, 16-bit platformer style, no text, poses far apart with wide empty magenta gaps between them, poses must NOT touch or overlap each other`;
  }
  return `Pixel art game sprite sheet of ${cleanSubject} for a 2D side-scrolling platformer, side view strictly facing right: ` +
    `exactly 4 action poses in 1 single horizontal row from left to right: idle standing facing right, running forward stride with LEFT leg reaching forward and right leg trailing (low contact step), running forward stride with RIGHT knee driving up high and left foot pushing off ground (lifted passing step) — the two stride poses MUST have opposite leading limbs and distinct silhouettes, jumping mid-air leap pose facing right. ` +
    `Orientation: every pose MUST face right in side profile — NEVER face backwards or away from the camera (no rear view, no back of character facing away), NEVER front-facing (no RPG turnaround), no top-down angles, NEVER multiple rows or a 2D grid. ` +
    `Flat solid magenta background (#FF00FF), chunky pixels, dark outline, 16-bit platformer style, no text, poses far apart with wide empty magenta gaps between them, poses must NOT touch or overlap each other`;
}

/** The sheet prompt generateSubjectArt sends for this subject; the receipt (ADR 0065) shows the same string. */
export function subjectArtPrompt(cleanSubject: string, key: string, scenery = false, flying = false, skin = false): string {
  if (skin) return spritePrompt(cleanSubject, { held: false, scenery: false, skin: true });
  // The ontology names the art form (ADR 0031); the router's `scenery` hint still wins.
  const plan = artPlanFor(key);
  const heldItem = isHeldItemType(cleanSubject) || plan === "held-item";
  const effectiveScenery = scenery || heldItem || plan === "scenery" || isScenerySubject(cleanSubject);
  return spritePrompt(cleanSubject, { held: heldItem, scenery: effectiveScenery, flying: flying && !heldItem && !effectiveScenery });
}

/**
 * Generate sprite-sheet art for a subject, or reuse the cached file.
 * Returns the public URL, or null on any failure. Never throws.
 */
export async function generateSubjectArt(subject: string, keyRaw: string, scenery = false, flying = false, skin = false): Promise<string | null> {
  try {
    // A flying subject gets its own sheet ("cat-fly"), so a cached walking cat can never
    // stand in for a flying one (ADR 0053).
    const key = artKeyForType(keyRaw, skin ? "skin" : flying && !scenery ? "fly" : undefined);
    if (!key) {
      clearCachedArt(keyRaw);
      return null;
    }
    const cached = artCache.get(key);
    if (cached) return cached;
    const url = artUrlForKey(key);
    const file = artFilePath(key);
    // Disk cache: still attach the URL without regenerating.
    if (existsSync(file)) {
      artCache.set(key, url);
      return url;
    }
    const apiKey = loadEnv();
    if (!apiKey) return null;
    const cleanSubject = subject.trim() || key;
    const prompt = subjectArtPrompt(cleanSubject, key, scenery, flying, skin);
    const t0 = performance.now();
    // Image prompts take the same kid-safe screen (ADR 0044): a declined subject simply gets
    // no AI art, and the mod still loads with its code-drawn shape.
    const screen = await screenArtPrompt(prompt);
    if (screen.unsafe) {
      console.log(`[safety] art declined category=${screen.category ?? "other"} by=${screen.by} in ${screen.ms} ms`);
      return null;
    }
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

/** Most generated sprite sheets one build may order: the player's skin plus one creature (ADR 0066). The owner sets this number. */
export const MAX_ART_PER_BUILD = 2;

/** The skin a mod asks for with api.setScene({ playerSkin: "spaceship" }), or null. */
export function pickSkin(source: string): string | null {
  const m = /playerSkin\s*:\s*["']([^"']{1,40})["']/.exec(source);
  const skin = m ? sanitizeArtKey(m[1]) : "";
  return skin && artKeyForType(skin, "skin") ? skin : null;
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
export function artKeyForType(type: string, variant?: string): string {
  const lower = type.toLowerCase().trim();
  if (!lower || isSkippedType(lower)) return "";
  const parts = lower.split("-").filter(Boolean);
  const base = parts.length > 1 ? (parts[parts.length - 1] ?? lower) : lower;
  const key = sanitizeArtKey(base || lower);
  if (!key || isSkippedType(key)) return "";
  // A pose variant (e.g. "fly") gets its own sheet, so a cached walking cat never stands in
  // for a flying one (ADR 0053).
  return variant ? sanitizeArtKey(`${key}-${variant}`) : key;
}
