// Smart object selection for camera capture and photo import.
//
// Solves bead bgh:
// - Clicking someone's hair selected only a tiny color patch instead of the whole head.
// - Clicking selects the whole connected object (grows generously, merges adjacent segments).
// - Allows subsequent clicks to add or remove segments.
// - Prefers the SAM box path when present, letting user toggle it.
//
// Pure on purpose (no DOM, no network): checkable headless in Vitest.

export interface Box {
  x: number; // 0..1600 coordinate space
  y: number; // 0..1600 coordinate space
  w: number;
  h: number;
}

export interface Segment {
  id: number;
  pixels: number[];
  count: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  avgColor: [number, number, number];
  touchesBorder: boolean;
  borderPixelCount: number;
  neighbors: Set<number>;
  isBackground: boolean;
}

export interface SegmentationResult {
  w: number;
  h: number;
  segmentMap: Int32Array;
  segments: Segment[];
  backgroundSegmentIds: Set<number>;
}

export interface SelectionState {
  activeSegments: Set<number>;
  mask: Uint8Array;
  count: number;
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
  box1600: Box | null;
}

/** Check if normalized point (0..1) is inside a 1600-space box (with optional fractional margin). */
export function isPointInBox(fx: number, fy: number, box: Box, margin = 0.04): boolean {
  const x0 = box.x / 1600 - margin;
  const y0 = box.y / 1600 - margin;
  const x1 = (box.x + box.w) / 1600 + margin;
  const y1 = (box.y + box.h) / 1600 + margin;
  return fx >= x0 && fx <= x1 && fy >= y0 && fy <= y1;
}

/** Compute color distance in RGB space (max channel difference). */
export function colorDiff(c1: readonly number[], c2: readonly number[]): number {
  return Math.max(Math.abs(c1[0] - c2[0]), Math.abs(c1[1] - c2[1]), Math.abs(c1[2] - c2[2]));
}

/**
 * Segment an image into connected components of quantized color, build an adjacency graph,
 * and identify background segments (corners, perimeter, and connected outer regions).
 */
