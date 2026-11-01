// One-shot object cut-out for "Bring an object in" (ADR 0081, bead samask).
//
// SAM 3.1 gives the object's BOX (its own mask comes back as an entropy-coded stream nobody
// outside Meta can decode, ADR 0081). Inside that box we cut the object out with a GrabCut-style
// foreground model (Gaussian-mixture colours + a min-cut), then finish the edge at the photo's
// own resolution: fill holes, keep the largest blob, 1 px erode (drops the background halo),
// crop, and either feather 1 px or leave a hard alpha for pixel art.
//
// No chroma key, no colour flood fill, no dilation hiding a bad edge, and never a low-res mask
// stretched over the full photo: the min-cut runs on a small working copy, and the full-res
// edge is then re-decided pixel by pixel from the photo's own colours inside a narrow band.
//
// Pure on purpose (no DOM, no network, no randomness): checkable headless in Vitest.

export interface Img { w: number; h: number; data: Uint8ClampedArray } // RGBA, row-major
/** Pixel box, x1/y1 exclusive. */
export interface PxBox { x0: number; y0: number; x1: number; y1: number }

const K = 5;
const EPS = 1e-9;

// ---- Gaussian mixture colour model ---------------------------------------------------------

interface Gmm { k: number; logw: Float64Array; mean: Float64Array; icov: Float64Array; lognorm: Float64Array }

function fitGmm(samples: Float64Array): Gmm | null {
  const n = samples.length / 3;
  if (n < 12) return null;
  const k = Math.min(K, Math.max(1, Math.floor(n / 40)));
  // Deterministic seeds: samples at luminance quantiles.
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) =>
    (samples[a * 3] + samples[a * 3 + 1] + samples[a * 3 + 2]) - (samples[b * 3] + samples[b * 3 + 1] + samples[b * 3 + 2]));
  const mean = new Float64Array(k * 3);
  for (let c = 0; c < k; c++) {
    const s = order[Math.min(n - 1, Math.floor(((c + 0.5) / k) * n))];
    for (let j = 0; j < 3; j++) mean[c * 3 + j] = samples[s * 3 + j];
  }
  const assign = new Int32Array(n);
  for (let it = 0; it < 8; it++) {
    const sum = new Float64Array(k * 3);
    const cnt = new Float64Array(k);
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const d0 = samples[i * 3] - mean[c * 3], d1 = samples[i * 3 + 1] - mean[c * 3 + 1], d2 = samples[i * 3 + 2] - mean[c * 3 + 2];
        const d = d0 * d0 + d1 * d1 + d2 * d2;
        if (d < bd) { bd = d; best = c; }
      }
      assign[i] = best;
      cnt[best]++;
      for (let j = 0; j < 3; j++) sum[best * 3 + j] += samples[i * 3 + j];
    }
    for (let c = 0; c < k; c++) if (cnt[c] > 0) for (let j = 0; j < 3; j++) mean[c * 3 + j] = sum[c * 3 + j] / cnt[c];
  }
  const cnt = new Float64Array(k);
  const cov = new Float64Array(k * 9);
  for (let i = 0; i < n; i++) {
    const c = assign[i];
    cnt[c]++;
    const d = [samples[i * 3] - mean[c * 3], samples[i * 3 + 1] - mean[c * 3 + 1], samples[i * 3 + 2] - mean[c * 3 + 2]];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[c * 9 + a * 3 + b] += d[a] * d[b];
  }
  const logw: number[] = [], means: number[] = [], icovs: number[] = [], lognorms: number[] = [];
  for (let c = 0; c < k; c++) {
    if (cnt[c] < 4) continue;
    const m = cov.subarray(c * 9, c * 9 + 9);
    for (let q = 0; q < 9; q++) m[q] /= cnt[c];
    for (let d = 0; d < 3; d++) m[d * 4] += 16; // regularise: ~4 grey levels of colour noise
    const [a, b, cc, , d, e, , , f] = [m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]];
    const det = a * (d * f - e * e) - b * (b * f - e * cc) + cc * (b * e - d * cc);
    if (det < 1e-6) continue;
    const inv = [
      (d * f - e * e) / det, (cc * e - b * f) / det, (b * e - cc * d) / det,
      0, (a * f - cc * cc) / det, (b * cc - a * e) / det,
      0, 0, (a * d - b * b) / det,
    ];
    inv[3] = inv[1]; inv[6] = inv[2]; inv[7] = inv[5];
    logw.push(Math.log(cnt[c] / n));
    means.push(mean[c * 3], mean[c * 3 + 1], mean[c * 3 + 2]);
    icovs.push(...inv);
    lognorms.push(-0.5 * Math.log(det) - 1.5 * Math.log(2 * Math.PI));
  }
  if (logw.length === 0) return null;
  return { k: logw.length, logw: Float64Array.from(logw), mean: Float64Array.from(means), icov: Float64Array.from(icovs), lognorm: Float64Array.from(lognorms) };
}

