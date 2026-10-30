// Landing restitution (ADR 0053, bead 2yt). A coin a flying creature drops used to be a
// dead zero-gravity stone: mods either froze it mid-air or hand-rolled their own bounce.
// The engine owns the settle: `data.bounce` (0..0.9) on a falling entity makes the landing
// in the Y collision elastic and decaying, so a drop bounces a few times and stops.
// Pure and deterministic: velocity in, velocity out.
import type { Entity } from "../contract";

/** Fastest fraction of energy a landing may keep. 0.9 is squishy but still settles. */
export const MAX_BOUNCE = 0.9;
/** Below this downward speed a landing is a settle, not a bounce (px/s). */
export const MIN_BOUNCE_SPEED = 120;

/** The upward speed a landing keeps, or 0 when the entity just settles (the old behavior). */
export function bounceVelocity(downwardSpeed: number, bounce: unknown): number {
  const r = typeof bounce === "number" && Number.isFinite(bounce) ? Math.min(Math.max(bounce, 0), MAX_BOUNCE) : 0;
  if (r <= 0 || !(downwardSpeed > MIN_BOUNCE_SPEED)) return 0;
  return -downwardSpeed * r;
}

/** The velocity an entity leaves a landing with: bounce if it asked for one, else a stop. */
export function landingVelocity(e: Pick<Entity, "data">, downwardSpeed: number): number {
  return bounceVelocity(downwardSpeed, e.data.bounce);
}
