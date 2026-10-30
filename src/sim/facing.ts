// Which way a creature's sprite looks (ADR 0071). Pure and deterministic.
// The engine owns facing, so a creature that is pinned (against a wall, or parked on a
// narrow drawn ledge with a drop on both sides) can no longer flip left-right EVERY frame
// while its own code keeps pushing one way and the engine keeps pushing back: the T-Rex pet
// "spun" in place. A flip now costs a few ticks of rest, so jitter never reaches the pixels
// while a real turn still reads at once.
import type { Entity } from "../contract";

/** Ticks a sprite must hold still before it may flip again. */
export const FACING_HOLD_TICKS = 6;

/** Where and when each creature last flipped, keyed by entity id (owner drops the entry on despawn). */
export type FacingClock = Map<number, number>;

/**
 * Point `e`'s sprite along `dir` (-1 or 1) at sim `tick`. Returns true when it actually flipped.
 * A deliberate turn (the engine turning a creature at a wall) lands on the first call, because
 * turns are always more than FACING_HOLD_TICKS apart; frame-by-frame wobble does not.
 */
export function faceToward(e: Entity, dir: number, clock: FacingClock, tick: number): boolean {
  const want: 1 | -1 = dir < 0 ? -1 : 1;
  if (e.facing === want) return false;
  const last = clock.get(e.id);
  if (last !== undefined && tick - last < FACING_HOLD_TICKS) return false;
  e.facing = want;
  clock.set(e.id, tick);
  return true;
}