/** log p(colour) under the mixture. */
function logp(g: Gmm, r: number, gr: number, b: number): number {
  let best = -Infinity;
  const terms = new Array<number>(g.k);
  for (let c = 0; c < g.k; c++) {
    const d0 = r - g.mean[c * 3], d1 = gr - g.mean[c * 3 + 1], d2 = b - g.mean[c * 3 + 2];
    const i = c * 9;
    const q = d0 * (g.icov[i] * d0 + g.icov[i + 1] * d1 + g.icov[i + 2] * d2)
      + d1 * (g.icov[i + 3] * d0 + g.icov[i + 4] * d1 + g.icov[i + 5] * d2)
      + d2 * (g.icov[i + 6] * d0 + g.icov[i + 7] * d1 + g.icov[i + 8] * d2);
    const t = g.logw[c] + g.lognorm[c] - 0.5 * q;
    terms[c] = t;
    if (t > best) best = t;
  }
  let s = 0;
  for (let c = 0; c < g.k; c++) s += Math.exp(terms[c] - best);
  return best + Math.log(s);
}

// ---- Min-cut on the pixel grid (Dinic) -----------------------------------------------------

/** Returns 1 for pixels on the source (foreground) side. */
function minCut(w: number, h: number, sCap: Float64Array, tCap: Float64Array, wR: Float64Array, wD: Float64Array): Uint8Array {
  const n = w * h;
  // Residual capacity to the 4 neighbours: 0 left, 1 right, 2 up, 3 down.
  const nb = new Float64Array(n * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (x < w - 1) { nb[p * 4 + 1] = wR[p]; nb[(p + 1) * 4] = wR[p]; }
      if (y < h - 1) { nb[p * 4 + 3] = wD[p]; nb[(p + w) * 4 + 2] = wD[p]; }
    }
  }
  const nbr = (p: number, d: number): number => {
    const x = p % w;
    if (d === 0) return x > 0 ? p - 1 : -1;
    if (d === 1) return x < w - 1 ? p + 1 : -1;
    if (d === 2) return p >= w ? p - w : -1;
    return p < n - w ? p + w : -1;
  };
  const opp = [1, 0, 3, 2];
  const level = new Int32Array(n);
  const it = new Uint8Array(n);
  const queue = new Int32Array(n);
  const stack = new Int32Array(n);
  for (let phase = 0; phase < 4000; phase++) {
    level.fill(-1);
    let qh = 0, qt = 0;
    for (let p = 0; p < n; p++) if (sCap[p] > EPS) { level[p] = 1; queue[qt++] = p; }
    let reachT = false;
    while (qh < qt) {
      const p = queue[qh++];
      if (tCap[p] > EPS) reachT = true;
      for (let d = 0; d < 4; d++) {
        if (nb[p * 4 + d] <= EPS) continue;
        const q = nbr(p, d);
        if (q < 0 || level[q] >= 0) continue;
        level[q] = level[p] + 1;
        queue[qt++] = q;
      }
    }
    if (!reachT) break;
    it.fill(0);
    for (let start = 0; start < n; start++) {
      if (level[start] !== 1) continue;
      while (sCap[start] > EPS && level[start] === 1) {
        let sp = 0;
        stack[sp++] = start;
        let found = false;
        while (sp > 0) {
          const p = stack[sp - 1];
          if (tCap[p] > EPS) { found = true; break; }
          let advanced = false;
          while (it[p] < 4) {
            const d = it[p];
            const q = nbr(p, d);
            if (q >= 0 && nb[p * 4 + d] > EPS && level[q] === level[p] + 1) { stack[sp++] = q; advanced = true; break; }
            it[p]++;
          }
          if (!advanced) { level[p] = -2; sp--; if (sp > 0) it[stack[sp - 1]]++; }
        }
        if (!found) break;
        let f = sCap[start];
        for (let i = 0; i < sp - 1; i++) {
          const p = stack[i], q = stack[i + 1];
          for (let d = 0; d < 4; d++) if (nbr(p, d) === q) { f = Math.min(f, nb[p * 4 + d]); break; }
        }
        f = Math.min(f, tCap[stack[sp - 1]]);
        sCap[start] -= f;
        tCap[stack[sp - 1]] -= f;
        for (let i = 0; i < sp - 1; i++) {
          const p = stack[i], q = stack[i + 1];
          for (let d = 0; d < 4; d++) if (nbr(p, d) === q) { nb[p * 4 + d] -= f; nb[q * 4 + opp[d]] += f; break; }
        }
      }
    }
  }
  // Source side = reachable from the source in the residual graph.
  const out = new Uint8Array(n);
  let qh = 0, qt = 0;
  for (let p = 0; p < n; p++) if (sCap[p] > EPS) { out[p] = 1; queue[qt++] = p; }
  while (qh < qt) {
    const p = queue[qh++];
    for (let d = 0; d < 4; d++) {
      if (nb[p * 4 + d] <= EPS) continue;
      const q = nbr(p, d);
      if (q < 0 || out[q]) continue;
      out[q] = 1;
      queue[qt++] = q;
    }
  }
  return out;
}

