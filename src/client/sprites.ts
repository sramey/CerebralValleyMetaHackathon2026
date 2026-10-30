import { Texture } from "pixi.js";
import { canUseSpriteSheet } from "../ontology";
import { loadAll } from "./art-late";

// Loads an AI sprite sheet (flat magenta background), chroma-keys it, splits
// it into frames by empty columns, trims each frame, and returns Pixi textures
// in left-to-right order. Falls back to [] on any failure (rect art remains).

function isMagenta(r: number, g: number, b: number): boolean {
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
  for (const key of Object.keys(framesBySubject).sort()) {
    if (!canUseSpriteSheet(key)) continue;
    if (lower.includes(key.toLowerCase())) return framesBySubject[key];
  }
  return [];
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

    // column occupancy -> frame runs separated by >12 empty columns
    const colHas = new Uint8Array(w);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        if (px[(y * w + x) * 4 + 3] > 20) { colHas[x] = 1; break; }
      }
    }
    const runs: { x0: number; x1: number }[] = [];
    let start = -1;
    let gap = 0;
    for (let x = 0; x < w; x++) {
      if (colHas[x]) {
        if (start < 0) start = x;
        gap = 0;
      } else if (start >= 0 && ++gap > 5) {
        runs.push({ x0: start, x1: x - gap });
        start = -1; gap = 0;
      }
    }
    if (start >= 0) runs.push({ x0: start, x1: w - 1 });
    // Split merged poses recursively: repeatedly cut the widest run wider
    // than 520px at its emptiest column in the central 25%-75%, re-examining
    // spliced pieces, until no run exceeds 520px or there are 6 runs.
    while (runs.length < 6) {
      let widest = -1, widestW = 520;
      for (let i = 0; i < runs.length; i++) {
        const wd = runs[i].x1 - runs[i].x0 + 1;
        if (wd > widestW) { widestW = wd; widest = i; }
      }
      if (widest < 0) break;
      const run = runs[widest];
      const span = run.x1 - run.x0;
      let bestX = -1, bestCount = Infinity;
      for (let x = Math.floor(run.x0 + span * 0.25); x < run.x0 + span * 0.75; x++) {
        let count = 0;
        for (let y = 0; y < h; y++) if (px[(y * w + x) * 4 + 3] > 20) count++;
        if (count < bestCount) { bestCount = count; bestX = x; }
      }
      if (bestX <= run.x0 || bestX >= run.x1) break;
      runs.splice(widest, 1, { x0: run.x0, x1: bestX - 1 }, { x0: bestX, x1: run.x1 });
    }

    const textures: Texture[] = [];
    for (const run of runs) {
      // Band crop: split occupied rows into bands separated by >24 empty
      // rows and keep only the band with the most occupied pixels, so a
      // stray object above/below the pose does not stretch the frame.
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
          if (!cur) {
            cur = { top: y, bottom: y, total: rowCount[y] };
          } else if (emptyRun > 24) {
            bands.push(cur);
            cur = { top: y, bottom: y, total: rowCount[y] };
          } else {
            cur.bottom = y;
            cur.total += rowCount[y];
          }
          emptyRun = 0;
        } else if (cur) {
          emptyRun++;
        }
      }
      if (cur) bands.push(cur);
      if (bands.length === 0) continue;
      let best = bands[0];
      for (const band of bands) if (band.total > best.total) best = band;
      const y0 = best.top;
      const y1 = best.bottom;
      if (y1 <= y0) continue;
      const fw = run.x1 - run.x0 + 1;
      const fh = y1 - y0 + 1;
      const frame = document.createElement("canvas");
      frame.width = fw;
      frame.height = fh;
      frame.getContext("2d")!.drawImage(canvas, run.x0, y0, fw, fh, 0, 0, fw, fh);
      textures.push(Texture.from(frame));
    }
    return textures;
  } catch {
    return [];
  }
}
