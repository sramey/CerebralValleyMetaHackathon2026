// Code-drawn mid-ground scenery in three fogged depth bands (beads 5fl, tq8). Pure function of the camera:
// no sim entities, no per-load cost, nothing the verifier or the playtest can see.
import type { Graphics } from "pixi.js";
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
