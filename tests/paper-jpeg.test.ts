// Paper photo dimensions (bead 8gk). Paper photos travel as JPEG (bead 9ch), but the bounds
// detector only read PNG headers, so every photo fell back to a guessed 640x480 sheet
// ('detected paper bounds: 32,24 576x432'). These tests read the real fixture JPEG's frame
// header, prove the bounds are the photo's own pixels, and pin the PNG path unchanged.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectPaperBounds,
  parseImageDimensions,
  parseJpegDimensions,
  parsePngDimensions,
  paperPrompt,
  runPaperBuild,
  type PaperDeps,
} from "../server/paper";
import { compileMod } from "../server/compile";
import { verifyMod } from "../server/verify";

const FIXTURE_DIR = resolve(process.cwd(), "tests/fixtures/paper");
/** A real 1024x768 JPEG of the same drawing as paper-level-1.png: what the client sends. */
const JPEG = "paper-level-1.jpg";
const JPEG_W = 1024;
const JPEG_H = 768;
/** The guess this bead removed: 5% of a 640x480 frame, exactly the log line in the report. */
const GUESSED_BOUNDS = { x: 32, y: 24, w: 576, h: 432 };

function fixtureBuffer(name: string): Buffer {
  return readFileSync(resolve(FIXTURE_DIR, name));
}

function fixtureDataUrl(name: string, mime = "image/png"): string {
  return `data:${mime};base64,${fixtureBuffer(name).toString("base64")}`;
}

describe("JPEG frame header dimensions", () => {
  it("reads width and height off a real JPEG photo", () => {
    expect(parseJpegDimensions(fixtureBuffer(JPEG))).toEqual({ w: JPEG_W, h: JPEG_H });
    expect(parseJpegDimensions(fixtureDataUrl(JPEG, "image/jpeg"))).toEqual({ w: JPEG_W, h: JPEG_H });
  });

  it("reads a progressive frame header (SOF2) the same way as a baseline one (SOF0)", () => {
    // The parser never decodes scan data, so the marker alone decides: re-label the real
    // fixture's SOF0 as SOF2 (progressive) and the same size comes back.
    const jpeg = Buffer.from(fixtureBuffer(JPEG));
    const sof = jpeg.indexOf(Buffer.from([0xff, 0xc0]));
    expect(sof).toBeGreaterThan(0);
    jpeg[sof + 1] = 0xc2;
    expect(parseJpegDimensions(jpeg)).toEqual({ w: JPEG_W, h: JPEG_H });
  });

  it("survives the other frame kinds (SOF1 extended sequential, SOF3 lossless)", () => {
    const jpeg = Buffer.from(fixtureBuffer(JPEG));
    const sof = jpeg.indexOf(Buffer.from([0xff, 0xc0]));
    for (const marker of [0xc1, 0xc3]) {
      const variant = Buffer.from(jpeg);
      variant[sof + 1] = marker;
      expect(parseJpegDimensions(variant)).toEqual({ w: JPEG_W, h: JPEG_H });
    }
  });

  it("returns null instead of guessing on data that is not a walkable JPEG", () => {
    const jpeg = fixtureBuffer(JPEG);
    // No SOI.
    expect(parseJpegDimensions(Buffer.from("not a jpeg at all"))).toBeNull();
    // A header cut short before the frame header.
    expect(parseJpegDimensions(jpeg.subarray(0, 20))).toBeNull();
    // A stream that hits SOS with no frame header first.
    const sosOnly = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 0, 0, 0, 0, 0, 0]);
    expect(parseJpegDimensions(sosOnly)).toBeNull();
    // Base64-less string, empty buffer, and a PNG handed to the JPEG reader.
    expect(parseJpegDimensions("data:image/jpeg,AAAA")).toBeNull();
    expect(parseJpegDimensions(Buffer.alloc(0))).toBeNull();
    expect(parseJpegDimensions(fixtureBuffer("paper-level-1.png"))).toBeNull();
  });
});

describe("image dimensions by format", () => {
  it("sniffs PNG and JPEG and reports both", () => {
    expect(parseImageDimensions(fixtureDataUrl("paper-level-1.png"))).toEqual({ w: 640, h: 480 });
    expect(parseImageDimensions(fixtureDataUrl(JPEG, "image/jpeg"))).toEqual({ w: JPEG_W, h: JPEG_H });
  });

  it("says nothing about a format it cannot read", () => {
    expect(parseImageDimensions("data:image/webp;base64,AAAA")).toBeNull();
    expect(parseImageDimensions("data:image/png;base64,AAAA")).toBeNull();
    expect(parseImageDimensions("")).toBeNull();
  });

  it("leaves the PNG reader untouched", () => {
    expect(parsePngDimensions(fixtureDataUrl("paper-level-1.png"))).toEqual({ w: 640, h: 480 });
    expect(parsePngDimensions(fixtureBuffer("paper-level-2.png"))).toEqual({ w: 640, h: 480 });
    expect(parsePngDimensions(fixtureDataUrl(JPEG, "image/jpeg"))).toBeNull();
  });
});

