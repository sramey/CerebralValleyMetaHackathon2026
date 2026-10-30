// Code-drawn mid-ground scenery in three fogged depth bands (beads 5fl, tq8). Pure function of the camera:
// no sim entities, no per-load cost, nothing the verifier or the playtest can see.
import type { Graphics } from "pixi.js";
import type { ThemedBackdrop, BackdropMotif } from "../contract";
import { mixColor } from "./depth";

export interface SceneryPalette {
  grass: number;
  ridgeNear: number;
  moon: number;
}

/** How the active mood dresses the scenery (bead tq8). */
export interface SceneryStyle {
  /** Snow settles on crowns, tiers, roofs and bushes. */
  snow: boolean;
  /** Bare, gnarled trees and eerie windows. */
  spooky: boolean;
  /** Bright rim lines on every silhouette. */
  neon: boolean;
}

export function sceneryStyle(moodName: string | undefined): SceneryStyle {
  // A mood worn by a backdrop is named "<mood>-<backdrop>" ("spooky-medieval", ADR 0067).
  moodName = moodName?.split("-")[0];
  return {
    snow: moodName === "christmas" || moodName === "snowy",
    spooky: moodName === "spooky",
    neon: moodName === "neon",
  };
}

/** Per-frame drawing context shared by the prop painters. */
interface Ctx {
  g: Graphics;
  st: SceneryStyle;
  /** Silhouette colour of this band. */
  col: number;
  /** Rim/edge colour of this band, or undefined for none. */
  rim: number | undefined;
  /** Snow colour of this band (already fogged), when snowy. */
  snow: number;
  /** Window/lantern colour. */
  lamp: number;
}

/** Deterministic 0..999 hash of a cell index. */
function hash(c: number, salt: number): number {
  return (((c * 2654435761) ^ (salt * 40503)) >>> 0) % 1000;
}

function strokeIf(c: Ctx, shape: Graphics): void {
  if (c.rim !== undefined) shape.stroke({ width: 1.5, color: c.rim, alpha: c.st.neon ? 0.9 : 0.55 });
}

function broadleaf(c: Ctx, x: number, by: number, h: number, trunk: number): void {
  const { g } = c;
  g.rect(x - h * 0.035, by - h * 0.4, h * 0.07, h * 0.4).fill(trunk);
  const r = h * 0.27;
  const crowns: [number, number, number][] = [[x - r * 0.75, by - h * 0.55, r * 0.85], [x + r * 0.75, by - h * 0.55, r * 0.85], [x, by - h * 0.72, r]];
  for (const [cx, cy, cr] of crowns) {
    strokeIf(c, g.circle(cx, cy, cr).fill(c.col));
  }
  g.circle(x - r * 0.3, by - h * 0.78, r * 0.55).fill({ color: mixColor(c.col, 0xffffff, 0.14), alpha: 0.5 });
  if (c.st.snow) {
    // A cap inside the top of each crown, narrower than the circle at that height so it never overhangs
    for (const [cx, cy, cr] of crowns) g.ellipse(cx, cy - cr * 0.72, cr * 0.5, cr * 0.2).fill(c.snow);
  }
}

/** A leafless, forked tree: trunk plus a few angled limbs. */
function deadTree(c: Ctx, x: number, by: number, h: number, seed: number): void {
  const { g } = c;
  const w = Math.max(3, h * 0.045);
  g.poly([x - w, by, x + w, by, x + w * 0.5, by - h * 0.55, x - w * 0.5, by - h * 0.55]).fill(c.col);
  const limbs: [number, number, number][] = [[-1, 0.42, 0.34], [1, 0.5, 0.4], [-1, 0.62, 0.3], [1, 0.72, 0.26], [-0.2, 0.55, 0.45]];
  limbs.forEach(([dir, from, len], i) => {
    const j = ((seed >> i) & 3) * 0.04;
    const sx = x, sy = by - h * from;
    const ex = x + dir * h * (len + j), ey = sy - h * (0.18 + j);
    g.poly([sx, sy, ex, ey, ex + dir * 2, ey + 3, sx + w * 0.4, sy + w]).fill(c.col);
    g.poly([ex, ey, ex + dir * h * 0.1, ey - h * 0.09, ex + dir * h * 0.1 + 2, ey - h * 0.09 + 3]).fill(c.col);
  });
  if (c.rim !== undefined) g.poly([x - w * 0.5, by - h * 0.55, x + w * 0.5, by - h * 0.55, x, by - h * 0.6]).stroke({ width: 1, color: c.rim, alpha: 0.5 });
}

function pine(c: Ctx, x: number, by: number, h: number): void {
  const { g } = c;
  g.rect(x - h * 0.03, by - h * 0.12, h * 0.06, h * 0.12).fill(c.col);
  for (let i = 0; i < 3; i++) {
    const w = h * (0.46 - i * 0.12);
    const top = by - h * (0.28 + i * 0.26) - h * 0.3;
    const bot = by - h * (0.1 + i * 0.26);
    strokeIf(c, g.poly([x - w, bot, x + w, bot, x, top]).fill(c.col));
    if (c.st.snow) {
      // A cap that follows the tier's two upper edges, plus a drift along its brim.
      const k = 0.55;
      g.poly([x, top, x - w * k, top + (bot - top) * k, x + w * k, top + (bot - top) * k]).fill(c.snow);
      g.ellipse(x - w * 0.55, bot - 1, w * 0.3, 2.4).fill(c.snow);
      g.ellipse(x + w * 0.5, bot - 1, w * 0.26, 2.2).fill(c.snow);
    }
  }
}

