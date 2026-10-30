// Player hurt feedback, engine side (bead r8n): a short invulnerability window plus a small,
// visible knockback. Pure and deterministic: tick counts and entity order only, no clock and
// no Math.random, so a headless verifier run and the browser produce the same world.
//
// Why the engine owns it: a hit on the player was only a health subtraction. Every player mod
// (the built-in one and every Wonder build) writes `p.vx` from the input each tick, so a
// knockback written by a mod would be erased by the next mod; the engine adds its impulse after
// the mods have run (see World's mover loop), and the window itself is engine state so a mod
// can neither forget nor double it. The client reads `data.invulnUntil` to blink the player.
import type { Entity } from "../contract";

/** Ticks of invulnerability after a hit lands: 0.6 s at 60 Hz. */
export const HURT_INVULN_TICKS = 36;
/** Ticks a knockback pushes for. */
export const KNOCKBACK_TICKS = 8;
/** Knockback speed (px/s) on the first tick; it fades to nothing over KNOCKBACK_TICKS. */
export const KNOCKBACK_SPEED = 340;
/** Upward pop (px/s) on the tick the hit lands, so the hit lifts the player off the ground. */
export const KNOCKBACK_LIFT = 205;
/** How far away the thing that hurt the player can be and still set the knockback direction (px). */
export const HURT_SOURCE_RANGE = 260;

/** A knockback in flight: a horizontal speed that fades, a one-tick lift, and ticks left. */
export interface Knockback {
  vx: number;
  vy: number;
  ticks: number;
}

/** True while `e` is inside its invulnerability window (and so takes no damage at all). */
export function invulnerable(e: Entity, tick: number): boolean {
  const until = e.data.invulnUntil;
  return typeof until === "number" && tick < until;
}

/** Types that count as "the thing that hit me" for the knockback direction. */
function hurtsPlayer(e: Entity): boolean {
  if (e.data.hostile === true || e.data.enemy === true) return true;
  if (typeof e.data.damage === "number") return true;
  return /^(enemy|walker|turtle|boss|monster|zombie|goblin|slime|spider|bat|skeleton|demon|orc|bullet|projectile|laser|arrow|fireball|plasma|shot)/i.test(e.type);
}

/**
 * Which way (1 = right, -1 = left) the player is knocked: away from the nearest thing that
 * could have hurt them, or backwards when nothing is close enough to blame.
 * Deterministic: the entity list order breaks ties.
 */
export function knockbackDirection(player: Pick<Entity, "x" | "y" | "w" | "h" | "facing">, entities: readonly Entity[]): 1 | -1 {
  const px = player.x + player.w / 2;
  const py = player.y + player.h / 2;
  let best: Entity | undefined;
  let bestD = HURT_SOURCE_RANGE * HURT_SOURCE_RANGE;
  for (const e of entities) {
    if (e === player || e.dead || e.type === "player" || !hurtsPlayer(e)) continue;
    const dx = e.x + e.w / 2 - px;
    const dy = e.y + e.h / 2 - py;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = e; }
  }
  // Only a source that is actually beside the player sets the direction; one directly above or
  // below cannot (there is no sideways answer), so the hit then pushes the way they are not facing.
  if (best && Math.abs(best.x + best.w / 2 - px) > 1) return best.x + best.w / 2 > px ? -1 : 1;
  return player.facing === 1 ? -1 : 1;
}

/** The velocity a knockback adds this tick. `vy` only fires on the launch tick, so it cannot fight gravity. */
export function knockbackVelocity(k: Knockback): { vx: number; vy: number } {
  const fade = Math.max(0, k.ticks) / KNOCKBACK_TICKS;
  return { vx: k.vx * fade, vy: k.ticks === KNOCKBACK_TICKS ? k.vy : 0 };
}

/** A fresh knockback for a hit that landed: away from `entities`, with a lift. */
export function launchKnockback(player: Pick<Entity, "x" | "y" | "w" | "h" | "facing">, entities: readonly Entity[]): Knockback {
  const dir = knockbackDirection(player, entities);
  return { vx: dir * KNOCKBACK_SPEED, vy: -KNOCKBACK_LIFT, ticks: KNOCKBACK_TICKS };
}
