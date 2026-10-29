// Verifier: dynamic-import a compiled mod, run 600 headless frames in a fresh
// World+ModLoader, fail on exception/NaN/entity overflow, run the mod's test().
// verifyMod never throws — bad mods return {ok:false, errors}.
// Isolation: in-process dynamic import of a cache-busted data: URL (see status
// note for why not a worker thread in spike v0).
import { SIM } from "../src/contract";
import type { ModDefinition, VerifyResult } from "../src/contract";
import { World } from "../src/sim/world";
import { ModLoader, runModTest } from "../src/sim/loader";

let importSeq = 0;

function hasNaN(world: World): boolean {
  for (const e of world.entities) {
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.vx) || !Number.isFinite(e.vy)) return true;
  }
  return false;
}

/** Load the compiled ESM js and extract its default export. Throws on failure. */
export async function importMod(compiledJs: string): Promise<ModDefinition> {
  const url = `data:text/javascript;base64,${Buffer.from(compiledJs, "utf8").toString("base64")}#m${Date.now()}_${importSeq++}`;
  const ns = (await import(url)) as { default?: unknown };
  const def = ns.default as ModDefinition;
  if (!def || typeof def !== "object") throw new Error("mod has no default export object");
  if (typeof def.id !== "string" || !def.id) throw new Error("mod.id must be a non-empty string");
  if (typeof def.title !== "string" || !def.title) throw new Error("mod.title must be a non-empty string");
  if (typeof def.setup !== "function") throw new Error("mod.setup must be a function");
  if (typeof def.dispose !== "function") throw new Error("mod.dispose must be a function");
  return def;
}

export interface VerifiedMod {
  def: ModDefinition;
  result: VerifyResult;
}

export async function verifyMod(source: string, compiledJs: string): Promise<VerifyResult & { def?: ModDefinition }> {
  const errors: string[] = [];
  const frames = SIM.healthFrames;
  let msPerFrame = 0;
  let entities = 0;
  try {
    const def = await importMod(compiledJs);
    const world = new World(1234);
    const loader = new ModLoader(world);
    try {
      loader.load(def);
    } catch (err) {
      return { ok: false, errors: [`setup threw: ${err instanceof Error ? err.message : String(err)}`], msPerFrame: 0, frames: 0, entities: 0 };
    }
    const t0 = performance.now();
    try {
      for (let i = 0; i < frames; i++) world.step();
    } catch (err) {
      errors.push(`exception during health run: ${err instanceof Error ? err.message : String(err)}`);
    }
    const totalMs = performance.now() - t0;
    msPerFrame = frames > 0 ? totalMs / frames : 0;
    entities = world.entities.length;
    if (hasNaN(world)) errors.push("NaN or non-finite entity position/velocity after health run");
    if (entities > SIM.maxEntities) errors.push(`entity count ${entities} exceeds max ${SIM.maxEntities}`);
    if (msPerFrame > SIM.msBudget) errors.push(`too slow: ${msPerFrame.toFixed(3)} ms/frame over budget ${SIM.msBudget}`);
    const testRes = runModTest(def);
    if (!testRes.ok) errors.push(...testRes.errors.map((e) => `test: ${e}`));
    try {
      loader.unload(def.id);
    } catch (err) {
      errors.push(`dispose threw: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (world.entities.some((e) => e.owner === def.id)) errors.push("dispose left entities behind");
    if (errors.length > 0) return { ok: false, errors, msPerFrame, frames, entities, def };
    return { ok: true, errors: [], msPerFrame, frames, entities, def };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    void source;
    return { ok: false, errors, msPerFrame, frames, entities };
  }
}