// ---- Helpers --------------------------------------------------------------------------------

/** Area-average downscale to w x h (RGB only). */
function shrink(img: Img, ox: number, oy: number, cw: number, ch: number, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const sy0 = oy + Math.floor((y * ch) / h), sy1 = oy + Math.max(Math.floor(((y + 1) * ch) / h), Math.floor((y * ch) / h) + 1);
    for (let x = 0; x < w; x++) {
      const sx0 = ox + Math.floor((x * cw) / w), sx1 = ox + Math.max(Math.floor(((x + 1) * cw) / w), Math.floor((x * cw) / w) + 1);
      let r = 0, g = 0, b = 0, c = 0;
      for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) {
        const o = (yy * img.w + xx) * 4;
        r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; c++;
      }
      const o = (y * w + x) * 3;
      out[o] = r / c; out[o + 1] = g / c; out[o + 2] = b / c;
    }
  }
  return out;
}

// ---- GrabCut inside the SAM box -------------------------------------------------------------

export interface CutOptions {
  /** Longest side of the working copy the min-cut runs on. */
  work?: number;
  /** Cap on the full-res crop the edge is finished on (very large uploads are scaled down once, first). */
  maxSide?: number;
  iterations?: number;
}

/**
 * Foreground mask of the object inside `box`, at the photo's own resolution (img.w x img.h).
 * Everything outside the (slightly padded) box is background, the middle of the box is foreground.
 */