function bush(c: Ctx, x: number, by: number, s: number): void {
  const { g } = c;
  for (const [dx, dy, r] of [[-0.7, 0.45, 0.55], [0.7, 0.45, 0.55], [0, 0.7, 0.7]] as const) strokeIf(c, g.circle(x + dx * s, by - dy * s, r * s).fill(c.col));
  g.rect(x - s * 1.2, by - s * 0.3, s * 2.4, s * 0.3).fill(c.col);
  if (c.st.snow) g.ellipse(x, by - s * 1.32, s * 0.62, s * 0.2).fill(c.snow);
}

function lampPost(c: Ctx, x: number, by: number, post: number, glow: number, lit: boolean): void {
  const { g } = c;
  g.rect(x - 2, by - 78, 4, 78).fill(post);
  g.rect(x - 2, by - 80, 14, 3).fill(post);
  g.rect(x + 8, by - 79, 8, 12).fill(post);
  if (c.st.snow) g.rect(x + 7, by - 81, 10, 2.5).fill(c.snow);
  if (lit) {
    for (let i = 0; i < 3; i++) g.circle(x + 12, by - 72, 30 - i * 10).fill({ color: glow, alpha: 0.04 + i * 0.04 });
    g.rect(x + 9, by - 77, 6, 8).fill(c.lamp);
  }
}

function fence(c: Ctx, x: number, by: number): void {
  const { g } = c;
  g.rect(x, by - 24, 110, 3).fill(c.col);
  g.rect(x, by - 13, 110, 3).fill(c.col);
  for (let i = 0; i < 5; i++) {
    g.rect(x + i * 26, by - 30, 5, 30).fill(c.col);
    if (c.st.snow) g.rect(x + i * 26 - 1, by - 32, 7, 3).fill(c.snow);
  }
}

/**
 * A castle on a far hill: curtain wall, two towers with cone roofs, a keep and lit windows at night.
 * It carries a moonlit rim and a pale wall wash so it reads against the dark ridges behind it.
 */
function castle(c: Ctx, x: number, by: number, s: number, lit: boolean, wash: number): void {
  const { g } = c;
  const wall = 150 * s;
  strokeIf(c, g.rect(x - wall / 2, by - 46 * s, wall, 46 * s).fill(c.col));
  for (let i = 0; i < 9; i++) g.rect(x - wall / 2 + i * (wall / 9) + 2 * s, by - 52 * s, wall / 18, 6 * s).fill(c.col);
  g.rect(x - wall / 2, by - 46 * s, wall, 5 * s).fill({ color: wash, alpha: 0.35 });
  const tower = (tx: number, th: number, tw: number): void => {
    strokeIf(c, g.rect(tx - tw / 2, by - th, tw, th).fill(c.col));
    strokeIf(c, g.poly([tx - tw * 0.7, by - th, tx + tw * 0.7, by - th, tx, by - th - tw * 1.3]).fill(c.col));
    g.rect(tx - tw / 2, by - th, tw * 0.28, th).fill({ color: wash, alpha: 0.3 });
    if (c.st.snow) g.poly([tx - tw * 0.7, by - th, tx + tw * 0.7, by - th, tx + tw * 0.3, by - th - tw * 0.8, tx - tw * 0.3, by - th - tw * 0.8]).fill(c.snow);
  };
  tower(x - wall / 2, 96 * s, 22 * s);
  tower(x + wall / 2, 84 * s, 22 * s);
  tower(x, 128 * s, 30 * s);
  if (lit) {
    const wins: [number, number][] = [[x, 108], [x, 90], [x - wall / 2, 80], [x + wall / 2, 66], [x - 28 * s, 26], [x + 22 * s, 26], [x + 44 * s, 26]];
    for (const [wx, wy] of wins) {
      g.rect(wx - 3 * s, by - wy * s, 6 * s, 10 * s).fill({ color: c.lamp, alpha: 0.9 });
      g.circle(wx, by - wy * s + 5 * s, 9 * s).fill({ color: c.lamp, alpha: 0.1 });
    }
  }
}

/** The band's silhouette colour: the near ridge, a touch of grass, fogged toward the sky; darker and cooler when spooky. */
function bandColor(pal: SceneryPalette, skyBottom: number, fog: number, daytime: boolean, st: SceneryStyle): number {
  let base = mixColor(pal.ridgeNear, pal.grass, daytime ? 0.22 : 0.12);
  if (st.snow) base = mixColor(base, 0x2e4468, 0.55);
  if (st.spooky) base = mixColor(base, 0x07030c, 0.5);
  if (st.neon) base = mixColor(base, 0x090614, 0.6);
  return mixColor(base, skyBottom, st.spooky ? fog * 0.55 : fog);
}

/**
 * Three bands behind the play plane (play plane = parallax 1.0):
 *  far  0.42  castle on a distant hill and pines, heavily fogged
 *  mid  0.70  broadleaf trees and pines (bare trees when spooky)
 *  near 0.90  bushes, a fence, lamp posts, one big tree as the focal point (lit at night)
 * `fog` is the base blend toward the sky colour (depthFog(mood).far); each nearer band gets less.
 */
