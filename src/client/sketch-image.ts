// Draw-to-build (ADR 0026, bug q8x): the sketch that travels to the server is a *compact*
// JPEG, not the raw full-screen PNG.
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

/** Fit a sketch inside the compact size, keeping its aspect ratio (and never upscaling). */
export function sketchImageSize(natural: { w: number; h: number }): { w: number; h: number } {
  const w = Math.max(1, Math.floor(natural.w));
  const h = Math.max(1, Math.floor(natural.h));
  const scale = Math.min(1, SKETCH_MAX_EDGE / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

function makeCanvas(w: number, h: number): SketchCanvas | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/**
 * The image that travels with a sketch: the canvas redrawn at `SKETCH_MAX_EDGE` and encoded
 * as JPEG. Falls back to the source's own PNG if a downscale or the JPEG encoder is
 * unavailable, so the build never fails for want of an image.
 */
export function compactSketchImage(source: SketchCanvas, make: (w: number, h: number) => SketchCanvas | null = makeCanvas): string {
  const { w, h } = sketchImageSize({ w: source.width, h: source.height });
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
        const jpeg = small.toDataURL("image/jpeg", SKETCH_JPEG_QUALITY);
        // A data URL shorter than this is an empty encode, not a picture.
        if (jpeg.startsWith("data:image/jpeg") && jpeg.length > 1024) return jpeg;
      }
    } catch { /* fall through to the source's own encoding */ }
  }
  try {
    const jpeg = source.toDataURL("image/jpeg", SKETCH_JPEG_QUALITY);
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
