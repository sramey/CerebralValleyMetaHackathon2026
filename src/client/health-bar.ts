// Where the overhead health bar goes. Pure: the client passes the drawn body, this returns the bar rect.
// The bar rides above the DRAWN sprite (scale, squash, walk bob, trimmed art), not the raw hitbox (bead qo0).

/** Fixed clear space between the top of the drawn body and the bar. */
export const BAR_GAP = 4;
export const BAR_HEIGHT = 4;
const BAR_MIN_W = 24;
const BAR_MAX_W = 120;

/** The body as the eye sees it, in screen pixels. `top` is the highest drawn pixel. */
export interface DrawnBody { cx: number; top: number; w: number }

export interface BarRect { x: number; y: number; w: number; h: number; fill: number }

/** Screen-space drawn body of a sprite: feet-anchored, trimmed art, so the top is feet minus drawn height. */
export function spriteBody(feetX: number, feetY: number, drawnW: number, drawnH: number): DrawnBody {
  return { cx: feetX, top: feetY - Math.abs(drawnH), w: Math.abs(drawnW) };
}

/** Bar for a code-drawn rect entity: the hitbox is what is drawn. */
export function rectBody(x: number, y: number, w: number): DrawnBody {
  return { cx: x + w / 2, top: y, w };
}

/** Width follows the body but stays readable when tiny and sane when huge. Returns null when no bar is due. */
export function healthBarRect(body: DrawnBody, health: unknown): BarRect | null {
  if (typeof health !== "number" || !(health > 0) || health >= 100) return null;
  const w = Math.min(BAR_MAX_W, Math.max(BAR_MIN_W, body.w));
  return { x: body.cx - w / 2, y: body.top - BAR_GAP - BAR_HEIGHT, w, h: BAR_HEIGHT, fill: w * health / 100 };
}

export function healthBarColor(health: number): number {
  return health > 50 ? 0x3fd06a : health > 25 ? 0xffc94d : 0xff5a4d;
}