export function drawScenery(
  g: Graphics,
  camX: number,
  camY: number,
  W: number,
  pal: SceneryPalette,
  skyBottom: number,
  fog: number,
  daytime: boolean,
  moodName?: string,
): void {
  const groundY = 400 - camY;
  const night = !daytime;
  const st = sceneryStyle(moodName);
  const lampCol = st.spooky ? 0xb6ff8a : st.neon ? 0xff4fd8 : 0xffd27a;
  const glowCol = st.spooky ? 0x7dff5a : st.neon ? 0xff2bd6 : 0xffb347;
  const neonRims = [0x24f0ff, 0xff3fd0];
  const snowOf = (f: number): number => mixColor(0xf2f8ff, skyBottom, f * 0.6);

  // Far band: a castle every ~3000 px and small pines between. At night it is fogged less and rim-lit so it stays readable.
  {
    const par = 0.42;
    const f = Math.min(0.85, fog + (night ? 0.1 : 0.28));
    const col = bandColor(pal, skyBottom, f, daytime, st);
    const rim = st.neon ? neonRims[0] : night ? mixColor(col, pal.moon, 0.45) : undefined;
    const wash = night ? mixColor(col, pal.moon, 0.5) : mixColor(col, 0xffffff, 0.2);
    const c: Ctx = { g, st, col, rim, snow: snowOf(f), lamp: lampCol };
    const plain: Ctx = { ...c, rim: st.neon ? rim : undefined };
    const by = groundY - 66;
    const first = Math.floor((camX * par - 120) / 220);
    const last = Math.ceil((camX * par + W + 120) / 220);
    for (let i = first; i <= last; i++) {
      const h = hash(i, 1);
      const x = i * 220 + (h % 80) - camX * par;
      if (i % 14 === 3) castle(c, x, by + 10, 1.35, night, wash);
      else if (h > 330) pine(plain, x, by + 6, 70 + (h % 40));
    }
  }

  // Mid band: trees.
  {
    const par = 0.7;
    const f = fog + 0.06;
    const col = bandColor(pal, skyBottom, f, daytime, st);
    const rim = st.neon ? neonRims[1] : undefined;
    const c: Ctx = { g, st, col, rim, snow: snowOf(f), lamp: lampCol };
    const trunk = mixColor(col, 0x000000, 0.25);
    const by = groundY - 26;
    const step = 190;
    const first = Math.floor((camX * par - 160) / step);
    const last = Math.ceil((camX * par + W + 160) / step);
    for (let i = first; i <= last; i++) {
      const h = hash(i, 2);
      if (h < 260) continue;
      const x = i * step + (h % 70) - camX * par;
      const th = 110 + (h % 60);
      if (st.spooky && h % 5 !== 0) deadTree(c, x, by, th * 1.05, h);
      else if (h % 3 === 0) pine(c, x, by, th);
      else broadleaf(c, x, by, th, trunk);
    }
  }

  // Near band: low props, plus the focal tree at world x ~ 380.
  {
    const par = 0.9;
    const f = Math.max(0.05, fog * 0.5);
    const col = bandColor(pal, skyBottom, f, daytime, st);
    const rim = st.neon ? neonRims[0] : undefined;
    const c: Ctx = { g, st, col, rim, snow: snowOf(f), lamp: lampCol };
    const dark = mixColor(col, 0x000000, 0.2);
    const post = night ? mixColor(dark, pal.moon, 0.3) : dark;
    const by = groundY - 7;
    const step = 230;
    const first = Math.floor((camX * par - 200) / step);
    const last = Math.ceil((camX * par + W + 200) / step);
    for (let i = first; i <= last; i++) {
      const h = hash(i, 3);
      const x = i * step + (h % 60) - camX * par;
      if (h < 200) continue;
      if (h < 480) bush(c, x, by, 22 + (h % 14));
      else if (h < 700) lampPost(c, x, by, post, glowCol, night);
      else if (h < 860) fence({ ...c, col: dark }, x, by);
      else bush(c, x, by, 30);
    }
    // Focal tree: tall, just right of the spawn, with two lanterns hanging from branches at night.
    const fx = 380 - camX * par;
    if (fx > -200 && fx < W + 200) {
      if (st.spooky) deadTree({ ...c, col: dark }, fx, by, 260, 7);
      else broadleaf({ ...c, col: mixColor(col, 0x000000, 0.08) }, fx, by, 250, dark);
      if (night) {
        for (const [dx, top, drop] of [[-52, 150, 36], [46, 128, 30]] as const) {
          const lx = fx + dx;
          g.rect(lx - 0.75, by - top, 1.5, drop).fill(dark); // the hanging line
          g.circle(lx, by - top + drop + 5, 15).fill({ color: glowCol, alpha: 0.1 });
          g.rect(lx - 3, by - top + drop, 6, 9).fill(lampCol);
          g.rect(lx - 4, by - top + drop - 2, 8, 2).fill(dark);
        }
      }
    }
  }
}

// --- Themed backdrops (ADR 0067) -------------------------------------------------------------
// "Change the background to medieval": the same three bands, but what stands in them comes from the
// mood's `backdrop` (a skyline plus motif lists). Every motif is a code-drawn silhouette in the band's
// fogged colour with a little accent (roofs, barn red, flames), so it sits in the same art style as the
// starter scenery and costs nothing per frame beyond a few polygons.

