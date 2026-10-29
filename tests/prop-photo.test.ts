import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROMISE_SCREENS, fitInside, stageHeight } from "../src/client/camera-dialog";
import { decodePng } from "../scripts/png";
import { drawMug } from "../scripts/make-mug-fixture";

// The prop photo every camera-import check uses instead of a webcam (bead jd1).
// Drawn, not photographed: `npx tsx scripts/make-mug-fixture.ts` regenerates it.
const root = process.cwd();
const file = readFileSync(join(root, "tests", "fixtures", "mug-photo.png"));
const png = decodePng(file);
const px = (x: number, y: number): number[] => {
  const o = (y * png.width + x) * 4;
  return [png.rgba[o], png.rgba[o + 1], png.rgba[o + 2], png.rgba[o + 3]];
};

describe("the prop-photo fixture", () => {
  it("is a real PNG a file input can load", () => {
    expect(file.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(png.width).toBe(480);
    expect(png.height).toBe(360);
    expect(file.length).toBeGreaterThan(2000);
    // Comfortably under the 4 MB the server refuses.
    expect(file.toString("base64").length).toBeLessThan(4_000_000);
  });

  it("is a mug on a plain background, not a person", () => {
    const [r, g, b] = px(230, 240);
    expect(b).toBeGreaterThan(r + 40); // the mug is blue
    expect(g).toBeGreaterThan(r); // ...and teal, not grey
    const coffee = px(230, 132);
    expect(coffee[0] + coffee[1] + coffee[2]).toBeLessThan(160); // dark coffee in the rim
    for (const [x, y] of [[3, 3], [476, 3], [3, 356], [476, 356]]) {
      expect(px(x, y)[3]).toBe(255);
    }
  });

  it("has a background flat enough for the background-diff cut", () => {
    // The client's diff method keys off a remembered empty frame; the corners have to agree.
    const corners = [[6, 6], [473, 6], [6, 290], [473, 290]].map(([x, y]) => px(x, y).slice(0, 3));
    const spread = Math.max(...corners.map((c) => c[0])) - Math.min(...corners.map((c) => c[0]));
    expect(spread).toBeLessThan(40);
  });

  it("comes back identical from the generator (deterministic, no photos)", () => {
    const drawn = drawMug();
    expect(drawn.width).toBe(png.width);
    expect(drawn.height).toBe(png.height);
    expect(Buffer.from(drawn.rgba).equals(Buffer.from(png.rgba))).toBe(true);
  });

  it("fits the reserved stage at the promised screens", () => {
    for (const screen of PROMISE_SCREENS) {
      const stage = { w: 528 - 2, h: stageHeight(screen.h) - 2 };
      const fit = fitInside({ w: png.width, h: png.height }, stage);
      expect(fit.w).toBeLessThanOrEqual(stage.w);
      expect(fit.h).toBeLessThanOrEqual(stage.h);
      expect(fit.w).toBeGreaterThan(200); // bigger than a thumbnail: the box can be clicked
    }
  });
});

describe("the PNG codec", () => {
  it("round-trips a fixture-sized image", () => {
    const drawn = drawMug();
    const decoded = decodePng(readFileSync(join(root, "tests", "fixtures", "mug-photo.png")));
    expect(decoded.rgba.length).toBe(drawn.width * drawn.height * 4);
    expect(Buffer.from(decoded.rgba).equals(Buffer.from(drawn.rgba))).toBe(true);
  });
  it("refuses something that is not a PNG", () => {
    expect(() => decodePng(Buffer.from("nope"))).toThrow();
  });
});
