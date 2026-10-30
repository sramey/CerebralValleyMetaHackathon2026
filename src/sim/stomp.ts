// Stomp: landing on a hostile's head finishes it and bounces the player (ADR 0071).
// Before this the rule lived inside the wave mod, so only its own swarm answered to a jump:
// a hand-drawn or Wonder-built walker hurt you from below and could not be jumped on at all.
// The engine owns it now, so every hostile — drawn on the sketch pad, spawned by a wave, or
// built by a mod — answers to the same landing. Pure and deterministic: no clock, no RNG.
import type { Entity } from "../contract";
import { isHostileEnemy } from "./combat";

export const STOMP = {
  /** Upward speed the player leaves with (px/s). Softer than a jump (720) so a chain of stomps stays controllable. */
  bounce: 380,
  /** Damage one landing deals: enough to finish an ordinary 100 hp hostile, a boss shrugs it off. */
  damage: 100,
  /** How far the player's feet may be into the hostile's head for the landing to count (px). */
  sink: 22,
} as const;

/**
 * True when `player` is falling onto `e`'s head: box overlap with the feet in the hostile's
 * top band. Anything friendlier than a hostile (a pet, an ally, a chicken, scenery, a pickup)
 * is never a target, and a walk-in from the side is never a stomp.
 */
export function stompableBy(player: Entity, e: Entity): boolean {
  if (e === player || e.dead || e.despawned || e.solid) return false;
  if (!isHostileEnemy(e)) return false;
  if (!(player.vy > 0)) return false; // only a landing from above
  const feet = player.y + player.h;
  if (feet <= e.y) return false; // not touching it yet
  if (feet > e.y + Math.min(STOMP.sink, e.h / 2)) return false; // too deep to be a head landing
  return player.x < e.x + e.w && player.x + player.w > e.x;
}

/** Damage this landing deals; a hostile may tune it with data.stompDamage. */
export function stompDamage(e: Entity): number {
  const d = e.data.stompDamage;
  return typeof d === "number" && Number.isFinite(d) && d > 0 ? d : STOMP.damage;
}

/** Upward speed the player leaves with; a hostile may tune it with data.stompBounce. */
export function stompBounce(e: Entity): number {
  const b = e.data.stompBounce;
  return typeof b === "number" && Number.isFinite(b) && b > 0 ? Math.min(b, 900) : STOMP.bounce;
}