describe("paper bounds use the photo's real size", () => {
  it("frames a JPEG photo on its own pixels, not on a 640x480 guess", () => {
    const bounds = detectPaperBounds(fixtureDataUrl(JPEG, "image/jpeg"));
    // 5% / 90% of a 1024x768 photo — the same shape as the old fallback, on the real frame.
    expect(bounds).toEqual({ x: 51, y: 38, w: 922, h: 691 });
    expect(bounds).not.toEqual(GUESSED_BOUNDS);
    // Every bound stays inside the photo it was measured from.
    expect(bounds.x + bounds.w).toBeLessThanOrEqual(JPEG_W);
    expect(bounds.y + bounds.h).toBeLessThanOrEqual(JPEG_H);
  });

  it("keeps detecting the sheet in a PNG photo (pixel path unchanged)", () => {
    for (const name of ["paper-level-1.png", "paper-level-2.png", "paper-level-3.png"]) {
      const bounds = detectPaperBounds(fixtureDataUrl(name));
      expect(bounds.x).toBeGreaterThan(30);
      expect(bounds.x).toBeLessThan(140);
      expect(bounds.w).toBeGreaterThan(400);
      expect(bounds.h).toBeGreaterThan(320);
    }
  });

  it("still degrades to the guessed frame for an unreadable payload", () => {
    expect(detectPaperBounds("data:image/png;base64,AAAA")).toEqual({
      x: 32,
      y: 24,
      w: 576,
      h: 432,
    });
  });

  it("hands the photo's size and sheet bounds to Wonder", () => {
    const bounds = detectPaperBounds(fixtureDataUrl(JPEG, "image/jpeg"));
    const prompt = paperPrompt("sky castle", bounds, { w: JPEG_W, h: JPEG_H });
    expect(prompt).toContain("Detected paper sheet bounds in the photo (1024x768 px):");
    expect(prompt).toContain(`x=${bounds.x}, y=${bounds.y}, w=${bounds.w}, h=${bounds.h}`);
    // Without dimensions the line keeps its old shape (no stray "(1024x768 px)").
    expect(paperPrompt("", bounds)).toContain("Detected paper sheet bounds in the photo:");
  });
});

describe("runPaperBuild on a JPEG photo", () => {
  function deps(notes: string[], prompts: string[], reply: string): PaperDeps {
    return {
      ask: async (messages) => {
        const content = messages[messages.length - 1].content;
        if (Array.isArray(content)) {
          const text = content.find((part) => part.type === "text");
          if (text && text.type === "text") prompts.push(text.text);
        }
        return reply;
      },
      deliver: async (source) => {
        const compiled = compileMod(source);
        if (!compiled.ok) return { ok: false, errors: compiled.errors };
        const verified = await verifyMod(source, compiled.js);
        return { ok: verified.ok, errors: verified.errors };
      },
      say: () => {},
      stage: () => {},
      note: (text) => notes.push(text),
    };
  }

  const REPLY = JSON.stringify({
    name: "Jpeg Terrace",
    platforms: [
      { x: 100, y: 880, w: 800, h: 40, kind: "ledge" },
      { x: 350, y: 550, w: 220, h: 30, kind: "ledge" },
    ],
    coins: [{ x: 450, y: 510, w: 25, h: 25 }],
    enemies: [],
  });

  it("logs the real photo size next to the bounds and reads the level", async () => {
    const notes: string[] = [];
    const prompts: string[] = [];
    const res = await runPaperBuild(deps(notes, prompts, REPLY), {
      image: fixtureDataUrl(JPEG, "image/jpeg"),
      prompt: "terrace",
    });
    expect(res.ok).toBe(true);
    expect(res.title).toBe("Jpeg Terrace");
    // The bug's trail: the log line said 32,24 576x432 for a 1024x768 photo.
    expect(notes[0]).toBe("detected paper bounds: 51,38 922x691 in a 1024x768 image");
    expect(prompts[0]).toContain("Detected paper sheet bounds in the photo (1024x768 px):");
  });

  it("says so when the photo's size cannot be read at all", async () => {
    const notes: string[] = [];
    const prompts: string[] = [];
    const res = await runPaperBuild(deps(notes, prompts, REPLY), { image: "data:image/webp;base64," + "A".repeat(512) });
    // An unreadable header is not fatal: the build proceeds on the guessed frame, and the note
    // is honest about it instead of implying a measured sheet.
    expect(notes[0]).toBe("detected paper bounds: 32,24 576x432 (image size unknown)");
    expect(res.ok).toBe(true);
  });
});
