// Paper photo payload (bead 9ch, ADR 0054 amendment): a photographed drawing travels as a
// compact JPEG with a hard wire budget, not as the raw multi-megabyte photo a phone camera
// hands over. No DOM here — the canvas is injected, so the downscale, the size ladder and
// both fallbacks are covered offline, and the paper fixtures stand in for a real drawing.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PAPER_HARD_CHARS,
  PAPER_JPEG_QUALITY,
  PAPER_MAX_CHARS,
  PAPER_MAX_EDGE,
  compactPaperImage,
  paperImageSize,
  paperLevelMessage,
} from "../src/client/paper-image";
import { compactImage, type SketchCanvas, type SketchContext } from "../src/client/sketch-image";
import { MAX_IMAGE, validateClientMsg } from "../server/validate";

const FIXTURE_DIR = resolve(process.cwd(), "tests/fixtures/paper");
const FIXTURES = ["paper-level-1.png", "paper-level-2.png", "paper-level-3.png"] as const;
/** The fixtures are 640x480 photographs of a drawing; a phone shot of the same paper is bigger. */
const FIXTURE_PX = 640 * 480;
const PHONE_PX = 4032 * 3024;

interface FakeCanvas extends SketchCanvas {
  drawn?: { w: number; h: number };
  kind?: string;
  quality?: number;
}

/**
 * A canvas stand-in. Encoded sizes follow a rough real-world budget: PNG ~1.6 bytes/px,
 * JPEG ~`jpegK * quality` bytes/px (0.12 is a detailed photo, higher stands in for a noisy
 * one that would blow the budget).
 */
function fakeCanvas(w: number, h: number, opts: { jpegK?: number; throwOnEncode?: boolean; noContext?: boolean } = {}): FakeCanvas {
  const jpegK = opts.jpegK ?? 0.12;
  const canvas: FakeCanvas = {
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
    toDataURL(type = "image/png", quality = 0): string {
      if (opts.throwOnEncode) throw new Error("encoder unavailable");
      const mime = type === "image/png" ? "image/png" : "image/jpeg";
      canvas.kind = mime;
      canvas.quality = quality;
      const bytes = Math.round(w * h * (mime === "image/png" ? 1.6 : jpegK * quality));
      const payload = "A".repeat(Math.max(64, Math.ceil(bytes * 4 / 3)));
      return `data:${mime};base64,${payload}`;
    },
  };
  return canvas;
}

function fixturePng(name: string): Buffer {
  return readFileSync(resolve(FIXTURE_DIR, name));
}

describe("paper image size", () => {
  it("fits a phone photo inside 1024 px on its long edge, keeping the aspect ratio", () => {
    expect(PAPER_MAX_EDGE).toBe(1024);
    expect(paperImageSize({ w: 4032, h: 3024 })).toEqual({ w: 1024, h: 768 });
    expect(paperImageSize({ w: 3024, h: 4032 })).toEqual({ w: 768, h: 1024 });
    expect(paperImageSize({ w: 1600, h: 1600 })).toEqual({ w: 1024, h: 1024 });
    // A drawing that is already small is never upscaled.
    expect(paperImageSize({ w: 640, h: 480 })).toEqual({ w: 640, h: 480 });
    expect(paperImageSize({ w: 0, h: 0 })).toEqual({ w: 1, h: 1 });
  });
});