interface MCtx extends Ctx {
  /** Lit windows, torches and lanterns (night). */
  lit: boolean;
  /** Pale wash for the lit side of walls. */
  wash: number;
  /** How much accent colour shows through the fog in this band (far bands are greyer). */
  accent: number;
  /** Trunk/post colour. */
  dark: number;
}

const ROOF = 0x9a3b2c;
const BARN = 0xa8322a;
const STONE = 0x8d8a82;
const WOOD = 0x6b4526;
const STRAW = 0xd8b04a;
const LEAF = 0x3f7a3a;
const FLAME = 0xffb347;

const tint = (c: MCtx, accent: number, k = 1): number => mixColor(c.col, accent, Math.min(0.85, c.accent * k));

function windowAt(c: MCtx, x: number, y: number, w: number, h: number): void {
  if (c.lit) {
    c.g.rect(x, y, w, h).fill({ color: c.lamp, alpha: 0.9 });
    c.g.circle(x + w / 2, y + h / 2, Math.max(w, h) * 1.2).fill({ color: c.lamp, alpha: 0.08 });
  } else {
    c.g.rect(x, y, w, h).fill({ color: mixColor(c.col, 0x000000, 0.35), alpha: 0.8 });
  }
}

function roofSnow(c: MCtx, pts: number[]): void {
  if (c.st.snow) c.g.poly(pts).fill(c.snow);
}

function cottage(c: MCtx, x: number, by: number, w: number, h: number, seed: number): void {
  const { g } = c;
  const roof = tint(c, ROOF);
  strokeIf(c, g.rect(x - w / 2, by - h, w, h).fill(c.col));
  g.rect(x - w / 2, by - h, w * 0.22, h).fill({ color: c.wash, alpha: 0.22 });
  if (seed % 2 === 0) g.rect(x + w * 0.18, by - h - h * 0.75, w * 0.12, h * 0.5).fill(c.dark); // chimney
  strokeIf(c, g.poly([x - w * 0.62, by - h, x + w * 0.62, by - h, x, by - h - h * 0.7]).fill(roof));
  roofSnow(c, [x - w * 0.3, by - h - h * 0.35, x + w * 0.3, by - h - h * 0.35, x, by - h - h * 0.7]);
  g.rect(x - w * 0.1, by - h * 0.5, w * 0.2, h * 0.5).fill(c.dark); // door
  windowAt(c, x - w * 0.38, by - h * 0.72, w * 0.16, h * 0.22);
  windowAt(c, x + w * 0.22, by - h * 0.72, w * 0.16, h * 0.22);
}

function tower(c: MCtx, x: number, by: number, s: number): void {
  const { g } = c;
  const tw = 26 * s, th = 120 * s;
  strokeIf(c, g.rect(x - tw / 2, by - th, tw, th).fill(tint(c, STONE, 0.4)));
  for (let i = 0; i < 3; i++) g.rect(x - tw / 2 + i * tw * 0.4 - 1, by - th - 6 * s, tw * 0.22, 6 * s).fill(tint(c, STONE, 0.4));
  strokeIf(c, g.poly([x - tw * 0.7, by - th - 6 * s, x + tw * 0.7, by - th - 6 * s, x, by - th - tw * 1.5]).fill(tint(c, ROOF)));
  g.rect(x - 0.75, by - th - tw * 1.5 - 14 * s, 1.5, 14 * s).fill(c.dark);
  g.poly([x, by - th - tw * 1.5 - 14 * s, x + 12 * s, by - th - tw * 1.5 - 10 * s, x, by - th - tw * 1.5 - 6 * s]).fill(tint(c, 0xd23b3b, 1.2));
  windowAt(c, x - 3 * s, by - th * 0.75, 6 * s, 10 * s);
  windowAt(c, x - 3 * s, by - th * 0.45, 6 * s, 10 * s);
}

function church(c: MCtx, x: number, by: number, s: number): void {
  const { g } = c;
  const nw = 70 * s, nh = 40 * s;
  strokeIf(c, g.rect(x - nw * 0.2, by - nh, nw, nh).fill(c.col));
  strokeIf(c, g.poly([x - nw * 0.25, by - nh, x + nw * 0.85, by - nh, x + nw * 0.3, by - nh - 26 * s]).fill(tint(c, ROOF)));
  const tw = 22 * s, th = 80 * s;
  strokeIf(c, g.rect(x - nw * 0.2 - tw, by - th, tw, th).fill(c.col));
  strokeIf(c, g.poly([x - nw * 0.2 - tw - 3 * s, by - th, x - nw * 0.2 + 3 * s, by - th, x - nw * 0.2 - tw / 2, by - th - 50 * s]).fill(tint(c, ROOF)));
  const cx = x - nw * 0.2 - tw / 2, cy = by - th - 50 * s;
  g.rect(cx - 0.8, cy - 12 * s, 1.6, 12 * s).fill(c.dark);
  g.rect(cx - 4 * s, cy - 9 * s, 8 * s, 1.6).fill(c.dark);
  windowAt(c, cx - 3 * s, by - th * 0.7, 6 * s, 12 * s);
  for (let i = 0; i < 3; i++) windowAt(c, x + i * nw * 0.22, by - nh * 0.7, 5 * s, 12 * s);
}