export function cutInBox(img: Img, box: PxBox, opts: CutOptions = {}): Uint8Array {
  const { w: W, h: H } = img;
  const full: Uint8Array = new Uint8Array(W * H);
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  if (bw < 4 || bh < 4) return full;
  // Crop = box + 12% context on every side.
  const padX = Math.max(3, Math.round(bw * 0.12)), padY = Math.max(3, Math.round(bh * 0.12));
  const cx0 = Math.max(0, box.x0 - padX), cy0 = Math.max(0, box.y0 - padY);
  const cx1 = Math.min(W, box.x1 + padX), cy1 = Math.min(H, box.y1 + padY);
  const cw = cx1 - cx0, ch = cy1 - cy0;
  const s = Math.min(1, (opts.work ?? 160) / Math.max(cw, ch));
  const w = Math.max(8, Math.round(cw * s)), h = Math.max(8, Math.round(ch * s));
  const rgb = shrink(img, cx0, cy0, cw, ch, w, h);

  // Box in working coordinates; a 1-px skin inside the box stays unknown, everything outside is sure background.
  const bx0 = Math.max(0, Math.floor((box.x0 - cx0) * w / cw)), by0 = Math.max(0, Math.floor((box.y0 - cy0) * h / ch));
  const bx1 = Math.min(w, Math.ceil((box.x1 - cx0) * w / cw)), by1 = Math.min(h, Math.ceil((box.y1 - cy0) * h / ch));
  // 0 sure bg, 1 sure fg, 2 unknown.
  const kind = new Uint8Array(w * h);
  const mx0 = bx0 + Math.floor((bx1 - bx0) * 0.35), mx1 = bx1 - Math.floor((bx1 - bx0) * 0.35);
  const my0 = by0 + Math.floor((by1 - by0) * 0.35), my1 = by1 - Math.floor((by1 - by0) * 0.35);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const inside = x >= bx0 && x < bx1 && y >= by0 && y < by1;
    kind[y * w + x] = !inside ? 0 : (x >= mx0 && x < mx1 && y >= my0 && y < my1 ? 1 : 2);
  }
  const n = w * h;

  // Contrast-sensitive smoothness weights (GrabCut's beta from the mean neighbour contrast).
  const dif = (a: number, b: number): number => {
    const d0 = rgb[a * 3] - rgb[b * 3], d1 = rgb[a * 3 + 1] - rgb[b * 3 + 1], d2 = rgb[a * 3 + 2] - rgb[b * 3 + 2];
    return d0 * d0 + d1 * d1 + d2 * d2;
  };
  let sumD = 0, cntD = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (x < w - 1) { sumD += dif(p, p + 1); cntD++; }
    if (y < h - 1) { sumD += dif(p, p + w); cntD++; }
  }
  const beta = 1 / (2 * Math.max(1, sumD / Math.max(1, cntD)));
  const lambda = 24;
  const wR = new Float64Array(n), wD = new Float64Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (x < w - 1) wR[p] = lambda * Math.exp(-beta * dif(p, p + 1));
    if (y < h - 1) wD[p] = lambda * Math.exp(-beta * dif(p, p + w));
  }

  // Initial labels: sure ones as given; unknown pixels start as background-ish if they look like the ring.
  const label = new Uint8Array(n); // 1 = fg
  for (let p = 0; p < n; p++) label[p] = kind[p] === 1 ? 1 : 0;
  let fg: Gmm | null = null, bg: Gmm | null = null;
  const BIG = 1e9;
  let sidedFg: Uint8Array = label;
  // Seed the first foreground model from the centre AND every in-box pixel that does not look like
  // the surroundings (rim, handle and shadow side are not in the centre); wall-coloured ones stay out.
  const seedFg = new Uint8Array(n);
  {
    const bgS0: number[] = [];
    for (let p = 0; p < n; p++) if (kind[p] === 0) bgS0.push(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]);
    const bg0 = fitGmm(Float64Array.from(bgS0));
    const ds: number[] = [];
    if (bg0) for (let p = 0; p < n; p++) if (kind[p] === 2) ds.push(-logp(bg0, rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]));
    const sorted = ds.slice().sort((a, b) => a - b);
    const thr = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : Infinity;
    for (let p = 0; p < n; p++) {
      if (kind[p] === 1) seedFg[p] = 1;
      else if (kind[p] === 2 && bg0 && -logp(bg0, rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]) >= thr) seedFg[p] = 1;
    }
  }
  // First pass: unknown pixels are classified by the models built from the sure sets.
  for (let iter = 0; iter < (opts.iterations ?? 4); iter++) {
    const fgS: number[] = [], bgS: number[] = [];
    for (let p = 0; p < n; p++) {
      const target = iter === 0 ? (seedFg[p] ? 1 : kind[p] === 0 ? 0 : -1) : sidedFg[p];
      if (target === 1) fgS.push(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]);
      else if (target === 0) bgS.push(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]);
    }
    fg = fitGmm(Float64Array.from(fgS)) ?? fg;
    bg = fitGmm(Float64Array.from(bgS)) ?? bg;
    if (!fg || !bg) return full;
    const sCap = new Float64Array(n), tCap = new Float64Array(n);
    for (let p = 0; p < n; p++) {
      if (kind[p] === 1) { sCap[p] = BIG; continue; }
      if (kind[p] === 0) { tCap[p] = BIG; continue; }
      const r = rgb[p * 3], g = rgb[p * 3 + 1], b = rgb[p * 3 + 2];
      const dFg = Math.min(40, -logp(fg, r, g, b)), dBg = Math.min(40, -logp(bg, r, g, b));
      // Cutting s->p labels p background (pay dBg); cutting p->t labels p foreground (pay dFg).
      sCap[p] = dBg;
      tCap[p] = dFg;
    }
    sidedFg = minCut(w, h, sCap, tCap, wR, wD);
  }
  const low = sidedFg;

  // ---- Finish the edge at full resolution -------------------------------------------------
  // Soft prior = bilinear sample of the low-res labels; decide only inside a band around the
  // low-res boundary, from the photo's own colours, and leave the sure inside/outside alone.
  const soft = (fx: number, fy: number): number => {
    const gx = Math.min(w - 1, Math.max(0, fx * w / cw - 0.5)), gy = Math.min(h - 1, Math.max(0, fy * h / ch - 0.5));
    const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    const ax = gx - x0, ay = gy - y0;
    return (low[y0 * w + x0] * (1 - ax) + low[y0 * w + x1] * ax) * (1 - ay) + (low[y1 * w + x0] * (1 - ax) + low[y1 * w + x1] * ax) * ay;
  };
  const bxMin = Math.max(cx0, box.x0), bxMax = Math.min(cx1, box.x1), byMin = Math.max(cy0, box.y0), byMax = Math.min(cy1, box.y1);
  const prior = new Float32Array(cw * ch);
  const score = new Float32Array(cw * ch);
  const band = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const p = y * cw + x;
    const sv = soft(x + 0.5, y + 0.5);
    prior[p] = sv;
    if (sv > 0.04 && sv < 0.96) band[p] = 1;
  }
  const pad = Math.ceil(1.5 / s);
  // Widen the band a little so the true edge can sit beside the coarse one.
  const widened = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    if (!band[y * cw + x]) continue;
    for (let yy = Math.max(0, y - pad); yy <= Math.min(ch - 1, y + pad); yy++) for (let xx = Math.max(0, x - pad); xx <= Math.min(cw - 1, x + pad); xx++) widened[yy * cw + xx] = 1;
  }
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const p = y * cw + x;
    if (!widened[p]) continue;
    const o = ((y + cy0) * W + (x + cx0)) * 4;
    score[p] = Math.max(-8, Math.min(8, logp(fg!, img.data[o], img.data[o + 1], img.data[o + 2]) - logp(bg!, img.data[o], img.data[o + 1], img.data[o + 2])));
  }
  // Smooth the colour evidence over 3x3 so one noisy pixel cannot punch the edge, then decide.
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const p = y * cw + x;
    const gx = x + cx0, gy = y + cy0;
    const inBox = gx >= bxMin && gx < bxMax && gy >= byMin && gy < byMax;
    let v: number;
    if (!inBox) v = 0;
    else if (!widened[p]) v = prior[p] >= 0.5 ? 1 : 0;
    else {
      let acc = 0, c = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(ch - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(cw - 1, x + 1); xx++) {
        const q = yy * cw + xx;
        if (widened[q]) { acc += score[q]; c++; }
      }
      const evidence = c > 0 ? acc / c : 0;
      v = evidence + 6 * (prior[p] - 0.5) > 0 ? 1 : 0;
    }
    full[(y + cy0) * W + (x + cx0)] = v;
  }
  return full;
}

