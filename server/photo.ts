// SAM 3.1 photo segmentation: prompt + JPEG data URL -> box normalized to 1600 space from whatever space SAM reports.
// Never throws; any failure returns null.
import { SPARK, chat, loadEnv } from "./meta";
import { parseSamText, type WireMask } from "./sam-mask";

export type Box = { x: number; y: number; w: number; h: number };
/** SAM's pick: the box, and its decoded one-bit mask when it sent one (ADR 0081). */
export type SamHit = { box: Box; mask: WireMask | null };

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
): Promise<SamHit | null> {
  try {
    const res = await fetch("https://api.meta.ai/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "sam-3.1",
        // one_bit: a binary mask per object, decoded here with Meta's own parser (ADR 0081).
        metadata: { mask_encoding: "one_bit" },
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
    // Several objects can come back: the most confident plausible one wins. Over 60% of the frame is
    // the room or the person; under 1% is text on the object, never the object.
    const ok = (await parseSamText(text))
      .filter((i) => {
        const a = (i.box.w * i.box.h) / (1600 * 1600);
        return a <= 0.6 && a >= 0.01;
      })
      .sort((a, b) => b.conf - a.conf);
    return ok.length ? { box: ok[0].box, mask: ok[0].mask } : null;
  } catch {
    return null;
  }
}

export async function segmentPhoto(
  imageDataUrl: string,
  prompt: string,
  extra: string[] = [],
): Promise<SamHit | null> {
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
        const h = boxes[j];
        const box = h?.box;
        console.info(`[photo] sam "${batch[j]}" -> ${box ? `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.w)}x${Math.round(box.h)}${h.mask ? " +mask" : ""}` : "none"}`);
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