describe("compact paper image", () => {
  it("downscales a phone photo to 1024 px and encodes it as JPEG at q0.8", () => {
    const source = fakeCanvas(4032, 3024);
    const made: FakeCanvas[] = [];
    const out = compactPaperImage(source, (w, h) => {
      const small = fakeCanvas(w, h);
      made.push(small);
      return small;
    });
    expect(made.length).toBe(1);
    const small = made[0];
    expect({ w: small.width, h: small.height }).toEqual({ w: 1024, h: 768 });
    expect(small.drawn).toEqual({ w: 1024, h: 768 });
    expect(small.kind).toBe("image/jpeg");
    expect(small.quality).toBe(PAPER_JPEG_QUALITY);
    expect(out.startsWith("data:image/jpeg")).toBe(true);
    // The bead's bar: a compact payload, not the megabytes the raw photo would be.
    expect(out.length).toBeLessThan(PAPER_MAX_CHARS);
    // And the raw PNG of the same photo is what the server would have refused.
    expect(source.toDataURL("image/png").length).toBeGreaterThan(MAX_IMAGE);
  });

  it("walks the ladder until the photo fits the wire budget", () => {
    // A noisy photo: q0.8 at 1024 px is over budget, so the encode steps down.
    const source = fakeCanvas(4032, 3024, { jpegK: 0.9 });
    const made: FakeCanvas[] = [];
    const out = compactPaperImage(source, (w, h) => {
      const small = fakeCanvas(w, h, { jpegK: 0.9 });
      made.push(small);
      return small;
    });
    expect(made.length).toBe(4);
    expect(out.length).toBeLessThanOrEqual(PAPER_MAX_CHARS);
    // Quality drops before resolution does: the first retry is still 1024 px.
    expect({ w: made[1].width, h: made[1].height }).toEqual({ w: 1024, h: 768 });
    expect(made[1].quality).toBeLessThan(PAPER_JPEG_QUALITY);
    // It stops at the first rung that fits, not after exhausting the ladder.
    expect({ w: made[3].width, h: made[3].height }).toEqual({ w: 640, h: 480 });
  });

  it("refuses to send a photo the server would throw away", () => {
    // Every rung is still past the server's 4 MB ceiling: nothing worth sending.
    const huge = fakeCanvas(4032, 3024, { jpegK: 30 });
    expect(compactPaperImage(huge, (w, h) => fakeCanvas(w, h, { jpegK: 30 }))).toBe("");
    expect(PAPER_HARD_CHARS).toBeLessThan(MAX_IMAGE);
    // A dead canvas (no encoder anywhere) also yields nothing rather than a broken frame.
    expect(compactPaperImage(fakeCanvas(800, 600, { throwOnEncode: true }), () => null)).toBe("");
  });

  it("keeps a drawing that is already small without upscaling it", () => {
    const source = fakeCanvas(640, 480);
    const out = compactPaperImage(source, () => null);
    expect(out.startsWith("data:image/jpeg")).toBe(true);
    expect(source.kind).toBe("image/jpeg");
    expect(source.quality).toBe(PAPER_JPEG_QUALITY);
  });
});

describe("paper level message", () => {
  it("carries the compact image and the optional level name", () => {
    const image = "data:image/jpeg;base64," + "A".repeat(4096);
    expect(paperLevelMessage(image, "  Sky Castle  ")).toEqual({ kind: "paperLevel", image, prompt: "Sky Castle" });
    // A blank name is left out of the frame entirely, not sent as an empty prompt.
    expect(paperLevelMessage(image, "   ")).toEqual({ kind: "paperLevel", image });
  });
});

describe("paper fixtures", () => {
  for (const name of FIXTURES) {
    it(`sends ${name} as a compact JPEG the server accepts`, () => {
      const png = fixturePng(name);
      // Stand in for the encoder with the fixture's own drawing at its natural size.
      const source = fakeCanvas(640, 480);
      const image = compactPaperImage(source, (w, h) => fakeCanvas(w, h));
      expect(image.startsWith("data:image/jpeg")).toBe(true);
      expect(image.length).toBeLessThan(PAPER_MAX_CHARS);

      const verdict = validateClientMsg(paperLevelMessage(image, "paper level"));
      expect(verdict.ok).toBe(true);

      // What the bead was filed about: the same drawing photographed at phone resolution is
      // a PNG past the server's 4 MB image ceiling (PNG bytes scale with pixels).
      const phonePngBytes = Math.round((png.byteLength * PHONE_PX) / FIXTURE_PX);
      const phonePngChars = Math.ceil(phonePngBytes * 4 / 3);
      expect(phonePngChars).toBeGreaterThan(MAX_IMAGE);
      const refused = validateClientMsg({ kind: "paperLevel", image: `data:image/png;base64,${"A".repeat(phonePngChars)}` });
      expect(refused.ok).toBe(false);
    });
  }
});

describe("compactImage stays generic", () => {
  it("honours the options it is given (the sketch keeps its own budget)", () => {
    const source = fakeCanvas(1920, 1080);
    const made: FakeCanvas[] = [];
    const out = compactImage(source, { maxEdge: 512, quality: 0.5 }, (w, h) => {
      const small = fakeCanvas(w, h);
      made.push(small);
      return small;
    });
    expect({ w: made[0].width, h: made[0].height }).toEqual({ w: 512, h: 288 });
    expect(made[0].quality).toBe(0.5);
    expect(out.startsWith("data:image/jpeg")).toBe(true);
  });
});