function windmill(c: MCtx, x: number, by: number, s: number, seed: number): void {
  const { g } = c;
  const bw = 34 * s, bh = 90 * s;
  strokeIf(c, g.poly([x - bw / 2, by, x + bw / 2, by, x + bw * 0.3, by - bh, x - bw * 0.3, by - bh]).fill(c.col));
  strokeIf(c, g.poly([x - bw * 0.42, by - bh, x + bw * 0.42, by - bh, x, by - bh - 20 * s]).fill(tint(c, ROOF)));
  g.rect(x - bw * 0.12, by - bh * 0.32, bw * 0.24, bh * 0.32).fill(c.dark);
  windowAt(c, x - 3 * s, by - bh * 0.7, 6 * s, 8 * s);
  const hx = x, hy = by - bh - 4 * s, len = 62 * s;
  const a0 = ((seed % 90) * Math.PI) / 180;
  for (let i = 0; i < 4; i++) {
    const a = a0 + (i * Math.PI) / 2;
    const ex = hx + Math.cos(a) * len, ey = hy + Math.sin(a) * len;
    const px = -Math.sin(a) * 7 * s, py = Math.cos(a) * 7 * s;
    g.moveTo(hx, hy).lineTo(ex, ey).stroke({ width: 2, color: c.dark });
    g.poly([hx + Math.cos(a) * len * 0.25, hy + Math.sin(a) * len * 0.25, ex, ey, ex + px, ey + py, hx + Math.cos(a) * len * 0.25 + px, hy + Math.sin(a) * len * 0.25 + py])
      .fill({ color: mixColor(c.col, 0xffffff, 0.25), alpha: 0.85 });
  }
  g.circle(hx, hy, 4 * s).fill(c.dark);
}

function farmhouse(c: MCtx, x: number, by: number, s: number): void {
  const { g } = c;
  const w = 90 * s, h = 52 * s;
  strokeIf(c, g.rect(x - w / 2, by - h, w, h).fill(tint(c, 0xe8e2d0, 0.6)));
  strokeIf(c, g.poly([x - w * 0.58, by - h, x + w * 0.58, by - h, x + w * 0.2, by - h - 30 * s, x - w * 0.2, by - h - 30 * s]).fill(tint(c, 0x4a4f5a)));
  roofSnow(c, [x - w * 0.4, by - h - 15 * s, x + w * 0.4, by - h - 15 * s, x + w * 0.2, by - h - 30 * s, x - w * 0.2, by - h - 30 * s]);
  g.rect(x + w * 0.25, by - h - 40 * s, 8 * s, 18 * s).fill(c.dark);
  g.rect(x - w / 2, by - h * 0.42, w, 3 * s).fill(c.dark); // porch roof
  for (let i = 0; i < 5; i++) g.rect(x - w / 2 + i * (w / 4) - 1, by - h * 0.42, 2, h * 0.42).fill(c.dark);
  for (const wx of [-0.32, -0.08, 0.16]) windowAt(c, x + w * wx, by - h * 0.85, 9 * s, 11 * s);
}

function barn(c: MCtx, x: number, by: number, s: number): void {
  const { g } = c;
  const w = 96 * s, h = 50 * s, red = tint(c, BARN, 1.1), trim = mixColor(red, 0xffffff, 0.55);
  strokeIf(c, g.poly([x - w / 2, by, x + w / 2, by, x + w / 2, by - h, x + w * 0.32, by - h - 24 * s, x, by - h - 34 * s, x - w * 0.32, by - h - 24 * s, x - w / 2, by - h]).fill(red));
  roofSnow(c, [x - w / 2, by - h, x - w * 0.32, by - h - 24 * s, x, by - h - 34 * s, x + w * 0.32, by - h - 24 * s, x + w / 2, by - h, x + w * 0.32, by - h - 18 * s, x, by - h - 28 * s, x - w * 0.32, by - h - 18 * s]);
  const dw = w * 0.34, dh = h * 0.78;
  g.rect(x - dw / 2, by - dh, dw, dh).stroke({ width: 2, color: trim, alpha: 0.85 });
  g.moveTo(x - dw / 2, by - dh).lineTo(x + dw / 2, by).stroke({ width: 1.5, color: trim, alpha: 0.8 });
  g.moveTo(x + dw / 2, by - dh).lineTo(x - dw / 2, by).stroke({ width: 1.5, color: trim, alpha: 0.8 });
  windowAt(c, x - 6 * s, by - h - 18 * s, 12 * s, 10 * s);
}

function silo(c: MCtx, x: number, by: number, s: number): void {
  const { g } = c;
  const col = tint(c, 0xb9bec4, 0.7);
  for (const [dx, sw, sh] of [[0, 26, 110], [30, 22, 88]] as const) {
    const sx = x + dx * s, w = sw * s, h = sh * s;
    strokeIf(c, g.rect(sx - w / 2, by - h, w, h).fill(col));
    strokeIf(c, g.ellipse(sx, by - h, w / 2, w * 0.45).fill(mixColor(col, 0xffffff, 0.2)));
    for (let i = 1; i < 5; i++) g.rect(sx - w / 2, by - h + (h * i) / 5, w, 1.2).fill({ color: c.dark, alpha: 0.35 });
    g.rect(sx - w / 2, by - h, w * 0.25, h).fill({ color: c.wash, alpha: 0.2 });
  }
}

