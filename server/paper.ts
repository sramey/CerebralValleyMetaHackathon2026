// Paper to level (ADR 0040): a photographed hand-drawn level drawing -> a verified, playable level mod.
//
// Reuses the sketch compiler (server/sketch.ts) and photo capture (server/photo.ts).
// 1. Detects paper sheet bounds in the photo (perspective-tolerant).
// 2. Multimodal Wonder reads the photograph and returns the level-spec JSON.
// 3. Normalizes and maps paper coordinates to stage world space (ground line y = 400).
// 4. Compiles, verifies, and hot-loads the mod, replacing the starter level.
// 5. Fallback: if no drawing is spotted, asks the player to retake the photo.
import { inflateSync } from "node:zlib";
import type { BuildStage } from "../src/contract";
import type { ChatMessage } from "./meta";
import {
  isEmptyLevel,
  levelToModSource,
  normalizeLevel,
  parseSketchLevel,
  type SketchBox,
  type SketchLevel,
  type SketchPlatform,
  type SketchPlatformKind,
  type SketchResult,
} from "./sketch";

/** Bounding box of the paper sheet in the photograph (pixel space or normalized [0..1]). */
export interface PaperBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Stage coordinate mapping bounds: world rectangle where the paper level lands. */
export const STAGE = {
  left: 40,
  right: 1480,
  width: 1440,
  skyY: -150,
  groundY: 400,
  height: 550, // groundY - skyY
};

export const PAPER_SYSTEM = `You read photographs of hand-drawn Level Sketches on paper for a 2D side-scrolling platformer and answer with ONE JSON object.
A kid drew a platformer level on paper and photographed it. The photo may have perspective tilt, shadows, or desk background around the paper.
Identify the paper sheet and every hand-drawn game element on it:
- Platforms / ledges (horizontal bars, stairs, floating blocks) -> kind: "ledge" (thin jump-through) or "wall" (solid block)
- Moving platforms (arrows or sliders) -> kind: "moving"
- Trampolines / springs (bouncy pads, springs) -> kind: "bouncer"
- Coins (circles, stars, dots, gold marks) -> coins
- Enemies (monsters, spikes, walkers, skulls) -> enemies

Coordinates:
Report coordinates in normalized paper units (0 to 1000):
- (0, 0) is the TOP-LEFT corner of the drawn level on the paper.
- (1000, 1000) is the BOTTOM-RIGHT corner of the drawn level on the paper.
- The ground / lowest surface is near y = 900..1000.
- Sky platforms are near y = 200..700.

Answer with JSON only, no markdown fence, no preamble:
{"name":"short evocative level name","platforms":[{"x":0,"y":0,"w":0,"h":0,"kind":"ledge"|"wall"|"moving"|"bouncer"}],"coins":[{"x":0,"y":0,"w":0,"h":0}],"enemies":[{"x":0,"y":0,"w":0,"h":0}]}

Rules:
- Give platforms reasonable paper thickness: 25-50 units high.
- Coins ~25x25 units, enemies ~40x40 units, placed on or just above platforms.
- If the photo is blank, blurry, has no recognizable hand-drawn level, or is an arbitrary object, return:
{"name":"empty","platforms":[],"coins":[],"enemies":[]}`;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const n2 = (v: number): number => Math.round(v * 100) / 100;

/** Extract width and height from a PNG data URL or buffer without external libraries. */
export function parsePngDimensions(dataUrlOrBuf: string | Buffer): { w: number; h: number } | null {
  try {
    let buf: Buffer;
    if (typeof dataUrlOrBuf === "string") {
      const idx = dataUrlOrBuf.indexOf("base64,");
      if (idx < 0) return null;
      buf = Buffer.from(dataUrlOrBuf.slice(idx + 7), "base64");
    } else {
      buf = dataUrlOrBuf;
    }
    if (buf.length < 24) return null;
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
    // IHDR starts at byte 12 (chunk data at 16)
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    return w > 0 && h > 0 ? { w, h } : null;
  } catch {
    return null;
  }
}

