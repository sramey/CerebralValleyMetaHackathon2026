// Paper-to-level (ADR 0040) has its own image budget (bead 9ch, ADR 0054 amendment).
//
// A photographed drawing is not a stroke canvas: Wonder has to read *pencil lines on paper*
// out of it, so the sketch's 720 px / q0.75 is too coarse — a hand-drawn platform and a
// scribbled coin blur together. Photos therefore travel at up to 1024 px on the long edge
// at q0.8, which keeps the drawing legible for vision while staying in the tens of KB.
//
// The size is not left to chance: `PAPER_MAX_CHARS` is a hard wire budget, and an encode
// that overshoots it is retried smaller (lower quality first, then a smaller edge) so the
// photo the server gets is always a compact JPEG and never the raw 4 MB a phone camera
// would hand over. The server's own ceilings (`MAX_IMAGE`, the paper handler's guard) stay
// where they are: they are the refusal line, not the target.

import type { ClientMsg } from "../contract";
import { compactImage, fitImageSize, makeCanvas, type CompactImageOptions, type SketchCanvas } from "./sketch-image";

/** Longest edge of a paper photo that travels. A drawing needs more detail than a stroke sketch (720). */
export const PAPER_MAX_EDGE = 1024;
/** JPEG quality for a paper photo: 0.8 keeps pencil lines and paper edges readable. */
export const PAPER_JPEG_QUALITY = 0.8;
/** Hard wire budget for one paper image, in base64 characters (~240 KB of JPEG). */
export const PAPER_MAX_CHARS = 320_000;
/**
 * The server refuses a paper image at or above 4,000,000 characters. Even the smallest
 * attempt staying above this means there is nothing worth sending, so the client says so
 * instead of spending a build on a photo the server will throw away.
 */
export const PAPER_HARD_CHARS = 3_900_000;

/**
 * The ladder an encode walks until it fits `PAPER_MAX_CHARS`: first the full 1024 px at
 * q0.8, then lower quality, then smaller edges. Order matters — dropping quality keeps the
 * drawing's geometry readable longer than cropping its resolution does.
 */
export const PAPER_STEPS: readonly CompactImageOptions[] = [
  { maxEdge: PAPER_MAX_EDGE, quality: PAPER_JPEG_QUALITY },
  { maxEdge: PAPER_MAX_EDGE, quality: 0.62 },
  { maxEdge: 768, quality: 0.62 },
  { maxEdge: 640, quality: 0.55 },
];

/** The canvas size a paper photo is worked at (and never upscaled). */
export function paperImageSize(natural: { w: number; h: number }): { w: number; h: number } {
  return fitImageSize(natural, PAPER_MAX_EDGE);
}

/**
 * The image that travels with a paper level: a compact JPEG inside `PAPER_MAX_CHARS`.
 * Returns "" when there is nothing encodable at all (a dead canvas) or when even the
 * smallest attempt is past the server's ceiling; the caller then keeps the dialog open and
 * asks for another photo instead of sending a build the server will refuse.
 */
export function compactPaperImage(source: SketchCanvas, make: (w: number, h: number) => SketchCanvas | null = makeCanvas): string {
  let best = "";
  for (const step of PAPER_STEPS) {
    const out = compactImage(source, step, make);
    if (!out) continue;
    if (best === "" || out.length < best.length) best = out;
    if (out.length <= PAPER_MAX_CHARS) return out;
  }
  return best.length > 0 && best.length < PAPER_HARD_CHARS ? best : "";
}

/** The message the paper path sends: a compact JPEG plus the optional level name. */
export function paperLevelMessage(image: string, prompt: string): ClientMsg {
  const name = prompt.trim();
  return { kind: "paperLevel", image, ...(name ? { prompt: name } : {}) };
}
