import { Texture } from "pixi.js";
import { canUseSpriteSheet } from "../ontology";
import { loadAll } from "./art-late";

// Loads an AI sprite sheet (flat magenta background), chroma-keys it, splits
// it into frames by empty columns, trims each frame, and returns Pixi textures
// in left-to-right order. Falls back to [] on any failure (rect art remains).

export function isMagenta(r: number, g: number, b: number): boolean {
  return r > 180 && g < 110 && b > 180;
}

/**
 * Every sheet at once (bead 8zu): loaded in sequence, one stalled sheet held up the others.
 * `load` is injectable so the concurrency rule is testable without a DOM.
 */
export async function loadSubjects(
  map: Record<string, string>,
  load: (url: string) => Promise<Texture[]> = loadSpriteSheet,
): Promise<Record<string, Texture[]>> {
  return loadAll(map, load);
}

export const PROJECTILE_PATTERN = /bullet|shot|projectile|arrow|fireball|laser|bolt|pellet|plasma/i;

export function isProjectileType(type: string): boolean {
  return PROJECTILE_PATTERN.test(type);
}

export function framesFor(
  framesBySubject: Record<string, Texture[]>,
  entityType: string,
  isPlayer: boolean,
): Texture[] {
  if (isPlayer) return framesBySubject["ninja"] ?? [];
  if (!canUseSpriteSheet(entityType)) return [];
  const lower = entityType.toLowerCase();
  if (isProjectileType(lower)) return [];
  // A flying sheet is keyed "<base>-fly" (ADR 0053): match on the base, and prefer the longest
  // matching key so "cat-fly" wins over a cached walking "cat" for the same subject.
  let best: string | undefined;
  for (const key of Object.keys(framesBySubject).sort()) {
    if (!canUseSpriteSheet(key)) continue;
    const base = key.toLowerCase().replace(/-fly$/, "");
    if (lower.includes(base) && (best === undefined || key.length > best.length)) best = key;
  }
  return best === undefined ? [] : framesBySubject[best];
}

export function computePrimaries(
  entities: { id: number; owner?: string; type: string; w: number; h: number }[],
  framesBySubject: Record<string, Texture[]>,
  hasCustomLook?: (type: string) => boolean,
): Set<number> {
  const primaries = new Set<number>();
  const groups = new Map<string, { maxArea: number; items: { id: number; area: number }[] }>();
  for (const e of entities) {
    const frames = framesFor(framesBySubject, e.type, e.type === "player");
    if (frames.length < 1 || (hasCustomLook && hasCustomLook(e.type))) continue;
    const subject = Object.entries(framesBySubject).find(([, v]) => v === frames)?.[0] ?? e.type;
    const gk = `${e.owner ?? ""}|${subject}`;
    const area = e.w * e.h;
    let g = groups.get(gk);
    if (!g) { g = { maxArea: area, items: [] }; groups.set(gk, g); }
    if (area > g.maxArea) g.maxArea = area;
    g.items.push({ id: e.id, area });
  }
  for (const g of groups.values()) {
    for (const item of g.items) {
      if (item.area >= 0.3 * g.maxArea) primaries.add(item.id);
    }
  }
  return primaries;
}

/**
 * Resolve once the image can be drawn, whatever happens — never hang.
 * `img.decode()` is the fast path but Chrome defers it while the tab is not the
 * focused window, and the promise then never settles. The boot sequence awaits
 * this loader, so a deferred decode used to leave a cold, unfocused first visit
 * stuck on a black screen ("Server: connecting…") with no mods and no error.
 * `load`/`error` and a timeout cover that case; a late decode just warms the cache.
 */
function imageDrawable(img: HTMLImageElement, timeoutMs: number): Promise<boolean> {
  const ready = (): boolean => img.complete && img.naturalWidth > 0;
  if (ready()) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    img.addEventListener("load", () => finish(ready()), { once: true });
    img.addEventListener("error", () => finish(false), { once: true });
    void img.decode?.().then(() => finish(ready())).catch(() => { /* the load/error listeners still decide */ });
    setTimeout(() => finish(ready()), timeoutMs);
  });
}

/** How long one sprite sheet may hold up the boot. Sheets are ~150 KB; 6 s is a stall, not a slow network. */
const SHEET_TIMEOUT_MS = 6000;

export interface FrameBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Deterministically find the true bounding box for each pose in an AI-generated
 * sprite sheet (flat solid magenta background, 4 poses in 1 row).
 * Never assumes 4 equal-width columns: detects actual occupied pixel runs,
 * recursively splits merged poses at occupancy valleys using image width ratios,
 * crops to the dominant vertical band, and trims tight horizontal bounds.
 */
