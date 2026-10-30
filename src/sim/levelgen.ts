// Deterministic platformer level generator (ADR 0074). Pure: a seed and a few numbers in, a list of
// pieces out. No DOM, no clock, no Math.random. The sim turns the pieces into entities (level.ts).
//
// The player jumps about 170 px high and 250 px far on the flat (speed 260, jump 720, gravity 1500), so every
// gap, step and wall below is sized with margin under that, and `difficulty` only narrows the margin.
import { createRng } from "./rng";

export type LevelPieceKind = "ground" | "platform" | "block" | "spikes" | "walker" | "flyer" | "coin" | "flag" | "checkpoint";

export interface LevelPiece {
  kind: LevelPieceKind;
  x: number; y: number; w: number; h: number;
  /** walker/flyer patrol range, platforms' one-way flag, spikes' damage. */
  data?: Record<string, number | boolean | string>;
}

export interface LevelOptions {
  seed?: number;
  /** 1 (gentle) to 5 (brutal). */
  difficulty?: number;
  /** Playable run in px, from the start platform to the flag. */
  length?: number;
  /** Where the start platform begins. */
  startX?: number;
}

export interface LevelSpec {
  seed: number;
  difficulty: number;
  length: number;
  pieces: LevelPiece[];
  /** Where the player stands to begin (top-left of a 26x34 body). */
  start: { x: number; y: number };
  /** Left edge of the first section and right edge of the last one. */
  startX: number;
  endX: number;
  /** Pits: x ranges with no floor, so the sim can send a fallen player back to the last checkpoint. */
  pits: { x: number; w: number }[];
  /** Counts for the receipt and the tests. */
  stats: { sections: number; gaps: number; hazards: number; enemies: number; platforms: number; heights: number; coins: number };
}

export const GROUND_Y = 400;
const FLOOR_H = 48;
const PLAT_H = 20;
export const MAX_GAP = 190; // jump reaches ~250 px; keep a margin
export const MAX_STEP = 120; // jump reaches ~170 px high; keep a margin

const clampInt = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(v)));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

type SectionName = "flat" | "gap" | "stepping" | "stairs" | "highroad" | "spikes" | "plateau" | "ambush" | "pillars";

