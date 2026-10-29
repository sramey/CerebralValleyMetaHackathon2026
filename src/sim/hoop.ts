// Basketball goal geometry (ADR 0046). One set of ratios decides where the rim, the board and the
// net are, so the hoop the client DRAWS and the hoop the sim SCORES are the same hoop: a mod asks
// rimOf(hoop) instead of guessing, and the renderer draws from the same numbers.
// Pure: a box in, numbers out. No DOM, no randomness, no wall-clock.

/** Every size below is a fraction of the goal entity's box (w, h). */
export const HOOP = {
  /** Steel post: centred behind the backboard, standing on the ground (box bottom). */
  postW: 0.09,
  /** Backboard, in the upper half of the box, facing the player. */
  boardX: 0.1,
  boardW: 0.5,
  boardY: 0.03,
  boardH: 0.4,
  /** The rim: a horizontal ring seen in perspective, its centre in front of the board. */
  rimY: 0.52,
  rimR: 0.17,
  /** Net: hangs from the rim, tapering inward. */
  netH: 0.27,
  netTaper: 0.55,
} as const;

/** The box a hoop should occupy: 100x200 px, standing on `groundY`. */
export const HOOP_SIZE = { w: 100, h: 200 } as const;

export function hoopBox(x: number, groundY: number): { x: number; y: number; w: number; h: number } {
  return { x, y: groundY - HOOP_SIZE.h, w: HOOP_SIZE.w, h: HOOP_SIZE.h };
}

/**
 * True for types that are a basketball goal and must be drawn as one structure (post, backboard,
 * rim, net) instead of a plain ring. Any *other* sport's goal keeps its own look.
 */
export function isHoopType(type: string): boolean {
  const t = type.toLowerCase();
  if (t.includes("hoop") || t.includes("backboard")) return true;
  if (t.includes("basket") && t.includes("goal")) return true;
  return t.includes("goal") && !/soccer|football|hockey|rugby|handball|goal-?post|keeper/.test(t);
}

export interface Rim {
  /** Left edge of the rim's mouth, world x. */
  x: number;
  /** The scoring plane: the ball's centre crossing this y going DOWN scores. */
  y: number;
  /** Mouth width; the ball must cross inside [x, x + w]. */
  w: number;
}

/** Where a goal's rim is, in world coordinates, for any box shaped like a hoop. */
export function rimOf(box: { x: number; y: number; w: number; h: number }): Rim {
  const cx = box.x + box.w * (HOOP.boardX + HOOP.boardW / 2);
  const r = box.w * HOOP.rimR;
  return { x: cx - r, y: box.y + box.h * HOOP.rimY, w: r * 2 };
}

/** The backboard's rectangle (visual only: the rim sits in front of it, so balls never collide with it). */
export function backboardOf(box: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  return { x: box.x + box.w * HOOP.boardX, y: box.y + box.h * HOOP.boardY, w: box.w * HOOP.boardW, h: box.h * HOOP.boardH };
}

/** The hoop a type describes, if it is one. */
export function isHoop(e: { type: string }): boolean {
  return isHoopType(e.type);
}