function watertower(c: MCtx, x: number, by: number, s: number): void {
  const { g } = c;
  const h = 120 * s, tw = 46 * s, th = 30 * s;
  for (const dx of [-0.4, -0.13, 0.13, 0.4]) g.moveTo(x + dx * tw * 1.1, by).lineTo(x + dx * tw * 0.7, by - h + th).stroke({ width: 2, color: c.dark });
  g.moveTo(x - tw * 0.4, by - h * 0.45).lineTo(x + tw * 0.4, by - h * 0.25).stroke({ width: 1, color: c.dark });
  strokeIf(c, g.roundRect(x - tw / 2, by - h, tw, th, 6 * s).fill(tint(c, 0xc7ccd2, 0.7)));
  strokeIf(c, g.poly([x - tw * 0.55, by - h, x + tw * 0.55, by - h, x, by - h - 16 * s]).fill(tint(c, 0x8a9096, 0.7)));
}

function city(c: MCtx, x: number, by: number, s: number, seed: number): void {
  const { g } = c;
  let bx = x - 90 * s;
  for (let i = 0; i < 6; i++) {
    const h = hash(seed * 7 + i, 11);
    const bw = (22 + (h % 18)) * s, bh = (70 + (h % 110)) * s;
    strokeIf(c, g.rect(bx, by - bh, bw, bh).fill(mixColor(c.col, 0x000000, (h % 3) * 0.06)));
    for (let wy = by - bh + 8 * s; wy < by - 10 * s; wy += 12 * s) {
      for (let wx = bx + 4 * s; wx < bx + bw - 6 * s; wx += 9 * s) {
        if (hash(Math.round(wx * 3 + wy), seed) % 3 === 0) windowAt(c, wx, wy, 4 * s, 5 * s);
      }
    }
    if (h % 4 === 0) g.rect(bx + bw / 2 - 0.75, by - bh - 18 * s, 1.5, 18 * s).fill(c.dark);
    bx += bw + 3 * s;
  }
}

function pyramid(c: MCtx, x: number, by: number, s: number): void {
  const { g } = c;
  const w = 200 * s, h = 120 * s, sand = tint(c, 0xd9b26a, 0.8);
  strokeIf(c, g.poly([x - w / 2, by, x + w / 2, by, x, by - h]).fill(mixColor(sand, 0x000000, 0.18)));
  g.poly([x - w / 2, by, x, by, x, by - h]).fill(sand);
  for (let i = 1; i < 6; i++) {
    const y = by - (h * i) / 6, half = (w / 2) * (1 - i / 6);
    g.moveTo(x - half, y).lineTo(x + half, y).stroke({ width: 1, color: c.dark, alpha: 0.25 });
  }
}

function tent(c: MCtx, x: number, by: number, s: number): void {
  const { g } = c;
  const w = 64 * s, h = 52 * s, a = tint(c, 0xd23b3b, 1.1), b = tint(c, 0xf0e6cc, 0.8);
  strokeIf(c, g.poly([x - w / 2, by, x + w / 2, by, x, by - h]).fill(b));
  for (let i = 0; i < 4; i += 2) {
    const l = -0.5 + i * 0.25, r = l + 0.25;
    g.poly([x + w * l, by, x + w * r, by, x, by - h]).fill(a);
  }
  g.rect(x - 0.75, by - h - 14 * s, 1.5, 14 * s).fill(c.dark);
  g.poly([x, by - h - 14 * s, x + 10 * s, by - h - 11 * s, x, by - h - 8 * s]).fill(a);
}

function palm(c: MCtx, x: number, by: number, h: number): void {
  const { g } = c;
  const lean = h * 0.12;
  g.poly([x - 4, by, x + 4, by, x + lean + 2, by - h, x + lean - 3, by - h]).fill(c.dark);
  const tx = x + lean, ty = by - h;
  const leaf = tint(c, LEAF, 0.8);
  for (const [dx, dy] of [[-1, 0.15], [1, 0.15], [-0.7, -0.25], [0.7, -0.25], [0, -0.35]] as const) {
    g.poly([tx, ty, tx + dx * h * 0.42, ty + dy * h * 0.42 + h * 0.08, tx + dx * h * 0.36, ty + dy * h * 0.42 + h * 0.15]).fill(leaf);
  }
}

function cactus(c: MCtx, x: number, by: number, h: number): void {
  const { g } = c;
  const col = tint(c, 0x4f8a45, 0.8), w = h * 0.16;
  g.roundRect(x - w / 2, by - h, w, h, w / 2).fill(col);
  g.roundRect(x - w * 1.8, by - h * 0.62, w * 0.75, h * 0.32, w * 0.37).fill(col);
  g.rect(x - w * 1.8, by - h * 0.38, w * 1.4, w * 0.6).fill(col);
  g.roundRect(x + w * 1.05, by - h * 0.78, w * 0.75, h * 0.4, w * 0.37).fill(col);
  g.rect(x + w * 0.4, by - h * 0.46, w * 1.2, w * 0.6).fill(col);
}

