import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planArtOrders, spritePrompt, subjectArtPrompt } from "../server/art";
import { isLandmarkSubject } from "../src/ontology";
import { fitSetPieceSprite, showsPlaceholder } from "../src/client/setpieces";
import { findPoseBounds, pickLandmarkBounds } from "../src/client/sprites";
import { parallaxFactorOf } from "../src/client/parallax";

// ADR 0080: a landmark's art is ONE picture of the whole subject.

function fixtureMask(): { w: number; h: number; px: Uint8ClampedArray } {
  const raw = JSON.parse(readFileSync(new URL("./fixtures/landmark-mountain-sheet.mask.json", import.meta.url), "utf8")) as { w: number; h: number; rows: number[][][] };
  const px = new Uint8ClampedArray(raw.w * raw.h * 4);
  raw.rows.forEach((runs, y) => {
    for (const [x0, len] of runs) for (let x = x0; x < x0 + len; x++) px[(y * raw.w + x) * 4 + 3] = 255;
  });
  return { w: raw.w, h: raw.h, px };
}

const MOUNTAIN_MOD = readFileSync(new URL("./fixtures/landmark-mountain-mod.ts.txt", import.meta.url), "utf8");

describe("landmark art orders", () => {
  it("orders ONE picture for a landmark and four for a creature", () => {
    const [mountain] = planArtOrders(MOUNTAIN_MOD, "add a mountain");
    expect(mountain.type).toBe("mountain");
    expect(mountain.frames).toBe(1);
    expect(mountain.scenery).toBe(true);
    expect(mountain.flying).toBe(false);
    const creature = planArtOrders('api.spawn({ type: "slime", x: 1, y: 1, w: 20, h: 20, data: { hostile: true } });', "add a slime");
    expect(creature[0].frames).toBe(4);
  });

  it("recognises whole-word landmarks only", () => {
    for (const s of ["mountain", "volcano", "castle", "pyramid", "tower", "fire-castle", "mountains"]) expect(isLandmarkSubject(s)).toBe(true);
    for (const s of ["goalkeeper", "relationship", "slime", "ninja", "chest"]) expect(isLandmarkSubject(s)).toBe(false);
  });

  it("asks Muse Image for one subject, not a pose sheet", () => {
    const p = subjectArtPrompt("mountain", "mountain");
    expect(p).toMatch(/ONE single mountain/);
    expect(p).not.toMatch(/exactly 4/);
    expect(p).not.toMatch(/running forward/);
    expect(spritePrompt("slime", { held: false, scenery: false })).toMatch(/exactly 4 action poses/);
  });
});

describe("landmark slicing", () => {
  it("turns a cached four-mountain sheet into one non-animated frame: the largest subject", () => {
    const { w, h, px } = fixtureMask();
    const old = findPoseBounds(w, h, px);
    expect(old.length).toBeGreaterThan(1); // the old path: several frames, cycled
    const picked = pickLandmarkBounds(findPoseBounds(w, h, px, 1));
    expect(picked).toHaveLength(1);
    const area = (b: { w: number; h: number }) => b.w * b.h;
    for (const b of findPoseBounds(w, h, px, 1)) expect(area(picked[0])).toBeGreaterThanOrEqual(area(b));
    expect(picked[0].w).toBeGreaterThan(300); // a whole mountain, not a ~230 px sliver of the sheet
  });

  it("keeps a single fresh image as one frame", () => {
    const w = 100, h = 80;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 10; y < 70; y++) for (let x = 20; x < 80; x++) px[(y * w + x) * 4 + 3] = 255;
    expect(pickLandmarkBounds(findPoseBounds(w, h, px, 1))).toEqual([{ x: 20, y: 10, w: 60, h: 60 }]);
  });
});

describe("landmark drawing", () => {
  it("fits the picture inside the box keeping aspect, bottom-anchored", () => {
    const box = { x: 100, y: 80, w: 560, h: 320 };
    const f = fitSetPieceSprite(box, 400, 400);
    expect(f.w / f.h).toBeCloseTo(1);
    expect(f.h).toBeCloseTo(320);
    expect(f.y + f.h).toBeCloseTo(400);
    expect(f.x + f.w / 2).toBeCloseTo(100 + 280);
  });

  it("hides the code-drawn placeholder once art is ready, and shows it again if the art is lost", () => {
    expect(showsPlaceholder(undefined)).toBe(true);
    expect(showsPlaceholder([])).toBe(true);
    expect(showsPlaceholder([{}])).toBe(false);
  });
});

describe("landmark vs parallax backdrop", () => {
  const base = { id: 1, x: 0, y: 80, w: 560, h: 320, vx: 0, vy: 0, solid: false, gravityScale: 0 };
  it("a landmark mountain or volcano is not also drawn as a parallax silhouette", () => {
    expect(parallaxFactorOf({ ...base, type: "mountain", data: { landmark: true } } as never)).toBeNull();
    expect(parallaxFactorOf({ ...base, type: "volcano", data: {} } as never)).toBeNull();
  });
  it("a real parallax layer still scrolls", () => {
    expect(parallaxFactorOf({ ...base, type: "far-mountain", data: {} } as never)).not.toBeNull();
    expect(parallaxFactorOf({ ...base, type: "mountain-bg", data: {} } as never)).not.toBeNull();
    expect(parallaxFactorOf({ ...base, type: "mountain", data: { parallax: 0.3 } } as never)).toBe(0.3);
  });
});
