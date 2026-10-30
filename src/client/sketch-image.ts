// Draw-to-build (ADR 0026, bug q8x): the sketch that travels to the server is a *compact*
// JPEG, not the raw full-screen PNG. Paper-to-level (ADR 0040) reuses the same machinery
// through `compactImage` with its own, larger budget (`src/client/paper-image.ts`).
//
// A 1920x1080 `toDataURL("image/png")` of the sketch overlay is 2–3.5 MB of base64: a slow
// upload, a 413 risk at the proxy, and long vision time on the model — which is what pushed
// the build past the client watchdog and lost the drawn level. Downscaling to at most 720 px
// on the long edge and encoding as JPEG q0.75 keeps every stroke legible for a vision model
// at ~1–2% of the bytes.
//
// The world-space stroke boxes still travel separately and unchanged, so geometry never
// depends on the pixels: the image is only "what does this mark mean" context.

/** Longest edge of the image that travels. Enough to read a drawn platform, ~10x smaller than a screenshot. */
export const SKETCH_MAX_EDGE = 720;
/** JPEG quality for the compact sketch. 0.75 is the point where a 9 px brush line stays crisp. */
export const SKETCH_JPEG_QUALITY = 0.75;

/** The canvas surface this module needs: a size, a 2d context to draw with, and an encoder. */
export interface SketchCanvas {
  width: number;
  height: number;
  getContext(type: "2d"): SketchContext | null;
  toDataURL(type?: string, quality?: number): string;
}

/** The slice of a 2d context used to blit a sketch downscale. */
export interface SketchContext {
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
  drawImage(source: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
}

/** How compact an image must be before it travels: longest edge in px and JPEG quality (0..1). */
export interface CompactImageOptions {
  maxEdge: number;
  quality: number;
}

/** Fit an image inside `maxEdge` on its long edge, keeping its aspect ratio (and never upscaling). */
export function fitImageSize(natural: { w: number; h: number }, maxEdge: number): { w: number; h: number } {
  const w = Math.max(1, Math.floor(natural.w));
  const h = Math.max(1, Math.floor(natural.h));
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** Fit a sketch inside the compact size, keeping its aspect ratio (and never upscaling). */
export function sketchImageSize(natural: { w: number; h: number }): { w: number; h: number } {
  return fitImageSize(natural, SKETCH_MAX_EDGE);
}

/** The real offscreen canvas, or null when there is no DOM (headless test, broken browser). */
export function makeCanvas(w: number, h: number): SketchCanvas | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/**
 * The image that travels: the canvas redrawn at `opts.maxEdge` and encoded as JPEG at
 * `opts.quality`. Falls back to the source's own PNG if a downscale or the JPEG encoder is
 * unavailable, so the build never fails for want of an image.
 */
export function compactImage(
  source: SketchCanvas,
  opts: CompactImageOptions,
  make: (w: number, h: number) => SketchCanvas | null = makeCanvas,
): string {
  const { w, h } = fitImageSize({ w: source.width, h: source.height }, opts.maxEdge);
  if (w < source.width || h < source.height) {
    try {
      const small = make(w, h);
      const ctx = small?.getContext("2d");
      if (small && ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        // A real source is an HTMLCanvasElement, which *is* a CanvasImageSource; the narrow
        // interface above is what keeps a headless test able to stand in for it.
        ctx.drawImage(source as unknown as CanvasImageSource, 0, 0, w, h);
        const jpeg = small.toDataURL("image/jpeg", opts.quality);
        // A data URL shorter than this is an empty encode, not a picture.
        if (jpeg.startsWith("data:image/jpeg") && jpeg.length > 1024) return jpeg;
      }
    } catch { /* fall through to the source's own encoding */ }
  }
  try {
    const jpeg = source.toDataURL("image/jpeg", opts.quality);
    if (jpeg.startsWith("data:image/jpeg") && jpeg.length > 1024) return jpeg;
  } catch { /* fall through */ }
  try {
    return source.toDataURL("image/png");
  } catch {
    // No encoder at all (a headless or broken canvas): the server refuses this sketch with a
    // friendly line instead of the build hanging.
    return "";
  }
}

/** The sketch's own budget: `SKETCH_MAX_EDGE` px on the long edge at `SKETCH_JPEG_QUALITY`. */
export function compactSketchImage(source: SketchCanvas, make: (w: number, h: number) => SketchCanvas | null = makeCanvas): string {
  return compactImage(source, { maxEdge: SKETCH_MAX_EDGE, quality: SKETCH_JPEG_QUALITY }, make);
}
