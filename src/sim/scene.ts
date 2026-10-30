import type { Entity, SceneOptions } from "../contract";
import { entityKind, isHeldItemType } from "../ontology";

/** Backdrops the client knows how to paint (ADR 0066). Anything else is ignored. */
export const BACKDROPS: readonly string[] = ["space"];

/** Skin and backdrop names are short lowercase words, like art keys. */
export function cleanSceneWord(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return s || undefined;
}

/** Static level geometry: ground, platforms, walls, towers, stairs. */
export function isSceneTerrain(e: Entity): boolean {
  return e.type !== "player" && entityKind(e) === "terrain";
}

/** Platformer dressing: trees, lamp posts, houses, and sky/parallax layers. Never gear, pickups or creatures. */
export function isSceneScenery(e: Entity): boolean {
  if (e.type === "player" || e.solid) return false;
  if (e.data.pickup === true || e.data.heldByPlayer === true || e.data.collectible !== undefined && e.data.collectible !== false) return false;
  const t = e.type.toLowerCase();
  if (/sky|background|cloud|cumulus/.test(t)) return true;
  if (typeof e.data.parallax === "number" || typeof e.data.scrollFactor === "number" || typeof e.data.depth === "number") return true;
  return entityKind(e) === "prop" && !isHeldItemType(e.type);
}

/** One mod's claim on the scene. The engine undoes it, in stack order, when the mod unloads (ADR 0066). */
export interface SceneRec {
  owner: string;
  /** Entities taken out of the world; they live here, so nothing (collision, targeting, raycast, pickups, camera, drawing) can see them. */
  stash: Entity[];
  backdrop?: string;
  skin?: string;
  /** The player's gravity before this scene, handed down the stack so undo order never matters. */
  prevGravity?: number;
}

export function sceneOptionsOk(o: SceneOptions | undefined): SceneOptions {
  return o && typeof o === "object" ? o : {};
}
