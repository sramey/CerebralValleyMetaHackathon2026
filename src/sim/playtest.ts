// "Can you still play?" bot. Pure and deterministic: it only reads a World,
// writes world.input, and steps. No DOM, no clock, no Math.random. The server
// runs it headless to judge a mod; the client replays the recorded inputs in a
// second World to show the ghost (ADR 0013).
import { emptyInput } from "../contract";
import type { Entity, InputState } from "../contract";
import type { World } from "./world";

export const PLAYTEST = {
  frames: 360,
  seeds: [11, 22, 33],
  /** A player lower than this has fallen out of the level. */
  fallY: 700,
  /** Dying before this frame counts as "dies on spawn". */
  spawnDeathFrame: 90,
  /** Candidate must cover at least this share of the baseline distance. */
  minProgress: 0.5,
  /** Size growth beyond this ratio is blamed on the player being too big. */
  bigRatio: 1.25,
} as const;

const L = 1, R = 2, J = 4, S = 8, U = 16;

export function packInput(i: InputState): number {
  return (i.left ? L : 0) | (i.right ? R : 0) | (i.jump ? J : 0) | (i.shoot ? S : 0) | (i.use ? U : 0);
}

export function unpackInput(m: number): InputState {
  return { left: (m & L) !== 0, right: (m & R) !== 0, jump: (m & J) !== 0, shoot: (m & S) !== 0, use: (m & U) !== 0 };
}

/** Run-length encode per-frame input masks as [mask, count, mask, count, ...]. */
export function rleEncode(masks: number[]): number[] {
  const out: number[] = [];
  for (const m of masks) {
    if (out.length >= 2 && out[out.length - 2] === m) out[out.length - 1]++;
    else out.push(m, 1);
  }
  return out;
}

export function rleDecode(rle: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < rle.length; i += 2) for (let k = 0; k < rle[i + 1]; k++) out.push(rle[i]);
  return out;
}

export interface PlaytestRun {
  seed: number;
  frames: number;
  /** RLE of the input masks the bot pressed, one per frame. */
  inputs: number[];
  hadPlayer: boolean;
  /** Frame the player entity disappeared, or -1. */
  diedAt: number;
  fell: boolean;
  /** Furthest the player got to the right of where it started, in px. */
  progress: number;
  startW: number;
  startH: number;
  /** Solid the player is jammed against at the end of the run, if stuck. */
  blocker: { type: string; x: number; y: number; w: number; h: number; headroom: number | null } | null;
  threw: string | null;
}

function player(world: World): Entity | undefined {
  return world.entities.find((e) => e.type === "player");
}

/** Scripted player: run right, jump at walls and ledges. Reads the world, nothing else. */
export function botInput(world: World, stuckFrames: number): InputState {
  const p = player(world);
  const input = emptyInput();
  if (!p) return input;
  input.right = true;
  if (!p.onGround) return input;
  const front = p.x + p.w;
  let wall = false;
  let floor = false;
  for (const e of world.entities) {
    if (!e.solid || e === p) continue;
    if (e.x < front + 12 && e.x + e.w > front && e.y < p.y + p.h - 6 && e.y + e.h > p.y) wall = true;
    if (e.x <= front + 16 && e.x + e.w >= front + 16 && e.y <= p.y + p.h + 8 && e.y + e.h > p.y + p.h) floor = true;
  }
  if (wall || !floor || stuckFrames > 12) input.jump = true;
  return input;
}

function findBlocker(world: World, p: Entity): PlaytestRun["blocker"] {
  const front = p.x + p.w;
  let best: Entity | null = null;
  for (const e of world.entities) {
    if (!e.solid || e === p) continue;
    if (e.x < front + 14 && e.x + e.w > front - 2 && e.y < p.y + p.h - 2 && e.y + e.h > p.y + 2) {
      if (!best || e.x < best.x) best = e;
    }
  }
  if (!best) {
    // Relaxed second look: anything solid within reach ahead that overlaps the player's height at all.
    for (const e of world.entities) {
      if (!e.solid || e === p) continue;
      if (e.x < front + 60 && e.x + e.w > front && e.y < p.y + p.h && e.y + e.h > p.y) {
        if (!best || e.x < best.x) best = e;
      }
    }
  }
  if (!best) return null;
  // Headroom: the vertical opening under a hanging blocker, down to the floor beneath it.
  const bottom = best.y + best.h;
  let floor = Infinity;
  for (const e of world.entities) {
    if (!e.solid || e === best || e === p) continue;
    if (e.x < best.x + best.w && e.x + e.w > best.x && e.y >= bottom - 1 && e.y < floor) floor = e.y;
  }
  const headroom = floor === Infinity ? null : Math.round(floor - bottom);
  return { type: best.type, x: Math.round(best.x), y: Math.round(best.y), w: Math.round(best.w), h: Math.round(best.h), headroom };
}