export function findPoseBounds(
  w: number,
  h: number,
  px: Uint8ClampedArray | Uint8Array,
  targetFrames = 4,
): FrameBounds[] {
  // 1. Column occupancy (filter out stray alpha noise: > 2 occupied pixels)
  const colCount = new Uint32Array(w);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (px[(y * w + x) * 4 + 3] > 20) colCount[x]++;
    }
  }

  // 2. Identify initial contiguous occupied runs separated by >4 empty columns
  const runs: { x0: number; x1: number }[] = [];
  let start = -1;
  let gap = 0;
  for (let x = 0; x < w; x++) {
    if (colCount[x] > 2) {
      if (start < 0) start = x;
      gap = 0;
    } else if (start >= 0 && ++gap > 4) {
      runs.push({ x0: start, x1: x - gap });
      start = -1;
      gap = 0;
    }
  }
  if (start >= 0) runs.push({ x0: start, x1: w - 1 });

  // 3. Recursively split merged poses at the column with lowest pixel occupancy (valley).
  // Dynamic threshold based on image width rather than a hardcoded 520 px.
  const maxPoseW = Math.round(w * 0.28);
  const splitCutoff = Math.min(maxPoseW, Math.round(w * 0.24));
  while (runs.length < targetFrames || runs.some((r) => r.x1 - r.x0 + 1 > maxPoseW)) {
    if (runs.length >= 6) break;
    let widest = -1, widestW = splitCutoff;
    for (let i = 0; i < runs.length; i++) {
      const wd = runs[i].x1 - runs[i].x0 + 1;
      if (wd > widestW) { widestW = wd; widest = i; }
    }
    if (widest < 0) break;
    const run = runs[widest];
    const span = run.x1 - run.x0;
    let bestX = -1, bestCount = Infinity;
    // Scan central 22% - 78% for the valley
    for (let x = Math.floor(run.x0 + span * 0.22); x < run.x0 + span * 0.78; x++) {
      const count = colCount[x];
      if (count < bestCount) { bestCount = count; bestX = x; }
    }
    if (bestX <= run.x0 || bestX >= run.x1) break;
    runs.splice(widest, 1, { x0: run.x0, x1: bestX - 1 }, { x0: bestX, x1: run.x1 });
  }

  // 4. For each run, find dominant vertical band and tight horizontal bounds
  const frames: FrameBounds[] = [];
  for (const run of runs) {
    const rowCount = new Int32Array(h);
    for (let y = 0; y < h; y++) {
      let count = 0;
      for (let x = run.x0; x <= run.x1; x++) {
        if (px[(y * w + x) * 4 + 3] > 20) count++;
      }
      rowCount[y] = count;
    }
    const bands: { top: number; bottom: number; total: number }[] = [];
    let cur: { top: number; bottom: number; total: number } | null = null;
    let emptyRun = 0;
    for (let y = 0; y < h; y++) {
      if (rowCount[y] > 0) {
        if (!cur) cur = { top: y, bottom: y, total: rowCount[y] };
        else if (emptyRun > 24) { bands.push(cur); cur = { top: y, bottom: y, total: rowCount[y] }; }
        else { cur.bottom = y; cur.total += rowCount[y]; }
        emptyRun = 0;
      } else if (cur) emptyRun++;
    }
    if (cur) bands.push(cur);
    if (bands.length === 0) continue;
    let best = bands[0];
    for (const b of bands) if (b.total > best.total) best = b;
    const y0 = best.top, y1 = best.bottom;
    if (y1 <= y0) continue;

    // Tight horizontal bounding box inside the vertical band
    let x0 = run.x1, x1 = run.x0;
    for (let y = y0; y <= y1; y++) {
      for (let x = run.x0; x <= run.x1; x++) {
        if (px[(y * w + x) * 4 + 3] > 20) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
        }
      }
    }
    if (x1 < x0) continue;
    frames.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  return frames;
}

export async function loadSpriteSheet(url: string): Promise<Texture[]> {
  try {
    const img = new Image();
    img.src = url;
    if (!(await imageDrawable(img, SHEET_TIMEOUT_MS))) return [];
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    // chroma-key magenta -> transparent
    for (let i = 0; i < px.length; i += 4) {
      if (isMagenta(px[i], px[i + 1], px[i + 2])) px[i + 3] = 0;
    }
    // despill / edge cleanup
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      if (Math.min(r, b) - g > 95 && r > 120 && b > 120) px[i + 3] = 0;
    }
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      let r = px[i];
      const g = px[i + 1];
      let b = px[i + 2];
      const m = Math.min(r, b);
      if (m - g > 28) {
        const pull = (m - g) * 0.65;
        r -= pull * (r / Math.max(1, m));
        b -= pull * (b / Math.max(1, m));
        px[i] = r;
        px[i + 2] = b;
      }
    }
    {
      const alphaCopy = new Uint8Array(w * h);
      for (let p = 0; p < w * h; p++) alphaCopy[p] = px[p * 4 + 3];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          if (alphaCopy[p] === 0) continue;
          const i = p * 4;
          const r = px[i], g = px[i + 1], b = px[i + 2];
          if (Math.min(r, b) - g <= 18) continue;
          const hasTransparentNeighbor =
            (x > 0 && alphaCopy[p - 1] === 0) ||
            (x < w - 1 && alphaCopy[p + 1] === 0) ||
            (y > 0 && alphaCopy[p - w] === 0) ||
            (y < h - 1 && alphaCopy[p + w] === 0);
          if (hasTransparentNeighbor) px[i + 3] = 0;
        }
      }
    }
    ctx.putImageData(data, 0, 0);

    const bounds = findPoseBounds(w, h, px);
    const textures: Texture[] = [];
    for (const b of bounds) {
      const frame = document.createElement("canvas");
      frame.width = b.w;
      frame.height = b.h;
      frame.getContext("2d")!.drawImage(canvas, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
      textures.push(Texture.from(frame));
    }
    return textures;
  } catch {
    return [];
  }
}
