import { Texture } from "pixi.js";

// Loads an AI sprite sheet (flat magenta background), chroma-keys it, splits
// it into frames by empty columns, trims each frame, and returns Pixi textures
// in left-to-right order. Falls back to [] on any failure (rect art remains).

function isMagenta(r: number, g: number, b: number): boolean {
  return r > 180 && g < 110 && b > 180;
}

export async function loadSubjects(map: Record<string, string>): Promise<Record<string, Texture[]>> {
  const out: Record<string, Texture[]> = {};
  for (const [subject, url] of Object.entries(map)) {
    out[subject] = await loadSpriteSheet(url);
  }
  return out;
}

export function framesFor(
  framesBySubject: Record<string, Texture[]>,
  entityType: string,
  isPlayer: boolean,
): Texture[] {
  if (isPlayer) return framesBySubject["ninja"] ?? [];
  const lower = entityType.toLowerCase();
  for (const key of Object.keys(framesBySubject).sort()) {
    if (lower.includes(key.toLowerCase())) return framesBySubject[key];
  }
  return [];
}

export async function loadSpriteSheet(url: string): Promise<Texture[]> {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
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
