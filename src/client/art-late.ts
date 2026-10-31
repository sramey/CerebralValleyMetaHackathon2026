// Late art (bead 8zu): the render loop starts as soon as Pixi is up, so the stage paints the
// code-drawn world while the AI sprite sheets are still in flight. A sheet that stalls used to
// hold the first frame back for its whole timeout, leaving a black stage behind a socket that
// was already connected and greeting.
//
// So the frame map starts *empty*: `framesFor()` finds nothing and every entity draws its shape
// fallback — the same path a failed sheet takes. Sheets merge into that same map object when
// they land, and the already-running loop swaps sprites in on the next frame.
//
// Plain record surgery: no Pixi, no DOM, so the merge rules are unit-tested.
import type { Texture } from "pixi.js";

export type Frames = Record<string, Texture[]>;

export interface LateArt {
  /** Live frame map, shared with the render loop. Filled in place, never replaced. */
  readonly frames: Frames;
  /** Resolves once every sheet has landed or given up. Never rejects. */
  readonly settled: Promise<Frames>;
}

/**
 * Load every sheet at once, in `map`'s key order. One stalled sheet must not delay the rest:
 * loaded in sequence, two 6 s timeouts meant the second subject waited 12 s.
 */
export async function loadAll<T>(
  map: Record<string, string>,
  load: (url: string, key: string) => Promise<T>,
): Promise<Record<string, T>> {
  const keys = Object.keys(map);
  const loaded = await Promise.all(keys.map((key) => load(map[key], key)));
  const out: Record<string, T> = {};
  for (let i = 0; i < keys.length; i++) out[keys[i]] = loaded[i];
  return out;
}

/**
 * Copy freshly loaded sheets into the live map. A key that already has frames wins: a mood
 * restyle or a mod's own art that landed while the boot sheets were still loading must not be
 * overwritten by the slower, older sheet. Returns the keys that actually gained frames.
 */
export function mergeFrames(target: Frames, loaded: Frames): string[] {
  const filled: string[] = [];
  for (const [key, frames] of Object.entries(loaded)) {
    const existing = target[key];
    if (existing !== undefined && existing.length > 0) continue;
    target[key] = frames;
    if (frames.length > 0) filled.push(key);
  }
  return filled;
}

/** Start the boot sheets behind the running loop: empty frames now, merged when they land. */
export function startLateArt(load: () => Promise<Frames>, target: Frames = {}): LateArt {
  const settled = load()
    .then((loaded) => {
      mergeFrames(target, loaded);
      return target;
    })
    .catch(() => target);
  return { frames: target, settled };
}
