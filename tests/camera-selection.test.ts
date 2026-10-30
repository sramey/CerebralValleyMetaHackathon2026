import { describe, it, expect } from "vitest";
import {
  segmentImage,
  toggleSelectionAtPoint,
  isPointInBox,
  colorDiff,
} from "../src/client/camera-selection";
import {
  drawCartoonHead,
  HEAD_W,
  HEAD_H,
  HAIR_COLOR,
  SKIN_COLOR,
  BG_COLOR,
} from "./fixtures/drawn-head";
import { drawMug } from "../scripts/make-mug-fixture";
import { candidatePrompts } from "../server/photo";

describe("camera object selection (bead bgh)", () => {
  const headImg = drawCartoonHead();
  const segResult = segmentImage(headImg);

  it("identifies the outer background correctly", () => {
    expect(segResult.backgroundSegmentIds.size).toBeGreaterThan(0);
    // Corners should be background
    const corner0 = segResult.segmentMap[0];
    expect(segResult.backgroundSegmentIds.has(corner0)).toBe(true);
    expect(segResult.segments[corner0].isBackground).toBe(true);
  });

  it("clicking hair selects the whole connected head (hair + face merged), not just a patch", () => {
    // Hair is around (100, 70), fx = 0.5, fy = 0.35
    const clickFx = 100 / HEAD_W;
    const clickFy = 70 / HEAD_H;

    const selection = toggleSelectionAtPoint(segResult, clickFx, clickFy);

    expect(selection.count).toBeGreaterThan(0);
    expect(selection.bbox).not.toBeNull();
    expect(selection.box1600).not.toBeNull();

    // Check that BOTH hair pixels and skin pixels are selected in the mask
    const hairPixelIdx = 70 * HEAD_W + 100;
    const skinPixelIdx = 120 * HEAD_W + 100;
    const bgPixelIdx = 10 * HEAD_W + 10;

    expect(selection.mask[hairPixelIdx]).toBe(1);
    expect(selection.mask[skinPixelIdx]).toBe(1); // Merged adjacent skin segment!
    expect(selection.mask[bgPixelIdx]).toBe(0); // Did not leak into background!

    // The bounding box should cover the whole head (~120px tall, from y~40 to y~160)
    const bbox = selection.bbox!;
    expect(bbox.y1 - bbox.y0).toBeGreaterThan(100);
    expect(bbox.x1 - bbox.x0).toBeGreaterThan(100);
  });

  it("clicking face selects the whole connected head as well", () => {
    // Face is around (100, 120), fx = 0.5, fy = 0.6
    const clickFx = 100 / HEAD_W;
    const clickFy = 120 / HEAD_H;

    const selection = toggleSelectionAtPoint(segResult, clickFx, clickFy);

    const hairPixelIdx = 70 * HEAD_W + 100;
    const skinPixelIdx = 120 * HEAD_W + 100;

    expect(selection.mask[hairPixelIdx]).toBe(1);
    expect(selection.mask[skinPixelIdx]).toBe(1);
  });

  it("fills internal holes (e.g. eyes inside the face)", () => {
    // Left eye is at (80, 105)
    const clickFx = 100 / HEAD_W;
    const clickFy = 70 / HEAD_H;
    const selection = toggleSelectionAtPoint(segResult, clickFx, clickFy);

    const eyePixelIdx = 105 * HEAD_W + 80;
    expect(selection.mask[eyePixelIdx]).toBe(1);
  });

  it("allows user to click again to remove a segment", () => {
    // 1. Initial click on hair selects whole head
    const click1 = toggleSelectionAtPoint(segResult, 100 / HEAD_W, 70 / HEAD_H);
    expect(click1.activeSegments.size).toBeGreaterThan(1);

    // 2. Click on face (100, 120) to remove the face segment
    const click2 = toggleSelectionAtPoint(segResult, 100 / HEAD_W, 120 / HEAD_H, click1.activeSegments);
    expect(click2.activeSegments.size).toBeLessThan(click1.activeSegments.size);

    // 3. Click face again to add it back
    const click3 = toggleSelectionAtPoint(segResult, 100 / HEAD_W, 120 / HEAD_H, click2.activeSegments);
    expect(click3.activeSegments.size).toBe(click1.activeSegments.size);
  });

  it("provides generous bounding box in 1600 space", () => {
    const selection = toggleSelectionAtPoint(segResult, 100 / HEAD_W, 70 / HEAD_H);
    const box = selection.box1600!;
    expect(box.w).toBeGreaterThan(800);
    expect(box.h).toBeGreaterThan(800);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.w).toBeLessThanOrEqual(1600);
    expect(box.y + box.h).toBeLessThanOrEqual(1600);
  });

  it("selects the mug in the committed mug fixture", () => {
    const mug = drawMug();
    const mugSeg = segmentImage({ w: mug.width, h: mug.height, data: mug.rgba });
    // Click on the mug body at (230, 240)
    const selection = toggleSelectionAtPoint(mugSeg, 230 / mug.width, 240 / mug.height);
    expect(selection.count).toBeGreaterThan(5000);
    // Bounding box encloses mug
    expect(selection.box1600!.w).toBeGreaterThan(500);
    expect(selection.box1600!.h).toBeGreaterThan(500);
    // Corner pixel is not in mask
    expect(selection.mask[0]).toBe(0);
  });
});

describe("candidatePrompts for SAM (bead bgh)", () => {
  it("expands empty prompt to fallback candidates including object and person", () => {
    const prompts = candidatePrompts("");
    expect(prompts).toContain("object");
    expect(prompts).toContain("person");
    expect(prompts).toContain("item");
  });

  it("expands hair prompt to include head and person", () => {
    const prompts = candidatePrompts("hair");
    expect(prompts[0]).toBe("hair");
    expect(prompts).toContain("head");
    expect(prompts).toContain("person");
    expect(prompts).toContain("face");
    expect(prompts).toContain("object");
  });

  it("expands multi-word person phrases", () => {
    const prompts = candidatePrompts("my curly hair");
    expect(prompts).toContain("my curly hair");
    expect(prompts).toContain("head");
    expect(prompts).toContain("person");
  });
});

describe("SAM box path preference (bead bgh)", () => {
  const samBox = { x: 320, y: 320, w: 960, h: 960 };

  it("recognizes when a click falls inside the SAM box", () => {
    // Center of SAM box is (800, 800) in 1600 space -> fx = 0.5, fy = 0.5
    expect(isPointInBox(0.5, 0.5, samBox)).toBe(true);
    // Point near corner of SAM box
    expect(isPointInBox(0.22, 0.22, samBox)).toBe(true);
    // Point outside SAM box
    expect(isPointInBox(0.05, 0.05, samBox)).toBe(false);
    expect(isPointInBox(0.95, 0.95, samBox)).toBe(false);
  });
});


