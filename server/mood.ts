// "Make it spooky" (ADR 0017): one sentence restyles the whole world. A mood is a style anchor (words)
// plus a palette; the same anchor drives the code-drawn palette swap and the Muse Image edits of every
// AI sprite sheet, always edited from the ORIGINAL sheet so characters stay recognizable.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artPlanFor, canUseSpriteSheet, isHeldItemType } from "../src/ontology";
import { isFlyingRequest, isScenerySubject } from "./art";
import { chat, loadEnv, SPARK } from "./meta";
import { BACKDROP_MOTIFS, type ThemedBackdrop, type BackdropMotif, type MoodSpec } from "../src/contract";

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
  christmas: {
    name: "christmas",
    anchor: "festive Christmas holiday winter night: warm red, gold and pine-green accents, snow-frosted surfaces, twinkling holiday lights, cozy festive pixel-art details",
    skyTop: 0x0b1528, skyBottom: 0x1e3557, ridgeFar: 0x2a4068, ridgeNear: 0x3d5f82, moon: 0xfff4cc, star: 0xffe082,
    grass: 0xf4f9ff, soil: 0x5c2c24, tint: 0xffd8a8, grade: 0.22, dim: 1.0, fog: 0.15, vignette: 0.25, ambient: "snow",
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
  christmas: "christmas", xmas: "christmas", festive: "christmas", holiday: "christmas", santa: "christmas", yuletide: "christmas",
  daytime: "daytime", day: "daytime", sunny: "daytime", morning: "daytime", noon: "daytime", bright: "daytime", clear: "daytime", sunshine: "daytime",
  sunset: "sunset", dusk: "sunset", evening: "sunset", golden: "sunset", twilight: "sunset", dawn: "sunset", sunrise: "sunset",
};

/**
 * Themed backdrops we expect on stage (ADR 0067): a palette plus what stands in the parallax bands.
 * Anything else gets its backdrop from the same Spark call that designs the palette.
 */
export const BACKDROP_PRESETS: Record<string, MoodSpec> = {
  medieval: {
    name: "medieval",
    anchor: "medieval fantasy kingdom in golden afternoon light: stone castle on a hill, thatched village, warm earthy browns and greens",
    skyTop: 0x4a78b8, skyBottom: 0xf3cf96, ridgeFar: 0x6b7f93, ridgeNear: 0x4d6b55, moon: 0xfff1c4, star: 0xffffff,
    grass: 0x6fae4a, soil: 0x5a3d26, tint: 0xffd9a0, grade: 0.08, dim: 1, fog: 0.15, vignette: 0.2, ambient: "none",
    backdrop: { skyline: "mountains", landmark: "castle", far: ["village", "church", "tower", "windmill", "pine"], mid: ["oak", "village", "pine", "oak", "tent"], near: ["fence", "torch", "haybale", "banner", "well", "cart", "bush"] },
  },
  farm: {
    name: "farm",
    anchor: "Midwest farmland on a clear summer day: red barns, white farmhouses, silos, endless corn and golden hay under a big blue sky",
    skyTop: 0x2f7fe0, skyBottom: 0xaedcff, ridgeFar: 0x6f9a62, ridgeNear: 0x4f8a3c, moon: 0xffe9a0, star: 0xffffff,
    grass: 0x8fc94a, soil: 0x6b4a2b, tint: 0xfff0c8, grade: 0.06, dim: 1.03, fog: 0.05, vignette: 0.1, ambient: "none",
    backdrop: { skyline: "flat", landmark: "barn", far: ["silo", "farmhouse", "watertower", "windmill", "oak", "barn"], mid: ["corn", "oak", "corn", "haybale", "silo"], near: ["fence", "corn", "haybale", "fence", "bush"] },
  },
  desert: {
    name: "desert",
    anchor: "sun-baked desert at golden hour: sand dunes, ancient pyramids, palms and cacti, warm orange and ochre light",
    skyTop: 0x3f6fb5, skyBottom: 0xffc98a, ridgeFar: 0xc79a62, ridgeNear: 0xb5834e, moon: 0xfff0b0, star: 0xffffff,
    grass: 0xe0bf7a, soil: 0x9a6a3a, tint: 0xffcf8a, grade: 0.1, dim: 1.02, fog: 0.12, vignette: 0.18, ambient: "none",
    backdrop: { skyline: "hills", landmark: "pyramid", far: ["pyramid", "rock", "palm", "tent"], mid: ["palm", "cactus", "rock"], near: ["cactus", "rock", "bush", "cart"] },
  },
  city: {
    name: "city",
    anchor: "big city at dusk: tall skyscrapers with lit windows, street lamps, cool blue and warm amber lights",
    skyTop: 0x1a2350, skyBottom: 0xe0876a, ridgeFar: 0x3a3f5c, ridgeNear: 0x2c3046, moon: 0xffe0b0, star: 0xffffff,
    grass: 0x5f8f5a, soil: 0x3a3a44, tint: 0xffb98a, grade: 0.08, dim: 1, fog: 0.12, vignette: 0.25, ambient: "none",
    backdrop: { skyline: "hills", landmark: "city", far: ["city", "watertower", "city"], mid: ["oak", "city", "lamp"], near: ["lamp", "bush", "fence"] },
  },
};
const BACKDROP_ALIASES: Record<string, string> = {
  medieval: "medieval", medevil: "medieval", mideval: "medieval", medival: "medieval", medeval: "medieval", midevil: "medieval",
  castle: "medieval", castles: "medieval", kingdom: "medieval", village: "medieval", knight: "medieval", knights: "medieval", camelot: "medieval", fantasy: "medieval",
  farm: "farm", farms: "farm", farmland: "farm", countryside: "farm", barnyard: "farm", barn: "farm", ranch: "farm", rural: "farm", prairie: "farm",
  cornfield: "farm", corn: "farm", indiana: "farm", iowa: "farm", kansas: "farm", nebraska: "farm", ohio: "farm", illinois: "farm", midwest: "farm",
  desert: "desert", egypt: "desert", egyptian: "desert", sahara: "desert", pyramids: "desert", pyramid: "desert", dunes: "desert",
  city: "city", downtown: "city", skyline: "city", skyscrapers: "city", urban: "city", metropolis: "city",
};

