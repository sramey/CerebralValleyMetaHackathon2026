// "Can you still play?" playtest (ADR 0013). Runs the scripted bot in a copy of
// the player's current world with and without the new mod, over a few seeds,
// and judges the difference. Headless, deterministic, a few ms per run.
import { SIM } from "../src/contract";
import type { KnobValues, ModDefinition } from "../src/contract";
import { World } from "../src/sim/world";
import { ModLoader } from "../src/sim/loader";
import { judge, PLAYTEST, runBot } from "../src/sim/playtest";
import type { PlaytestVerdict } from "../src/sim/playtest";
import { importMod } from "./verify";

/** One mod of the player's current world, in load order. */
export interface WorldMod { id: string; compiled: string; values?: KnobValues }

export interface PlaytestOutcome {
  ok: boolean;
  /** One line for the player. */
  plain: string;
  /** Technical detail for Wonder (empty when ok). */
  detail: string;
  /** The run the ghost should replay: the failing one, else the first. */
  seed: number;
  frames: number;
  inputs: number[];
  ms: number;
  msPerFrame: number;
  skipped: boolean;
}

const defCache = new Map<string, ModDefinition>();

async function defOf(compiled: string): Promise<ModDefinition> {
  let def = defCache.get(compiled);
  if (!def) {
    def = await importMod(compiled);
    if (defCache.size > 200) defCache.clear();
    defCache.set(compiled, def);
  }
  return def;
}

interface Entry { def: ModDefinition; values: KnobValues }

function buildWorld(seed: number, entries: Entry[]): World {
  const world = new World(seed);
  const loader = new ModLoader(world);
  for (const e of entries) loader.load(e.def, e.values);
  return world;
}

/** The mods that make up the world the player sees now, plus (or replacing) the candidate. */
export async function playtestMod(worldMods: WorldMod[], candidate: { def: ModDefinition; values?: KnobValues }): Promise<PlaytestOutcome> {
  const t0 = performance.now();
  const base: Entry[] = [];
  for (const m of worldMods) {
    try { base.push({ def: await defOf(m.compiled), values: m.values ?? {} }); } catch { /* a broken installed mod is not the candidate's fault */ }
  }
  const idx = base.findIndex((e) => e.def.id === candidate.def.id);
  const withCand: Entry[] = base.slice();
  const cand: Entry = { def: candidate.def, values: candidate.values ?? (idx >= 0 ? base[idx].values : {}) };
  if (idx >= 0) withCand[idx] = cand; else withCand.push(cand);

  let shown: PlaytestVerdict | null = null;
  let simMs = 0;
  let simFrames = 0;
  for (const seed of PLAYTEST.seeds) {
    let verdict: PlaytestVerdict;
    try {
      const baseline = runBot(buildWorld(seed, base), seed);
      const w = buildWorld(seed, withCand);
      const s0 = performance.now();
      const run = runBot(w, seed);
      simMs += performance.now() - s0;
      simFrames += run.frames;
      verdict = judge(baseline, run);
    } catch (err) {
      const run = runBot(new World(seed), seed);
      verdict = { ok: false, failure: "crashed", plain: "It crashed the game while loading.", detail: `playtest (seed ${seed}): mod setup threw: ${err instanceof Error ? err.message : String(err)}`, run, baseline: run };
    }
    if (!shown || (shown.ok && !verdict.ok)) shown = verdict;
    if (!verdict.ok) break;
  }
  const v = shown!;
  const msPerFrame = simFrames > 0 ? simMs / simFrames : 0;
  let { ok, plain, detail } = v;
  if (ok && msPerFrame > SIM.msBudget) {
    ok = false;
    plain = "It slows the game down too much.";
    detail = `playtest: ${msPerFrame.toFixed(2)} ms/frame with the full world loaded, over budget ${SIM.msBudget}`;
  }
  return {
    ok, plain, detail, seed: v.run.seed, frames: v.run.frames, inputs: v.run.inputs,
    ms: Math.round(performance.now() - t0), msPerFrame, skipped: ok && !v.baseline.hadPlayer,
  };
}
