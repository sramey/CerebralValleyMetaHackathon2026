import { describe, expect, it } from "vitest";
import { cleanMask, cutObject, cutInBox, erode1, finishCut, placeMask, rleToRaster } from "../src/client/cutout";
import type { Img, PxBox } from "../src/client/cutout";

// Deterministic "photo": a wall with a gradient and sensor noise, and a rounded object on it.
function scene(wall: [number, number, number], obj: [number, number, number], rect: PxBox, w = 480, h = 360): { img: Img; truth: Uint8Array } {
  const data = new Uint8ClampedArray(w * h * 4);
  const truth = new Uint8Array(w * h);
  let seed = 12345;
  const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed / 4294967296 - 0.5) * 2; };
  const cx = (rect.x0 + rect.x1) / 2, cy = (rect.y0 + rect.y1) / 2, rx = (rect.x1 - rect.x0) / 2, ry = (rect.y1 - rect.y0) / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    const nx = Math.abs(x - cx) / rx, ny = Math.abs(y - cy) / ry;
    const inside = nx <= 1 && ny <= 1 && nx ** 6 + ny ** 6 <= 1; // rounded rectangle
    truth[y * w + x] = inside ? 1 : 0;
    const base = inside ? obj : wall;
    const grad = inside ? ((x - rect.x0) / (rect.x1 - rect.x0)) * 10 - 5 : (x / w) * 12 - 6;
    for (let c = 0; c < 3; c++) data[o + c] = Math.max(0, Math.min(255, base[c] + grad + rnd() * 5));
    data[o + 3] = 255;
  }
  return { img: { w, h, data }, truth };
}
function iou(a: Uint8Array, b: Uint8Array): number {
  let i = 0, u = 0;
  for (let p = 0; p < a.length; p++) { if (a[p] && b[p]) i++; if (a[p] || b[p]) u++; }
  return u === 0 ? 0 : i / u;
}
const BOX: PxBox = { x0: 150, y0: 90, x1: 330, y1: 270 };
const OBJ: PxBox = { x0: 160, y0: 100, x1: 320, y1: 260 };