function rock(c: MCtx, x: number, by: number, s: number, seed: number): void {
  const w = (40 + (seed % 30)) * s, h = (22 + (seed % 16)) * s;
  strokeIf(c, c.g.poly([x - w / 2, by, x - w * 0.4, by - h * 0.6, x - w * 0.1, by - h, x + w * 0.3, by - h * 0.8, x + w / 2, by]).fill(tint(c, STONE, 0.4)));
  c.g.poly([x - w * 0.4, by - h * 0.6, x - w * 0.1, by - h, x, by - h * 0.5]).fill({ color: c.wash, alpha: 0.2 });
}

function torch(c: MCtx, x: number, by: number): void {
  const { g } = c;
  g.rect(x - 2, by - 60, 4, 60).fill(c.dark);
  g.rect(x - 5, by - 64, 10, 5).fill(c.dark);
  const flame = c.lit ? c.lamp : tint(c, FLAME, 0.9);
  if (c.lit) for (let i = 0; i < 3; i++) g.circle(x, by - 72, 26 - i * 8).fill({ color: FLAME, alpha: 0.05 + i * 0.04 });
  g.poly([x - 5, by - 64, x + 5, by - 64, x + 1, by - 80, x - 1, by - 72]).fill(flame);
}

function haybale(c: MCtx, x: number, by: number, s: number): void {
  const { g } = c;
  const r = 16 * s, col = tint(c, STRAW, 0.9);
  strokeIf(c, g.circle(x, by - r, r).fill(col));
  g.circle(x, by - r, r * 0.6).stroke({ width: 1.2, color: mixColor(col, 0x000000, 0.25), alpha: 0.7 });
  g.circle(x, by - r, r * 0.25).stroke({ width: 1.2, color: mixColor(col, 0x000000, 0.25), alpha: 0.7 });
  if (c.st.snow) g.ellipse(x, by - r * 1.85, r * 0.6, r * 0.2).fill(c.snow);
}

function corn(c: MCtx, x: number, by: number, s: number, seed: number): void {
  const { g } = c;
  const stalk = tint(c, 0x6f9a3a, 0.8), tassel = tint(c, STRAW, 0.9);
  const n = 9;
  for (let i = 0; i < n; i++) {
    const h = (44 + (hash(seed + i, 5) % 18)) * s;
    const sx = x - 70 * s + i * 17 * s;
    g.rect(sx - 1.5, by - h, 3, h).fill(stalk);
    g.poly([sx, by - h * 0.55, sx - 11 * s, by - h * 0.42, sx, by - h * 0.48]).fill(stalk);
    g.poly([sx, by - h * 0.75, sx + 11 * s, by - h * 0.62, sx, by - h * 0.68]).fill(stalk);
    g.rect(sx - 2.5, by - h - 6 * s, 5, 6 * s).fill(tassel);
  }
}

function banner(c: MCtx, x: number, by: number, seed: number): void {
  const { g } = c;
  const colors = [0xc0392b, 0x2a6fb5, 0xd4a017];
  const col = tint(c, colors[seed % colors.length], 1.1);
  g.rect(x - 1.5, by - 90, 3, 90).fill(c.dark);
  g.rect(x - 12, by - 88, 24, 2.5).fill(c.dark);
  g.poly([x - 11, by - 86, x + 11, by - 86, x + 11, by - 46, x, by - 54, x - 11, by - 46]).fill(col);
  g.rect(x - 11, by - 80, 22, 3).fill({ color: mixColor(col, 0xffffff, 0.5), alpha: 0.6 });
}

function well(c: MCtx, x: number, by: number): void {
  const { g } = c;
  strokeIf(c, g.rect(x - 18, by - 20, 36, 20).fill(tint(c, STONE, 0.5)));
  g.rect(x - 16, by - 50, 3, 30).fill(c.dark);
  g.rect(x + 13, by - 50, 3, 30).fill(c.dark);
  strokeIf(c, g.poly([x - 24, by - 48, x + 24, by - 48, x, by - 64]).fill(tint(c, ROOF)));
  g.rect(x - 0.6, by - 46, 1.2, 14).fill(c.dark);
  g.rect(x - 4, by - 33, 8, 7).fill(c.dark);
}

function cart(c: MCtx, x: number, by: number): void {
  const { g } = c;
  const wood = tint(c, WOOD, 0.7);
  g.rect(x - 32, by - 30, 64, 14).fill(wood);
  g.rect(x + 30, by - 24, 30, 3).fill(c.dark);
  for (const dx of [-16, 16]) {
    g.circle(x + dx, by - 11, 11).stroke({ width: 3, color: c.dark });
    g.moveTo(x + dx - 11, by - 11).lineTo(x + dx + 11, by - 11).stroke({ width: 1.5, color: c.dark });
    g.moveTo(x + dx, by - 22).lineTo(x + dx, by).stroke({ width: 1.5, color: c.dark });
  }
  g.poly([x - 28, by - 30, x + 26, by - 30, x + 18, by - 42, x - 20, by - 44]).fill(tint(c, STRAW, 0.8));
}

