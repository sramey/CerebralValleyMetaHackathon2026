// SAM 3.1 photo segmentation: prompt + JPEG data URL -> box normalized to 1600 space from whatever space SAM reports.
// Never throws; any failure returns null.
import { loadEnv } from "./meta";

const BOX_RE = /box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)/;

export type Box = { x: number; y: number; w: number; h: number };

export function candidatePrompts(prompt: string): string[] {
  const trimmed = typeof prompt === "string" ? prompt.trim() : "";
  const lower = trimmed.toLowerCase();
  const words = lower ? lower.split(/\s+/) : [];
  const last = words.length > 0 ? words[words.length - 1] : "";
  const raw: string[] = [];
  if (trimmed) raw.push(trimmed);
  if (last && last !== lower) raw.push(last);

  // If prompt suggests person/body/face/hair, include relevant visual terms
  if (/\b(hair|head|face|person|portrait|selfie|guy|girl|man|woman|kid|boy|human|me|my)\b/.test(lower)) {
    raw.push("head", "person", "face", "hair");
  }

  // Broad semantic fallbacks for objects / toys / props (person at end as fallback)
  raw.push("object", "toy", "handheld object", "item", "gadget", "device", "prop", "person");

  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of raw) {
    if (!c) continue;
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

async function segmentOnce(
  imageDataUrl: string,
  prompt: string,
  key: string,
): Promise<Box | null> {
  try {
    const res = await fetch("https://api.meta.ai/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "sam-3.1",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              { type: "input_image", image_url: imageDataUrl },
            ],
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data: any = await res.json().catch(() => null);
    const text: unknown = data?.output?.[0]?.content?.[0]?.text;
    if (typeof text !== "string") return null;
    const m = text.match(BOX_RE);
    if (!m) return null;
    const x1 = Number(m[1]);
    const y1 = Number(m[2]);
    const x2 = Number(m[3]);
    const y2 = Number(m[4]);
    const W = Number(m[5]) || 1600;
    const H = Number(m[6]) || 1600;
    const box = { x: x1 * 1600 / W, y: y1 * 1600 / H, w: (x2 - x1) * 1600 / W, h: (y2 - y1) * 1600 / H };
    // Guard against oversized boxes (covers > 60% of frame area, e.g. whole room or entire person)
    const areaFraction = (box.w * box.h) / (1600 * 1600);
    if (areaFraction > 0.60) return null;
    return box;
  } catch {
    return null;
  }
}

export async function segmentPhoto(
  imageDataUrl: string,
  prompt: string,
): Promise<Box | null> {
  try {
    const key = loadEnv();
    if (!key) return null;
    for (const candidate of candidatePrompts(prompt)) {
      const box = await segmentOnce(imageDataUrl, candidate, key);
      if (box) return box;
    }
    return null;
  } catch {
    return null;
  }
}
