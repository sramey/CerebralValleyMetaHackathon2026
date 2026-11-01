// Photo objects get a role and a real name (ADR 0082). Pure, shared by the client (which picks the
// role and registers the cut-out texture under the slug) and the server (which validates both and
// generates the mod). No DOM, no wall clock.

export const PHOTO_ROLES = ["prop", "collectible", "enemy", "friendly"] as const;
export type PhotoRole = (typeof PHOTO_ROLES)[number];

/** Anything that is not one of the four roles is a prop: today's behaviour. */
export function parsePhotoRole(v: unknown): PhotoRole {
  return typeof v === "string" && (PHOTO_ROLES as readonly string[]).includes(v) ? (v as PhotoRole) : "prop";
}

// The engine reads some behaviour off a type NAME alone (src/sim/combat.ts PET_NAME_RE, src/sim/world.ts
// enemyName). A photo called "cat" must not become a pet by accident, and one called "zombie" must not
// hurt unless the player chose Enemy, so those names get a neutral "my-" prefix for the other roles.
const PET_NAME = /^(pet|pets|companion|ally|friend|friendly|buddy|pal|puppy|kitten|dog|cat|chicken|mount|steed|npc)\b/i;
const ENEMY_NAME = /^(enemy|walker|turtle|boss|monster|zombie|goblin|slime|spider|bat|skeleton|demon|orc)$/i;
const SLUG_OK = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** "Learning toy!" -> "learning-toy". Never empty, never longer than 24 chars. */
export function photoSlug(name: string, role: PhotoRole = "prop"): string {
  let s = String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/g, "");
  if (!s) s = "object";
  if ((role !== "friendly" && PET_NAME.test(s)) || (role !== "enemy" && ENEMY_NAME.test(s))) s = `my-${s}`;
  return s;
}

/** A slug that came over the wire: kept only if it is a plain short slug, else null (the key is used). */
export function cleanSlug(v: unknown): string | null {
  return typeof v === "string" && v.length <= 32 && SLUG_OK.test(v) ? v : null;
}

/** The spoken name: what the player (or Spark) called it, trimmed and capped. */
export function photoName(prompt: unknown): string {
  const t = typeof prompt === "string" ? prompt.trim().replace(/\s+/g, " ") : "";
  return (t || "object").slice(0, 40);
}

/** The first free slug: `base`, then `base-2`, `base-3`... `taken` answers "is this type already in use?". */
export function freeSlug(base: string, taken: (slug: string) => boolean): string {
  if (!taken(base)) return base;
  let i = 2;
  while (i < 1000 && taken(`${base.slice(0, 26)}-${i}`)) i++;
  return `${base.slice(0, 26)}-${i}`;
}
