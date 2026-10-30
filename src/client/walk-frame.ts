// Which sheet frame a grounded sprite shows, and the step bob that sells the walk.
// Sheets are [idle, stride, stride, jump] but the model often draws the two strides near-identical,
// so the walk cycles idle -> stride1 -> idle -> stride2 (bead 0zy) and bobs a little on each stride.

export interface WalkInput {
  frameCount: number;
  tick: number;
  moving: boolean;
  onGround: boolean;
}

export interface WalkPick {
  index: number;
  /** Pixels to lift the sprite this frame (a step bob); 0 when not walking. */
  bob: number;
}

/** Ticks each walk phase holds; four phases make one full step cycle. */
export const WALK_PHASE_TICKS = 6;

export function pickWalkFrame({ frameCount, tick, moving, onGround }: WalkInput): WalkPick {
  if (frameCount >= 4 && !onGround) return { index: 3, bob: 0 };
  if (!moving || frameCount < 2) return { index: 0, bob: 0 };
  const phase = Math.floor(tick / WALK_PHASE_TICKS) % 4;
  const strides = Math.min(2, frameCount - 1);
  if (phase % 2 === 0) return { index: 0, bob: 0 };
  return { index: 1 + (phase >> 1) % strides, bob: 2 };
}
