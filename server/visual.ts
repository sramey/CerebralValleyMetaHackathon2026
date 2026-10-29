// Visual kind of a thing the player asks for (ADR 0015). Spark decides it inside the router call it
// already makes (zero extra latency); these word lists are only the safety net for a router miss.
import type { Look, ShapeName } from "../src/contract";

export type Visual = "shape" | "effect" | "prop" | "creature";

export const VISUALS: readonly Visual[] = ["shape", "effect", "prop", "creature"];
export const SHAPES: readonly ShapeName[] = ["circle", "ring", "triangle", "spikes", "pill", "diamond", "star", "block"];

export function parseVisual(v: unknown): Visual | undefined {
  return typeof v === "string" && (VISUALS as readonly string[]).includes(v) ? (v as Visual) : undefined;
}
export function parseShape(v: unknown): ShapeName | undefined {
  return typeof v === "string" && (SHAPES as readonly string[]).includes(v) ? (v as ShapeName) : undefined;
}

const SHAPE_WORDS: [ShapeName, RegExp][] = [
  ["ring", /\b(ring|halo|hoop|donut)s?\b/],
  ["spikes", /\b(spike|spikes|spiky|thorn)s?\b/],
  ["triangle", /\b(triangle|cone|wedge)s?\b/],
  ["diamond", /\b(diamond|gem|rhombus)s?\b/],
  ["star", /\bstars?\b/],
  ["pill", /\b(pill|capsule|beam|laser|bar)s?\b/],
  ["circle", /\b(ball|balls|orb|orbs|bubble|bubbles|sphere|spheres|circle|circles|disc|disk|bomb|bombs|marble|pearl)\b/],
];
const EFFECT_WORDS = /\b(rain|fog|mist|haze|smoke|snow|blizzard|explosion|explosions|spark|sparks|ember|embers|lightning|glow|fireflies)\b/;

/** Safety net when Spark returned no visual kind: obvious primitives and weather only. */
export function fallbackVisual(text: string): { visual: Visual; shape?: ShapeName } | undefined {
  const lower = text.toLowerCase();
  if (EFFECT_WORDS.test(lower)) return { visual: "effect" };
  for (const [shape, re] of SHAPE_WORDS) if (re.test(lower)) return { visual: "shape", shape };
  return undefined;
}

export function lookFor(visual: Visual | undefined, shape: ShapeName | undefined, types: string[]): Look | undefined {
  if (visual === "shape") return { visual, shape: shape ?? "circle", types };
  if (visual === "effect") return { visual, types };
  return undefined;
}
