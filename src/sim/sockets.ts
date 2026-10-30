// Gear sockets measured on the DRAWN body, not the hitbox (ADR 0061).
// The client draws the player 56 px tall (scaled by h/34) and any other character 1.5x its hitbox,
// both feet-anchored. Gear must follow what the eye sees, so the numbers live here and the client
// imports them. Pure: no DOM, no clock, no randomness.
import type { Entity } from "../contract";

export type Socket = "hand" | "back" | "head" | "feet" | "belt";
export const SOCKETS: readonly Socket[] = ["hand", "back", "head", "feet", "belt"];

/** The sprite sits this far below the hitbox bottom (client: e.y + e.h + 2). */
const FEET_DROP = 2;
/** Gear may sit at most this far outside the drawn body. */
const MARGIN = 4;
/** A nudge from Wonder (offsetX/offsetY) moves gear at most this fraction of the drawn height. */
const NUDGE = 0.12;
/** A creature's head sits this fraction of its width ahead of the body centre. */
const HEAD_FORWARD = 0.22;
const SCALE_MIN = 0.25;
const SCALE_MAX = 8;

export interface VisualBox { x: number; y: number; w: number; h: number; bottom: number }

/** Drawn height of a character with art: the player 56 * (h / 34), anything else 1.5x its hitbox (34..630). */
export function visualHeight(e: Pick<Entity, "type" | "h">, hasArt = true): number {
  if (!hasArt) return e.h; // code-drawn: the client draws the hitbox itself
  return e.type === "player" ? 56 * (e.h / 34) : Math.min(630, Math.max(34, e.h * 1.5));
}

/** The box the eye sees: hitbox width, drawn height, feet anchored a hair below the hitbox. */
export function visualBox(e: Pick<Entity, "type" | "x" | "y" | "w" | "h">, hasArt = true): VisualBox {
  const h = visualHeight(e, hasArt);
  const bottom = e.y + e.h + FEET_DROP;
  return { x: e.x, y: bottom - h, w: e.w, h, bottom };
}

/** The socket a gear type belongs in. */
export function socketForType(type: string): Socket {
  if (/^(jetpack|backpack|cape|wings?)$/i.test(type)) return "back";
  if (/^(hat|crown|helmet|halo)$/i.test(type)) return "head";
  if (/^(boots?|skates?)$/i.test(type)) return "feet";
  return "hand"; // gun, blaster, sword, wand, torch, shield, bow...
}

/** Wonder's data.socket wins only when it names a real socket. */
export function socketFor(item: Pick<Entity, "type" | "data">): Socket {
  const s = item.data.socket;
  return typeof s === "string" && (SOCKETS as readonly string[]).includes(s) ? (s as Socket) : socketForType(item.type);
}

/**
 * Gear grows and shrinks with its wearer ("make me huge"). The first mount remembers the item's own
 * size and the wearer's drawn height; later mounts scale by the ratio. If something else resized
 * the item since (its width is not what we last set), that size becomes the new base.
 */
function scaleWithWearer(item: Entity, wearerH: number): void {
  const d = item.data;
  if (typeof d.gearRefH !== "number" || typeof d.gearW !== "number" || d.gearAppliedW !== item.w || d.gearAppliedH !== item.h) {
    d.gearRefH = wearerH; d.gearW = item.w; d.gearH = item.h;
  }
  const k = clamp(wearerH / (d.gearRefH as number), SCALE_MIN, SCALE_MAX);
  item.w = (d.gearW as number) * k;
  item.h = (d.gearH as number) * k;
  d.gearAppliedW = item.w; d.gearAppliedH = item.h;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Put `item` on `wearer`'s socket and face it the wearer's way. Offsets are small nudges, never the position. */
export function mountGear(item: Entity, wearer: Entity, socket: Socket = socketFor(item), hasArt = true): void {
  const b = visualBox(wearer, hasArt);
  const f = wearer.facing >= 0 ? 1 : -1;
  scaleWithWearer(item, b.h);
  const nx = typeof item.data.offsetX === "number" ? item.data.offsetX : 0;
  const ny = typeof item.data.offsetY === "number" ? item.data.offsetY : 0;
  const maxNudge = Math.max(2, b.h * NUDGE);
  const dx = clamp(Number.isFinite(nx) ? nx : 0, -maxNudge, maxNudge);
  const dy = clamp(Number.isFinite(ny) ? ny : 0, -maxNudge, maxNudge);
  const mid = b.x + b.w / 2;
  let cx = mid;
  let cy = b.bottom - b.h * 0.5;
  if (socket === "hand") { cx = mid + f * (b.w / 2 + item.w / 2 - 4); cy = b.bottom - b.h * 0.55; }
  else if (socket === "back") { cx = mid - f * (b.w / 2 + item.w / 2 - 8); cy = b.bottom - b.h * 0.62; }
  else if (socket === "head") {
    cy = b.y - item.h / 2 + Math.min(4, item.h * 0.3);
    if (wearer.type !== "player") cx = mid + f * b.w * HEAD_FORWARD; // creatures lead with the head
  }
  else if (socket === "feet") { cy = b.bottom - item.h / 2; }
  else { cy = b.bottom - b.h * 0.4; } // belt
  // Keep the item's centre inside the drawn body plus a margin, whatever the nudge asked for.
  cx = clamp(cx + dx, b.x - item.w - MARGIN, b.x + b.w + item.w + MARGIN);
  cy = clamp(cy + dy, b.y - item.h - MARGIN, b.bottom + MARGIN);
  item.facing = wearer.facing;
  item.x = cx - item.w / 2;
  item.y = cy - item.h / 2;
  item.vx = wearer.vx;
  item.vy = wearer.vy;
}

/** Who wears this gear? data.attachedTo may be "player", an entity id, or a creature type. */
export function wearerOf(item: Entity, entities: readonly Entity[], player: Entity | undefined): Entity | undefined {
  const a = item.data.attachedTo;
  if (typeof a === "number") return entities.find((e) => e.id === a && e !== item);
  if (typeof a === "string" && a !== "player") return entities.find((e) => e.type === a && e !== item);
  return player;
}
