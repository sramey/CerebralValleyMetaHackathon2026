// Pickup reach (bug cxl): what a collector can grab should match what the player SEES,
// not just the physics box. The ninja sprite is drawn 56 px tall over a 34 px box, so its
// head and shoulders used to pass through coins without collecting them. Pure and
// deterministic: boxes in, boolean out.
import type { Entity } from "../contract";

/** Grow the box this much on every side so a near miss still counts. */
export const PICKUP_PAD = 8;
/** The player's drawn height over its collision height (src/client/main.ts visualHeightOf: 56 px over 34 px). */
const PLAYER_VISUAL_RATIO = 56 / 34;

type Box = { x: number; y: number; w: number; h: number };

/** The area a collector can pick things up from: its box, padded, and for the player extended up to the drawn head. */
export function reachBox(c: Box & { type?: string }): Box {
  const up = c.type === "player" ? Math.ceil(c.h * (PLAYER_VISUAL_RATIO - 1)) : 0;
  return { x: c.x - PICKUP_PAD, y: c.y - PICKUP_PAD - up, w: c.w + 2 * PICKUP_PAD, h: c.h + 2 * PICKUP_PAD + up };
}

/** True when the item overlaps the collector's reach. */
export function touches(collector: Entity, item: Box): boolean {
  const a = reachBox(collector);
  return a.x < item.x + item.w && a.x + a.w > item.x && a.y < item.y + item.h && a.y + a.h > item.y;
}
