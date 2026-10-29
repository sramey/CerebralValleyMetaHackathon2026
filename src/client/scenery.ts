// Code-drawn mid-ground scenery in three fogged depth bands (bead 5fl). Pure function of the camera:
// no sim entities, no per-load cost, nothing the verifier or the playtest can see.
import type { Graphics } from "pixi.js";
import { mixColor } from "./depth";

export interface SceneryPalette {
  grass: number;
  ridgeNear: number;
  moon: number;
}

/** Deterministic 0..999 hash of a cell index. */
function hash(c: number, salt: number): number {
  return (((c * 2654435761) ^ (salt * 40503)) >>> 0) % 1000;
}

function broadleaf(g: Graphics, x: number, by: number, h: number, crown: number, trunk: number): void {
  g.rect(x - h * 0.035, by - h * 0.4, h * 0.07, h * 0.4).fill(trunk);
  const r = h * 0.27;
  g.circle(x - r * 0.75, by - h * 0.55, r * 0.85).fill(crown);
  g.circle(x + r * 0.75, by - h * 0.55, r * 0.85).fill(crown);
  g.circle(x, by - h * 0.72, r).fill(crown);
  g.circle(x - r * 0.3, by - h * 0.78, r * 0.55).fill({ color: mixColor(crown, 0xffffff, 0.14), alpha: 0.5 });
}

function pine(g: Graphics, x: number, by: number, h: number, col: number): void {
  g.rect(x - h * 0.03, by - h * 0.12, h * 0.06, h * 0.12).fill(col);
  for (let i = 0; i < 3; i++) {
    const w = h * (0.46 - i * 0.12);
    const top = by - h * (0.28 + i * 0.26) - h * 0.3;
    const bot = by - h * (0.1 + i * 0.26);
    g.poly([x - w, bot, x + w, bot, x, top]).fill(col);
  }
}

function bush(g: Graphics, x: number, by: number, s: number, col: number): void {
  g.circle(x - s * 0.7, by - s * 0.45, s * 0.55).fill(col);
  g.circle(x + s * 0.7, by - s * 0.45, s * 0.55).fill(col);
  g.circle(x, by - s * 0.7, s * 0.7).fill(col);
  g.rect(x - s * 1.2, by - s * 0.3, s * 2.4, s * 0.3).fill(col);
}

function lampPost(g: Graphics, x: number, by: number, col: number, glow: number, lit: boolean): void {
  g.rect(x - 2, by - 78, 4, 78).fill(col);
  g.rect(x - 2, by - 80, 14, 3).fill(col);
  g.rect(x + 8, by - 79, 8, 12).fill(col);
  if (lit) {
    for (let i = 0; i < 3; i++) g.circle(x + 12, by - 72, 30 - i * 10).fill({ color: glow, alpha: 0.04 + i * 0.04 });
    g.rect(x + 9, by - 77, 6, 8).fill(0xffe6a0);
  }
}

function fence(g: Graphics, x: number, by: number, col: number): void {
  g.rect(x, by - 24, 110, 3).fill(col);
  g.rect(x, by - 13, 110, 3).fill(col);
  for (let i = 0; i < 5; i++) g.rect(x + i * 26, by - 30, 5, 30).fill(col);
}

/** A castle on a far hill: curtain wall, two towers with cone roofs, a keep and (at night) a few lit windows. */
function castle(g: Graphics, x: number, by: number, s: number, col: number, lit: boolean): void {
  const wall = 150 * s;
  g.rect(x - wall / 2, by - 46 * s, wall, 46 * s).fill(col);
  for (let i = 0; i < 9; i++) g.rect(x - wall / 2 + i * (wall / 9) + 2 * s, by - 52 * s, wall / 18, 6 * s).fill(col);
  const tower = (tx: number, th: number, tw: number): void => {
    g.rect(tx - tw / 2, by - th, tw, th).fill(col);
    g.poly([tx - tw * 0.7, by - th, tx + tw * 0.7, by - th, tx, by - th - tw * 1.3]).fill(col);
  };
  tower(x - wall / 2, 96 * s, 22 * s);
  tower(x + wall / 2, 84 * s, 22 * s);
  tower(x, 128 * s, 30 * s);
  if (lit) {
    for (const [wx, wy] of [[x, 108], [x - wall / 2, 80], [x + wall / 2, 70], [x - 22 * s, 30]] as const) {
      g.rect(wx - 2 * s, by - wy * s, 4 * s, 7 * s).fill({ color: 0xffd27a, alpha: 0.75 });
    }
  }
}