/** Drive the bot in an already-loaded world. Never throws. */
export function runBot(world: World, seed: number, frames: number = PLAYTEST.frames): PlaytestRun {
  const masks: number[] = [];
  const first = player(world);
  const run: PlaytestRun = {
    seed, frames, inputs: [], hadPlayer: !!first, diedAt: -1, fell: false, progress: 0,
    startW: first?.w ?? 0, startH: first?.h ?? 0, blocker: null, threw: null,
  };
  if (!first) return run;
  const startX = first.x;
  let maxX = first.x;
  let stuck = 0;
  let lastX = first.x;
  try {
    for (let f = 0; f < frames; f++) {
      const input = botInput(world, stuck);
      world.input = input;
      masks.push(packInput(input));
      world.step();
      const p = player(world);
      if (!p) { run.diedAt = f; break; }
      if (p.y > PLAYTEST.fallY) run.fell = true;
      if (p.x > maxX) maxX = p.x;
      stuck = Math.abs(p.x - lastX) < 0.5 ? stuck + 1 : 0;
      lastX = p.x;
    }
  } catch (err) {
    run.threw = err instanceof Error ? err.message : String(err);
  }
  world.input = emptyInput();
  run.inputs = rleEncode(masks);
  run.frames = masks.length;
  run.progress = Math.round(maxX - startX);
  const end = player(world);
  if (end && stuck > 30) run.blocker = findBlocker(world, end);
  return run;
}

export type PlaytestFailure = "no-player" | "died" | "fell" | "stuck" | "crashed";

export interface PlaytestVerdict {
  ok: boolean;
  failure?: PlaytestFailure;
  /** One line for the player: why the change was rejected. */
  plain: string;
  /** Technical detail for Wonder's fix prompt. */
  detail: string;
  run: PlaytestRun;
  baseline: PlaytestRun;
}

function label(type: string): string {
  return type.replace(/[-_]+/g, " ");
}

/** Compare the bot's run in the world with the new mod against the run without it. */
export function judge(baseline: PlaytestRun, run: PlaytestRun): PlaytestVerdict {
  const base = (failure: PlaytestFailure, plain: string, detail: string): PlaytestVerdict =>
    ({ ok: false, failure, plain, detail: `playtest (seed ${run.seed}): ${detail}`, run, baseline });
  if (run.threw) return base("crashed", "It crashed the game while you were playing.", `the sim threw: ${run.threw}`);
  if (!baseline.hadPlayer) return { ok: true, plain: "No player in the world yet, nothing to playtest.", detail: "", run, baseline };
  if (!run.hadPlayer) return base("no-player", "It would remove you from the world.", "the player entity no longer exists once this mod is loaded");
  if (run.diedAt >= 0 && run.diedAt < PLAYTEST.spawnDeathFrame && !(baseline.diedAt >= 0 && baseline.diedAt < PLAYTEST.spawnDeathFrame)) {
    return base("died", "You'd be knocked out the moment you spawn.", `the player died ${run.diedAt} frames after spawning`);
  }
  if (run.fell && !baseline.fell) return base("fell", "You'd fall out of the world.", `the player fell below y=${PLAYTEST.fallY}`);
  if (run.progress < baseline.progress * PLAYTEST.minProgress) {
    const bigger = run.startW > baseline.startW * PLAYTEST.bigRatio || run.startH > baseline.startH * PLAYTEST.bigRatio;
    const b = run.blocker;
    const what = b ? ` by the ${label(b.type)}` : "";
    const plain = bigger
      ? `You'd be too big to fit through the gap${what}, so you couldn't get any further.`
      : `You'd get stuck${what} and couldn't keep going.`;
    const where = b ? ` stuck against a "${b.type}" at x=${b.x},y=${b.y},w=${b.w},h=${b.h}` : " stuck";
    const room = b?.headroom != null && bigger ? `. The opening past it is only ${b.headroom}px tall: the player must stay under ${b.headroom}px tall (and keep moving at normal speed) to get through` : "";
    return base("stuck", plain,
      `the bot only got ${run.progress}px right (${baseline.progress}px without this mod),${where}. Player size ${baseline.startW}x${baseline.startH} -> ${run.startW}x${run.startH}${room}`);
  }
  return { ok: true, plain: "You can still play.", detail: "", run, baseline };
}
