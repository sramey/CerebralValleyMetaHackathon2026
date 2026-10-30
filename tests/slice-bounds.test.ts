import { describe, expect, it } from "vitest";
import { findPoseBounds } from "../src/client/sprites";

function makeSheet(w: number, h: number, boxes: { x: number; y: number; w: number; h: number }[]): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  // Default to transparent (or magenta that was chroma-keyed to alpha 0)
  for (const b of boxes) {
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        if (x >= 0 && x < w && y >= 0 && y < h) {
          const idx = (y * w + x) * 4;
          px[idx] = 100;
          px[idx + 1] = 150;
          px[idx + 2] = 200;
          px[idx + 3] = 255; // solid alpha
        }
      }
    }
  }
  return px;
}

describe("findPoseBounds: real pose bounds instead of 4 equal columns", () => {
  it("extracts 4 well-separated poses with tight bounding boxes", () => {
    const w = 1024, h = 1024;
    const boxes = [
      { x: 50, y: 300, w: 120, h: 200 },
      { x: 300, y: 280, w: 140, h: 220 },
      { x: 550, y: 290, w: 130, h: 210 },
      { x: 800, y: 250, w: 150, h: 250 },
    ];
    const px = makeSheet(w, h, boxes);
    const bounds = findPoseBounds(w, h, px);
    expect(bounds).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(bounds[i].x).toBe(boxes[i].x);
      expect(bounds[i].y).toBe(boxes[i].y);
      expect(bounds[i].w).toBe(boxes[i].w);
      expect(bounds[i].h).toBe(boxes[i].h);
    }
  });

  it("handles uneven pose spacing without clipping across equal 400px column boundaries (slime case)", () => {
    const w = 1600, h = 1600;
    // Uneven poses matching real slime.webp layout:
    // Pose 1 spans 384..805 (crosses 400 and 800 boundaries!)
    // Pose 2 spans 826..1225 (crosses 1200 boundary!)
    const boxes = [
      { x: 12, y: 834, w: 358, h: 313 },
      { x: 384, y: 773, w: 421, h: 417 },
      { x: 826, y: 780, w: 399, h: 421 },
      { x: 1270, y: 481, w: 306, h: 626 },
    ];
    const px = makeSheet(w, h, boxes);
    const bounds = findPoseBounds(w, h, px);
    expect(bounds).toHaveLength(4);

    // If sliced by naive 4 equal columns (w / 4 = 400px), bounds would clip at 400, 800, 1200.
    // Our slicer finds the real pose bounds without clipping!
    expect(bounds[1].x).toBe(384);
    expect(bounds[1].w).toBe(421);
    expect(bounds[1].x + bounds[1].w).toBe(805); // preserves full width across x=400 and x=800 boundaries!

    expect(bounds[2].x).toBe(826);
    expect(bounds[2].w).toBe(399);
    expect(bounds[2].x + bounds[2].w).toBe(1225); // preserves full width across x=1200 boundary!
  });

  it("splits touching/merged poses at occupancy valleys", () => {
    const w = 1024, h = 1024;
    // Poses 1 and 2 touch via a thin 1-pixel-thick arm/trail at y=500, but have wide body masses
    const boxes = [
      { x: 50, y: 300, w: 150, h: 200 },
      { x: 260, y: 300, w: 180, h: 200 }, // body 1
      { x: 440, y: 500, w: 20, h: 2 },   // thin bridge
      { x: 460, y: 300, w: 180, h: 200 }, // body 2
      { x: 750, y: 300, w: 160, h: 200 },
    ];
    const px = makeSheet(w, h, boxes);
    const bounds = findPoseBounds(w, h, px, 4);
    expect(bounds.length).toBeGreaterThanOrEqual(4);
    // Pose at x=260 and pose at x=460 are split into distinct frames
    expect(bounds[1].x).toBeGreaterThanOrEqual(250);
    expect(bounds[1].x + bounds[1].w).toBeLessThanOrEqual(460);
    expect(bounds[2].x).toBeGreaterThanOrEqual(440);
  });

  it("filters out stray noise pixels in gaps", () => {
    const w = 1024, h = 1024;
    const boxes = [
      { x: 50, y: 300, w: 150, h: 200 },
      { x: 250, y: 400, w: 1, h: 1 }, // isolated single noise pixel in gap
      { x: 350, y: 300, w: 150, h: 200 },
    ];
    const px = makeSheet(w, h, boxes);
    const bounds = findPoseBounds(w, h, px, 2);
    // Noise pixel at x=250 should not create a separate frame
    expect(bounds).toHaveLength(2);
    expect(bounds[0].w).toBe(150);
    expect(bounds[1].x).toBe(350);
  });
});
