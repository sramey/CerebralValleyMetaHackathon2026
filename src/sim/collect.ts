// Engine-owned collectibles (ADR 0055, bead ees). Dropped coins used to be
// uncollectible until every mod hand-rolled its own contact test, its own despawn,
// its own burst and its own score counter, so one world grew three HUDs that each
// counted part of the truth. Now a mod only TAGS: any entity carrying
// `data.collectible` is collected by the engine the moment the player's pickup reach
// (reach.ts, ADR 0039) touches it, and the value lands in ONE shared score HUD the
// engine owns. Pure and deterministic: boxes and numbers in, world mutations out. No
// DOM, no wall clock, no Math.random (particles come from the seeded world rng).
import type { Entity, HudDef, HudWidget } from "../contract";
import { touches } from "./reach";

/** The HUD id every tagged pickup counts into unless it names its own. */
export const SCORE_HUD = "score";
/** Who owns the score widget. Never a mod, so an undo cannot delete the banked total. */
export const ENGINE_OWNER = "engine";
/** Particles per pickup. */
export const COLLECT_BURST = 12;
/** Burst color when the pickup does not carry a usable one. */
export const COLLECT_COLOR = 0xffd94d;
/** A single pickup cannot be worth more than this (a mod typo must not wreck the HUD). */
const MAX_VALUE = 1000;
const MAX_HUD_ID = 24;

/** What a tagged entity is worth and where it counts. */
export interface CollectibleSpec {
  /** Points added to the HUD on touch. */
  value: number;
  /** Which shared HUD widget the value lands in. */
  hud: string;
}

/** The host the collect pass runs against: the World in the game, a test double in tests. */
export interface CollectHost {
  entities: Entity[];
  hud: Map<string, HudWidget>;
  /** Engine running total per HUD id: banked pickups outlive the mod that dropped them. */
  collected: Map<string, number>;
  setHud(owner: string, id: string, def: HudDef): void;
  despawn(id: number): void;
  burst(x: number, y: number, color: number, n?: number): void;
}

/** A positive, finite, capped number, or undefined. */
function positive(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(v, MAX_VALUE) : undefined;
}

/** A wire-safe HUD id from mod data ("Gems!" -> "gems"), or undefined. */
function hudId(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const id = v.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, MAX_HUD_ID);
  return id.length > 0 ? id : undefined;
}

/**
 * The pickup a tagged entity carries, or undefined when it is not a pickup.
 * `data.collectible: true` is worth 1 (or `data.value`), a number is that many points,
 * a string is a HUD id (so a gem can feed its own counter). `data.collectibleHud`
 * renames the counter for the boolean and number forms.
 */
export function collectibleOf(e: Entity): CollectibleSpec | undefined {
  const data = e.data;
  if (!data) return undefined;
  const tag = data.collectible;
  if (tag === undefined || tag === false || tag === 0) return undefined;
  if (typeof tag === "string" && tag.trim() === "") return undefined;
  const hud = hudId(data.collectibleHud) ?? hudId(tag) ?? SCORE_HUD;
  const value = (typeof tag === "number" ? positive(tag) : undefined) ?? positive(data.value) ?? 1;
  return { value, hud };
}

/** The widget the engine writes for a shared counter. */
function hudDefFor(id: string, value: number): HudDef {
  const shared = id === SCORE_HUD;
  const words = id.replace(/[-_]+/g, " ");
  return {
    kind: "stat",
    label: shared ? "Coins" : words.charAt(0).toUpperCase() + words.slice(1),
    icon: shared ? "🪙" : "✨",
    value,
    position: "top-left",
  };
}

/** Rewrite one shared counter from the engine's running total. */
function writeHud(w: CollectHost, id: string): void {
  w.setHud(ENGINE_OWNER, id, hudDefFor(id, w.collected.get(id) ?? 0));
}

/**
 * Collect every tagged pickup the player is touching, right now, once.
 * Returns how many were taken this tick (0 on a world with no player).
 *
 * Mod tick handlers run BEFORE physics in World.step, so a mod that already collects
 * its drops by hand has despawned them by the time this pass runs: nothing is counted
 * twice. `data.collected === true` is honoured for a mod that keeps the entity around.
 */
export function collectPickups(w: CollectHost, player?: Entity): number {
  // A banked counter whose widget vanished (the mod that last wrote that id was undone)
  // comes back with its total: the score belongs to the engine, not to a mod's undo.
  for (const [id, total] of w.collected) if (total > 0 && !w.hud.has(id)) writeHud(w, id);
  const p = player ?? w.entities.find((e) => e.type === "player");
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return 0;
  // One cheap pass over the world, allocating only when something is actually tagged:
  // most worlds have no collectibles, and the step budget is 2 ms (AGENTS.md).
  let tagged: Entity[] | undefined;
  for (const e of w.entities) {
    if (e.type === "player" || !e.data || e.data.collected === true) continue;
    if (!collectibleOf(e)) continue;
    (tagged ??= []).push(e);
  }
  if (!tagged) return 0;
  let taken = 0;
  for (const e of tagged) {
    const spec = collectibleOf(e);
    if (!spec) continue;
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) continue;
    if (!touches(p, e)) continue;
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    w.despawn(e.id);
    w.collected.set(spec.hud, (w.collected.get(spec.hud) ?? 0) + spec.value);
    w.burst(cx, cy, e.color || COLLECT_COLOR, COLLECT_BURST);
    writeHud(w, spec.hud);
    taken++;
  }
  return taken;
}
