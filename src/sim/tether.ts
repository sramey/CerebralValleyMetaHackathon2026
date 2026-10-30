// Grappling-hook helpers (ADR 0050): pointer aim, a solid raycast, and a smooth winch.
// Pure and deterministic: no clock, no Math.random. Mods reach them through api.aim / raycast / winch.
import { SIM } from "../contract";
import type { Entity, InputState } from "../contract";

const STEP = 4; // px per march step; solids are at least ~10 px thick so none is skipped

/** Unit vector from `from`'s centre toward the pointer; keyboard-only falls back to facing, tilted up while jump is held. */
export function aimFrom(from: Entity, input: Readonly<InputState>): { x: number; y: number } {
  const cx = from.x + from.w / 2, cy = from.y + from.h / 2;
  let dx: number, dy: number;
  if (typeof input.pointerX === "number" && typeof input.pointerY === "number") {
    dx = input.pointerX - cx;
    dy = input.pointerY - cy;
  } else {
    dx = from.facing;
    dy = input.jump ? -1 : -0.35;
  }
  const len = Math.hypot(dx, dy);
  return len < 1e-6 ? { x: from.facing, y: -0.35 } : { x: dx / len, y: dy / len };
}

/** First solid point along a ray, or undefined. `ignore` and the player are skipped. */
export function raycastSolid(
  entities: readonly Entity[], x: number, y: number, dx: number, dy: number, maxDist: number, ignore?: Entity,
): { x: number; y: number; entity: Entity } | undefined {
  const len = Math.hypot(dx, dy);
  if (len < 1e-6 || !(maxDist > 0)) return undefined;
  const ux = dx / len, uy = dy / len;
  const solids = entities.filter((e) => e.solid && e.type !== "player" && e !== ignore);
  for (let d = 0; d <= maxDist; d += STEP) {
    const px = x + ux * d, py = y + uy * d;
    for (const s of solids) {
      if (px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.h) return { x: px, y: py, entity: s };
    }
  }
  return undefined;
}

/** Reel `e` toward (ax,ay): velocity eases toward `speed` along the line, gravity is cancelled for the tick. Returns the distance left. */
export function winchToward(e: Entity, ax: number, ay: number, speed: number): number {
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  const dx = ax - cx, dy = ay - cy;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return 0;
  const s = Math.min(speed, dist * 8); // slow into the anchor instead of overshooting
  const ease = 0.25;
  e.vy -= SIM.gravity * e.gravityScale * SIM.dt; // the step adds gravity after mods run; take it back so the climb is smooth
  e.vx += (dx / dist * s - e.vx) * ease;
  e.vy += (dy / dist * s - e.vy) * ease;
  return dist;
}
