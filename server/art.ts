// On-demand subject art: generate a sprite sheet with Muse Image the first
// time a mod introduces a new drawable subject, then reuse the cached file.
// Never throws: every failure path returns null (the mod still loads, just
// without art). Files land under public/art/gen/<key>.webp served at
// /art/gen/<key>.webp.
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { artPlanFor, canUseSpriteSheet, detectMoodCommand, entityKind, extractSpawnedEntities, isHeldItemType, isLandmarkSubject } from "../src/ontology";
import { skinSheetKey } from "../src/sim/scene";
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
    return artCachedUrlByKey(key);
  } catch {
    return null;
  }
}

/** The cached public URL for an already-computed art key, or null. */
export function artCachedUrlByKey(key: string): string | null {
  try {
    if (!key) return null;
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
export function spritePrompt(cleanSubject: string, form: { held: boolean; scenery: boolean; flying?: boolean; skin?: "flight" | "ground"; landmark?: boolean }): string {
  if (form.landmark) {
    // A landmark is ONE picture of the whole subject (ADR 0080), not a pose sheet or a row of variants.
    return `Pixel art game landmark: ONE single ${cleanSubject}, the whole subject complete and centered, filling most of the frame, side-on view like a 2D side-scrolling platformer backdrop. Exactly one ${cleanSubject} in the image, NOT a sheet, NOT several variants, NOT a row, NOT a grid, no animation poses. Nothing else: no character, no creature, no ground line, no landscape, no sky, no other objects, no text. Flat solid magenta background (#FF00FF), chunky pixels, thin dark outline, 16-bit platformer style, the base of the ${cleanSubject} flat along the bottom`;
  }
  if (form.skin === "ground") {
    // A plain character swap (ADR 0083): the same walking pose sheet any platformer creature gets, so the player walks, runs and jumps.
    return spritePrompt(`${cleanSubject}, the player's own character`, { held: false, scenery: false }) + `, all feet resting on one flat ground line in the standing and running poses`;
  }
  if (form.skin === "flight") {
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
export function subjectArtPrompt(cleanSubject: string, key: string, scenery = false, flying = false, skin: false | "flight" | "ground" = false): string {
  if (skin) return spritePrompt(cleanSubject, { held: false, scenery: false, skin });
  // The ontology names the art form (ADR 0031); the router's `scenery` hint still wins.
  if (isLandmarkSubject(cleanSubject) || isLandmarkSubject(key)) return spritePrompt(cleanSubject, { held: false, scenery: true, landmark: true });
  const plan = artPlanFor(key);
  const heldItem = isHeldItemType(cleanSubject) || plan === "held-item";
  const effectiveScenery = scenery || heldItem || plan === "scenery" || isScenerySubject(cleanSubject);
  return spritePrompt(cleanSubject, { held: heldItem, scenery: effectiveScenery, flying: flying && !heldItem && !effectiveScenery });
}

/**
 * Generate sprite-sheet art for a subject, or reuse the cached file.
 * Returns the public URL, or null on any failure. Never throws.
 */
export async function generateSubjectArt(subject: string, keyRaw: string, scenery = false, flying = false, skin: false | "flight" | "ground" = false): Promise<string | null> {
  try {
    // A flying subject gets its own sheet ("cat-fly"), so a cached walking cat can never
    // stand in for a flying one (ADR 0053).
    // A skin carries its form in the key (ADR 0083): a walking elephant and a flying one are different sheets.
    const key = skin ? (sanitizeArtKey(keyRaw) ? skinSheetKey(sanitizeArtKey(keyRaw), skin === "flight") : "") : artKeyForType(keyRaw, flying && !scenery ? "fly" : undefined);
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
 * Every drawable creature or prop type a mod source spawns, in first-seen order.
 * Terrain and static solid geometry, effects, projectiles and shapes are never
 * included, and neither is the player's own sheet (the ontology decides, ADR 0031).
 */
export function artTypesForSource(source: string): string[] {
  const types: string[] = [];
  for (const s of extractSpawnedEntities(source)) {
    if (s.solid && s.gravityScale === 0) continue;
    if (s.kind !== "creature" && s.kind !== "prop") continue;
    if (isSkippedType(s.type)) continue;
    if (!artKeyForType(s.type)) continue;
    types.push(s.type);
  }
  return types;
}

/**
 * The first type a mod spawns that needs art, or null when nothing does.
 * Kept for callers that only need one (the look/receipt); a build now orders art
 * for every type (planArtOrders).
 */
export function pickArtType(source: string): string | null {
  return artTypesForSource(source)[0] ?? null;
}

/** One sprite sheet a build wants: which subject, under which cache key. */
export interface ArtOrder {
  /** Entity type exactly as the mod spawns it. */
  type: string;
  /** Human subject phrase for the sheet prompt. */
  subject: string;
  /** Art cache key (also the dedupe key; a flier's is "<base>-fly"). */
  key: string;
  /** Scenery/held-item art instead of animated character poses. */
  scenery: boolean;
  /** Airborne poses instead of the walk/run cycle (ADR 0053). */
  flying: boolean;
  /** Pictures in the sheet Muse Image is asked for: 1 for a landmark (ADR 0080), 4 otherwise. */
  frames: 1 | 4;
}

/**
 * Every sheet a build should order, deduped by art key (so "dragon" and
 * "fire-dragon" share one). `visual` is the router's hint for the whole command;
 * the ontology still wins per type (a chest is scenery even in a creature build).
 * When modifying an existing mod without an art change request, existing art
 * keys (like flying sheets) are preserved.
 */
export function planArtOrders(
  source: string,
  command: string,
  visual?: string,
  existingArts?: readonly { key: string; url?: string }[],
): ArtOrder[] {
  const orders: ArtOrder[] = [];
  const seen = new Set<string>();
  const isArtChange = isArtChangeRequest(command);
  for (const type of artTypesForSource(source)) {
    const subject = deriveSubjectForType(command, type);
    const landmark = isLandmarkSubject(type) || isLandmarkSubject(subject);
    const scenery =
      landmark ||
      visual === "prop" ||
      isHeldItemType(subject) ||
      isHeldItemType(type) ||
      entityKind(type) === "prop" ||
      (visual !== "creature" && (isScenerySubject(subject) || isScenerySubject(type)));
    // A flying request gets airborne poses, not the walk cycle (ADR 0053).
    // When modifying a mod without requesting an art change, preserve existing flying status or art key.
    const existing = !isArtChange && existingArts ? existingArts.find((a) => {
      const base = a.key.toLowerCase().replace(/-fly$/, "");
      const t = type.toLowerCase();
      return t === base || t.includes(base) || base.includes(t);
    }) : undefined;
    const flying = (existing?.key.endsWith("-fly") ?? false) || (isFlyingRequest(`${command} ${subject}`, type) && !scenery);
    const key = existing?.key ?? artKeyForType(type, flying ? "fly" : undefined);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    orders.push({ type, subject, key, scenery, flying, frames: landmark ? 1 : 4 });
  }
  return orders;
}

/**
 * True when a command explicitly asks to change or redraw the visual appearance / art / skin of an entity,
 * rather than modifying gameplay/abilities/behavior.
 */
export function isArtChangeRequest(command: string): boolean {
  const c = command.toLowerCase();
  return /\b(reskin|re-skin|retheme|re-theme|redraw|change\s+(?:the\s+)?(?:\w+\s+)?(?:art|look|skin|sprite|color|appearance)|turn\s+(?:it|the\s+\w+)\s+into\s+a\b|make\s+(?:it|the\s+\w+)\s+look\s+like|paint\s+it)\b/i.test(c);
}

/** The skin a mod asks for with api.setScene({ playerSkin: "spaceship" }), or null. */
export function pickSkin(source: string): string | null {
  const m = /playerSkin\s*:\s*["']([^"']{1,40})["']/.exec(source);
  // The player is always drawn from art, so the whole name is the subject: "bowling-ball" must not
  // shrink to "ball" and be refused as a code-drawn shape (the player then silently stayed a ninja).
  const skin = m ? sanitizeArtKey(m[1]) : "";
  return skin || null;
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

const escapeWord = (w: string): string => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The subject phrase for one spawned type: the command clause that names it
 * ("add a dragon, a knight and a treasure chest" -> "treasure chest" for the
 * chest), else the type itself. Never borrows another clause's subject, so a
 * multi-part build gets one honest prompt per thing.
 */
export function deriveSubjectForType(command: string, type: string): string {
  const words = type.toLowerCase().replace(/[-_]+/g, " ").split(/\s+/).filter(Boolean);
  if (words.length > 0 && command.trim()) {
    const clauses = command.split(/\s*[,;]\s*|\s+and\s+/i).map((c) => c.trim()).filter(Boolean);
    for (const clause of clauses) {
      const lower = clause.toLowerCase();
      const named = words.every((w) => new RegExp(`(?:^|[^a-z0-9])${escapeWord(w)}(?:s|es)?(?:$|[^a-z0-9])`).test(lower));
      if (!named) continue;
      const subject = deriveSubject(clause, type);
      if (subject) return subject;
    }
  }
  const fallback = type.replace(/[-_]+/g, " ").trim();
  return fallback || type;
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
  const last = parts[parts.length - 1];
  const base = parts.length > 1 ? (last === "player" ? lower : (last ?? lower)) : lower;
  const key = sanitizeArtKey(base || lower);
  if (!key || isSkippedType(key)) return "";
  // A pose variant (e.g. "fly") gets its own sheet, so a cached walking cat never stands in
  // for a flying one (ADR 0053).
  return variant ? sanitizeArtKey(`${key}-${variant}`) : key;
}
