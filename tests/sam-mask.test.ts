import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSamText, rleDecode, rleEncode } from "../server/sam-mask";

// Real SAM 3.1 replies (metadata.mask_encoding "one_bit") for person-free images: a drawn red
// square, the drawn toy fixture and the drawn mug fixture. Decoded with Meta's @meta-sam/parser.
const fx = (n: string): string => readFileSync(`tests/fixtures/sam-onebit-${n}.txt`, "utf8");

describe("SAM one-bit masks (ADR 0081)", () => {
  it("decodes the red square to its 151x151 near-solid square", async () => {
    const [i] = await parseSamText(fx("rect"));
    expect(i.mask).not.toBeNull();
    const m = i.mask!;
    expect([m.w, m.h, m.x, m.y]).toEqual([151, 151, 150, 100]);
    expect([m.srcW, m.srcH]).toEqual([480, 360]);
    const r = rleDecode(m.rle, m.w * m.h);
    // SAM's own mask of a hard-edged square: all but a handful of edge cells (22766 of 22801 here).
    expect(r.reduce((a, b) => a + b, 0) / (151 * 151)).toBeGreaterThan(0.99);
    expect(r[75 * 151 + 75]).toBe(1);
  });

  it("decodes the toy and the mug with a plausible shape inside their boxes", async () => {
    for (const n of ["toy", "mug"]) {
      const [i] = await parseSamText(fx(n));
      const m = i.mask!;
      expect(m, n).not.toBeNull();
      const r = rleDecode(m.rle, m.w * m.h);
      const on = r.reduce((a, b) => a + b, 0);
      expect(on / (m.w * m.h), n).toBeGreaterThan(0.6);
      expect(on / (m.w * m.h), n).toBeLessThanOrEqual(1);
      expect(i.conf).toBeGreaterThanOrEqual(0);
      expect(i.conf).toBeLessThanOrEqual(1);
    }
  });

  it("the mug mask leaves the handle's hole open and the toy mask clears its corner", async () => {
    const [mug] = await parseSamText(fx("mug"));
    const m = mug.mask!;
    const r = rleDecode(m.rle, m.w * m.h);
    // Handle hole: right side, mid height (photo px 345,195 in the 480x360 fixture).
    expect(r[(195 - m.y) * m.w + (345 - m.x)]).toBe(0);
    // Mug body centre.
    expect(r[(220 - m.y) * m.w + (230 - m.x)]).toBe(1);
  });

  it("round-trips run lengths and survives garbage", async () => {
    const raster = Uint8Array.from([0, 0, 1, 1, 1, 0, 1, 0, 0]);
    expect(Array.from(rleDecode(rleEncode(raster), raster.length))).toEqual(Array.from(raster));
    expect(Array.from(rleDecode(rleEncode(Uint8Array.from([1, 1, 0])), 3))).toEqual([1, 1, 0]);
    expect(await parseSamText("not a sam reply")).toEqual([]);
    expect(await parseSamText("<0f>0<|box;x1=1;y1=1;x2=9;y2=9;w=10;h=10|><|mask;x=0;y=0;data=9,9,!!!!!|>")).toHaveLength(1);
  });
});