// ---- Mask clean-up and the final cut --------------------------------------------------------

/** Fill holes (background not reachable from the border) and keep only the largest 8-connected blob. */
export function cleanMask(mask: Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h;
  const out = new Uint8Array(mask);
  // Holes: flood the background from the border; whatever background is left is a hole.
  const reach = new Uint8Array(n);
  const q = new Int32Array(n);
  let qh = 0, qt = 0;
  const seed = (p: number): void => { if (!out[p] && !reach[p]) { reach[p] = 1; q[qt++] = p; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (qh < qt) {
    const p = q[qh++];
    const x = p % w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (p >= w) seed(p - w);
    if (p < n - w) seed(p + w);
  }
  // Fill only small holes (specks of mis-labelled pixels). A big enclosed gap is real: a mug handle,
  // a ring. Filling it would paint the wall into the sprite.
  let area = 0;
  for (let p = 0; p < n; p++) if (out[p]) area++;
  const maxHole = Math.max(4, Math.floor(area * 0.02));
  const seen = new Uint8Array(n);
  for (let s0 = 0; s0 < n; s0++) {
    if (out[s0] || reach[s0] || seen[s0]) continue;
    const members: number[] = [s0];
    seen[s0] = 1;
    for (let i = 0; i < members.length; i++) {
      const p = members[i], x = p % w;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < n - w ? p + w : -1];
      for (const r of nb) if (r >= 0 && !out[r] && !reach[r] && !seen[r]) { seen[r] = 1; members.push(r); }
    }
    if (members.length <= maxHole) for (const p of members) out[p] = 1;
  }
  // Largest blob (8-connected); stray islands vanish, anything touching it is part of it.
  const comp = new Int32Array(n).fill(-1);
  let best = -1, bestSize = 0, id = 0;
  for (let s0 = 0; s0 < n; s0++) {
    if (!out[s0] || comp[s0] >= 0) continue;
    let size = 0;
    qh = 0; qt = 0;
    q[qt++] = s0; comp[s0] = id;
    while (qh < qt) {
      const p = q[qh++];
      size++;
      const x = p % w, y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const r = yy * w + xx;
        if (out[r] && comp[r] < 0) { comp[r] = id; q[qt++] = r; }
      }
    }
    if (size > bestSize) { bestSize = size; best = id; }
    id++;
  }
  for (let p = 0; p < n; p++) if (out[p] && comp[p] !== best) out[p] = 0;
  return out;
}