export function generateLevel(opts: LevelOptions = {}): LevelSpec {
  const seed = clampInt(opts.seed ?? 1, 0, 0x7fffffff);
  const difficulty = clampInt(opts.difficulty ?? 2, 1, 5);
  const length = clampInt(opts.length ?? 3600, 1200, 16000);
  const startX = clampInt(opts.startX ?? 0, -4000, 4000);
  const rng = createRng(seed * 7919 + difficulty * 104729 + 17);
  const d = (difficulty - 1) / 4; // 0..1
  const pick = (lo: number, hi: number): number => Math.round(lerp(lo, hi, rng()));
  const pieces: LevelPiece[] = [];
  const pits: { x: number; w: number }[] = [];
  const names: SectionName[] = [];
  let gaps = 0;

  const floor = (x: number, w: number): void => { pieces.push({ kind: "ground", x, y: GROUND_Y, w, h: FLOOR_H }); };
  const plat = (x: number, y: number, w: number): void => { pieces.push({ kind: "platform", x, y, w, h: PLAT_H, data: { oneWay: true } }); };
  const block = (x: number, y: number, w: number, h: number): void => { pieces.push({ kind: "block", x, y, w, h }); };
  const coinRow = (x: number, y: number, n: number, gapPx = 34): void => { for (let i = 0; i < n; i++) pieces.push({ kind: "coin", x: x + i * gapPx, y, w: 14, h: 14 }); };
  const walker = (x: number, topY: number, from: number, to: number): void => {
    pieces.push({ kind: "walker", x, y: topY - 28, w: 28, h: 28, data: { minX: from, maxX: to } });
  };
  const flyer = (x: number, y: number, span: number): void => { pieces.push({ kind: "flyer", x, y, w: 34, h: 24, data: { baseX: x, baseY: y, span } }); };

  // A safe start: a wide floor with the player on it and a first coin trail.
  let x = startX;
  const startW = 420;
  floor(x - 600, startW + 600);
  coinRow(x + 200, GROUND_Y - 40, 3);
  pieces.push({ kind: "checkpoint", x: x + startW - 40, y: GROUND_Y - 6, w: 8, h: 6 });
  x += startW;
  let sinceChecked = 0;

  // Weighted menu of sections; harder levels unlock the nastier ones and take them more often.
  const menu = (): SectionName => {
    const w: [SectionName, number][] = [
      ["flat", 3 - 2 * d],
      ["gap", 2 + 2 * d],
      ["stepping", difficulty >= 2 ? 1.5 + d : 0],
      ["stairs", 2],
      ["highroad", 2],
      ["spikes", difficulty >= 2 ? 1 + 2 * d : 0],
      ["plateau", 1.5],
      ["ambush", difficulty >= 2 ? 1 + 2 * d : 0],
      ["pillars", difficulty >= 3 ? 1 + d : 0],
    ];
    const total = w.reduce((s, [, v]) => s + v, 0);
    let r = rng() * total;
    for (const [n, v] of w) { if ((r -= v) < 0) return n; }
    return "flat";
  };

  // Every level opens with a tour of its own kinds (in a seeded order), so even a short one has a gap, a climb, a hazard and an enemy.
  const tour: SectionName[] = ["gap", "stairs", "highroad", ...(difficulty >= 2 ? (["spikes", "stepping"] as SectionName[]) : []), ...(difficulty >= 3 ? (["ambush"] as SectionName[]) : [])];
  for (let i = tour.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [tour[i], tour[j]] = [tour[j], tour[i]]; }
  const target = startX + length;
  let last: SectionName = "flat";
  while (x < target - 520) {
    let name = tour.length > 0 ? tour.shift()! : menu();
    // Never two of the same kind in a row, and never two gaps back to back without ground between.
    for (let tries = 0; tries < 6 && tour.length === 0 && (name === last || (name === "gap" && last === "stepping") || (name === "stepping" && last === "gap")); tries++) name = menu();
    last = name;
    names.push(name);
    switch (name) {
      case "flat": {
        const w = pick(260, 420);
        floor(x, w);
        coinRow(x + 40, GROUND_Y - 36, 4);
        if (difficulty >= 2 && rng() < 0.5 + d * 0.4) walker(x + w * 0.6, GROUND_Y, x + 30, x + w - 30);
        x += w;
        break;
      }
      case "gap": {
        const g = pick(lerp(70, 110, d), lerp(120, MAX_GAP, d));
        pits.push({ x, w: g });
        gaps++;
        // Coins in an arc over the pit show the jump.
        for (let i = 0; i < 4; i++) {
          const t = (i + 0.5) / 4;
          pieces.push({ kind: "coin", x: x + t * g, y: GROUND_Y - 60 - Math.sin(t * Math.PI) * 70, w: 14, h: 14 });
        }
        x += g;
        const w = pick(200, 340);
        floor(x, w);
        x += w;
        break;
      }
      case "stepping": {
        // A pit too wide to jump, crossed on 2-3 small stones.
        const stones = difficulty >= 4 ? 3 : 2;
        const stoneW = 108 - 10 * (difficulty - 1); // 108 .. 68 px
        // A full-speed jump from a stone's edge travels ~250 px, so a hop of (250 - stoneW)..MAX_GAP lands on the next stone.
        const hop = pick(Math.max(140, 250 - stoneW), MAX_GAP - 4);
        const span = stones * stoneW + (stones + 1) * hop;
        pits.push({ x, w: span });
        gaps++;
        for (let i = 0; i < stones; i++) {
          const sx = x + hop + i * (stoneW + hop);
          const sy = GROUND_Y - 30 - ((i % 2) * 40);
          plat(sx, sy, stoneW);
          pieces.push({ kind: "coin", x: sx + stoneW / 2 - 7, y: sy - 30, w: 14, h: 14 });
        }
        x += span;
        const w = pick(200, 300);
        floor(x, w);
        x += w;
        break;
      }
      case "stairs": {
        // Up a staircase of ledges to a platform that overlooks the way on, then walk off the far end.
        const steps = 3 + (difficulty >= 3 ? 1 : 0);
        const run = pick(110, 150);
        const rise = pick(54, 72);
        const total = steps * run + pick(260, 340);
        floor(x, total);
        let sx = x + 40;
        for (let i = 0; i < steps; i++) {
          const top = GROUND_Y - rise * (i + 1);
          plat(sx, top, run - 20);
          if (i === steps - 1) { coinRow(sx + 10, top - 34, 3); if (difficulty >= 3) walker(sx + 30, top, sx, sx + run - 24); }
          sx += run;
        }
        x += total;
        break;
      }
      case "highroad": {
        // Two ways through: ground below, a run of platforms above at two heights.
        const w = pick(420, 560);
        floor(x, w);
        const n = 3;
        const pw = pick(110, 150);
        const dx = Math.floor((w - 80) / n);
        for (let i = 0; i < n; i++) {
          const py = GROUND_Y - (i % 2 === 0 ? 105 : 175);
          plat(x + 40 + i * dx, py, pw);
          coinRow(x + 50 + i * dx, py - 30, 3, 30);
          if (i === 1 && difficulty >= 2) walker(x + 40 + i * dx + 20, py, x + 40 + i * dx, x + 40 + i * dx + pw - 30);
        }
        if (difficulty >= 3) flyer(x + w * 0.5, 255, 60);
        x += w;
        break;
      }
      case "spikes": {
        const w = pick(340, 460);
        floor(x, w);
        const sw = clampInt(lerp(40, 120, d) + pick(0, 20), 40, 140);
        const sx = x + Math.floor((w - sw) / 2);
        pieces.push({ kind: "spikes", x: sx, y: GROUND_Y - 18, w: sw, h: 18, data: { damage: 10 + difficulty * 2 } });
        coinRow(sx + 4, GROUND_Y - 80, Math.max(2, Math.floor(sw / 34)));
        x += w;
        break;
      }
      case "plateau": {
        // A raised block the player hops onto, with a coin or an enemy on top.
        const w = pick(380, 480);
        floor(x, w);
        const bh = pick(50, MAX_STEP - 30);
        const bw = pick(150, 220);
        const bx = x + Math.floor((w - bw) / 2);
        block(bx, GROUND_Y - bh, bw, bh);
        if (difficulty >= 2 && rng() < 0.6) walker(bx + bw * 0.5, GROUND_Y - bh, bx + 8, bx + bw - 36);
        else coinRow(bx + 20, GROUND_Y - bh - 36, 3);
        x += w;
        break;
      }
      case "ambush": {
        // A flat run with several enemies and a pillar to hop to break line of fire.
        const w = pick(420, 520);
        floor(x, w);
        const n = 2 + Math.floor(d * 2);
        for (let i = 0; i < n; i++) walker(x + 60 + i * Math.floor((w - 140) / n), GROUND_Y, x + 40 + i * Math.floor((w - 100) / n), x + 40 + (i + 1) * Math.floor((w - 100) / n) - 10);
        if (difficulty >= 4) flyer(x + w * 0.3, 270, 70);
        x += w;
        break;
      }
      case "pillars": {
        // Pits crossed on stone pillars of different heights.
        const n = 3;
        const pw = 70;
        const hop = pick(80, lerp(110, MAX_GAP - 40, d));
        const span = n * pw + (n + 1) * hop;
        pits.push({ x, w: span });
        gaps++;
        for (let i = 0; i < n; i++) {
          const ph = [70, 110, 80][i];
          const px = x + hop + i * (pw + hop);
          block(px, GROUND_Y - ph, pw, ph + FLOOR_H);
          pieces.push({ kind: "coin", x: px + pw / 2 - 7, y: GROUND_Y - ph - 32, w: 14, h: 14 });
        }
        x += span;
        const w = pick(180, 260);
        floor(x, w);
        x += w;
        break;
      }
    }
    // A checkpoint after every few sections so a pit never sends the player back to the beginning.
    sinceChecked++;
    if (sinceChecked >= 3 && x < target - 700) {
      pieces.push({ kind: "checkpoint", x: x - 60, y: GROUND_Y - 6, w: 8, h: 6 });
      sinceChecked = 0;
    }
  }

  // The finish: a wide floor with the flag at its far end.
  const finishW = 520;
  floor(x, finishW);
  coinRow(x + 60, GROUND_Y - 40, 5);
  pieces.push({ kind: "flag", x: x + finishW - 120, y: GROUND_Y - 120, w: 44, h: 120 });
  const endX = x + finishW;

  // The world holds 500 entities: a very long level thins its coins (every other one, then more) rather than blowing the cap.
  for (let keep = 2; pieces.length > 420 && keep < 16; keep++) {
    let n = 0;
    for (let i = pieces.length - 1; i >= 0 && pieces.length > 420; i--) if (pieces[i].kind === "coin" && n++ % keep !== 0) pieces.splice(i, 1);
  }

  // Counts for the receipt and the tests.
  const count = (k: LevelPieceKind): number => pieces.filter((p) => p.kind === k).length;
  const heights = new Set(pieces.filter((p) => p.kind === "platform" || p.kind === "block").map((p) => GROUND_Y - p.y)).size;
  return {
    seed, difficulty, length, pieces, pits,
    start: { x: startX + 120, y: GROUND_Y - 34 },
    startX, endX,
    stats: {
      sections: names.length, gaps, hazards: count("spikes") + pits.length, enemies: count("walker") + count("flyer"),
      platforms: count("platform") + count("block"), heights, coins: count("coin"),
    },
  };
}