/** Paint one motif. `s` is the band's scale; `seed` varies size and shape inside the motif. */
function motif(c: MCtx, m: BackdropMotif, x: number, by: number, s: number, seed: number): void {
  const j = 0.85 + (seed % 30) / 100; // 0.85 .. 1.14
  switch (m) {
    case "castle": castle(c, x, by, 1.1 * s, c.lit, c.wash); return;
    case "tower": tower(c, x, by, s * j); return;
    case "village": {
      const n = 3 + (seed % 2);
      for (let i = 0; i < n; i++) {
        const hh = hash(seed + i, 9);
        cottage(c, x - 70 * s + i * 48 * s, by, (36 + (hh % 14)) * s, (26 + (hh % 10)) * s, hh);
      }
      return;
    }
    case "church": church(c, x, by, s * j); return;
    case "windmill": windmill(c, x, by, s * j, seed); return;
    case "farmhouse": farmhouse(c, x, by, s * j); return;
    case "barn": barn(c, x, by, s * j); return;
    case "silo": silo(c, x, by, s * j); return;
    case "watertower": watertower(c, x, by, s * j); return;
    case "city": city(c, x, by, s, seed); return;
    case "pyramid": pyramid(c, x, by, s * j); return;
    case "tent": tent(c, x, by, s * j); return;
    case "pine": pine(c, x, by, 120 * s * j); return;
    case "oak": broadleaf({ ...c, col: tint(c, LEAF, 0.5) }, x, by, 125 * s * j, c.dark); return;
    case "deadtree": deadTree(c, x, by, 130 * s * j, seed); return;
    case "palm": palm(c, x, by, 120 * s * j); return;
    case "cactus": cactus(c, x, by, 70 * s * j); return;
    case "rock": rock(c, x, by, s, seed); return;
    case "bush": bush(c, x, by, 24 * s * j); return;
    case "fence": fence({ ...c, col: c.dark }, x - 55, by); return;
    case "lamp": lampPost(c, x, by, c.dark, c.lamp, c.lit); return;
    case "torch": torch(c, x, by); return;
    case "haybale": haybale(c, x, by, s * j); return;
    case "corn": corn(c, x, by, s, seed); return;
    case "banner": banner(c, x, by, seed); return;
    case "well": well(c, x, by); return;
    case "cart": cart(c, x, by); return;
  }
}

/** Ridge amplitude for a skyline: flat farmland barely rolls, mountains keep the full ridges. */
export function skylineAmplitude(bd: ThemedBackdrop | undefined): number {
  return !bd ? 1 : bd.skyline === "flat" ? 0.22 : bd.skyline === "hills" ? 0.7 : 1;
}

/**
 * The themed backdrop: the same three bands and parallax factors as `drawScenery`, filled from the
 * backdrop's motif lists. The landmark stands every 12 far cells (~2600 world px), the first one just
 * right of the spawn so the new background is on screen the moment it lands.
 */
export function drawBackdrop(
  g: Graphics,
  camX: number,
  camY: number,
  W: number,
  pal: SceneryPalette,
  skyBottom: number,
  fog: number,
  daytime: boolean,
  bd: ThemedBackdrop,
  moodName?: string,
): void {
  const groundY = 400 - camY;
  const night = !daytime;
  const st = sceneryStyle(moodName);
  const lampCol = st.spooky ? 0xb6ff8a : st.neon ? 0xff4fd8 : 0xffd27a;
  const snowOf = (f: number): number => mixColor(0xf2f8ff, skyBottom, f * 0.6);
  const bands: { list: BackdropMotif[]; par: number; f: number; by: number; step: number; gap: number; s: number; accent: number; salt: number; rim: boolean }[] = [
    // Daytime fog is lighter than the starter scenery's: the buildings are the point, so they must read.
    { list: bd.far, par: 0.42, f: Math.min(0.85, fog + (night ? 0.1 : 0.14)), by: groundY - 56, step: 210, gap: 330, s: 0.8, accent: 0.42, salt: 1, rim: night },
    { list: bd.mid, par: 0.7, f: fog * 0.7 + 0.04, by: groundY - 26, step: 180, gap: 260, s: 1, accent: 0.6, salt: 2, rim: false },
    { list: bd.near, par: 0.9, f: Math.max(0.05, fog * 0.5), by: groundY - 7, step: 220, gap: 230, s: 0.9, accent: 0.75, salt: 3, rim: false },
  ];
  for (let b = 0; b < bands.length; b++) {
    const band = bands[b];
    const col = bandColor(pal, skyBottom, band.f, daytime, st);
    const rim = st.neon ? 0x24f0ff : band.rim ? mixColor(col, pal.moon, 0.45) : undefined;
    const c: MCtx = {
      g, st, col, rim, snow: snowOf(band.f), lamp: lampCol, lit: night,
      wash: night ? mixColor(col, pal.moon, 0.5) : mixColor(col, 0xffffff, 0.3),
      accent: band.accent * (night ? 0.45 : 1), dark: mixColor(col, 0x000000, 0.28),
    };
    const first = Math.floor((camX * band.par - 260) / band.step);
    const last = Math.ceil((camX * band.par + W + 260) / band.step);
    for (let i = first; i <= last; i++) {
      const h = hash(i, band.salt);
      const x = i * band.step + (h % 60) - camX * band.par;
      if (b === 0 && bd.landmark && i % 12 === 3) { motif(c, bd.landmark, x, band.by + 10, 1.25, h); continue; }
      if (b === 0 && bd.landmark && (i % 12 === 2 || i % 12 === 4)) continue; // room around the landmark
      if (band.list.length === 0 || h < band.gap) continue;
      motif(c, band.list[h % band.list.length], x, band.by, band.s, h);
    }
  }
}