/** Drop the outermost ring of pixels (the background halo that survives a soft edge). */
export function erode1(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (!mask[p]) continue;
    if (x > 0 && !mask[p - 1]) continue;
    if (x < w - 1 && !mask[p + 1]) continue;
    if (y > 0 && !mask[p - w]) continue;
    if (y < h - 1 && !mask[p + w]) continue;
    out[p] = 1;
  }
  return out;
}

export interface Cut {
  /** RGBA, transparent outside the object, cropped to the object's bounds. */
  img: Img;
  /** Where the crop sits in the source photo. */
  bounds: PxBox;
  /** Fraction of the source photo the object covers, 0..1. */
  share: number;
}

/**
 * The whole pipeline: cut inside `box`, fill holes, keep the largest blob, erode 1 px, crop.
 * `feather` blurs the alpha by 1 px (smooth style); false leaves a hard 0/255 alpha (pixel art).
 */
export function cutObject(img: Img, box: PxBox, opts: CutOptions & { feather?: boolean } = {}): Cut | null {
  return finishCut(img, cutInBox(img, box, opts), opts.feather === true);
}

/**
 * Place a SAM mask (rows x cols, row-major 0/1, native resolution) at the box origin of a
 * full-photo-sized raster. `scaleX/scaleY` map mask cells to photo pixels (1 when the mask is
 * already at photo resolution; larger when the photo was scaled down after SAM saw it).
 */
export function placeMask(img: Img, mask: Uint8Array, rows: number, cols: number, originX: number, originY: number, scaleX = 1, scaleY = 1): Uint8Array {
  const out = new Uint8Array(img.w * img.h);
  for (let y = 0; y < img.h; y++) {
    const my = Math.floor((y - originY) / scaleY);
    if (my < 0 || my >= rows) continue;
    for (let x = 0; x < img.w; x++) {
      const mx = Math.floor((x - originX) / scaleX);
      if (mx >= 0 && mx < cols && mask[my * cols + mx]) out[y * img.w + x] = 1;
    }
  }
  return out;
}

/** Hole fill, largest blob, 1 px erode, crop, alpha: everything after a mask exists. */
export function finishCut(img: Img, raw: Uint8Array, feather: boolean): Cut | null {
  const opts = { feather };
  const clean = erode1(cleanMask(raw, img.w, img.h), img.w, img.h);
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1, count = 0;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    if (!clean[y * img.w + x]) continue;
    count++;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (count < 16 || x1 < x0 || y1 < y0) return null;
  const pad = opts.feather ? 2 : 0;
  const bx0 = Math.max(0, x0 - pad), by0 = Math.max(0, y0 - pad), bx1 = Math.min(img.w - 1, x1 + pad), by1 = Math.min(img.h - 1, y1 + pad);
  const w = bx1 - bx0 + 1, h = by1 - by0 + 1;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sp = (y + by0) * img.w + (x + bx0);
    const o = (y * w + x) * 4;
    let a = clean[sp] ? 255 : 0;
    if (opts.feather) {
      let acc = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + bx0 + dx, yy = y + by0 + dy;
        if (xx < 0 || yy < 0 || xx >= img.w || yy >= img.h) { c++; continue; }
        acc += clean[yy * img.w + xx] ? 1 : 0; c++;
      }
      a = Math.round((acc / c) * 255);
    }
    data[o] = img.data[sp * 4]; data[o + 1] = img.data[sp * 4 + 1]; data[o + 2] = img.data[sp * 4 + 2]; data[o + 3] = a;
  }
  return { img: { w, h, data }, bounds: { x0: bx0, y0: by0, x1: bx1 + 1, y1: by1 + 1 }, share: count / (img.w * img.h) };
}
