// Compact sketch image (bug q8x): the picture that travels to the server is a downscaled JPEG,
// not a multi-megabyte full-screen PNG. No DOM here: the canvas is injected, so the downscale
// path, the encoder choice and both fallbacks are covered offline.
import { describe, expect, it } from "vitest";
import {
  SKETCH_JPEG_QUALITY,
  SKETCH_MAX_EDGE,
  compactSketchImage,
  sketchImageSize,
  type SketchCanvas,
  type SketchContext,
} from "../src/client/sketch-image";

/** A canvas stand-in: records the blit, and encodes to a data URL whose size follows the pixels. */
function fakeCanvas(w: number, h: number, opts: { throwOnEncode?: boolean; noContext?: boolean } = {}): SketchCanvas & { drawn?: { w: number; h: number }; kind?: string; quality?: number } {
  const canvas: SketchCanvas & { drawn?: { w: number; h: number }; kind?: string; quality?: number } = {
    width: w,
    height: h,
    getContext(): SketchContext | null {
      if (opts.noContext) return null;
      return {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low",
        drawImage(_source, _dx, _dy, dw, dh) { canvas.drawn = { w: dw, h: dh }; },
      };
    },
    toDataURL(type = "image/png", quality?: number): string {
      if (opts.throwOnEncode) throw new Error("encoder unavailable");
      const mime = type === "image/png" ? "image/png" : "image/jpeg";
      canvas.kind = mime;
      canvas.quality = quality;
      // A rough, real-ish encoding budget: PNG of this artwork is ~1.6 bytes/px, JPEG q0.75 ~0.09.
      const bytes = Math.round(w * h * (mime === "image/png" ? 1.6 : 0.09));
      const payload = "A".repeat(Math.max(64, Math.ceil(bytes * 4 / 3)));
      return `data:${mime};base64,${payload}`;
    },
  };
  return canvas;
}

describe("compact sketch image", () => {
  it("fits the sketch inside 720 px on its long edge, keeping the aspect ratio", () => {
    expect(SKETCH_MAX_EDGE).toBe(720);
    expect(sketchImageSize({ w: 1920, h: 1080 })).toEqual({ w: 720, h: 405 });
    expect(sketchImageSize({ w: 1080, h: 1920 })).toEqual({ w: 405, h: 720 });
    expect(sketchImageSize({ w: 720, h: 720 })).toEqual({ w: 720, h: 720 });
    // A small sketch is never upscaled.
    expect(sketchImageSize({ w: 480, h: 300 })).toEqual({ w: 480, h: 300 });
    expect(sketchImageSize({ w: 0, h: 0 })).toEqual({ w: 1, h: 1 });
  });

  it("sends a downscaled JPEG instead of the raw full-screen canvas", () => {
    const source = fakeCanvas(1920, 1080);
    const made: ReturnType<typeof fakeCanvas>[] = [];
    const out = compactSketchImage(source, (w, h) => {
      const small = fakeCanvas(w, h);
      made.push(small);
      return small;
    });
    expect(made.length).toBe(1);
    const small = made[0];
    expect(small.width).toBe(720);
    expect(small.height).toBe(405);
    expect(small.drawn).toEqual({ w: 720, h: 405 });
    expect(small.kind).toBe("image/jpeg");
    expect(small.quality).toBe(SKETCH_JPEG_QUALITY);
    expect(out.startsWith("data:image/jpeg")).toBe(true);
    // Reference points for the bug: the raw PNG path was megabytes.
    expect(source.toDataURL("image/png").length).toBeGreaterThan(2_000_000);
    expect(out.length).toBeLessThan(100_000); // the bead's done bar for the wire payload
  });

  it("encodes the source itself when it is already compact", () => {
    const source = fakeCanvas(640, 360);
    const out = compactSketchImage(source, () => null);
    expect(out.startsWith("data:image/jpeg")).toBe(true);
    expect(source.kind).toBe("image/jpeg");
  });

  it("never fails to produce an image (and degrades to the source, then to nothing)", () => {
    // No 2d context on the downscale target: encode the source itself.
    const noContext = fakeCanvas(1920, 1080, { noContext: true });
    expect(compactSketchImage(noContext, () => fakeCanvas(720, 405, { noContext: true }))).toContain("data:image/jpeg");
    // The encoder refuses JPEG: the source's PNG still travels.
    const throws = fakeCanvas(1920, 1080, { throwOnEncode: true });
    expect(compactSketchImage(throws, () => fakeCanvas(720, 405, { throwOnEncode: true }))).toBe("");
    // Nothing to encode with at all: empty, and the server's sanitizer refuses it politely.
    const dead = fakeCanvas(800, 600, { throwOnEncode: true });
    expect(compactSketchImage(dead, () => null)).toBe("");
  });
});