export function segmentImage(
  img: { w: number; h: number; data: Uint8ClampedArray | Uint8Array },
  step = 24,
): SegmentationResult {
  const { w, h, data } = img;
  const total = w * h;
  const visited = new Uint8Array(total);
  const segmentMap = new Int32Array(total);
  segmentMap.fill(-1);
  const segments: Segment[] = [];
  const queue = new Int32Array(total);

  // Quantized color key (rgb packed into integer)
  const colorKey = (p: number): number => {
    const o = p * 4;
    // Transparent pixels share a unique key
    if (data[o + 3] < 128) return -1;
    const qr = Math.floor(data[o] / step);
    const qg = Math.floor(data[o + 1] / step);
    const qb = Math.floor(data[o + 2] / step);
    return (qr << 16) | (qg << 8) | qb;
  };

  for (let s = 0; s < total; s++) {
    if (visited[s]) continue;
    const segId = segments.length;
    let qh = 0, qt = 0;
    queue[qt++] = s;
    visited[s] = 1;
    segmentMap[s] = segId;

    const pixels: number[] = [];
    const targetKey = colorKey(s);
    let minX = w, maxX = -1, minY = h, maxY = -1;
    let sumR = 0, sumG = 0, sumB = 0;
    let borderCount = 0;

    while (qh < qt) {
      const p = queue[qh++];
      pixels.push(p);
      const x = p % w;
      const y = (p - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const isBorder = (x === 0 || x === w - 1 || y === 0 || y === h - 1);
      if (isBorder) borderCount++;

      const o = p * 4;
      sumR += data[o];
      sumG += data[o + 1];
      sumB += data[o + 2];

      const n1 = x > 0 ? p - 1 : -1;
      const n2 = x < w - 1 ? p + 1 : -1;
      const n3 = y > 0 ? p - w : -1;
      const n4 = y < h - 1 ? p + w : -1;

      for (const n of [n1, n2, n3, n4]) {
        if (n >= 0 && !visited[n] && colorKey(n) === targetKey) {
          visited[n] = 1;
          segmentMap[n] = segId;
          queue[qt++] = n;
        }
      }
    }

    const count = pixels.length;
    segments.push({
      id: segId,
      pixels,
      count,
      minX,
      maxX,
      minY,
      maxY,
      avgColor: [
        count > 0 ? Math.round(sumR / count) : 0,
        count > 0 ? Math.round(sumG / count) : 0,
        count > 0 ? Math.round(sumB / count) : 0,
      ],
      touchesBorder: borderCount > 0,
      borderPixelCount: borderCount,
      neighbors: new Set<number>(),
      isBackground: targetKey === -1, // transparent is automatically background
    });
  }

  // Build adjacency graph between segments
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const s = segmentMap[p];
      if (x < w - 1) {
        const sRight = segmentMap[p + 1];
        if (s !== sRight) {
          segments[s].neighbors.add(sRight);
          segments[sRight].neighbors.add(s);
        }
      }
      if (y < h - 1) {
        const sDown = segmentMap[p + w];
        if (s !== sDown) {
          segments[s].neighbors.add(sDown);
          segments[sDown].neighbors.add(s);
        }
      }
    }
  }

  // Background identification
  const perimeterTotal = 2 * (w + h) - 4;
  const backgroundSegmentIds = new Set<number>();

  // Check 4 corners of the image
  const corners = [0, w - 1, (h - 1) * w, h * w - 1];
  const cornerSegIds = new Set<number>();
  for (const c of corners) {
    if (c >= 0 && c < total && segmentMap[c] >= 0) {
      cornerSegIds.add(segmentMap[c]);
    }
  }

  for (const seg of segments) {
    if (seg.isBackground) {
      backgroundSegmentIds.add(seg.id);
      continue;
    }
    const isCorner = cornerSegIds.has(seg.id);
    const perimShare = seg.borderPixelCount / Math.max(1, perimeterTotal);
    const areaShare = seg.count / total;

    // Definite background if:
    // 1. Located at a corner
    // 2. Touches a significant portion of perimeter (> 5%)
    // 3. Dominates the image area (> 30%) and touches outer border
    if (isCorner || (seg.touchesBorder && perimShare > 0.05) || (seg.touchesBorder && areaShare > 0.30)) {
      seg.isBackground = true;
      backgroundSegmentIds.add(seg.id);
    }
  }

  // Expand background to contiguous border-touching segments with similar color to confirmed background
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const bgId of Array.from(backgroundSegmentIds)) {
      const bgSeg = segments[bgId];
      for (const nbrId of bgSeg.neighbors) {
        if (backgroundSegmentIds.has(nbrId)) continue;
        const nbr = segments[nbrId];
        if (nbr.touchesBorder && colorDiff(bgSeg.avgColor, nbr.avgColor) < 36) {
          nbr.isBackground = true;
          backgroundSegmentIds.add(nbrId);
          expanded = true;
        }
      }
    }
  }

  return { w, h, segmentMap, segments, backgroundSegmentIds };
}

/**
 * Build a SelectionState from an active set of segment IDs.
 * Applies hole-filling and generous 1-pixel dilation so the selected object is solid and complete.
 */
