// SAM 3.1 photo segmentation: prompt + JPEG data URL -> box normalized to 1600 space from whatever space SAM reports.
// Never throws; any failure returns null.
import { SPARK, chat, loadEnv } from "./meta";

const BOX_RE = /box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)/;

export type Box = { x: number; y: number; w: number; h: number };

export function candidatePrompts(prompt: string, extra: string[] = []): string[] {
  const trimmed = typeof prompt === "string" ? prompt.trim() : "";
  const lower = trimmed.toLowerCase();
  const words = lower ? lower.split(/\s+/) : [];
  const last = words.length > 0 ? words[words.length - 1] : "";
  const raw: string[] = [];
  if (trimmed) raw.push(trimmed);
  if (last && last !== lower) raw.push(last);
  for (const e of extra) raw.push(e);

  // If prompt suggests person/body/face/hair, include relevant visual terms
  if (/\b(hair|head|face|person|portrait|selfie|guy|girl|man|woman|kid|boy|human|me|my)\b/.test(lower)) {
    raw.push("head", "person", "face", "hair");
  }

  // "person" is only ever a fallback when the prompt is about a person: for a held object it
  // boxes the holder (arm, shirt) and the cutout swallows the room (camfix).
  raw.push("handheld object", "object", "toy", "calculator", "remote control", "game controller", "radio", "box", "gadget", "device", "bottle", "book", "figurine", "stuffed toy");
  if (/\b(person|me|my|man|woman|guy|girl|kid|boy|human|portrait|selfie)\b/.test(lower)) raw.push("person");

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
    // Text-sized boxes (a logo on the toy, a button) are never the object.
    if (areaFraction < 0.01) return null;
    return box;
  } catch {
    return null;
  }
}

export async function segmentPhoto(
  imageDataUrl: string,
  prompt: string,
  extra: string[] = [],
): Promise<Box | null> {
  try {
    const key = loadEnv();
    if (!key) return null;
    // SAM 3.1 is picky about nouns, so try the candidates in small parallel batches and keep the
    // first one, in priority order, that boxes something (camfix).
    const all = candidatePrompts(prompt, extra);
    for (let i = 0; i < all.length; i += 5) {
      const batch = all.slice(i, i + 5);
      const boxes = await Promise.all(batch.map((c) => segmentOnce(imageDataUrl, c, key)));
      for (let j = 0; j < batch.length; j++) {
        const box = boxes[j];
        console.info(`[photo] sam "${batch[j]}" -> ${box ? `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.w)}x${Math.round(box.h)}` : "none"}`);
      }
      const hit = boxes.find((b) => b !== null);
      if (hit) return hit;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * When nobody typed a name, ask Meta Spark (vision) what is being held: up to four short
 * noun phrases, most specific first, ending with plain everyday category words. SAM 3.1
 * segments a named thing far better than "object", but it is picky: on the owner's photo
 * "calculator" boxed the toy while "toy" and "speak and spell" found nothing (camfix), so
 * the caller tries every name in turn. Never throws; [] means "no idea".
 */
export async function nameHeldObject(imageDataUrl: string): Promise<string[]> {
  try {
    if (!loadEnv()) return [];
    const r = await chat(SPARK, [{
      role: "user",
      content: [
        { type: "text", text: "A person holds one object up to a camera. Name that object as up to 4 alternative short lowercase noun phrases of 1 to 3 words, most specific first, and end with plain everyday category words a segmentation model would know (for example: coffee mug, cup, mug / toy robot, robot, toy). Reply with only the phrases, comma separated." },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    }], 48);
    const names = r.text.toLowerCase().split(/[,\n]/)
      .map((n) => n.trim().replace(/^["'`\-\s]+|["'`.!\s]+$/g, "").replace(/\s+/g, " "))
      .filter((n) => n && n.length <= 30 && n.split(" ").length <= 3 && !/[<>|;]/.test(n))
      .slice(0, 4);
    console.info(`[photo] named ${JSON.stringify(names)}`);
    return names;
  } catch (e) {
    console.info(`[photo] naming failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    return [];
  }
}