const MOTIFS = new Set<string>(BACKDROP_MOTIFS);
const motifList = (v: unknown): BackdropMotif[] =>
  Array.isArray(v) ? v.map((m) => String(m).toLowerCase().trim()).filter((m): m is BackdropMotif => MOTIFS.has(m)).slice(0, 8) : [];

/** Validate a backdrop (Spark-written or stored): only known motifs survive; nothing to draw means no backdrop. */
export function parseBackdrop(raw: unknown): ThemedBackdrop | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const skyline = o.skyline === "flat" || o.skyline === "hills" ? o.skyline : "mountains";
  const landmark = typeof o.landmark === "string" && MOTIFS.has(o.landmark.toLowerCase()) ? (o.landmark.toLowerCase() as BackdropMotif) : undefined;
  const far = motifList(o.far), mid = motifList(o.mid), near = motifList(o.near);
  if (!landmark && far.length + mid.length + near.length === 0) return undefined;
  return { skyline, ...(landmark ? { landmark } : {}), far, mid, near };
}

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
      ...(parseBackdrop(o.backdrop) ? { backdrop: parseBackdrop(o.backdrop) } : {}),
    };
  } catch {
    return null;
  }
}

const MOOD_SYSTEM = `You art-direct a 2D pixel-art platformer. Given a mood or theme, reply with ONLY one JSON object, no markdown:
{"anchor":"one sentence describing the visual style in plain words (colors, lighting, texture, details) that an image editor can follow",
"skyTop":"#rrggbb","skyBottom":"#rrggbb","ridgeFar":"#rrggbb","ridgeNear":"#rrggbb","moon":"#rrggbb","star":"#rrggbb","grass":"#rrggbb","soil":"#rrggbb",
"tint":"#rrggbb (overall color wash)","grade":0-0.6 (wash strength),"dim":0.5-1.2 (brightness),"fog":0-1,"vignette":0-0.8,"ambient":"none"|"fog"|"snow"|"embers"|"sparks"}
Sky is a vertical gradient from skyTop to skyBottom; ridges are far hill silhouettes; grass is the ground's top edge, soil its speckles. Keep the whole picture readable.
When the theme is a PLACE or setting (a village, a farm, a city, a jungle, ancient Egypt), also add
"backdrop":{"skyline":"mountains"|"hills"|"flat","landmark":"<one motif>","far":[motifs],"mid":[motifs],"near":[motifs]}
using ONLY these motifs: ${BACKDROP_MOTIFS.join(", ")}. far = distant buildings and landmarks, mid = trees and big props, near = low props and fences. Leave "backdrop" out when no motif fits.`;

/**
 * The look for a mood word: a hand-tuned preset when we have one, otherwise Spark designs it (preset spooky as a safety net).
 * A backdrop preset word ("medieval", "indiana farm") brings its scenery; with a mood word too ("spooky castle")
 * the mood's palette wears the backdrop's scenery. `background` scopes it to the backdrop (ADR 0067): sprites keep
 * their look, so the colour wash stays light.
 */