/**
 * Perspective-tolerant paper bounds detection.
 * Inspects a PNG image to locate the bright, off-white paper region against a darker background.
 * Falls back to 90% centered frame if the paper already fills the camera view or on decode failure.
 */
export function detectPaperBounds(pngDataUrl: string): PaperBounds {
  const dims = parsePngDimensions(pngDataUrl);
  const w = dims?.w ?? 640;
  const h = dims?.h ?? 480;
  const fallback: PaperBounds = {
    x: Math.round(w * 0.05),
    y: Math.round(h * 0.05),
    w: Math.round(w * 0.90),
    h: Math.round(h * 0.90),
  };

  try {
    const idx = pngDataUrl.indexOf("base64,");
    if (idx < 0) return fallback;
    const buf = Buffer.from(pngDataUrl.slice(idx + 7), "base64");

    // Extract IDAT chunks to decompress raw scanlines
    let offset = 8;
    const idatBuffers: Buffer[] = [];
    let colorType = 6; // default RGBA
    while (offset + 8 <= buf.length) {
      const len = buf.readUInt32BE(offset);
      const type = buf.toString("ascii", offset + 4, offset + 8);
      if (type === "IHDR") {
        colorType = buf[offset + 8 + 9];
      } else if (type === "IDAT") {
        idatBuffers.push(buf.subarray(offset + 8, offset + 8 + len));
      } else if (type === "IEND") {
        break;
      }
      offset += 12 + len;
    }

    if (idatBuffers.length === 0) return fallback;
    const decompressed = inflateSync(Buffer.concat(idatBuffers));

    const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
    const stride = w * channels;
    const scanlineLen = stride + 1;

    let minX = w, maxX = 0, minY = h, maxY = 0;
    let paperCount = 0;

    // Sample every 4th pixel for high speed
    for (let y = 0; y < h; y += 4) {
      const lineStart = y * scanlineLen + 1;
      for (let x = 0; x < w; x += 4) {
        const px = lineStart + x * channels;
        const r = decompressed[px];
        const g = channels >= 3 ? decompressed[px + 1] : r;
        const b = channels >= 3 ? decompressed[px + 2] : r;

        // Bright off-white / light paper pixel check: high luminance, low saturation
        const lum = (r * 2 + g * 3 + b) / 6;
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;

        if (lum > 175 && sat < 0.35) {
          paperCount++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    const totalSampled = (w / 4) * (h / 4);
    // If we found a distinct paper cluster (covering between 15% and 95% of image)
    if (paperCount > totalSampled * 0.15 && maxX > minX + 50 && maxY > minY + 50) {
      return {
        x: Math.max(0, minX),
        y: Math.max(0, minY),
        w: Math.min(w - minX, maxX - minX),
        h: Math.min(h - minY, maxY - minY),
      };
    }
  } catch {
    // Graceful fallback on any decompression glitch
  }

  return fallback;
}

/** Map coordinates from paper space into the Talk-to-Build game world stage. */
export function mapBoxToStage(
  b: { x: number; y: number; w: number; h: number },
  paperBounds?: PaperBounds,
  imgDims?: { w: number; h: number },
): SketchBox {
  let u: number;
  let v: number;
  let uw: number;
  let vh: number;

  // Case 1: Pixel coordinates within detected paper bounds
  if (
    paperBounds &&
    b.x >= paperBounds.x &&
    b.y >= paperBounds.y &&
    b.x <= paperBounds.x + paperBounds.w * 1.05 &&
    b.y <= paperBounds.y + paperBounds.h * 1.05
  ) {
    const pw = paperBounds.w || 640;
    const ph = paperBounds.h || 480;
    u = (b.x - paperBounds.x) / pw;
    v = (b.y - paperBounds.y) / ph;
    uw = b.w / pw;
    vh = b.h / ph;
  }
  // Case 2: Percentage coordinates [0..100]
  else if (Math.max(b.x, b.y, b.w, b.h) <= 100) {
    u = b.x / 100;
    v = b.y / 100;
    uw = b.w / 100;
    vh = b.h / 100;
  }
  // Case 3: Normalized paper units [0..1000] (default paper coordinates)
  else {
    u = b.x / 1000;
    v = b.y / 1000;
    uw = b.w / 1000;
    vh = b.h / 1000;
  }

  u = clamp(u, 0, 1);
  v = clamp(v, 0, 1);
  uw = clamp(uw, 0.01, 1);
  vh = clamp(vh, 0.01, 1);

  const stageX = STAGE.left + u * STAGE.width;
  const stageY = STAGE.skyY + v * STAGE.height;
  const stageW = uw * STAGE.width;
  const stageH = vh * STAGE.height;

  return {
    x: n2(stageX),
    y: n2(stageY),
    w: n2(stageW),
    h: n2(stageH),
  };
}

/** Turn the parsed level response into a stage-mapped SketchLevel. */
export function normalizePaperLevel(
  raw: unknown,
  paperBounds?: PaperBounds,
  imgDims?: { w: number; h: number },
): SketchLevel {
  const norm = normalizeLevel(raw);
  const platforms: SketchPlatform[] = [];
  const coins: SketchBox[] = [];
  const enemies: SketchBox[] = [];

  for (const p of norm.platforms) {
    const box = mapBoxToStage(p, paperBounds, imgDims);
    const h = p.kind === "bouncer" ? clamp(box.h, 14, 36) : p.kind === "wall" ? clamp(box.h, 24, 300) : clamp(box.h, 18, 40);
    platforms.push({ ...box, h, kind: p.kind });
  }

  for (const c of norm.coins) {
    const box = mapBoxToStage(c, paperBounds, imgDims);
    coins.push({
      x: n2(box.x + box.w / 2 - 8),
      y: n2(box.y + box.h / 2 - 8),
      w: 16,
      h: 16,
    });
  }

  for (const e of norm.enemies) {
    const box = mapBoxToStage(e, paperBounds, imgDims);
    enemies.push({
      x: n2(box.x + box.w / 2 - 14),
      y: n2(box.y + box.h / 2 - 14),
      w: 28,
      h: 28,
    });
  }

  return {
    name: norm.name === "Sketched level" ? "Paper level" : norm.name,
    platforms,
    coins,
    enemies,
  };
}

/** Parse multimodal Wonder's reply and map paper coordinates to the stage. */
export function parsePaperLevelReply(
  text: string,
  paperBounds?: PaperBounds,
  imgDims?: { w: number; h: number },
): { level?: SketchLevel; error?: string } {
  const parsed = parseSketchLevel(text);
  if (!parsed.level) return { error: parsed.error ?? "no level found in reply" };
  if (parsed.level.name.toLowerCase() === "empty" || isEmptyLevel(parsed.level)) {
    return { error: "the drawing had no platforms, coins or enemies" };
  }
  const level = normalizePaperLevel(parsed.level, paperBounds, imgDims);
  if (isEmptyLevel(level)) {
    return { error: "no usable platforms or items found" };
  }
  return { level };
}

export function paperPrompt(hint = "", bounds?: PaperBounds): string {
  const lines: string[] = [
    "The player held up or uploaded a photograph of a hand-drawn level sketch on paper.",
  ];
  if (bounds) {
    lines.push(`Detected paper sheet bounds in the photo: x=${bounds.x}, y=${bounds.y}, w=${bounds.w}, h=${bounds.h}.`);
  }
  if (hint.trim()) {
    lines.push(`The player named or described it: "${hint.trim().slice(0, 200)}"`);
  }
  lines.push("Extract the hand-drawn platforms, coins, and enemies inside the paper sheet.");
  lines.push("Map coordinates to normalized paper units 0..1000 (0=top/left, 1000=bottom/right).");
  lines.push("Reply with ONLY the JSON level object.");
  return lines.join("\n");
}

export interface PaperDeps {
  /** One multimodal Wonder call: sends the photographed drawing. */
  ask: (messages: ChatMessage[]) => Promise<string>;
  /** Compile, verify and hot-load the generated mod source. */
  deliver: (source: string) => Promise<{ ok: boolean; errors: string[] }>;
  say: (text: string) => void;
  stage: (stage: BuildStage, detail: string) => void;
  note?: (text: string) => void;
}

/**
 * Run the complete paper-to-level pipeline:
 * 1. Validate image data URL.
 * 2. Detect paper bounds.
 * 3. Multimodal Wonder reads the photo.
 * 4. Parse & map coordinates to the stage.
 * 5. Stroke-free fallback = ask the player to retake if unreadable.
 * 6. Compile & deliver verified mod.
 */
export async function runPaperBuild(
  deps: PaperDeps,
  msg: { image?: unknown; prompt?: unknown },
): Promise<SketchResult> {
  const failed = (why: string): SketchResult => {
    deps.say(why);
    return { ok: false, title: "", source: "", usedFallback: false };
  };

  if (
    typeof msg.image !== "string" ||
    !msg.image.startsWith("data:image/") ||
    msg.image.length < 256 ||
    msg.image.length >= 4_000_000
  ) {
    return failed("That photo didn't come through — try taking it again.");
  }

  const promptText = typeof msg.prompt === "string" ? msg.prompt.slice(0, 200) : "";
  const dims = parsePngDimensions(msg.image);
  const bounds = detectPaperBounds(msg.image);

  deps.stage("writing", "reading your paper drawing");
  deps.note?.(`detected paper bounds: ${bounds.x},${bounds.y} ${bounds.w}x${bounds.h}`);

  const body: ChatMessage[] = [
    { role: "system", content: PAPER_SYSTEM },
    {
      role: "user",
      content: [
        { type: "text", text: paperPrompt(promptText, bounds) },
        { type: "image_url", image_url: { url: msg.image } },
      ],
    },
  ];

  let level: SketchLevel | undefined;
  let error = "";

  for (let attempt = 0; attempt < 2 && !level; attempt++) {
    try {
      const text = await deps.ask(body);
      const parsed = parsePaperLevelReply(text, bounds, dims ?? undefined);
      if (parsed.level) level = parsed.level;
      else error = parsed.error ?? "could not read level";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    if (!level && attempt === 0) {
      deps.note?.(`first paper reply unusable (${error}), asking once more`);
      body.push({ role: "assistant", content: "(my last reply was not usable)" });
      body.push({
        role: "user",
        content: `That reply could not be used because ${error}. Reply with ONLY the JSON level object with platforms and items.`,
      });
    }
  }

  // Stroke-free fallback: ask to retake
  if (!level || isEmptyLevel(level)) {
    return failed(
      "I couldn't spot a clear level drawing on that paper. Draw with a darker pen or thicker lines, hold it steady, and try taking the photo again.",
    );
  }

  deps.stage("compiling", "building your paper level");
  let source = levelToModSource(level);
  let built = await deps.deliver(source);

  if (!built.ok) {
    deps.stage("fixing", "fixing the paper level");
    try {
      const fixBody: ChatMessage[] = [
        { role: "system", content: PAPER_SYSTEM },
        {
          role: "user",
          content: `This level spec failed verification:\n${JSON.stringify(level)}\nfailures:\n- ${built.errors.slice(0, 300).join("\n- ")}\nReply with a corrected JSON level object only.`,
        },
      ];
      const text = await deps.ask(fixBody);
      const parsed = parsePaperLevelReply(text, bounds, dims ?? undefined);
      if (parsed.level) {
        level = parsed.level;
        source = levelToModSource(level);
        deps.stage("compiling", "recompiling the fixed paper level");
        built = await deps.deliver(source);
      }
    } catch (err) {
      deps.note?.(`paper fix round failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!built.ok) {
    return failed(`That paper drawing didn't verify: ${built.errors.join("; ").slice(0, 300)}`);
  }

  const counts = [
    level.platforms.length > 0 ? `${level.platforms.length} platforms` : "",
    level.coins.length > 0 ? `${level.coins.length} coins` : "",
    level.enemies.length > 0 ? `${level.enemies.length} enemies` : "",
  ]
    .filter(Boolean)
    .join(", ");

  deps.say(`📄 ${level.name} is live: ${counts || "level"}!`);
  return { ok: true, title: level.name, source, level, usedFallback: false };
}