describe("cutout (ADR 0081)", () => {
  it("cuts a distinct object out of its SAM box at photo resolution", () => {
    const { img, truth } = scene([205, 205, 210], [190, 40, 40], OBJ);
    const mask = cutInBox(img, BOX);
    expect(mask.length).toBe(img.w * img.h);
    expect(iou(mask, truth)).toBeGreaterThan(0.95);
  });

  it("uses SAM's own mask as the start and snaps its edge to the photo at full resolution", () => {
    const { img, truth } = scene([226, 210, 178], [196, 160, 112], OBJ);
    // A SAM mask at half the photo's resolution (SAM saw a downscaled copy), upscaled by placeMask.
    const hw = img.w / 2, hh = img.h / 2;
    const half = new Uint8Array(hw * hh);
    for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) half[y * hw + x] = truth[(y * 2) * img.w + x * 2];
    const prior = placeMask(img, half, hh, hw, 0, 0, 2, 2);
    const mask = cutInBox(img, BOX, { prior });
    expect(iou(mask, truth)).toBeGreaterThan(0.97);
    // Never worse than the coarse mask it started from.
    expect(iou(mask, truth)).toBeGreaterThanOrEqual(iou(prior, truth) - 0.005);
  });

  it("run lengths come back as the raster they came from", () => {
    expect(Array.from(rleToRaster([2, 3, 1, 2], 8))).toEqual([0, 0, 1, 1, 1, 0, 1, 1]);
  });

  it("cuts a tan object off a beige wall (similar colours), never beyond the box", () => {
    const { img, truth } = scene([226, 210, 178], [196, 160, 112], OBJ);
    const mask = cutInBox(img, BOX);
    expect(iou(mask, truth)).toBeGreaterThan(0.9);
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      if (mask[y * img.w + x]) expect(x >= BOX.x0 && x < BOX.x1 && y >= BOX.y0 && y < BOX.y1).toBe(true);
    }
  });

  it("fills holes, drops stray islands, keeps the largest blob", () => {
    const w = 20, h = 20;
    const m = new Uint8Array(w * h);
    for (let y = 4; y < 16; y++) for (let x = 4; x < 16; x++) m[y * w + x] = 1;
    m[9 * w + 9] = 0; // hole
    m[1 * w + 1] = 1; // island
    const c = cleanMask(m, w, h);
    expect(c[9 * w + 9]).toBe(1);
    expect(c[1 * w + 1]).toBe(0);
    expect(c[10 * w + 10]).toBe(1);
  });

  it("keeps a big enclosed gap (a handle) open", () => {
    const w = 40, h = 40;
    const m = new Uint8Array(w * h);
    for (let y = 4; y < 36; y++) for (let x = 4; x < 36; x++) m[y * w + x] = 1;
    for (let y = 14; y < 26; y++) for (let x = 14; x < 26; x++) m[y * w + x] = 0; // 144 of ~1000 px
    const c = cleanMask(m, w, h);
    expect(c[20 * w + 20]).toBe(0);
  });

  it("fills a big enclosed gap that is not background-coloured (coffee in a mug), keeps one that is (a handle)", () => {
    const w = 40, h = 40;
    const data = new Uint8ClampedArray(w * h * 4);
    const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, inObj = x >= 4 && x < 36 && y >= 4 && y < 36;
      const gapA = x >= 8 && x < 16 && y >= 8 && y < 18, gapB = x >= 22 && x < 32 && y >= 22 && y < 32;
      const c = gapA ? [60, 40, 30] : gapB ? [226, 210, 178] : inObj ? [40, 100, 140] : [226, 210, 178];
      data.set([...c, 255], o);
      m[y * w + x] = inObj && !gapA && !gapB ? 1 : 0;
    }
    const c = cleanMask(m, w, h, { w, h, data });
    expect(c[12 * w + 12]).toBe(1); // brown gap: object content, filled
    expect(c[27 * w + 27]).toBe(0); // wall-coloured gap: a real opening, kept
  });

  it("erodes exactly one pixel off the edge", () => {
    const w = 12, h = 12;
    const m = new Uint8Array(w * h);
    for (let y = 2; y < 10; y++) for (let x = 2; x < 10; x++) m[y * w + x] = 1;
    const e = erode1(m, w, h);
    expect(e.reduce((a, b) => a + b, 0)).toBe(6 * 6);
  });

  it("crops to the object; hard alpha for pixel art, feathered alpha otherwise", () => {
    const { img } = scene([205, 205, 210], [190, 40, 40], OBJ);
    const hard = cutObject(img, BOX)!;
    expect(hard.img.w).toBeLessThan(BOX.x1 - BOX.x0 + 2);
    const alphas = new Set<number>();
    for (let p = 3; p < hard.img.data.length; p += 4) alphas.add(hard.img.data[p]);
    expect([...alphas].sort()).toEqual([0, 255]);
    const soft = cutObject(img, BOX, { feather: true })!;
    const soft2 = new Set<number>();
    for (let p = 3; p < soft.img.data.length; p += 4) soft2.add(soft.img.data[p]);
    expect(soft2.size).toBeGreaterThan(2);
  });

  it("applies a supplied mask at native resolution placed at the box origin", () => {
    const { img, truth } = scene([205, 205, 210], [190, 40, 40], OBJ);
    // A SAM-style mask: rows x cols covering the box, row-major 0/1.
    const rows = BOX.y1 - BOX.y0, cols = BOX.x1 - BOX.x0;
    const m = new Uint8Array(rows * cols);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) m[y * cols + x] = truth[(y + BOX.y0) * img.w + (x + BOX.x0)];
    const placed = placeMask(img, m, rows, cols, BOX.x0, BOX.y0);
    expect(iou(placed, truth)).toBe(1);
    const cut = finishCut(img, placed, false)!;
    expect(cut.img.w).toBeGreaterThan(100);
  });

  it("gives up cleanly on an empty box", () => {
    const { img } = scene([205, 205, 210], [190, 40, 40], OBJ);
    expect(cutObject(img, { x0: 10, y0: 10, x1: 12, y1: 12 })).toBeNull();
  });
});