export async function moodSpecFor(mood: string, opts: { background?: boolean } = {}): Promise<MoodSpec> {
  const spec = await designMood(mood);
  if (!opts.background) return spec;
  return { ...spec, scope: "background", grade: Math.min(spec.grade, 0.1), dim: Math.max(0.9, spec.dim) };
}

async function designMood(mood: string): Promise<MoodSpec> {
  const word = mood.toLowerCase().trim();
  const words = word.split(/[^a-z]+/);
  const moodHit = words.find((w) => ALIASES[w]);
  const backdropHit = words.find((w) => BACKDROP_ALIASES[w]);
  if (moodHit && backdropHit) {
    return { ...PRESETS[ALIASES[moodHit]], name: moodKey(`${ALIASES[moodHit]} ${BACKDROP_ALIASES[backdropHit]}`), backdrop: BACKDROP_PRESETS[BACKDROP_ALIASES[backdropHit]].backdrop };
  }
  if (moodHit) return PRESETS[ALIASES[moodHit]];
  if (backdropHit) return BACKDROP_PRESETS[BACKDROP_ALIASES[backdropHit]];
  try {
    const res = await chat(SPARK, [
      { role: "system", content: MOOD_SYSTEM },
      { role: "user", content: `Mood: "${word.slice(0, 60)}"` },
    ], 900);
    const spec = parseMoodSpec(res.text, word);
    if (spec) return spec;
  } catch { /* fall through to the safety net */ }
  return { ...PRESETS.spooky, name: moodKey(word), anchor: `${word.slice(0, 60)} atmosphere` };
}

export function moodPrompt(anchor: string, key?: string): string {
  const cleanKey = key ? key.replace(/-fly$/, "").replace(/[-_]+/g, " ").trim() : "";
  const subject = cleanKey || "character or object";
  const plan = key ? artPlanFor(key) : "sheet";
  const held = key ? (plan === "held-item" || isHeldItemType(key)) : false;
  const scenery = key ? (plan === "scenery" || isScenerySubject(cleanKey)) : false;
  const flying = key ? (key.endsWith("-fly") || isFlyingRequest("", cleanKey)) : false;

  let spec: string;
  if (held) {
    spec = `What it is: held item icon sheet containing ONLY the isolated object ${subject} by itself for a 2D side-scrolling platformer. ` +
      `Orientation: side view, pointing right. EXACTLY 4 variants of that single item in 1 single horizontal row from left to right. ` +
      `NO character, NO person, NO hands holding it, NO body, NO animation poses.`;
  } else if (scenery) {
    spec = `What it is: scenery sprite sheet containing ONLY ${subject} for a 2D side-scrolling platformer. ` +
      `Orientation: side view. EXACTLY 4 static variants of that single object in 1 single horizontal row from left to right, bottoms aligned on the same baseline. ` +
      `NOT a character, no face, no limbs, no animation poses.`;
  } else if (flying) {
    spec = `What it is: 2D side-scrolling platformer sprite sheet of ${subject} in flight, AIRBORNE. ` +
      `Orientation: strict side-scroller side view, facing right in ALL poses. Every pose MUST face right. NEVER face backwards or away from camera (NO rear view), NEVER front-facing, no top-down angles. ` +
      `Actions & layout: EXACTLY 4 airborne flight action poses in 1 single horizontal row from left to right, all facing right: (1) hovering idle facing right, (2) gliding forward facing right, (3) flapping/flying forward facing right, (4) diving/ascending facing right. ` +
      `NEVER multiple rows, NEVER a 2D grid. The ${subject} is off the ground in every pose, nothing underneath, no ground line.`;
  } else {
    spec = `What it is: 2D side-scrolling platformer sprite sheet of ${subject}. ` +
      `Orientation: strict side-scroller side view, facing right in ALL poses. Every pose MUST face right (looking right). NEVER face backwards or away from camera (NO rear view, NO back of the character facing away), NEVER front-facing (no RPG turnaround), no top-down angles. ` +
      `Actions & layout: EXACTLY 4 action poses in 1 single horizontal row from left to right, all facing right: (1) idle standing facing right, (2) running forward stride facing right, (3) running forward stride facing right, (4) jumping mid-air leap pose facing right. ` +
      `NEVER multiple rows, NEVER a 2D grid.`;
  }

  return `Restyle this exact pixel-art sprite sheet for this mood: ${anchor}. ` +
    `Keep the SAME character or object, the same chunky pixel-art style and dark outline. ` +
    `${spec} ` +
    `Change only colors, lighting, texture and small thematic details. ` +
    `Keep the flat solid magenta (#FF00FF) background exactly as it is, with wide empty magenta gaps between poses so poses do NOT touch or overlap each other. No text.`;
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
  if (key !== "ninja" && !canUseSpriteSheet(key)) return null;
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
        fd.append("prompt", moodPrompt(anchor, key));
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