export function buildSelectionState(
  segResult: SegmentationResult,
  activeSegments: Set<number>,
): SelectionState {
  const { w, h, segments } = segResult;
  const total = w * h;

  if (activeSegments.size === 0) {
    return {
      activeSegments: new Set(),
      mask: new Uint8Array(total),
      count: 0,
      bbox: null,
      box1600: null,
    };
  }

  const rawMask = new Uint8Array(total);
  for (const segId of activeSegments) {
    const seg = segments[segId];
    if (!seg) continue;
    for (const p of seg.pixels) {
      rawMask[p] = 1;
    }
  }

  // 1. Hole-filling: flood-fill outside pixels from the borders of the image
  // Any unselected pixel that cannot reach the edge is an internal hole -> fill it
  const outside = new Uint8Array(total);
  const q = new Int32Array(total);
  let qh = 0, qt = 0;

  const pushEdge = (p: number): void => {
    if (!rawMask[p] && !outside[p]) {
      outside[p] = 1;
      q[qt++] = p;
    }
  };

  for (let x = 0; x < w; x++) {
    pushEdge(x);
    pushEdge((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    pushEdge(y * w);
    pushEdge(y * w + w - 1);
  }

  while (qh < qt) {
    const p = q[qh++];
    const x = p % w;
    const y = (p - x) / w;

    if (x > 0) {
      const n = p - 1;
      if (!rawMask[n] && !outside[n]) { outside[n] = 1; q[qt++] = n; }
    }
    if (x < w - 1) {
      const n = p + 1;
      if (!rawMask[n] && !outside[n]) { outside[n] = 1; q[qt++] = n; }
    }
    if (y > 0) {
      const n = p - w;
      if (!rawMask[n] && !outside[n]) { outside[n] = 1; q[qt++] = n; }
    }
    if (y < h - 1) {
      const n = p + w;
      if (!rawMask[n] && !outside[n]) { outside[n] = 1; q[qt++] = n; }
    }
  }

  // Pixels not reached from outside become selected (fills internal gaps/pupils/strands)
  const solidMask = new Uint8Array(total);
  for (let p = 0; p < total; p++) {
    if (rawMask[p] || !outside[p]) solidMask[p] = 1;
  }

  // 2. Generous dilation: 1-pixel expansion in 4 directions
  const dilatedMask = new Uint8Array(solidMask);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (solidMask[p]) {
        if (x > 0) dilatedMask[p - 1] = 1;
        if (x < w - 1) dilatedMask[p + 1] = 1;
        if (y > 0) dilatedMask[p - w] = 1;
        if (y < h - 1) dilatedMask[p + w] = 1;
      }
    }
  }

  // Compute bounding box & count
  let minX = w, maxX = -1, minY = h, maxY = -1, count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (dilatedMask[y * w + x]) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (count === 0 || maxX < minX || maxY < minY) {
    return {
      activeSegments: new Set(),
      mask: new Uint8Array(total),
      count: 0,
      bbox: null,
      box1600: null,
    };
  }

  // Generous padding: 5% around the box
  const padX = Math.max(2, Math.round((maxX - minX) * 0.05));
  const padY = Math.max(2, Math.round((maxY - minY) * 0.05));
  const x0 = Math.max(0, minX - padX);
  const x1 = Math.min(w - 1, maxX + padX);
  const y0 = Math.max(0, minY - padY);
  const y1 = Math.min(h - 1, maxY + padY);

  const box1600: Box = {
    x: Math.round(x0 * 1600 / w),
    y: Math.round(y0 * 1600 / h),
    w: Math.round((x1 - x0 + 1) * 1600 / w),
    h: Math.round((y1 - y0 + 1) * 1600 / h),
  };

  return {
    activeSegments: new Set(activeSegments),
    mask: dilatedMask,
    count,
    bbox: { x0, y0, x1, y1 },
    box1600,
  };
}

/**
 * Handle a click at normalized point (fx, fy) on the image.
 * - If the clicked segment is already selected: REMOVES it from the selection.
 * - If the clicked segment is unselected: GROWS the object generously by merging
 *   connected adjacent non-background segments, and ADDS them to the selection.
 */
export function toggleSelectionAtPoint(
  segResult: SegmentationResult,
  fx: number,
  fy: number,
  currentActive: Set<number> = new Set(),
): SelectionState {
  const { w, h, segmentMap, segments } = segResult;
  const sx = Math.min(w - 1, Math.max(0, Math.floor(fx * w)));
  const sy = Math.min(h - 1, Math.max(0, Math.floor(fy * h)));
  const p = sy * w + sx;
  const clickedId = segmentMap[p];

  if (clickedId < 0 || clickedId >= segments.length) {
    return buildSelectionState(segResult, currentActive);
  }

  // If already active: REMOVE action
  if (currentActive.has(clickedId)) {
    const nextActive = new Set(currentActive);
    nextActive.delete(clickedId);
    return buildSelectionState(segResult, nextActive);
  }

  // Unselected: ADD action (grow generously across adjacent foreground segments)
  const nextActive = new Set(currentActive);
  const clickedSeg = segments[clickedId];

  // If the clicked segment is marked as background, still select it specifically if user clicked it
  if (clickedSeg.isBackground) {
    nextActive.add(clickedId);
    return buildSelectionState(segResult, nextActive);
  }

  // BFS to merge all connected foreground (non-background) segments belonging to the same object
  const toAdd = new Set<number>([clickedId]);
  const queue = [clickedId];

  while (queue.length > 0) {
    const currId = queue.shift()!;
    const curr = segments[currId];
    if (!curr) continue;

    for (const nbrId of curr.neighbors) {
      if (toAdd.has(nbrId)) continue;
      const nbr = segments[nbrId];
      if (!nbr || nbr.isBackground) continue; // Boundary stop: never leak into background!

      toAdd.add(nbrId);
      queue.push(nbrId);
    }
  }

  for (const id of toAdd) nextActive.add(id);
  return buildSelectionState(segResult, nextActive);
}
