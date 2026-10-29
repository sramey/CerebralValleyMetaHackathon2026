// "Make it spooky" (ADR 0017): one sentence restyles the whole world. A mood is a style anchor (words)
// plus a palette; the same anchor drives the code-drawn palette swap and the Muse Image edits of every
// AI sprite sheet, always edited from the ORIGINAL sheet so characters stay recognizable.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chat, loadEnv, SPARK } from "./meta";
import type { MoodSpec } from "../src/contract";

const IMAGE_EDIT_URL = "https://api.meta.ai/v1/images/edits";
const IMAGE_MODEL = "muse-image-1.0";

type Ambient = MoodSpec["ambient"];
const AMBIENTS: Ambient[] = ["none", "fog", "snow", "embers", "sparks"];

/** Hand-tuned looks for the moods we expect on stage; anything else is designed by Spark. */
export const PRESETS: Record<string, MoodSpec> = {
  spooky: {
    name: "spooky",
    anchor: "spooky moonlit night: desaturated purple-gray tones, pale cyan ghostly glow, eerie twilight shadows, moonlit fog",
    skyTop: 0x07040f, skyBottom: 0x2a1a3d, ridgeFar: 0x120a1c, ridgeNear: 0x1a1028, moon: 0xd9e6c0, star: 0x5a4a78,
    grass: 0x56634a, soil: 0x15101f, tint: 0x6a3fa0, grade: 0.35, dim: 0.8, fog: 0.5, vignette: 0.55, ambient: "fog",
  },
  snowy: {
    name: "snowy",
    anchor: "snowy winter night: icy blue and white, frost and snow covering everything, cold pale light",
    skyTop: 0x1c2b4a, skyBottom: 0x9db7d6, ridgeFar: 0x5d7396, ridgeNear: 0x7c93b3, moon: 0xffffff, star: 0xdce9ff,
    grass: 0xf2f8ff, soil: 0x8fa6c4, tint: 0xbfd8ff, grade: 0.3, dim: 1, fog: 0.2, vignette: 0.25, ambient: "snow",
  },
  neon: {
    name: "neon",
    anchor: "neon cyberpunk synthwave night: glowing magenta, cyan and electric violet on near-black, bright glowing outlines",
    skyTop: 0x0a0016, skyBottom: 0x4a0a63, ridgeFar: 0x1d0a3a, ridgeNear: 0x2b0f55, moon: 0xff4fd8, star: 0x00f0ff,
    grass: 0x00f5d4, soil: 0x2a0a4a, tint: 0xff2bd6, grade: 0.25, dim: 1, fog: 0.1, vignette: 0.35, ambient: "sparks",
  },
  daytime: {
    name: "daytime",
    anchor: "bright sunny daytime: clear cerulean blue sky, warm golden sunlight, vibrant green grass, crisp sunlit pixel art",
    skyTop: 0x2f80ed, skyBottom: 0x9be2ff, ridgeFar: 0x4a8c6f, ridgeNear: 0x357a5b, moon: 0xffe042, star: 0xffffff,
    grass: 0x45d66b, soil: 0x7a5230, tint: 0xfff4d6, grade: 0.08, dim: 1.05, fog: 0.08, vignette: 0.05, ambient: "none",
  },
  sunset: {
    name: "sunset",
    anchor: "warm golden-hour sunset: deep violet-indigo zenith to glowing amber-orange horizon, warm purple-amber hills, golden rim light",
    skyTop: 0x2c1654, skyBottom: 0xff7b42, ridgeFar: 0x47294c, ridgeNear: 0x2d1832, moon: 0xff9e3d, star: 0xffd2a6,
    grass: 0x5ca85b, soil: 0x47281e, tint: 0xff8a3d, grade: 0.22, dim: 0.96, fog: 0.18, vignette: 0.22, ambient: "embers",
  },
};
const ALIASES: Record<string, string> = {
  spooky: "spooky", scary: "spooky", creepy: "spooky", haunted: "spooky", halloween: "spooky", horror: "spooky",
  snowy: "snowy", snow: "snowy", winter: "snowy", icy: "snowy", frozen: "snowy",
  neon: "neon", cyberpunk: "neon", synthwave: "neon", vaporwave: "neon",
  daytime: "daytime", day: "daytime", sunny: "daytime", morning: "daytime", noon: "daytime", bright: "daytime", clear: "daytime", sunshine: "daytime",
  sunset: "sunset", dusk: "sunset", evening: "sunset", golden: "sunset", twilight: "sunset", dawn: "sunset", sunrise: "sunset",
};

