// SAM 3.1 reply text -> instances with a box and (when SAM sent one) a decoded mask (ADR 0081).
//
// The mask is requested as `metadata.mask_encoding: "one_bit"` and decoded with Meta's own
// `@meta-sam/parser` (decodeMaskToRaster); nothing here reads the payload by hand. The result
// travels to the client as run lengths ("rle"), because a 0/1 raster of a 768 px photo is mostly
// long runs. Pure: no network, no env.
import { decodeMaskToRaster, parseImageStream, recordsOfKind, type ResponsesEvent } from "@meta-sam/parser";
import type { SamMask } from "../src/contract";

/** The mask on the wire (see `SamMask`). */
export type WireMask = SamMask;

export interface SamInstance {
  /** Box in the 1600 space the client uses (same normalisation as before). */
  box: { x: number; y: number; w: number; h: number };
  mask: WireMask | null;
  /** SAM's own `c=` confidence, 0..1; 0.5 when it sent none. */
  conf: number;
}

const BOX_RE = /box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)/g;

export function rleEncode(raster: Uint8Array): number[] {
  const runs: number[] = [];
  let cur = 0, n = 0;
  for (let i = 0; i < raster.length; i++) {
    const v = raster[i] ? 1 : 0;
    if (v === cur) n++;
    else { runs.push(n); cur = v; n = 1; }
  }
  runs.push(n);
  return runs;
}

export function rleDecode(rle: readonly number[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let p = 0, v = 0;
  for (const run of rle) {
    if (v) out.fill(1, p, Math.min(length, p + run));
    p += run;
    v ^= 1;
  }
  return out;
}

async function* events(text: string): AsyncIterable<ResponsesEvent> {
  const lane = { item_id: "m", output_index: 0, content_index: 0 };
  yield { type: "response.output_text.delta", delta: text, ...lane };
  yield { type: "response.output_text.done", text, ...lane };
  yield { type: "response.completed" };
}

/** Every object SAM reported in `text`, with its decoded mask when there is one. Never throws. */
export async function parseSamText(text: string): Promise<SamInstance[]> {
  try {
    const sizes: { w: number; h: number }[] = [];
    for (const m of text.matchAll(BOX_RE)) sizes.push({ w: Number(m[5]) || 1600, h: Number(m[6]) || 1600 });
    const parsed = parseImageStream(events(text));
    for await (const snap of parsed) void snap;
    const result = await parsed.finalResult;
    const boxes = recordsOfKind(result.records, "box");
    const masks = recordsOfKind(result.records, "mask");
    const out: SamInstance[] = [];
    boxes.forEach((b, i) => {
      const W = sizes[i]?.w ?? 1600, H = sizes[i]?.h ?? 1600;
      // The same box maths as the old regex path: x2 - x1 is the width.
      const box = { x: b.left * 1600 / W, y: b.top * 1600 / H, w: (b.right - b.left) * 1600 / W, h: (b.bottom - b.top) * 1600 / H };
      const rec = masks.find((m) => m.objectId === b.objectId);
      let mask: WireMask | null = null;
      if (rec) {
        try {
          const raster = decodeMaskToRaster(rec.mask);
          if (raster.length === rec.mask.width * rec.mask.height && raster.some((v) => v)) {
            mask = { x: rec.bounds.left, y: rec.bounds.top, w: rec.mask.width, h: rec.mask.height, srcW: W, srcH: H, rle: rleEncode(raster) };
          }
        } catch { /* a mask that will not decode is no mask: the client falls back to its own cut */ }
      }
      out.push({ box, mask, conf: rec?.confidence ?? b.confidence ?? 0.5 });
    });
    return out;
  } catch {
    return [];
  }
}