/** The tinted, fogged colour of one band. */
function bandColor(pal: SceneryPalette, skyBottom: number, fog: number, daytime: boolean): number {
  const base = mixColor(pal.ridgeNear, pal.grass, daytime ? 0.22 : 0.12);
  return mixColor(base, skyBottom, fog);
}

/**
 * Three bands behind the play plane (play plane = parallax 1.0):
 *  far  0.42  castle on a distant hill and pines, heavily fogged
 *  mid  0.70  broadleaf trees and pines
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
): void {
  const groundY = 400 - camY;
  const night = !daytime;

  // Far band: a castle every ~3000 px and small pines between.
  {
    const par = 0.42;
    const col = bandColor(pal, skyBottom, Math.min(0.85, fog + 0.28), daytime);
    const by = groundY - 66;
    const first = Math.floor((camX * par - 120) / 220);
    const last = Math.ceil((camX * par + W + 120) / 220);
    for (let c = first; c <= last; c++) {
      const h = hash(c, 1);
      const x = c * 220 + (h % 80) - camX * par;
      if (c % 14 === 3) castle(g, x, by + 10, 1.35, col, night);
      else if (h > 330) pine(g, x, by + 6, 70 + (h % 40), col);
    }
  }

  // Mid band: trees.
  {
    const par = 0.7;
    const col = bandColor(pal, skyBottom, fog + 0.06, daytime);
    const trunk = mixColor(col, 0x000000, 0.25);
    const by = groundY - 26;
    const step = 190;
    const first = Math.floor((camX * par - 160) / step);
    const last = Math.ceil((camX * par + W + 160) / step);
    for (let c = first; c <= last; c++) {
      const h = hash(c, 2);
      if (h < 260) continue;
      const x = c * step + (h % 70) - camX * par;
      const th = 110 + (h % 60);
      if (h % 3 === 0) pine(g, x, by, th, col);
      else broadleaf(g, x, by, th, col, trunk);
    }
  }

  // Near band: low props, plus the focal tree at world x ~ 600.
  {
    const par = 0.9;
    const col = bandColor(pal, skyBottom, Math.max(0.05, fog * 0.5), daytime);
    const dark = mixColor(col, 0x000000, 0.2);
    const by = groundY - 7;
    const step = 230;
    const first = Math.floor((camX * par - 200) / step);
    const last = Math.ceil((camX * par + W + 200) / step);
    for (let c = first; c <= last; c++) {
      const h = hash(c, 3);
      const x = c * step + (h % 60) - camX * par;
      if (h < 200) continue;
      if (h < 480) bush(g, x, by, 22 + (h % 14), col);
      else if (h < 700) lampPost(g, x, by, night ? mixColor(dark, pal.moon, 0.3) : dark, 0xffb347, night);
      else if (h < 860) fence(g, x, by, dark);
      else bush(g, x, by, 30, col);
    }
    // Focal tree: tall, just right of the spawn, with two lanterns hanging from branches at night.
    const fx = 380 - camX * par;
    if (fx > -200 && fx < W + 200) {
      broadleaf(g, fx, by, 250, mixColor(col, 0x000000, 0.08), dark);
      if (night) {
        for (const [dx, top, drop] of [[-52, 150, 36], [46, 128, 30]] as const) {
          const lx = fx + dx;
          g.rect(lx - 0.75, by - top, 1.5, drop).fill(dark); // the hanging line
          g.circle(lx, by - top + drop + 5, 15).fill({ color: 0xffb347, alpha: 0.1 });
          g.rect(lx - 3, by - top + drop, 6, 9).fill(0xffd27a);
          g.rect(lx - 4, by - top + drop - 2, 8, 2).fill(dark);
        }
      }
    }
  }
}