export function moodKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "mood";
}

function hex(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.min(0xffffff, Math.round(v)));
  if (typeof v === "string") {
    const m = v.trim().replace(/^(#|0x)/i, "");
    if (/^[0-9a-f]{6}$/i.test(m)) return parseInt(m, 16);
  }
  return fallback;
}
const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

/** Validate a Spark-written mood JSON into a safe MoodSpec (colors clamped, unknown ambient dropped). */
export function parseMoodSpec(text: string, name: string): MoodSpec | null {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    const o = JSON.parse(text.slice(s, e + 1)) as Record<string, unknown>;
    if (typeof o.anchor !== "string" || o.anchor.length < 8) return null;
    const base = PRESETS.spooky;
    const ambient = AMBIENTS.includes(o.ambient as Ambient) ? (o.ambient as Ambient) : "none";
    return {
      name: moodKey(name),
      anchor: o.anchor.replace(/[\r\n"]+/g, " ").slice(0, 240),
      skyTop: hex(o.skyTop, base.skyTop), skyBottom: hex(o.skyBottom, base.skyBottom),
      ridgeFar: hex(o.ridgeFar, base.ridgeFar), ridgeNear: hex(o.ridgeNear, base.ridgeNear),
      moon: hex(o.moon, base.moon), star: hex(o.star, base.star),
      grass: hex(o.grass, base.grass), soil: hex(o.soil, base.soil),
      tint: hex(o.tint, base.tint), grade: num(o.grade, 0, 0.6, 0.25), dim: num(o.dim, 0.5, 1.2, 0.9),
      fog: num(o.fog, 0, 1, 0), vignette: num(o.vignette, 0, 0.8, 0.3), ambient,
    };
  } catch {
    return null;
  }
}

const MOOD_SYSTEM = `You art-direct a 2D pixel-art platformer. Given a mood or theme, reply with ONLY one JSON object, no markdown:
{"anchor":"one sentence describing the visual style in plain words (colors, lighting, texture, details) that an image editor can follow",
"skyTop":"#rrggbb","skyBottom":"#rrggbb","ridgeFar":"#rrggbb","ridgeNear":"#rrggbb","moon":"#rrggbb","star":"#rrggbb","grass":"#rrggbb","soil":"#rrggbb",
"tint":"#rrggbb (overall color wash)","grade":0-0.6 (wash strength),"dim":0.5-1.2 (brightness),"fog":0-1,"vignette":0-0.8,"ambient":"none"|"fog"|"snow"|"embers"|"sparks"}
Sky is a vertical gradient from skyTop to skyBottom; ridges are far hill silhouettes; grass is the ground's top edge, soil its speckles. Keep the whole picture readable.`;

/** The look for a mood word: a hand-tuned preset when we have one, otherwise Spark designs it (preset spooky as a safety net). */
export async function moodSpecFor(mood: string): Promise<MoodSpec> {
  const word = mood.toLowerCase().trim();
  for (const w of word.split(/[^a-z]+/)) if (ALIASES[w]) return PRESETS[ALIASES[w]];
  try {
    const res = await chat(SPARK, [
      { role: "system", content: MOOD_SYSTEM },
      { role: "user", content: `Mood: "${word.slice(0, 60)}"` },
    ], 700);
    const spec = parseMoodSpec(res.text, word);
    if (spec) return spec;
  } catch { /* fall through to the safety net */ }
  return { ...PRESETS.spooky, name: moodKey(word), anchor: `${word.slice(0, 60)} atmosphere` };
}

export function moodPrompt(anchor: string): string {
  return `Restyle this exact pixel-art sprite sheet for this mood: ${anchor}. Keep the SAME character or object, the same number of poses in the same layout and positions, the same chunky pixel-art style and dark outline. Change only colors, lighting, texture and small thematic details. Keep the flat solid magenta (#FF00FF) background exactly as it is. No text.`;
}

/** Soften words that can intermittently trip image-edit moderation on retry. */
export function softenAnchor(anchor: string, name: string): string {
  const cleaned = anchor
    .replace(/\b(graveyard|tattered|creepy|haunted|horror|scary|blood|gore|corpse|dead|skull|skeleton|zombie|kill|weapon)s?\b/gi, "stylized")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= 12 ? cleaned : `${name} palette: stylized lighting and atmospheric pixel-art colors`;
}

/** Strip extended VP8X/XMP metadata chunks from a WebP buffer, leaving a simple RIFF+WEBP+VP8/VP8L image. */
export function cleanWebp(b: Buffer<ArrayBuffer>): Buffer<ArrayBuffer> {
  if (b.length < 20 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return b;
  let off = 12;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4);
    const sz = b.readUInt32LE(off + 4);
    const padded = sz + (sz % 2);
    if ((id === "VP8 " || id === "VP8L") && off + 8 + padded <= b.length) {
      const chunk = b.subarray(off, off + 8 + padded);
      const out = Buffer.allocUnsafe(12 + chunk.length);
      out.write("RIFF", 0, "ascii");
      out.writeUInt32LE(4 + chunk.length, 4);
      out.write("WEBP", 8, "ascii");
      chunk.copy(out, 12);
      return out;
    }
    off += 8 + padded;
  }
  return b;
}

/** Where a sprite key's ORIGINAL sheet lives, or null when it is not one of ours. */
export function sheetPath(key: string, root = process.cwd()): string | null {
  if (!/^[a-z0-9-]{1,64}$/.test(key) || key.startsWith("photo") || key.includes("--")) return null;
  const p = key === "ninja" ? join(root, "public", "art", "ninja-sheet.webp")
    : key === "chicken" ? join(root, "public", "art", "chicken.webp")
    : join(root, "public", "art", "gen", `${key}.webp`);
  return existsSync(p) ? p : null;
}

export function restyledUrl(key: string, mood: string): string { return `/art/gen/${key}--${moodKey(mood)}.webp`; }

/**
 * Muse Image EDIT of one sheet toward the mood anchor; cached on disk per (key, mood).
 * Returns the public URL or null. Never throws.
 */
export async function restyleSheet(key: string, spec: MoodSpec, root = process.cwd()): Promise<{ url: string; cached: boolean } | null> {
  try {
    const src = sheetPath(key, root);
    if (!src) return null;
    const url = restyledUrl(key, spec.name);
    const out = join(root, "public", "art", "gen", `${key}--${moodKey(spec.name)}.webp`);
    if (existsSync(out)) return { url, cached: true };
    const apiKey = loadEnv();
    if (!apiKey) return null;
    const sheet = cleanWebp(readFileSync(src));
    let b64: string | undefined;
    for (let attempt = 0; attempt < 3 && !b64; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));
      try {
        const anchor = attempt === 0 ? spec.anchor : softenAnchor(spec.anchor, spec.name);
        const fd = new FormData();
        fd.append("model", IMAGE_MODEL);
        fd.append("prompt", moodPrompt(anchor));
        fd.append("image", new Blob([sheet], { type: "image/webp" }), "sheet.webp");
        fd.append("size", "1024x1024");
        const res = await fetch(IMAGE_EDIT_URL, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: fd, signal: AbortSignal.timeout(75_000) });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          console.log(`[mood] edit ${key} (attempt ${attempt + 1}) -> HTTP ${res.status} ${body.slice(0, 200)}`);
          continue;
        }
        b64 = ((await res.json()) as { data?: { b64_json?: string }[] })?.data?.[0]?.b64_json;
      } catch (err) {
        console.log(`[mood] edit ${key} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!b64) return null;
    mkdirSync(join(root, "public", "art", "gen"), { recursive: true });
    writeFileSync(out, Buffer.from(b64, "base64"));
    return { url, cached: false };
  } catch {
    return null;
  }
}

/** Run `fn` over items with at most `limit` in flight. */
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}
