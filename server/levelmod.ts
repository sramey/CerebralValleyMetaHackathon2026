// Level requests without a model (ADR 0074): "make a harder level", "extend the level" turn into the engine's
// api.buildLevel generator. The mod source is a tiny template; the knobs (difficulty, length, seed) are what the
// player and the router tweak afterwards, so "make it harder" later is a knob change, not a rewrite.
import type { KnobDefs, KnobValue } from "../src/contract";
import type { LevelIntent } from "../src/ontology";

export const LEVEL_MOD_ID = "level";
export const LEVEL_LIMITS = { difficulty: { min: 1, max: 5 }, length: { min: 1200, max: 16000 }, seed: { min: 1, max: 9999 } } as const;
/** A first level is long enough to be a journey and short enough to build in a blink. */
export const FIRST_LEVEL = { difficulty: 3, length: 4800 } as const;
const LENGTH_STEP = 2400;

export interface LevelParams { difficulty: number; length: number; seed: number }

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(v)));

/** The params a level request lands on, given the level already in the world (if any). `roll` picks a new seed. */
export function levelParamsFor(intent: LevelIntent, current: Partial<LevelParams> | undefined, roll: () => number): LevelParams {
  const L = LEVEL_LIMITS;
  const seed = intent.fresh || !current?.seed ? clamp(1 + roll() * (L.seed.max - 1), L.seed.min, L.seed.max) : current.seed;
  // Asking for a level while one exists starts from its settings, so "a harder level" is harder than this one.
  let difficulty = current?.difficulty ?? FIRST_LEVEL.difficulty;
  let length = current?.length ?? FIRST_LEVEL.length;
  if (typeof intent.difficulty === "number") difficulty = intent.difficulty;
  else if (intent.difficulty === "up") difficulty += 1; // a first "harder level" lands on 4
  else if (intent.difficulty === "down") difficulty -= 1;
  if (intent.length === "up") length += LENGTH_STEP;
  else if (intent.length === "down") length -= LENGTH_STEP;
  return { difficulty: clamp(difficulty, L.difficulty.min, L.difficulty.max), length: clamp(length, L.length.min, L.length.max), seed };
}

/** Knob values by name, for the mod already in the manifest. */
export function currentLevelParams(knobs: KnobDefs | undefined): Partial<LevelParams> | undefined {
  if (!knobs) return undefined;
  const n = (k: string): number | undefined => { const v = knobs[k]?.value as KnobValue | undefined; return typeof v === "number" ? v : undefined; };
  return { difficulty: n("difficulty"), length: n("length"), seed: n("seed") };
}

/** Describe what was built in the voice of the game. */
export function levelSay(p: LevelParams, stats: { gaps: number; hazards: number; enemies: number; platforms: number }, mode: "built" | "changed"): string {
  const feel = ["a gentle", "an easy", "a medium", "a tough", "a brutal"][p.difficulty - 1];
  const metres = Math.round(p.length / 100);
  const bits = [`${stats.gaps} pits to jump`, `${stats.platforms} ledges and blocks at different heights`, `${stats.hazards} hazards`, `${stats.enemies} enemies`];
  return `${mode === "built" ? "Built" : "Rebuilt"} ${feel} level, about ${metres} screens of running to the flag: ${bits.join(", ")}. Say "make it harder", "extend the level" or "make a new level" to change it.`;
}

/** The mod. Plain source so it is saved, shared, exported and shown in the receipt like any other mod. */
export function levelModSource(p: LevelParams): string {
  const L = LEVEL_LIMITS;
  return `// A generated level (ADR 0074): the engine's level generator builds the layout from these three knobs.
let level: { dispose(): void } | undefined;
export default {
  id: "${LEVEL_MOD_ID}",
  title: "Level",
  knobs: {
    difficulty: { value: ${p.difficulty}, min: ${L.difficulty.min}, max: ${L.difficulty.max}, label: "Difficulty" },
    length: { value: ${p.length}, min: ${L.length.min}, max: ${L.length.max}, label: "Level length" },
    seed: { value: ${p.seed}, min: ${L.seed.min}, max: ${L.seed.max}, label: "Layout (change for a new level)" },
  },
  setup(api, knobs) {
    level = api.buildLevel({ seed: Number(knobs.seed), difficulty: Number(knobs.difficulty), length: Number(knobs.length) });
  },
  dispose(api) {
    if (level) level.dispose();
    level = undefined;
  },
  test(t) {
    t.expect(t.api.byType("ground").length >= 3, "the floor has several sections");
    t.expect(t.api.byType("finish-flag").length === 1, "there is one goal flag");
    t.expect(t.api.byType("platform").length >= 2, "there are platforms at other heights");
    t.step(120);
    t.expect(t.api.entities().every((e) => Number.isFinite(e.x + e.y)), "positions stay finite");
  },
};
`;
}
